"""Instagram 公开端点客户端（纯标准库，零第三方依赖）。

仅使用公开网页端点与公开头部，不做任何鉴权绕过：
- 单帖元数据：/api/v1/media/{id}/info/（未登录可用），失败回退公开 embed 页。
- embed 页的 contextJSON：Instagram 官方为嵌入场景公开提供的 GraphQL 数据
  （含 edge_sidecar_to_children 完整 Carousel 结构），用社交爬虫 UA 获取。
- 用户资料：/api/v1/users/web_profile_info/ + 公开页面回退。
- 主页媒体：/api/v1/feed/user/{id}/（未登录常受限 -> E_IG_LOGIN_REQUIRED）。
- Stories：需要用户自己的会话 Cookie（设置页提供，safeStorage 加密仅存本地）。
"""

import gzip
import html as html_mod
import http.client
import json
import random
import re
import time
import urllib.error
import urllib.parse
import urllib.request

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
# Instagram 为社交平台抓取（oEmbed/嵌入）公开提供的 UA：
# 使用它时 IG 返回含 contextJSON 的完整页面（公开元数据，无需登录，不绕过任何权限）。
CRAWLER_UA = "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"
# Instagram 官方网页端公开的 App ID（任何浏览器访问 instagram.com 都会携带，
# 非逆向所得、非私有接口凭据）。
X_IG_APP_ID = "936619743392459"
# 请求间隔节流（秒）：既是礼貌抓取的下限，也是账号安全的必要条件。
# 请勿调小或绕过 —— 高频访问会触发 IG 风控，且违背本项目的使用意图
# （个人归档工具，不是批量采集器）。
MIN_INTERVAL = 1.5
TIMEOUT = 20

_HTTP_ERRORS = {
    404: "E_IG_NOT_FOUND",
    410: "E_IG_NOT_FOUND",
    429: "E_IG_RATE_LIMIT",
    401: "E_IG_LOGIN_REQUIRED",
    403: "E_IG_LOGIN_REQUIRED",
}


class WorkerError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


class IgClient:
    def __init__(self) -> None:
        self.session_cookie: str = ""
        self._last_request = 0.0

    # ------------------------------------------------------------------ http
    def _headers(self, extra: dict | None = None, with_session: bool = False) -> dict:
        """构造请求头。

        with_session 语义（无登录优先原则，最高优先级约束）：
        - 默认 **False**：请求绝不携带用户会话 Cookie。IG 会把自动化特征
          关联到登录账号，公开内容用匿名身份获取即可完成，不带 Cookie
          意味着用户的账号完全不暴露在请求路径上。
        - True：仅在端点**确实需要账号**时使用（Stories、私密内容等），
          由调用方显式声明并自担说明义务。
        """
        h = {
            "User-Agent": USER_AGENT,
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.9",
            "x-ig-app-id": X_IG_APP_ID,
            "x-requested-with": "XMLHttpRequest",
            "Accept-Encoding": "gzip",
        }
        if with_session and self.session_cookie:
            h["Cookie"] = self.session_cookie
        if extra:
            h.update(extra)
        return h

    def _throttle(self) -> None:
        wait = MIN_INTERVAL + random.uniform(0, 0.6) - (time.time() - self._last_request)
        if wait > 0:
            time.sleep(wait)
        self._last_request = time.time()

    def http_get(
        self,
        url: str,
        extra_headers: dict | None = None,
        retries: int = 2,
        with_session: bool = False,
    ) -> tuple[int, bytes]:
        last_code, last_body = 0, b""
        for attempt in range(retries + 1):
            self._throttle()
            req = urllib.request.Request(
                url, headers=self._headers(extra_headers, with_session=with_session), method="GET"
            )
            try:
                with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                    body = resp.read()
                    if resp.headers.get("Content-Encoding", "").lower() == "gzip":
                        body = gzip.decompress(body)
                    return resp.status, body
            except urllib.error.HTTPError as e:
                last_code = e.code
                last_body = e.read()[:2000]
                if e.code in (429, 500, 502, 503, 504) and attempt < retries:
                    time.sleep(2 ** attempt + random.uniform(0, 1))
                    continue
                break
            except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException, gzip.BadGzipFile) as e:
                # 含 IncompleteRead / RemoteDisconnected / BadStatusLine 等：
                # Instagram 在高频或反爬时经常截断连接，重试通常可恢复
                last_code = 0
                last_body = f"{type(e).__name__}: {e}".encode()[:2000]
                if attempt < retries:
                    time.sleep(1 + attempt + random.uniform(0, 0.8))
                    continue
                break
        if last_code in _HTTP_ERRORS:
            raise WorkerError(_HTTP_ERRORS[last_code], f"HTTP {last_code}")
        if last_code == 0:
            raise WorkerError("E_NETWORK", f"network error: {last_body[:120]!r}")
        return last_code, last_body

    def get_json(self, url: str, extra_headers: dict | None = None, with_session: bool = False) -> dict:
        _, body = self.http_get(url, extra_headers, with_session=with_session)
        if _looks_like_html(body):
            # Instagram 对未登录请求返回 JS 壳页（登录墙）
            raise WorkerError("E_IG_LOGIN_REQUIRED", "Instagram login wall detected")
        try:
            return json.loads(body.decode("utf-8", "replace"))
        except json.JSONDecodeError:
            raise WorkerError("E_PARSE_FAILED", "invalid JSON from Instagram")

    def get_html_as_crawler(self, url: str) -> str:
        """以社交爬虫 UA 获取页面：IG 会返回含 contextJSON 的完整公开元数据。

        爬虫 UA 与匿名身份是这对组合的要点：facebookexternalhit 是 IG 官方
        为嵌入场景开放的抓取身份，**绝不能掺入用户会话**——掺入等于把
        用户账号主动暴露给自动化审查。
        """
        _, body = self.http_get(
            url,
            extra_headers={
                "User-Agent": CRAWLER_UA,
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "en-US,en;q=0.9",
            },
            with_session=False,
        )
        return body.decode("utf-8", "replace")

    # ------------------------------------------------------------------ api
    def set_session(self, cookie: str | None) -> None:
        self.session_cookie = (cookie or "").strip()

    def media_info(self, media_id: int) -> dict:
        url = f"https://www.instagram.com/api/v1/media/{media_id}/info/"
        # 该端点对匿名请求也可能给出公开数据；先匿名，被拒再考虑会话
        try:
            data = self.get_json(url)
        except WorkerError as e:
            if e.code == "E_IG_LOGIN_REQUIRED" and self.session_cookie:
                data = self.get_json(url, with_session=True)
            else:
                raise
        items = data.get("items") or []
        if not items:
            raise WorkerError("E_PARSE_FAILED", "empty media info")
        return items[0]

    def post_embed_media(self, shortcode: str) -> dict:
        """通过公开 embed 页的 contextJSON 获取完整帖子媒体（含 Carousel 全部子项）。

        注意：老帖子的 contextJSON 可能为 null（IG 只为较新帖子提供），
        此时抛 E_PARSE_FAILED 让上层走 og:meta 回退，而非误报登录墙。
        返回统一结构：{username, full_name, avatar, caption, items:[MediaItem]}
        """
        text = self.get_html_as_crawler(f"https://www.instagram.com/p/{shortcode}/embed/captioned/")
        ctx = _extract_context_json(text)
        if not ctx:
            # 区分「contextJSON 为 null（老帖，走 og 回退）」与「整页登录墙」
            raise WorkerError("E_PARSE_FAILED", "no contextJSON in embed page")
        media = (ctx.get("gql_data") or {}).get("shortcode_media")
        if not media:
            raise WorkerError("E_PARSE_FAILED", "no shortcode_media in embed data")

        owner = media.get("owner") or {}
        children = ((media.get("edge_sidecar_to_children") or {}).get("edges")) or []
        nodes = [e.get("node") or {} for e in children] if children else [media]

        items = []
        for n in nodes:
            item = _media_node_to_item(n)
            if item:
                items.append(item)
        if not items:
            raise WorkerError("E_PARSE_FAILED", "no downloadable media in embed data")

        cap_edges = ((media.get("edge_media_to_caption") or {}).get("edges")) or []
        caption = ""
        if cap_edges:
            caption = ((cap_edges[0].get("node") or {}).get("text")) or ""

        return {
            "username": owner.get("username", ""),
            "full_name": owner.get("full_name", ""),
            "avatar": owner.get("profile_pic_url", ""),
            "caption": caption,
            "items": items,
        }

    def post_page_fallback(self, shortcode: str) -> dict:
        """公开页面回退解析（按可靠性排序，均无需登录）：
        1) embed 页 contextJSON（可拿到 Carousel 全部子项）
        2) oembed 端点
        3) 帖子页 og:meta
        """
        # 1) embed contextJSON —— 首选，唯一能拿到完整 Carousel 的公开路径
        last: WorkerError | None = None
        try:
            data = self.post_embed_media(shortcode)
            return data
        except WorkerError as e:
            if e.code not in ("E_PARSE_FAILED", "E_NETWORK", "E_IG_RATE_LIMIT"):
                raise
            last = e

        # 2) oembed
        try:
            _, body = self.http_get(
                f"https://www.instagram.com/api/v1/oembed/?url=https://www.instagram.com/p/{shortcode}/",
                extra_headers={"Accept": "application/json"},
            )
            if not _looks_like_html(body):
                d = json.loads(body.decode("utf-8", "replace"))
                thumb = d.get("thumbnail_url", "")
                if thumb:
                    return {
                        "username": d.get("author_name", ""),
                        "full_name": "",
                        "avatar": "",
                        "caption": d.get("title", ""),
                        "items": [
                            {
                                "id": f"oembed-{shortcode}",
                                "type": "image",
                                "url": thumb,
                                "thumb_url": thumb,
                                "width": None,
                                "height": None,
                                "duration": None,
                                "taken_at": None,
                            }
                        ],
                    }
        except (WorkerError, json.JSONDecodeError, KeyError):
            pass

        # 2.5) embed 页面 HTML 直接扫描：Carousel 多图帖即使 contextJSON 为 null
        #     （老帖），embed 页仍会把每个子项渲染为 EmbeddedMediaImage。
        #     这是多图回退的关键一步 —— 只有 og:meta 时永远只有第一张。
        for page_url in (
            f"https://www.instagram.com/p/{shortcode}/embed/captioned/",
            f"https://www.instagram.com/p/{shortcode}/embed/",
        ):
            try:
                text = self.get_html_as_crawler(page_url)
            except WorkerError:
                continue
            emb = _extract_embed_media(text)
            if emb:
                items = []
                for i, u in enumerate(emb["image_urls"]):
                    items.append(
                        {
                            "id": f"embed-{shortcode}-{i}",
                            "type": "image",
                            "url": u,
                            "thumb_url": u,
                            "width": None,
                            "height": None,
                            "duration": None,
                            "taken_at": None,
                        }
                    )
                for i, u in enumerate(emb["video_urls"]):
                    items.append(
                        {
                            "id": f"embed-{shortcode}-v{i}",
                            "type": "video",
                            "url": u,
                            "thumb_url": emb["image_urls"][0] if emb["image_urls"] else u,
                            "width": None,
                            "height": None,
                            "duration": None,
                            "taken_at": None,
                        }
                    )
                if items:
                    return {
                        "username": emb["username"],
                        "full_name": "",
                        "avatar": "",
                        "caption": "",
                        "items": items,
                    }

        # 3) og:meta 回退（爬虫 UA 的帖子页对老帖有效）
        for page_url in (
            f"https://www.instagram.com/p/{shortcode}/",
            f"https://www.instagram.com/p/{shortcode}/embed/captioned/",
        ):
            try:
                text = self.get_html_as_crawler(page_url)
            except WorkerError:
                continue
            og = _extract_og_media(text)
            if og:
                url = og["video_urls"][0] if og["video_urls"] else og["image_urls"][0]
                thumb = og["image_urls"][0] if og["image_urls"] else url
                return {
                    "username": og["username"],
                    "full_name": "",
                    "avatar": "",
                    "caption": "",
                    "items": [
                        {
                            "id": f"og-{shortcode}",
                            "type": "video" if og["video_urls"] else "image",
                            "url": url,
                            "thumb_url": thumb,
                            "width": None,
                            "height": None,
                            "duration": None,
                            "taken_at": None,
                        }
                    ],
                }

        raise last or WorkerError(
            "E_IG_LOGIN_REQUIRED", "page metadata unavailable (login wall)"
        )

    def web_profile(self, username: str) -> dict:
        """用户信息：API 端点（先匿名，被拒才考虑会话）→ 页面解析回退。"""
        q = urllib.parse.urlencode({"username": username})
        api_url = f"https://www.instagram.com/api/v1/users/web_profile_info/?{q}"
        # 第一优先：匿名请求。公开账号的资料本就无需登录。
        try:
            data = self.get_json(api_url)
            user = data.get("data", {}).get("user")
            if user:
                return user
        except WorkerError as e:
            if e.code not in ("E_NETWORK", "E_PARSE_FAILED", "E_IG_RATE_LIMIT", "E_IG_LOGIN_REQUIRED"):
                raise
            # 匿名被拒且已有会话：最后手段才动用账号（减少账号暴露面）
            if e.code == "E_IG_LOGIN_REQUIRED" and self.session_cookie:
                try:
                    data = self.get_json(api_url, with_session=True)
                    user = data.get("data", {}).get("user")
                    if user:
                        return user
                except WorkerError:
                    pass
        # 页面解析回退（始终匿名）
        return self._web_profile_page(username)

    def _web_profile_page(self, username: str) -> dict:
        """从用户主页页面解析公开信息（无需登录，用爬虫 UA 拿公开元数据）。"""
        try:
            text = self.get_html_as_crawler(f"https://www.instagram.com/{username}/")
        except WorkerError:
            _, body = self.http_get(f"https://www.instagram.com/{username}/")
            text = body.decode("utf-8", "replace")
        og_image = _og_meta(text, "og:image")
        og_title = _og_meta(text, "og:title") or ""
        og_desc = _og_meta(text, "og:description") or ""

        # 1) 内嵌 JSON（新页面结构）
        #    两个坑：
        #    a) 字符串是 JSON 转义的（中文写成 \u674e…），正则截取后必须反转义；
        #    b) **带会话时页面里先出现登录者本人**的 full_name/头像，直接取
        #       第一个匹配会拿到自己的资料（曾把 natgeo 显示成登录者姓名）。
        #       因此把提取范围锚定到目标用户名的 JSON 片段内。
        profile_text = _profile_json_window(text, username)
        uid_match = re.search(r'"user_id":"(\d+)"', profile_text) or re.search(
            r'"profile_id":"(\d+)"', profile_text
        ) or re.search(r'"id":"(\d+)"', profile_text)
        full_match = re.search(r'"full_name":"([^"]*)"', profile_text)
        followers_match = re.search(r'"follower_count":(\d+)', profile_text) or re.search(
            r'"edge_followed_by":\{"count":(\d+)\}', profile_text
        )
        posts_match = re.search(r'"media_count":(\d+)', profile_text) or re.search(
            r'"edge_owner_to_timeline_media":\{"count":(\d+)\}', profile_text
        )
        private_match = re.search(r'"is_private":(true|false)', profile_text)
        verified_match = re.search(r'"is_verified":(true|false)', profile_text)
        avatar_match = re.search(r'"profile_pic_url_hd":"([^"]+)"', profile_text) or re.search(
            r'"profile_pic_url":"([^"]+)"', profile_text
        )

        # 2) og:description 回退（形如 "268M Followers, 195 Following, 32K Posts - ... (@natgeo)"）
        followers = int(followers_match.group(1)) if followers_match else _parse_count(og_desc, "Followers")
        posts = int(posts_match.group(1)) if posts_match else _parse_count(og_desc, "Posts")
        full_name = _unescape_json_string(full_match.group(1)) if full_match else ""
        if not full_name:
            m = re.search(r"-\s*See Instagram photos and videos from (.+?)\s*\(", og_desc)
            if m:
                full_name = _unescape_json_string(m.group(1).strip())
        username_match = re.search(r"\(@([\w.]+)\)", og_desc)

        user = {
            "id": uid_match.group(1) if uid_match else "",
            "username": username_match.group(1) if username_match else username,
            "full_name": full_name,
            "profile_pic_url_hd": (
                _unescape_json_string(avatar_match.group(1)) if avatar_match else og_image or ""
            ),
            "follower_count": followers,
            "media_count": posts,
            "is_private": private_match.group(1) == "true" if private_match else False,
            "is_verified": verified_match.group(1) == "true" if verified_match else False,
        }
        # 只要拿到任一有效公开信息即视为成功（og:image / og:description 均来自公开页面）
        if not (user["id"] or user["full_name"] or user["profile_pic_url_hd"] or followers or posts):
            raise WorkerError("E_IG_NOT_FOUND", f"user {username} not found")
        return user

    def user_feed(self, user_id: str, max_id: str | None = None, count: int = 12) -> dict:
        params: dict = {"count": str(count)}
        if max_id:
            params["max_id"] = max_id
        q = urllib.parse.urlencode(params)
        url = f"https://www.instagram.com/api/v1/feed/user/{user_id}/?{q}"
        # 该端点已对网页端关闭（返回 HTML 壳），常规路径由主进程的 DOM 回退
        # 接管；这里保持匿名优先，仅当匿名被明确要求登录时才动用会话。
        try:
            data = self.get_json(url)
        except WorkerError as e:
            if e.code == "E_IG_LOGIN_REQUIRED" and self.session_cookie:
                data = self.get_json(url, with_session=True)
            else:
                raise
        return {
            "items": data.get("items") or [],
            "next_max_id": data.get("next_max_id"),
        }

    def story(self, user_id: str) -> dict:
        # Stories 只能经由登录账号查看（IG 官方机制），是少数**必须**用会话
        # 的端点 —— with_session=True 是显式声明的必要暴露。
        if not self.session_cookie:
            raise WorkerError("E_IG_LOGIN_REQUIRED", "stories require a session cookie")
        data = self.get_json(
            f"https://www.instagram.com/api/v1/feed/user/{user_id}/story/",
            with_session=True,
        )
        reels = data.get("reels") or {}
        items: list = []
        for reel in reels.values():
            items.extend(reel.get("items") or [])
        return {"items": items}



def _profile_json_window(text: str, username: str) -> str:
    """把页面源码裁剪到目标用户的 JSON 片段，避免取到登录者本人的字段。

    带会话访问主页时，页面内联 JSON 里**先出现的是当前登录者**的
    full_name / profile_pic_url_hd，直接对全文做正则会拿到自己的资料
    （曾把 natgeo 显示成登录者姓名）。这里以 `"username":"<目标>"` 为锚点，
    优先取其**之后**的窗口作为提取范围（目标用户字段紧随其 username 出现），
    前向找不到时再退回全文，保证未登录路径行为不变。
    """
    if not username:
        return text
    idx = text.find(f'"username":"{username}"')
    if idx < 0:
        return text
    # 取锚点后 6000 字符：目标用户节点的字段通常紧随其后
    return text[idx : min(len(text), idx + 6000)]


def _unescape_json_string(value: str) -> str:
    """把内联 JSON 里截取到的字符串反转义。

    页面源码里的字符串是 JSON 编码的（中文写成 \\u674e，引号写成 \\"），
    正则直接截取会得到字面量反斜杠序列，必须反转义后再交给 UI。
    优先用 json.loads（最准确），失败时退回逐个 \\uXXXX 解码。
    """
    if not value or "\\" not in value:
        return value
    try:
        return json.loads(f'"{value}"')
    except (json.JSONDecodeError, ValueError):
        # 截断的片段（如含未转义引号）用 unicode_escape 兜底
        try:
            return value.encode("latin-1", "backslashreplace").decode("unicode_escape")
        except (UnicodeDecodeError, UnicodeEncodeError):
            return value


def _parse_count(text: str, label: str) -> int:
    """从 og:description 解析 "268M Followers" / "32K Posts" 形式的计数。"""
    m = re.search(rf"([\d.,]+)\s*([KMB]?)\s+{label}", text, re.I)
    if not m:
        return 0
    num = m.group(1).replace(",", "")
    try:
        val = float(num)
    except ValueError:
        return 0
    mult = {"": 1, "K": 1_000, "M": 1_000_000, "B": 1_000_000_000}.get(m.group(2).upper(), 1)
    return int(val * mult)


def _looks_like_html(body: bytes) -> bool:
    head = body[:512].lstrip().lower()
    return head.startswith(b"<!doctype html") or head.startswith(b"<html")


def _extract_context_json(text: str) -> dict | None:
    """从 embed 页提取 contextJSON（IG 官方公开嵌入数据，含完整 Carousel）。

    结构为 `"contextJSON":"<double-escaped JSON>"`；用括号匹配定位并逐层反转义。
    """
    marker = '"contextJSON":"'
    start = text.find(marker)
    if start < 0:
        return None
    i = start + len(marker)
    # 扫描到该 JSON 字符串的结尾（处理 \\" 与 \\\\ 转义）
    out = []
    escaped = False
    while i < len(text):
        ch = text[i]
        if escaped:
            out.append(ch)
            escaped = False
        elif ch == "\\":
            out.append(ch)
            escaped = True
        elif ch == '"':
            break
        else:
            out.append(ch)
        i += 1
    raw = "".join(out)
    # 反转义：页面里是 \\" / \\\\ 形式，json.loads 一次即可解出
    for _ in range(3):
        try:
            data = json.loads(f'"{raw}"')
            parsed = json.loads(data)
            if isinstance(parsed, dict):
                return parsed
            raw = data
        except json.JSONDecodeError:
            # 再尝试直接解析（部分页面为单层转义）
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, dict):
                    return parsed
            except json.JSONDecodeError:
                pass
            raw = raw.replace('\\"', '"').replace("\\\\", "\\")
    return None


def _candidate_url(c: dict) -> str:
    """候选资源可能是 {url}（video_versions/video_resources）或 {src}（display_resources）。"""
    return c.get("url") or c.get("src") or ""


def _best_from_candidates(candidates: list, prefer: str = "width") -> dict | None:
    valid = [
        c
        for c in (candidates or [])
        if isinstance(c, dict) and _candidate_url(c)
    ]
    if not valid:
        return None
    return max(valid, key=lambda c: c.get(prefer) or c.get("config_width") or 0)


def _media_node_to_item(node: dict) -> dict | None:
    """把 contextJSON 的媒体节点归一化为 MediaItem（取最高可用质量）。

    真实字段（IG embed contextJSON）：
      图片: display_url + dimensions{width,height}
      视频: video_url + display_url(缩略图) + dimensions + video_duration
    """
    if not node:
        return None
    is_video = bool(node.get("is_video"))
    url = thumb = ""
    width = height = 0
    duration = node.get("video_duration")
    dims = node.get("dimensions") or {}

    if is_video:
        # 优先 video_url（embed 数据里的直链），回退 video_resources/video_versions
        url = node.get("video_url") or ""
        if not url:
            best = _best_from_candidates(node.get("video_resources") or node.get("video_versions") or [])
            if best:
                url = _candidate_url(best)
                width = int(best.get("width") or best.get("config_width") or 0)
                height = int(best.get("height") or best.get("config_height") or 0)
        thumb = node.get("display_url") or ""
        if not width:
            width = int(dims.get("width") or 0)
            height = int(dims.get("height") or 0)
        if not url:
            url = thumb
    else:
        url = node.get("display_url") or ""
        thumb = url
        # 优先 display_resources 里的最高分辨率
        best = _best_from_candidates(node.get("display_resources") or [])
        if best and _candidate_url(best):
            url = _candidate_url(best)
            width = int(best.get("config_width") or best.get("width") or 0)
            height = int(best.get("config_height") or best.get("height") or 0)
        if not width:
            width = int(dims.get("width") or 0)
            height = int(dims.get("height") or 0)

    if not url:
        return None
    nid = str(node.get("id") or node.get("shortcode") or "")
    return {
        "id": nid or f"embed-{abs(hash(url)) % 10**10}",
        "type": "video" if is_video else "image",
        "url": url,
        "thumb_url": thumb or url,
        "width": width or None,
        "height": height or None,
        "duration": round(float(duration), 2) if duration else None,
        "taken_at": int(node.get("taken_at_timestamp") or 0) or None,
    }


def _extract_og_media(text: str) -> dict | None:
    og_video = _og_meta(text, "og:video") or _og_meta(text, "og:video:secure_url")
    og_image = _og_meta(text, "og:image") or _og_meta(text, "og:image:secure_url")
    og_title = _og_meta(text, "og:title") or ""
    if not og_video and not og_image:
        return None
    username = ""
    m = re.search(r"@([\w.]+)", og_title)
    if m:
        username = m.group(1).lower()
    video_urls = _json_strings(text, "video_url")
    image_urls = _json_strings(text, "display_url") or ([og_image] if og_image else [])
    if og_video:
        video_urls = [og_video] + video_urls
    return {"username": username, "video_urls": video_urls, "image_urls": image_urls}


def _extract_embed_media(text: str) -> dict | None:
    """embed/captioned 页：EmbeddedMediaImage / <video> 标签。

    注意必须用 findall 而非 search：Carousel 多图帖在 embed 页里每个子项
    渲染为一个 EmbeddedMediaImage，search 只会拿到第一张（曾导致
    "3 图帖子解析出来只有第一张"）。
    """
    image_urls: list[str] = []
    seen: set[str] = set()
    for m in re.finditer(r'class="EmbeddedMediaImage"[^>]*src="([^"]+)"', text):
        url = html_mod.unescape(m.group(1))
        if url.startswith("http") and url not in seen:
            seen.add(url)
            image_urls.append(url)
    if not image_urls:
        # 属性顺序可能颠倒（src 在 class 之前），再扫一遍
        for m in re.finditer(r'<img[^>]+src="([^"]+)"[^>]*class="[^"]*EmbeddedMediaImage', text):
            url = html_mod.unescape(m.group(1))
            if url.startswith("http") and url not in seen:
                seen.add(url)
                image_urls.append(url)
    video_urls = _json_strings(text, "video_url") or [
        html_mod.unescape(x) for x in re.findall(r"<video[^>]+src=\"([^\"]+)\"", text)
    ]
    username = ""
    m = (
        re.search(r'"username":"([\w.]+)"', text)
        or re.search(r"username=([\w.]+)", text)
        or re.search(r'href="/([\w.]+)/"', text)
    )
    if m:
        username = m.group(1).lower()
    if not image_urls and not video_urls:
        return None
    return {"username": username, "video_urls": video_urls, "image_urls": image_urls}


def _og_meta(text: str, prop: str) -> str | None:
    m = re.search(
        rf'<meta[^>]+(?:property|name)="{re.escape(prop)}"[^>]+content="([^"]*)"',
        text,
        re.I,
    ) or re.search(
        rf'<meta[^>]+content="([^"]*)"[^>]+(?:property|name)="{re.escape(prop)}"',
        text,
        re.I,
    )
    if not m:
        return None
    return html_mod.unescape(m.group(1)) or None


def _json_strings(text: str, key: str) -> list[str]:
    """从页面内嵌 JSON 里提取某字段的 URL 列表（去重保序）。"""
    out: list[str] = []
    for m in re.finditer(rf'"{key}":"((?:[^"\\]|\\.)*)"', text):
        raw = m.group(1)
        raw = raw.replace("\\u0026", "&").replace("\\/", "/").replace("\\", "")
        if raw.startswith("http") and raw not in out:
            out.append(raw)
    return out

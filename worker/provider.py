"""Instagram Provider —— 实现统一 Provider 协议（docs/05）：
resolve(url) / searchUser(username) / getMedia() / download() 的解析与元数据部分。
输出统一 MediaCollection：author / thumbnail / media type / resolution / metadata。

── 跨进程 wire 契约对照表（与 src/shared/types.ts 的注释互为镜像）──
本文件的归一化函数产出的 dict 经 worker/main.py 的 JSON-RPC 帧进入主进程，
字段名与 TS 侧类型必须同步修改：
  _normalize_media / _media_node_to_item → MediaItem（media_id 以字符串传输，
    taken_at 为秒级时间戳，url 仅 http(s)）
  _normalize_user                        → ProfileUser（avatar ← profile_pic_url[_hd]）
  resolve_post / resolve_story 返回值     → MediaCollection
  WorkerError.code                       → ipc.ts 的 WORKER_ERROR_TO_APP 错误码映射
修改任一侧字段名前先改本表与 types.ts 中的对照表，并同步 bump
worker/main.py 的 PROTOCOL_VERSION。
"""

from __future__ import annotations

import time

from igclient import IgClient, WorkerError
from urls import classify_url, shortcode_to_media_id


def _now() -> int:
    return int(time.time())


def _best_image(media: dict) -> tuple[str, int, int]:
    candidates = ((media.get("image_versions2") or {}).get("candidates")) or []
    best = max(candidates, key=lambda c: c.get("width") or 0, default=None)
    if not best:
        return "", 0, 0
    return best.get("url", ""), int(best.get("width") or 0), int(best.get("height") or 0)


def _best_video(media: dict) -> tuple[str, int, int]:
    candidates = media.get("video_versions") or []
    best = max(candidates, key=lambda c: c.get("width") or 0, default=None)
    if not best:
        return "", 0, 0
    return best.get("url", ""), int(best.get("width") or 0), int(best.get("height") or 0)


def _normalize_media(media: dict) -> dict | None:
    """把 IG media 对象归一化为 MediaItem（取最高可用质量，docs/06）。"""
    media_type = media.get("media_type")
    url = thumb = ""
    width = height = 0
    duration = media.get("video_duration")
    mtype = "image"

    if media_type == 2:
        mtype = "video"
        url, width, height = _best_video(media)
        thumb, tw, th = _best_image(media)
        thumb = thumb or url
        if not url:
            url, width, height = thumb, tw, th
    else:
        mtype = "image"
        url, width, height = _best_image(media)
        thumb = url

    if not url:
        return None
    return {
        "id": str(media.get("id") or media.get("pk") or f"{media.get('code')}-{_now()}"),
        "type": mtype,
        "url": url,
        "thumb_url": thumb,
        "width": width,
        "height": height,
        "duration": round(float(duration), 2) if duration else None,
        "taken_at": int(media.get("taken_at") or 0) or None,
    }


def _normalize_user(user: dict) -> dict:
    return {
        "user_id": str(user.get("id") or user.get("pk") or ""),
        "username": user.get("username", ""),
        "full_name": user.get("full_name", ""),
        "avatar": user.get("profile_pic_url_hd") or user.get("profile_pic_url", ""),
        "followers": ((user.get("edge_followed_by") or {}).get("count")) or user.get("follower_count") or 0,
        "posts": ((user.get("edge_owner_to_timeline_media") or {}).get("count")) or user.get("media_count") or 0,
        "is_private": bool(user.get("is_private")),
        "is_verified": bool(user.get("is_verified")),
    }


def _author_from_media(media: dict) -> dict:
    user = media.get("user") or {}
    return {
        "username": user.get("username", ""),
        "full_name": user.get("full_name", ""),
        "avatar": user.get("profile_pic_url") or user.get("profile_pic_url_hd", ""),
    }


class InstagramProvider:
    name = "instagram"

    def __init__(self) -> None:
        self.client = IgClient()

    # ------------------------------------------------------------- protocol
    def classify(self, url: str) -> dict:
        return classify_url(url)

    def resolve_url(self, url: str) -> dict:
        info = classify_url(url)
        kind = info.get("kind")
        if kind in ("post", "reel", "tv"):
            return self.resolve_post(info["shortcode"])
        if kind == "profile":
            return self.get_user(info["username"])
        if kind == "story":
            return self.resolve_story(info["username"])
        if kind == "highlight":
            raise WorkerError("E_IG_LOGIN_REQUIRED", "highlights require a session cookie")
        raise WorkerError("E_INVALID_URL", f"unsupported url: {url[:120]}")

    def resolve_post(self, shortcode: str) -> dict:
        # 首选公开 embed 的 contextJSON：唯一能拿到完整 Carousel 子项的公开路径
        try:
            fb = self.client.post_embed_media(shortcode)
            return {
                "source": {"kind": "post", "shortcode": shortcode},
                "author": {
                    "username": fb["username"],
                    "full_name": fb.get("full_name", ""),
                    "avatar": fb.get("avatar", ""),
                },
                "items": fb["items"],
                "caption": fb.get("caption", ""),
            }
        except WorkerError as embed_err:
            if embed_err.code == "E_IG_PRIVATE":
                raise

        # 回退 1：媒体 API（若可用则信息最全）
        try:
            media_id = shortcode_to_media_id(shortcode)
            media = self.client.media_info(media_id)
            items_raw = media.get("carousel_media") or [media]
            items = [m for m in (_normalize_media(x) for x in items_raw) if m]
            if items:
                caption = ""
                cap = media.get("caption")
                if isinstance(cap, dict):
                    caption = cap.get("text", "")
                return {
                    "source": {"kind": "post", "shortcode": shortcode},
                    "author": _author_from_media(media),
                    "items": items,
                    "caption": caption,
                }
        except WorkerError:
            pass

        # 回退 2：oembed / og:meta（可能仅首条媒体）
        try:
            fb = self.client.post_page_fallback(shortcode)
        except WorkerError as e:
            raise e
        return {
            "source": {"kind": "post", "shortcode": shortcode},
            "author": {
                "username": fb["username"],
                "full_name": fb.get("full_name", ""),
                "avatar": fb.get("avatar", ""),
            },
            "items": fb["items"],
            "caption": fb.get("caption", ""),
        }

    def get_user(self, username: str) -> dict:
        user = self.client.web_profile(username)
        if user.get("is_private"):
            raise WorkerError("E_IG_PRIVATE", f"@{username} is a private account")
        return {"user": _normalize_user(user)}

    def resolve_story(self, username: str) -> dict:
        user = self.client.web_profile(username)
        data = self.client.story(user["id"])
        items = [m for m in (_normalize_media(x) for x in data["items"]) if m]
        if not items:
            raise WorkerError("E_IG_NOT_FOUND", "no active stories")
        return {
            "source": {"kind": "story", "username": username},
            "author": _author_from_media({"user": user}),
            "items": items,
            "caption": "",
        }

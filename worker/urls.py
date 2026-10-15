"""URL / 用户名分类 —— 与 src/shared/ig-url.ts 保持同一规则。"""

import re

SHORTCODE_RE = re.compile(r"^[A-Za-z0-9_-]{5,32}$")
USERNAME_RE = re.compile(r"^[A-Za-z0-9._]{1,30}$")

RESERVED = {
    "p", "reel", "reels", "tv", "stories", "explore", "accounts",
    "direct", "about", "developer", "legal", "privacy", "terms", "challenge",
}

IG_HOSTS = ("instagram.com", "instagr.am", "ig.me")


def classify_url(raw: str) -> dict:
    s = (raw or "").strip()
    if not s:
        return {"kind": "unknown"}

    # 裸用户名
    if USERNAME_RE.match(s) and "." not in s:
        if s.lower() not in RESERVED:
            return {"kind": "profile", "username": s.lower()}
        return {"kind": "unknown"}

    path = s
    if not s.lower().startswith("http"):
        host = re.split(r"[/?#]", s)[0] or ""
        if not _is_ig_host(host):
            return {"kind": "unknown"}
        path = _strip_url(s)[len(host):]
    else:
        try:
            from urllib.parse import urlparse

            u = urlparse(s)
            if not _is_ig_host(u.hostname or ""):
                return {"kind": "unknown"}
            path = u.path
        except ValueError:
            return {"kind": "unknown"}

    segs = [seg for seg in path.split("/") if seg]
    if not segs:
        return {"kind": "unknown"}

    first = segs[0]
    second = segs[1] if len(segs) > 1 else None
    third = segs[2] if len(segs) > 2 else None

    if first in ("p", "tv") and second and SHORTCODE_RE.match(second):
        return {"kind": "tv" if first == "tv" else "post", "shortcode": second}
    if first in ("reel", "reels") and second and SHORTCODE_RE.match(second):
        return {"kind": "reel", "shortcode": second}
    if first == "stories" and second == "highlights" and third:
        return {"kind": "highlight", "username": third}
    if first == "stories" and second and USERNAME_RE.match(second):
        return {"kind": "story", "username": second.lower()}
    if len(segs) <= 2 and USERNAME_RE.match(first) and first.lower() not in RESERVED:
        return {"kind": "profile", "username": first.lower()}
    return {"kind": "unknown"}


def _is_ig_host(host: str) -> bool:
    host = (host or "").lower()
    return any(host == h or host.endswith("." + h) for h in IG_HOSTS)


def _strip_url(s: str) -> str:
    s = re.sub(r"^https?://", "", s, flags=re.I)
    s = re.sub(r"^www\.", "", s, flags=re.I)
    return s.rstrip("/")


_SHORTCODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"


def shortcode_to_media_id(shortcode: str) -> int:
    """Instagram shortcode 是 media id 的 base64url 编码（公开可逆编码）。"""
    n = 0
    for ch in shortcode:
        idx = _SHORTCODE_ALPHABET.find(ch)
        if idx < 0:
            raise ValueError("bad shortcode")
        n = n * 64 + idx
    return n


def media_id_to_shortcode(media_id: int) -> str:
    if media_id <= 0:
        raise ValueError("bad media id")
    chars = []
    n = media_id
    while n > 0:
        n, r = divmod(n, 64)
        chars.append(_SHORTCODE_ALPHABET[r])
    return "".join(reversed(chars))

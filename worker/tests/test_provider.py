import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from provider import _normalize_media, _normalize_user  # noqa: E402
from igclient import (  # noqa: E402
    _og_meta,
    _json_strings,
    _extract_og_media,
    _extract_embed_media,
    _looks_like_html,
    _unescape_json_string,
    _profile_json_window,
    WorkerError,
)


IMAGE_MEDIA = {
    "id": "1111",
    "media_type": 1,
    "code": "Ab12",
    "taken_at": 1700000000,
    "user": {"username": "natgeo", "full_name": "Nat Geo", "profile_pic_url": "http://a"},
    "image_versions2": {
        "candidates": [
            {"url": "http://img-1080", "width": 1080, "height": 1080},
            {"url": "http://img-480", "width": 480, "height": 480},
        ]
    },
}

VIDEO_MEDIA = {
    "id": "2222",
    "media_type": 2,
    "code": "Cd34",
    "video_duration": 12.345,
    "taken_at": 1700000100,
    "video_versions": [
        {"url": "http://vid-480", "width": 480, "height": 480},
        {"url": "http://vid-1080", "width": 1080, "height": 1080},
    ],
    "image_versions2": {"candidates": [{"url": "http://thumb", "width": 640, "height": 640}]},
}


class TestNormalize(unittest.TestCase):
    def test_image_prefers_highest_quality(self):
        item = _normalize_media(IMAGE_MEDIA)
        self.assertIsNotNone(item)
        self.assertEqual(item["type"], "image")
        self.assertEqual(item["url"], "http://img-1080")
        self.assertEqual(item["width"], 1080)

    def test_video_prefers_highest_quality_with_thumb(self):
        item = _normalize_media(VIDEO_MEDIA)
        self.assertEqual(item["type"], "video")
        self.assertEqual(item["url"], "http://vid-1080")
        self.assertEqual(item["thumb_url"], "http://thumb")
        self.assertEqual(item["duration"], 12.35)

    def test_normalize_user(self):
        u = _normalize_user(
            {
                "id": 42,
                "username": "natgeo",
                "full_name": "Nat Geo",
                "profile_pic_url_hd": "http://hd",
                "edge_followed_by": {"count": 1000},
                "edge_owner_to_timeline_media": {"count": 20},
                "is_private": False,
                "is_verified": True,
            }
        )
        self.assertEqual(u["user_id"], "42")
        self.assertEqual(u["followers"], 1000)
        self.assertTrue(u["is_verified"])

    def test_empty_media_rejected(self):
        self.assertIsNone(_normalize_media({"media_type": 1, "image_versions2": {"candidates": []}}))


class TestPageFallbackParsing(unittest.TestCase):
    HTML = """
    <html><head>
    <meta property="og:video" content="http://video.example/v.mp4" />
    <meta property="og:image" content="http://img.example/i.jpg" />
    <meta property="og:title" content="natgeo 在 Instagram 上发布了一条视频" />
    </head><body>
    <script type="application/json">{"display_url":"http://cdn.example/a.jpg\\u0026se=1","video_url":"http://cdn.example/v2.mp4"}</script>
    </body></html>
    """

    def test_og_meta(self):
        self.assertEqual(_og_meta(self.HTML, "og:video"), "http://video.example/v.mp4")
        self.assertEqual(_og_meta(self.HTML, "og:image"), "http://img.example/i.jpg")
        self.assertIsNone(_og_meta(self.HTML, "og:missing"))

    def test_json_strings(self):
        urls = _json_strings(self.HTML, "display_url")
        self.assertEqual(urls, ["http://cdn.example/a.jpg&se=1"])
        self.assertEqual(_json_strings(self.HTML, "video_url"), ["http://cdn.example/v2.mp4"])

    def test_worker_error_codes(self):
        e = WorkerError("E_IG_RATE_LIMIT", "slow down")
        self.assertEqual(e.code, "E_IG_RATE_LIMIT")

    def test_html_wall_detection(self):
        self.assertTrue(_looks_like_html(b"<!DOCTYPE html><html>..."))
        self.assertTrue(_looks_like_html(b'\n\n  <html lang="en">'))
        self.assertFalse(_looks_like_html(b'{"data": {"user": {}}}'))

    def test_extract_embed_media(self):
        html = (
            '<div class="Embed"><img class="EmbeddedMediaImage" '
            'src="https://cdn.example/photo.jpg" />'
            '<script>{"video_url":"https://cdn.example/v.mp4"}</script>'
            '<a href="/natgeo/">natgeo</a></div>'
        )
        result = _extract_embed_media(html)
        self.assertIsNotNone(result)
        self.assertEqual(result["image_urls"], ["https://cdn.example/photo.jpg"])
        self.assertEqual(result["video_urls"], ["https://cdn.example/v.mp4"])
        self.assertEqual(result["username"], "natgeo")

    def test_extract_og_media(self):
        html = (
            '<meta property="og:video" content="https://v.example/a.mp4" />'
            '<meta property="og:image" content="https://i.example/a.jpg" />'
            '<meta property="og:title" content="by @natgeo" />'
        )
        result = _extract_og_media(html)
        self.assertIsNotNone(result)
        self.assertEqual(result["video_urls"][0], "https://v.example/a.mp4")
        self.assertEqual(result["username"], "natgeo")


class TestUnescapeJsonString(unittest.TestCase):
    """内联 JSON 里的字符串是转义过的，正则截取后必须反转义。

    回归：主页 full_name 曾把 \\u674e\\u4f50\\u4e50 原样显示给用户。"""

    def test_unicode_escape_decoded(self):
        # \u674e\u4f50\u4e50 = 李佐乐
        self.assertEqual(_unescape_json_string(r"\u674e\u4f50\u4e50"), "李佐乐")

    def test_plain_text_unchanged(self):
        self.assertEqual(_unescape_json_string("National Geographic"), "National Geographic")

    def test_empty_unchanged(self):
        self.assertEqual(_unescape_json_string(""), "")

    def test_escaped_quote_decoded(self):
        self.assertEqual(_unescape_json_string(r"a\"b"), 'a"b')


class TestProfileJsonWindow(unittest.TestCase):
    """带会话访问主页时，页面里先出现登录者字段，必须锚定到目标用户。

    回归：曾把 natgeo 主页显示成登录者自己的姓名与头像。"""

    # 登录者在前的真实结构（用户名为虚构示例）
    PAGE = (
        '{"viewer":{"username":"example_viewer","full_name":"\\u674e\\u67d0\\u67d0",'
        '"profile_pic_url_hd":"https://cdn/MY_AVATAR.jpg","follower_count":3}}'
        '...{"user":{"username":"natgeo","full_name":"National Geographic",'
        '"profile_pic_url_hd":"https://cdn/NATGEO_AVATAR.jpg","follower_count":268000000,'
        '"media_count":32000,"id":"787132"}}'
    )

    def test_picks_target_not_viewer(self):
        import re

        window = _profile_json_window(self.PAGE, "natgeo")
        full = re.search(r'"full_name":"([^"]*)"', window)
        avatar = re.search(r'"profile_pic_url_hd":"([^"]+)"', window)
        self.assertEqual(_unescape_json_string(full.group(1)), "National Geographic")
        self.assertEqual(avatar.group(1), "https://cdn/NATGEO_AVATAR.jpg")

    def test_missing_anchor_falls_back_to_full_text(self):
        # 锚点不存在时退回全文（未登录路径行为不变）
        self.assertEqual(_profile_json_window("no anchor here", "ghost"), "no anchor here")

    def test_empty_username_returns_text(self):
        self.assertEqual(_profile_json_window(self.PAGE, ""), self.PAGE)


if __name__ == "__main__":
    unittest.main()

"""公开 embed contextJSON 解析测试（Carousel / 图片 / 视频 归一化）。"""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from igclient import (  # noqa: E402
    _extract_context_json,
    _extract_embed_media,
    _media_node_to_item,
    _parse_count,
    _best_from_candidates,
)

SAMPLE = {
    "context": {"type": "GraphSidecar", "shortcode": "DeZnnO7CBKY"},
    "gql_data": {
        "shortcode_media": {
            "__typename": "GraphSidecar",
            "id": "4006407563419062936",
            "is_video": False,
            "display_url": "https://cdn.example/main.jpg",
            "owner": {
                "username": "natgeo",
                "full_name": "National Geographic",
                "profile_pic_url": "https://cdn.example/av.jpg",
            },
            "edge_media_to_caption": {"edges": [{"node": {"text": "caption here"}}]},
            "edge_sidecar_to_children": {
                "edges": [
                    {
                        "node": {
                            "id": "1",
                            "shortcode": "A1",
                            "is_video": False,
                            "display_url": "https://cdn.example/a.jpg",
                            "dimensions": {"width": 1080, "height": 1350},
                        }
                    },
                    {
                        "node": {
                            "id": "2",
                            "shortcode": "A2",
                            "is_video": True,
                            "display_url": "https://cdn.example/b_thumb.jpg",
                            "video_url": "https://cdn.example/b.mp4",
                            "dimensions": {"width": 1080, "height": 1920},
                            "video_duration": 12.34,
                        }
                    },
                ]
            },
        }
    },
}


def _page_with_context(obj: dict) -> str:
    """构造形如 IG embed 页的页面片段（contextJSON 为 JSON 字符串）。"""
    inner = json.dumps(obj)  # 序列化为字符串
    return 'foo,"contextJSON":' + json.dumps(inner) + ',"bar":1'


class TestExtractContextJSON(unittest.TestCase):
    def test_extract_basic(self):
        page = _page_with_context(SAMPLE)
        ctx = _extract_context_json(page)
        self.assertIsNotNone(ctx)
        self.assertEqual(ctx["gql_data"]["shortcode_media"]["__typename"], "GraphSidecar")

    def test_extract_returns_none_when_null(self):
        self.assertIsNone(_extract_context_json('"contextJSON":null'))
        self.assertIsNone(_extract_context_json("no marker here"))

    def test_extract_handles_escaped_quotes(self):
        # 模拟真实页面的双重转义
        inner = json.dumps(SAMPLE)
        escaped = inner.replace('"', '\\"')
        page = '"contextJSON":"' + escaped + '"'
        ctx = _extract_context_json(page)
        self.assertIsNotNone(ctx)
        self.assertEqual(ctx["gql_data"]["shortcode_media"]["id"], "4006407563419062936")


class TestMediaNodeNormalize(unittest.TestCase):
    def test_image_node(self):
        node = SAMPLE["gql_data"]["shortcode_media"]["edge_sidecar_to_children"]["edges"][0]["node"]
        item = _media_node_to_item(node)
        self.assertEqual(item["type"], "image")
        self.assertEqual(item["url"], "https://cdn.example/a.jpg")
        self.assertEqual(item["width"], 1080)
        self.assertEqual(item["height"], 1350)

    def test_video_node_uses_video_url(self):
        node = SAMPLE["gql_data"]["shortcode_media"]["edge_sidecar_to_children"]["edges"][1]["node"]
        item = _media_node_to_item(node)
        self.assertEqual(item["type"], "video")
        self.assertEqual(item["url"], "https://cdn.example/b.mp4")
        self.assertEqual(item["thumb_url"], "https://cdn.example/b_thumb.jpg")
        self.assertEqual(item["duration"], 12.34)

    def test_video_prefers_display_resources_when_no_video_url(self):
        node = {
            "is_video": True,
            "display_url": "https://cdn.example/thumb.jpg",
            "video_resources": [
                {"src": "https://cdn.example/v_720.mp4", "config_width": 720, "config_height": 1280},
                {"src": "https://cdn.example/v_1080.mp4", "config_width": 1080, "config_height": 1920},
            ],
        }
        item = _media_node_to_item(node)
        self.assertEqual(item["url"], "https://cdn.example/v_1080.mp4")
        self.assertEqual(item["width"], 1080)

    def test_image_prefers_highest_display_resource(self):
        node = {
            "is_video": False,
            "display_url": "https://cdn.example/low.jpg",
            "display_resources": [
                {"src": "https://cdn.example/low.jpg", "config_width": 240, "config_height": 300},
                {"src": "https://cdn.example/high.jpg", "config_width": 1080, "config_height": 1350},
            ],
        }
        item = _media_node_to_item(node)
        self.assertEqual(item["url"], "https://cdn.example/high.jpg")
        self.assertEqual(item["width"], 1080)

    def test_empty_node_returns_none(self):
        self.assertIsNone(_media_node_to_item({}))

    def test_best_from_candidates(self):
        self.assertIsNone(_best_from_candidates([]))
        best = _best_from_candidates(
            [{"url": "a", "width": 10}, {"url": "b", "width": 99}, {"no_url": True, "width": 500}]
        )
        self.assertEqual(best["url"], "b")


class TestParseCount(unittest.TestCase):
    def test_plain(self):
        self.assertEqual(_parse_count("195 Following", "Following"), 195)

    def test_thousands(self):
        self.assertEqual(_parse_count("32K Posts", "Posts"), 32000)

    def test_millions(self):
        self.assertEqual(_parse_count("268M Followers", "Followers"), 268_000_000)

    def test_missing(self):
        self.assertEqual(_parse_count("no numbers here", "Followers"), 0)


class TestExtractEmbedMedia(unittest.TestCase):
    """embed 页 HTML 扫描：Carousel 多图必须全部取出。

    回归：曾用 re.search 只取第一张 EmbeddedMediaImage，导致
    "3 图帖子解析出来只有第一张"。
    """

    def test_multi_image_all_extracted(self):
        html = (
            '<img class="EmbeddedMediaImage" src="https://cdn.example/1.jpg">'
            '<img class="EmbeddedMediaImage" src="https://cdn.example/2.jpg">'
            '<img class="EmbeddedMediaImage" src="https://cdn.example/3.jpg">'
        )
        r = _extract_embed_media(html)
        self.assertIsNotNone(r)
        self.assertEqual(len(r["image_urls"]), 3)
        self.assertEqual(r["image_urls"][0], "https://cdn.example/1.jpg")

    def test_dedup_and_skip_non_http(self):
        html = (
            '<img class="EmbeddedMediaImage" src="https://cdn.example/a.jpg">'
            '<img class="EmbeddedMediaImage" src="https://cdn.example/a.jpg">'
            '<img class="EmbeddedMediaImage" src="data:image/png;base64,xx">'
        )
        r = _extract_embed_media(html)
        self.assertEqual(len(r["image_urls"]), 1)

    def test_src_before_class(self):
        html = '<img src="https://cdn.example/x.jpg" class="EmbeddedMediaImage other">'
        r = _extract_embed_media(html)
        self.assertEqual(r["image_urls"], ["https://cdn.example/x.jpg"])

    def test_video_tag(self):
        html = '<video src="https://cdn.example/v.mp4"></video>'
        r = _extract_embed_media(html)
        self.assertEqual(r["video_urls"], ["https://cdn.example/v.mp4"])

    def test_empty_returns_none(self):
        self.assertIsNone(_extract_embed_media("<div>nothing</div>"))


if __name__ == "__main__":
    unittest.main()

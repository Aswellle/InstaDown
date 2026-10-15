import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from urls import classify_url, shortcode_to_media_id, media_id_to_shortcode  # noqa: E402


class TestClassifyUrl(unittest.TestCase):
    def test_post(self):
        self.assertEqual(
            classify_url("https://www.instagram.com/p/B1LbfVPlwIA/"),
            {"kind": "post", "shortcode": "B1LbfVPlwIA"},
        )
        self.assertEqual(
            classify_url("https://instagram.com/p/CxAbCdEfGhI/?img_index=2"),
            {"kind": "post", "shortcode": "CxAbCdEfGhI"},
        )

    def test_reel_and_tv(self):
        self.assertEqual(
            classify_url("https://www.instagram.com/reel/CxYz1234567/"),
            {"kind": "reel", "shortcode": "CxYz1234567"},
        )
        self.assertEqual(
            classify_url("instagram.com/reels/CxYz1234567"),
            {"kind": "reel", "shortcode": "CxYz1234567"},
        )
        self.assertEqual(
            classify_url("https://www.instagram.com/tv/B1LbfVPlwIA"),
            {"kind": "tv", "shortcode": "B1LbfVPlwIA"},
        )

    def test_story_highlight(self):
        self.assertEqual(
            classify_url("https://www.instagram.com/stories/natgeo/123/"),
            {"kind": "story", "username": "natgeo"},
        )
        self.assertEqual(
            classify_url("https://www.instagram.com/stories/highlights/1798/"),
            {"kind": "highlight", "username": "1798"},
        )

    def test_profile_and_username(self):
        self.assertEqual(
            classify_url("https://www.instagram.com/instagram/"),
            {"kind": "profile", "username": "instagram"},
        )
        self.assertEqual(classify_url("natgeo"), {"kind": "profile", "username": "natgeo"})

    def test_rejects(self):
        self.assertEqual(classify_url("https://youtube.com/watch?v=1")["kind"], "unknown")
        self.assertEqual(classify_url("")["kind"], "unknown")
        self.assertEqual(classify_url("hello world!")["kind"], "unknown")
        self.assertEqual(classify_url("https://www.instagram.com/explore/")["kind"], "unknown")


class TestShortcodeConversion(unittest.TestCase):
    def test_round_trip(self):
        cases = ["B1LbfVPlwIA", "CxYz1234567", "C0AbCdEfG12"]
        for sc in cases:
            mid = shortcode_to_media_id(sc)
            self.assertEqual(media_id_to_shortcode(mid), sc)

    def test_known_value(self):
        self.assertEqual(shortcode_to_media_id("B1LbfVPlwIA"), 2110901750722920960)

    def test_bad_input(self):
        with self.assertRaises(ValueError):
            shortcode_to_media_id("!!!bad!!!")


if __name__ == "__main__":
    unittest.main()

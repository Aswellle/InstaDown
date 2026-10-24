"""Worker 进程协议集成测试（subprocess + 行分隔 JSON-RPC）。"""

import json
import os
import subprocess
import sys
import unittest

WORKER = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "main.py")


class TestWorkerProtocol(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.proc = subprocess.Popen(
            [sys.executable, WORKER],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )

    @classmethod
    def tearDownClass(cls):
        if cls.proc.stdin:
            cls.proc.stdin.close()
        cls.proc.wait(timeout=5)

    def rpc(self, rid, method, params=None):
        frame = json.dumps({"id": rid, "method": method, "params": params or {}})
        self.proc.stdin.write((frame + "\n").encode())
        self.proc.stdin.flush()
        while True:
            line = self.proc.stdout.readline()
            if not line:
                raise AssertionError("worker closed stdout")
            msg = json.loads(line.decode())
            if "event" in msg:
                continue  # 跳过日志事件帧
            if msg.get("id") == rid:
                return msg

    def test_handshake(self):
        resp = self.rpc(0, "handshake")
        self.assertTrue(resp["ok"])
        self.assertEqual(resp["result"]["protocol"], 2)
        self.assertEqual(resp["result"]["provider"], "instagram")

    def test_classify_url(self):
        resp = self.rpc(1, "classify_url", {"url": "https://www.instagram.com/p/B1LbfVPlwIA/"})
        self.assertEqual(resp["result"], {"kind": "post", "shortcode": "B1LbfVPlwIA"})

    def test_unknown_method_is_error(self):
        resp = self.rpc(2, "definitely_not_a_method")
        self.assertFalse(resp["ok"])
        self.assertEqual(resp["error"]["code"], "E_INTERNAL")

    def test_resolve_post_shortcode_media_id(self):
        resp = self.rpc(3, "shortcode_to_media_id", {"shortcode": "B1LbfVPlwIA"})
        self.assertEqual(resp["result"]["media_id"], "2110901750722920960")


if __name__ == "__main__":
    unittest.main()

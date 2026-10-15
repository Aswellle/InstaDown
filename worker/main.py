"""Worker 主入口：stdin/stdout 上的行分隔 JSON-RPC。

约定（docs/dev/02-技术设计 §3）：
- 请求  {"id":1,"method":"...","params":{...}}
- 响应  {"id":1,"ok":true,"result":...} / {"id":1,"ok":false,"error":{"code","message"}}
- 事件  {"event":"log","data":{...}}（无 id；stdout 仅承载协议帧，日志走事件或 stderr）
"""

import json
import os
import sys
import threading
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from igclient import WorkerError  # noqa: E402
from provider import InstagramProvider  # noqa: E402
from urls import classify_url, media_id_to_shortcode, shortcode_to_media_id  # noqa: E402

PROTOCOL_VERSION = 1
WORKER_VERSION = "1.0.0"

provider = InstagramProvider()
_write_lock = threading.Lock()


def _send(obj: dict) -> None:
    line = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    with _write_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


def _log(level: str, message: str) -> None:
    _send({"event": "log", "data": {"level": level, "message": message}})


def handle(method: str, params: dict):
    if method == "handshake":
        return {"protocol": PROTOCOL_VERSION, "provider": provider.name, "version": WORKER_VERSION}
    if method == "set_session":
        provider.client.set_session(params.get("cookie"))
        return {}
    if method == "classify_url":
        return classify_url(params.get("url", ""))
    if method == "resolve_url":
        return provider.resolve_url(params.get("url", ""))
    if method == "resolve_post":
        return provider.resolve_post(params["shortcode"])
    if method == "get_user":
        return provider.get_user(params["username"])
    if method == "get_profile_media":
        return provider.get_profile_media(
            params["username"],
            max_id=params.get("max_id"),
            limit=int(params.get("limit") or 12),
        )
    if method == "resolve_story":
        return provider.resolve_story(params["username"])
    if method == "shortcode_to_media_id":
        return {"media_id": str(shortcode_to_media_id(params["shortcode"]))}
    if method == "media_id_to_shortcode":
        return {"shortcode": media_id_to_shortcode(int(params["media_id"]))}
    raise WorkerError("E_INTERNAL", f"unknown method: {method}")


def main() -> int:
    _log("info", f"worker started pid={os.getpid()} python={sys.version.split()[0]}")
    for raw in sys.stdin.buffer:
        line = raw.decode("utf-8", "replace").strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            _send({"id": None, "ok": False, "error": {"code": "E_INTERNAL", "message": "bad frame"}})
            continue
        rid = req.get("id")
        method = req.get("method", "")
        params = req.get("params") or {}
        try:
            result = handle(method, params)
            _send({"id": rid, "ok": True, "result": result})
        except WorkerError as e:
            _send({"id": rid, "ok": False, "error": {"code": e.code, "message": e.message}})
        except Exception as e:  # noqa: BLE001 兜底：worker 不允许崩溃
            print(traceback.format_exc(), file=sys.stderr)
            _send({"id": rid, "ok": False, "error": {"code": "E_INTERNAL", "message": str(e)}})
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BrokenPipeError:
        sys.exit(0)

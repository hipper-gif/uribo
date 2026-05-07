"""Uribo Local Runner - ブラウザからのワンクリック実行を可能にする HTTP サーバー

PCログオン中に常駐させ、Uribo の /payroll 画面からの fetch リクエストを受けて
sync_salonboard.py を subprocess 起動する。

起動方法 (どれか):
  - 手動: python local_runner.py
  - ダブルクリック: start_local_runner.bat
  - 自動: register_local_runner.ps1 で Windows ログオン時に自動起動登録

セキュリティ:
  - localhost (127.0.0.1) のみバインド
  - Origin: https://twinklemark.xsrv.jp 以外は 403
  - Private Network Access (PNA) ヘッダで Chrome の Mixed Content警告に対応
"""
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ALLOWED_ORIGIN = "https://twinklemark.xsrv.jp"
PORT = 8765
SCRIPTS_DIR = Path(__file__).parent

current_proc: subprocess.Popen | None = None
log_buffer: list[str] = []
log_lock = threading.Lock()


def append_log(line: str) -> None:
    with log_lock:
        log_buffer.append(line)
        if len(log_buffer) > 200:
            del log_buffer[:100]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write(f"[{self.log_date_time_string()}] {fmt % args}\n")

    def _cors(self):
        origin = self.headers.get("Origin", "")
        if origin == ALLOWED_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        # Chrome Private Network Access 対応
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "86400")

    def _origin_ok(self) -> bool:
        return self.headers.get("Origin", "") == ALLOWED_ORIGIN

    def _json_response(self, code: int, payload: dict):
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.end_headers()
        self.wfile.write(json.dumps(payload, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self._json_response(200, {"status": "ok", "version": "1.0"})
            return
        if self.path == "/status":
            global current_proc
            running = current_proc is not None and current_proc.poll() is None
            with log_lock:
                tail = list(log_buffer[-30:])
            self._json_response(200, {
                "running": running,
                "returncode": current_proc.returncode if (current_proc and not running) else None,
                "log_tail": tail,
            })
            return
        self._json_response(404, {"error": "not found"})

    def do_POST(self):
        if not self._origin_ok():
            self._json_response(403, {"error": "origin not allowed"})
            return

        if self.path == "/sync":
            length = int(self.headers.get("Content-Length", 0))
            try:
                body = json.loads(self.rfile.read(length).decode("utf-8"))
            except Exception:
                body = {}
            month = body.get("month", "")
            mode = body.get("mode", "with-staff")  # with-staff | only-staff | full

            global current_proc, log_buffer
            if current_proc is not None and current_proc.poll() is None:
                self._json_response(409, {"error": "already running", "pid": current_proc.pid})
                return

            cmd = [sys.executable, "sync_salonboard.py"]
            if mode == "only-staff":
                cmd.append("--only-staff")
            else:
                cmd.append("--with-staff")
            if month:
                cmd.extend(["--month", month])

            with log_lock:
                log_buffer = []
            append_log(f"$ {' '.join(cmd)}")

            try:
                current_proc = subprocess.Popen(
                    cmd,
                    cwd=str(SCRIPTS_DIR),
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    creationflags=subprocess.CREATE_NEW_CONSOLE if os.name == "nt" else 0,
                )
            except Exception as e:
                self._json_response(500, {"error": str(e)})
                return

            def reader(proc: subprocess.Popen):
                if proc.stdout is None:
                    return
                for line in proc.stdout:
                    append_log(line.rstrip())

            threading.Thread(target=reader, args=(current_proc,), daemon=True).start()

            self._json_response(202, {
                "status": "started",
                "pid": current_proc.pid,
                "cmd": " ".join(cmd),
            })
            return

        self._json_response(404, {"error": "not found"})


def main():
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"=== Uribo Local Runner ===")
    print(f"  URL:           http://127.0.0.1:{PORT}")
    print(f"  Allowed Origin: {ALLOWED_ORIGIN}")
    print(f"  Scripts dir:   {SCRIPTS_DIR}")
    print(f"  Endpoints:     GET /health, GET /status, POST /sync")
    print(f"")
    print(f"このウィンドウは閉じないでください (閉じるとブラウザからの実行ができなくなります)")
    print(f"Ctrl+C で停止")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n停止しました")


if __name__ == "__main__":
    main()

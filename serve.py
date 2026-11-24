#!/usr/bin/env python3
"""Serve Popit Call and proxy its same-origin JSON calls to the Popit bridge.

GitHub Pages has no server, so the published page is the contact book and the
signed-package desk. This companion is the call transport on a machine that also
runs Popit: it serves the same static files at loopback and forwards
`/api/bridge/...` to `http://127.0.0.1:5207`.

Run:
    python serve.py --port 5220 --bridge http://127.0.0.1:5207

A remote bridge must be HTTPS and must expose CORS for the published page; the
companion avoids that by keeping the page and the proxy on one origin.
"""
from __future__ import annotations

import argparse
import json
import mimetypes
import pathlib
import ssl
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parent
BRIDGE = "http://127.0.0.1:5207"
PUBLIC_ORIGIN = ""
TLS_LISTENER = False
# A public companion exposes only the signed call protocol. Opening a call, driving
# Debian, moving windows or reading the archive stays on the host's loopback bridge.
BRIDGE_ALLOW = (
    "/api/toast/call/join",
    "/api/toast/call/turns",
    "/api/toast/call/say",
    "/api/toast/call/leave",
    "/api/toast/civilians/scope",
)
TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".md": "text/markdown; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
}


def health() -> dict:
    return {
        "ok": True,
        "service": "popit-call-companion",
        "bridge": BRIDGE,
        "tls": TLS_LISTENER or BRIDGE.startswith("https://"),
        "public_origin": PUBLIC_ORIGIN or "same-origin",
        "bridge_allow": list(BRIDGE_ALLOW),
        "static": str(ROOT),
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "PopitCall/1"

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        # One line per request is enough; the page's own status carries the result.
        print(f"popit-call {self.address_string()} {format % args}", flush=True)

    def _cors(self) -> None:
        if PUBLIC_ORIGIN and self.headers.get("Origin") == PUBLIC_ORIGIN:
            self.send_header("Access-Control-Allow-Origin", PUBLIC_ORIGIN)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Max-Age", "600")

    def _json(self, value: dict, status: int = 200) -> None:
        body = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _file(self, path: pathlib.Path) -> None:
        try:
            data = path.read_bytes()
        except OSError:
            return self._json({"ok": False, "refused": "not-found"}, 404)
        self.send_response(200)
        self.send_header("Content-Type", TYPES.get(path.suffix.lower(), "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    def _safe_path(self) -> pathlib.Path | None:
        path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        if path in ("", "/"):
            path = "/index.html"
        candidate = (ROOT / path.lstrip("/")).resolve()
        try:
            candidate.relative_to(ROOT.resolve())
        except ValueError:
            return None
        return candidate

    def _bridge(self, method: str, body: bytes | None = None) -> None:
        path = urllib.parse.urlsplit(self.path).path
        target_path = path[len("/api/bridge"):] or "/"
        if target_path == "/health":
            return self._json(health())
        if target_path not in BRIDGE_ALLOW:
            return self._json({"ok": False, "refused": {"code": "bridge-route",
                                                         "detail": target_path}}, 403)
        target = BRIDGE.rstrip("/") + target_path
        request = urllib.request.Request(
            target, data=body, method=method,
            headers={"Content-Type": self.headers.get("Content-Type") or "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                data = response.read()
                self.send_response(response.status)
                self.send_header("Content-Type", response.headers.get("Content-Type") or "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self._cors()
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as error:
            data = error.read()
            self.send_response(error.code)
            self.send_header("Content-Type", error.headers.get("Content-Type") or "application/json")
            self.send_header("Content-Length", str(len(data)))
            self._cors()
            self.end_headers()
            self.wfile.write(data)
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            self._json({"ok": False, "refused": {"code": "bridge-unreachable",
                                                 "detail": str(error)[:240]}}, 502)

    def do_GET(self) -> None:  # noqa: N802
        path = urllib.parse.urlsplit(self.path).path
        if path.startswith("/api/bridge"):
            return self._bridge("GET")
        if path == "/health":
            return self._json(health())
        candidate = self._safe_path()
        if candidate is None:
            return self._json({"ok": False, "refused": "path"}, 403)
        if candidate.is_dir():
            candidate = candidate / "index.html"
        self._file(candidate)

    def do_HEAD(self) -> None:  # noqa: N802
        candidate = self._safe_path()
        if candidate is None:
            return self._json({"ok": False, "refused": "path"}, 403)
        try:
            size = candidate.stat().st_size
        except OSError:
            return self._json({"ok": False, "refused": "not-found"}, 404)
        self.send_response(200)
        self.send_header("Content-Type", TYPES.get(candidate.suffix.lower(), "application/octet-stream"))
        self.send_header("Content-Length", str(size))
        self.end_headers()

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        path = urllib.parse.urlsplit(self.path).path
        if not path.startswith("/api/bridge"):
            return self._json({"ok": False, "refused": "not-found"}, 404)
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length > 64 * 1024:
            return self._json({"ok": False, "refused": "body-size"}, 413)
        return self._bridge("POST", self.rfile.read(length) if length else b"")


def main() -> int:
    global BRIDGE, PUBLIC_ORIGIN, TLS_LISTENER
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5220)
    parser.add_argument("--bridge", default=BRIDGE)
    parser.add_argument("--public-origin", default="",
                        help="exact HTTPS origin of the published page, e.g. https://alacripose.github.io")
    parser.add_argument("--tls-cert", default="", help="PEM certificate for a remote companion")
    parser.add_argument("--tls-key", default="", help="PEM private key for a remote companion")
    args = parser.parse_args()
    BRIDGE = str(args.bridge).rstrip("/")
    PUBLIC_ORIGIN = str(args.public_origin or "").rstrip("/")
    if bool(args.tls_cert) != bool(args.tls_key):
        parser.error("--tls-cert and --tls-key must be supplied together")
    if PUBLIC_ORIGIN and not PUBLIC_ORIGIN.startswith("https://"):
        parser.error("--public-origin must be an exact https:// origin")
    if PUBLIC_ORIGIN and not args.tls_cert:
        parser.error("--public-origin requires the companion's own --tls-cert/--tls-key")
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    scheme = "http"
    if args.tls_cert:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(args.tls_cert, args.tls_key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        TLS_LISTENER = True
        scheme = "https"
    print(json.dumps({"ok": True, "url": f"{scheme}://{args.host}:{args.port}/",
                      "bridge": BRIDGE, "public_origin": PUBLIC_ORIGIN or "same-origin"},
                     ensure_ascii=False), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Tiny stand-in for the GitHub contents API (only what kit.js uses), for local testing."""
import base64, hashlib, json, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

FILES = {}  # path -> bytes
PREFIX = "/repos/isaacbsmith4-sys/life-data"
LOG = []

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Accept, Content-Type, X-GitHub-Api-Version")
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, OPTIONS")
    def reply(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.cors()
        self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_OPTIONS(self): self.send_response(204); self.cors(); self.end_headers()
    def authed(self):
        if self.headers.get("Authorization") != "Bearer test-token": self.reply(401, {"message": "Bad credentials"}); return False
        return True
    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/_files": return self.reply(200, {k: json.loads(v) for k, v in FILES.items()})
        if p == "/_log": return self.reply(200, LOG)
        if not self.authed(): return
        if p == PREFIX: return self.reply(200, {"full_name": "isaacbsmith4-sys/life-data", "permissions": {"push": True}})
        path = p[len(PREFIX + "/contents/"):]
        if path in FILES:
            b = FILES[path]; return self.reply(200, {"sha": hashlib.sha1(b).hexdigest(), "content": base64.b64encode(b).decode()})
        kids = sorted({k[len(path) + 1:].split("/")[0] for k in FILES if k.startswith(path + "/")})
        if kids:
            return self.reply(200, [{"name": n, "sha": hashlib.sha1(FILES.get(path + "/" + n, b"dir")).hexdigest()} for n in kids])
        self.reply(404, {"message": "Not Found"})
    def do_PUT(self):
        if not self.authed(): return
        path = self.path.split("?")[0][len(PREFIX + "/contents/"):]
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        cur = FILES.get(path)
        if cur is not None and body.get("sha") != hashlib.sha1(cur).hexdigest(): return self.reply(409, {"message": "sha mismatch"})
        if cur is None and body.get("sha"): return self.reply(409, {"message": "no file"})
        FILES[path] = base64.b64decode(body["content"]); LOG.append(body["message"])
        self.reply(200, {"content": {"sha": hashlib.sha1(FILES[path]).hexdigest()}})

ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()

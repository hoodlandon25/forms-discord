#!/usr/bin/env python3

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DEFAULT_USERNAME = os.environ.get("ADMIN_USERNAME", "").strip()
DEFAULT_PASSWORD = os.environ.get("ADMIN_PASSWORD", "").strip()
RESET_CODE = os.environ.get("RESET_CODE", "").strip()
ACCOUNT_CREATE_CODE = os.environ.get("ACCOUNT_CREATE_CODE", "").strip()
RESET_WEBHOOK_URL = os.environ.get("RESET_WEBHOOK_URL", "").strip()
SUBMISSION_WEBHOOK_URL = os.environ.get("SUBMISSION_WEBHOOK_URL", "").strip()
DECISION_WEBHOOK_URL = os.environ.get("DECISION_WEBHOOK_URL", "").strip()
RESET_TOKEN_TTL_SECONDS = 3600
DISCORD_CLIENT_ID = os.environ.get("DISCORD_CLIENT_ID", "").strip()
DISCORD_CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET", "").strip()
DISCORD_REDIRECT_URI = os.environ.get("DISCORD_REDIRECT_URI", "").strip()
DISCORD_OAUTH_SCOPE = "identify"
DISCORD_STATE_TTL_SECONDS = 600

SESSIONS: dict[str, str] = {}
RESET_TOKENS: dict[str, float] = {}
DISCORD_SESSIONS: dict[str, dict] = {}
DISCORD_OAUTH_STATES: dict[str, dict] = {}
STATE_FILE_LOCK = threading.RLock()

DEFAULT_SITE_DATA = {
    "forms": [
        {
            "id": "event-signup-form",
            "title": "Event Signup",
            "description": "Collect names, availability, and favorite activities for the next server event.",
            "style": "default",
            "maxResponses": 0,
            "maxAcceptedResponses": 0,
            "createdAt": 1743422400000,
            "updatedAt": 1743422400000,
            "questions": [
                {
                    "id": "display-name-question",
                    "type": "short",
                    "label": "What is your display name?",
                    "required": True,
                    "options": [],
                    "placeholder": "",
                    "content": "",
                    "graphPoints": [
                        {"label": "A", "value": 4},
                        {"label": "B", "value": 7},
                        {"label": "C", "value": 5},
                    ],
                    "scaleLeft": "Low",
                    "scaleRight": "High",
                },
                {
                    "id": "day-question",
                    "type": "multiple",
                    "label": "Which day works best?",
                    "required": True,
                    "options": ["Friday", "Saturday", "Sunday"],
                    "placeholder": "",
                    "content": "",
                    "graphPoints": [
                        {"label": "A", "value": 4},
                        {"label": "B", "value": 7},
                        {"label": "C", "value": 5},
                    ],
                    "scaleLeft": "Low",
                    "scaleRight": "High",
                },
                {
                    "id": "notes-question",
                    "type": "long",
                    "label": "Anything we should plan for?",
                    "required": False,
                    "options": [],
                    "placeholder": "",
                    "content": "",
                    "graphPoints": [
                        {"label": "A", "value": 4},
                        {"label": "B", "value": 7},
                        {"label": "C", "value": 5},
                    ],
                    "scaleLeft": "Low",
                    "scaleRight": "High",
                },
            ],
            "responses": [],
        }
    ]
}

DEFAULT_SECURITY_DATA = {
    "banned_device_ips": [],
    "banned_network_ips": [],
    "activity_log": [],
    "visitors": {},
    "deployments": [],
}


def password_hash(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


class DiscordFormsHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, directory: str, data_directory: str | None = None, **kwargs):
        self.root = Path(directory)
        self.data_root = Path(data_directory).resolve() if data_directory else self.root
        self.data_root.mkdir(parents=True, exist_ok=True)
        self.auth_file = self.data_root / ".admin_auth.json"
        self.site_data_file = self.data_root / ".site_data.json"
        self.security_file = self.data_root / ".security_data.json"
        self.ensure_auth_file()
        self.ensure_site_data_file()
        self.ensure_security_file()
        super().__init__(*args, directory=directory, **kwargs)

    def do_POST(self):
        if self.enforce_ban():
            return

        if self.path == "/api/login":
            self.handle_login()
            return

        if self.path == "/api/logout":
            self.handle_logout()
            return

        if self.path == "/api/send-reset-link":
            self.handle_send_reset_link()
            return

        if self.path == "/api/reset-password":
            self.handle_reset_password()
            return

        if self.path == "/api/create-account":
            self.handle_create_account()
            return

        if self.path == "/api/submit-response-notice":
            self.handle_submit_response_notice()
            return

        if self.path == "/api/submission-decision":
            self.handle_submission_decision()
            return

        if self.path == "/api/discord-logout":
            self.handle_discord_logout()
            return

        if self.path == "/api/import-pdf":
            self.handle_pdf_import()
            return

        if self.path == "/api/site-data":
            self.handle_save_site_data()
            return

        if self.path == "/api/submit-response":
            self.handle_submit_response()
            return

        if self.path == "/api/activity":
            self.handle_activity_event()
            return

        if self.path == "/api/admin/ban":
            self.handle_ban_ip()
            return

        if self.path == "/api/admin/unban":
            self.handle_unban_ip()
            return

        if self.path == "/api/admin/deploy":
            self.handle_deploy_site()
            return

        self.send_error(HTTPStatus.NOT_FOUND, "Unknown endpoint")

    def do_GET(self):
        if self.enforce_ban():
            return

        if self.path == "/api/auth-status":
            self.handle_auth_status()
            return

        if self.path == "/api/discord-auth-status":
            self.handle_discord_auth_status()
            return

        if self.path.startswith("/auth/discord/start"):
            self.handle_discord_oauth_start()
            return

        if self.path.startswith("/auth/discord/callback"):
            self.handle_discord_oauth_callback()
            return

        if self.path == "/api/site-data":
            self.handle_site_data()
            return

        if self.path == "/api/admin/security":
            self.handle_admin_security()
            return

        if self.path == "/api/admin/deploy-status":
            self.handle_admin_deploy_status()
            return

        super().do_GET()

    def ensure_auth_file(self):
        if self.auth_file.exists():
            return

        if not DEFAULT_USERNAME or not DEFAULT_PASSWORD:
            raise RuntimeError(
                "Missing admin credentials. Set ADMIN_USERNAME and ADMIN_PASSWORD in the local .env before starting the server."
            )

        self.write_accounts(
            [
                {
                    "username": DEFAULT_USERNAME,
                    "password_hash": password_hash(DEFAULT_PASSWORD),
                }
            ]
        )

    def load_auth(self) -> dict:
        return self.read_json_file(self.auth_file, default={"accounts": []})

    def ensure_site_data_file(self):
        if self.site_data_file.exists():
            return
        self.write_json_file(self.site_data_file, DEFAULT_SITE_DATA)

    def ensure_security_file(self):
        if self.security_file.exists():
            return
        self.write_json_file(self.security_file, DEFAULT_SECURITY_DATA)

    def load_site_data(self) -> dict:
        data = self.read_json_file(self.site_data_file, default=DEFAULT_SITE_DATA)
        if not isinstance(data, dict):
            data = dict(DEFAULT_SITE_DATA)
        data.setdefault("forms", [])
        return data

    def save_site_data(self, payload: dict):
        self.write_json_file(self.site_data_file, payload)

    def load_security(self) -> dict:
        data = self.read_json_file(self.security_file, default=DEFAULT_SECURITY_DATA)
        if not isinstance(data, dict):
            data = dict(DEFAULT_SECURITY_DATA)
        data["banned_device_ips"] = self.normalize_ban_entries(data.get("banned_device_ips", []), "device")
        data["banned_network_ips"] = self.normalize_ban_entries(data.get("banned_network_ips", []), "network")
        data.setdefault("activity_log", [])
        data.setdefault("visitors", {})
        data.setdefault("deployments", [])
        return data

    def save_security(self, payload: dict):
        self.write_json_file(self.security_file, payload)

    def read_json_file(self, path: Path, *, default: dict) -> dict:
        with STATE_FILE_LOCK:
            if not path.exists():
                data = json.loads(json.dumps(default))
                self.write_json_file(path, data)
                return data

            raw = path.read_text(encoding="utf-8").strip()
            if not raw:
                data = json.loads(json.dumps(default))
                self.write_json_file(path, data)
                return data

            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                decoder = json.JSONDecoder()
                try:
                    recovered, _end = decoder.raw_decode(raw)
                except json.JSONDecodeError:
                    data = json.loads(json.dumps(default))
                else:
                    data = recovered if isinstance(recovered, dict) else json.loads(json.dumps(default))
                self.write_json_file(path, data)
                return data

    def write_json_file(self, path: Path, payload: dict):
        serialized = json.dumps(payload)
        with STATE_FILE_LOCK:
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=str(path.parent), delete=False) as temp_file:
                temp_file.write(serialized)
                temp_name = temp_file.name
            os.replace(temp_name, path)

    def normalize_ban_entries(self, values: list, scope: str) -> list[dict]:
        normalized: list[dict] = []
        for item in values:
            if isinstance(item, str):
                value = item.strip()
                if value:
                    normalized.append(
                        {
                            "value": value,
                            "reason": "",
                            "scope": scope,
                            "created_at": 0,
                        }
                    )
                continue
            if not isinstance(item, dict):
                continue
            value = str(item.get("value", "")).strip()
            if not value:
                continue
            normalized.append(
                {
                    "value": value,
                    "reason": str(item.get("reason", "")).strip(),
                    "scope": scope,
                    "created_at": int(item.get("created_at", 0) or 0),
                }
            )
        return normalized

    def request_ip_info(self) -> dict[str, str]:
        device_ip = (self.client_address[0] if self.client_address else "") or ""
        forwarded = self.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        cf_ip = self.headers.get("CF-Connecting-IP", "").strip()
        network_ip = forwarded or cf_ip or device_ip
        return {
            "device_ip": device_ip,
            "network_ip": network_ip,
        }

    def viewer_key(self) -> str:
        ip_info = self.request_ip_info()
        return f"{ip_info['device_ip']}|{ip_info['network_ip']}"

    def current_actor_name(self, ip_info: dict[str, str] | None = None) -> str:
        username = SESSIONS.get(self.auth_token(), "").strip()
        if username:
            return username
        details = ip_info or self.request_ip_info()
        return details.get("network_ip") or details.get("device_ip") or "Unknown"

    def append_security_event(self, security: dict, *, category: str, action: str, detail: dict | None = None):
        ip_info = self.request_ip_info()
        key = self.viewer_key()
        now = int(time.time() * 1000)
        actor_name = self.current_actor_name(ip_info)
        is_admin = bool(SESSIONS.get(self.auth_token(), "").strip())
        viewer = security["visitors"].get(key, {})
        viewer.update(
            {
                "device_ip": ip_info["device_ip"],
                "network_ip": ip_info["network_ip"],
                "first_seen": viewer.get("first_seen", now),
                "last_seen": now,
                "request_count": int(viewer.get("request_count", 0)) + 1,
                "activity_count": int(viewer.get("activity_count", 0)) + 1,
                "user_agent": self.headers.get("User-Agent", ""),
                "last_path": self.path,
                "last_username": actor_name,
                "is_admin": is_admin,
                "last_action": action,
                "last_category": category,
            }
        )
        security["visitors"][key] = viewer
        security["activity_log"].append(
            {
                "timestamp": now,
                "category": category,
                "action": action,
                "path": self.path,
                "detail": detail or {},
                "device_ip": ip_info["device_ip"],
                "network_ip": ip_info["network_ip"],
                "username": actor_name,
                "is_admin": is_admin,
            }
        )
        security["activity_log"] = security["activity_log"][-5000:]

    def record_activity(self, *, category: str, action: str, detail: dict | None = None):
        security = self.load_security()
        self.append_security_event(security, category=category, action=action, detail=detail)
        self.save_security(security)

    def find_ban_entry(self, security: dict, ip_info: dict[str, str]) -> dict | None:
        for entry in security.get("banned_device_ips", []):
            if entry.get("value", "") == ip_info["device_ip"]:
                return entry
        for entry in security.get("banned_network_ips", []):
            if entry.get("value", "") == ip_info["network_ip"]:
                return entry
        return None

    def send_ban_response(self, entry: dict):
        reason = str(entry.get("reason", "")).strip() or "No reason was provided."
        scope_label = "Device IP" if entry.get("scope") == "device" else "Network IP"
        escaped_reason = html.escape(reason)
        escaped_value = html.escape(str(entry.get("value", "")))
        if self.path.startswith("/api/"):
            self.send_json(
                {
                    "ok": False,
                    "error": "Access denied.",
                    "reason": reason,
                    "scope": entry.get("scope", ""),
                    "value": entry.get("value", ""),
                },
                HTTPStatus.FORBIDDEN,
            )
            return

        if any(
            self.path.endswith(extension)
            for extension in (".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".map")
        ):
            body = f"Access denied.\n{scope_label}: {entry.get('value', '')}\nReason: {reason}\n".encode("utf-8")
            self.send_response(HTTPStatus.FORBIDDEN)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            self.wfile.flush()
            return

        page = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Access Denied</title>
  <style>
    body {{
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: radial-gradient(circle at top, rgba(255, 115, 115, 0.22), transparent 30%), linear-gradient(180deg, #120e12, #1f1416 60%, #2a1719);
      color: #f7ecec;
      font-family: "Trebuchet MS", "Segoe UI", sans-serif;
      padding: 24px;
    }}
    .ban-card {{
      width: min(720px, 100%);
      background: rgba(30, 20, 23, 0.94);
      border: 1px solid rgba(255, 170, 170, 0.25);
      border-radius: 24px;
      padding: 28px;
      box-shadow: 0 28px 80px rgba(0, 0, 0, 0.45);
    }}
    .eyebrow {{
      display: inline-block;
      margin-bottom: 16px;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(255, 115, 115, 0.14);
      color: #ffb7b7;
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }}
    h1 {{ margin: 0 0 12px; font-size: 34px; }}
    p {{ color: #e6cfd2; line-height: 1.6; }}
    .reason {{
      margin-top: 18px;
      padding: 18px;
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.08);
      white-space: pre-wrap;
    }}
    .meta {{
      margin-top: 16px;
      color: #cda9ae;
      font-size: 14px;
    }}
  </style>
</head>
<body>
  <section class="ban-card">
    <div class="eyebrow">Access Denied</div>
    <h1>This website blocked your access.</h1>
    <p>An administrator banned this {scope_label.lower()}. If you think this is wrong, contact the website owner and include the address below.</p>
    <div class="reason">{escaped_reason}</div>
    <div class="meta">{scope_label}: {escaped_value}</div>
  </section>
</body>
</html>
"""
        body = page.encode("utf-8")
        self.send_response(HTTPStatus.FORBIDDEN)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        self.wfile.flush()

    def enforce_ban(self) -> bool:
        security = self.load_security()
        ip_info = self.request_ip_info()
        entry = self.find_ban_entry(security, ip_info)
        if entry:
            self.append_security_event(
                security,
                category="security",
                action="blocked_request",
                detail={"scope": entry.get("scope", ""), "value": entry.get("value", "")},
            )
            self.save_security(security)
            self.send_ban_response(entry)
            return True
        if not any(
            self.path.endswith(extension)
            for extension in (".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".map")
        ):
            self.record_activity(category="request", action=self.command, detail={"path": self.path})
        return False

    def sanitize_site_data(self, payload: dict) -> dict:
        forms = []
        for form in payload.get("forms", []):
            sanitized_form = dict(form)
            sanitized_form["responses"] = [
                {
                    "id": response.get("id", ""),
                    "createdAt": response.get("createdAt", 0),
                    "meta": {
                        "status": response.get("meta", {}).get("status", "pending")
                    },
                }
                for response in form.get("responses", [])
            ]
            forms.append(sanitized_form)
        return {"forms": forms}

    def normalize_accounts(self) -> list[dict]:
        auth = self.load_auth()
        if isinstance(auth.get("accounts"), list) and auth["accounts"]:
            return auth["accounts"]
        username = auth.get("username", DEFAULT_USERNAME)
        password_hash_value = auth.get("password_hash", password_hash(DEFAULT_PASSWORD))
        return [{"username": username, "password_hash": password_hash_value}]

    def write_accounts(self, accounts: list[dict]):
        primary = accounts[0] if accounts else {
            "username": DEFAULT_USERNAME,
            "password_hash": password_hash(DEFAULT_PASSWORD),
        }
        self.write_json_file(
            self.auth_file,
            {
                "username": primary["username"],
                "password_hash": primary["password_hash"],
                "accounts": accounts,
            },
        )

    def save_auth(self, username: str, password: str):
        self.write_accounts(
            [
                {
                    "username": username,
                    "password_hash": password_hash(password),
                }
            ]
        )

    def parse_json_body(self) -> dict:
        content_length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(content_length)
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        self.wfile.flush()

    def auth_token(self) -> str:
        return self.headers.get("X-Auth-Token", "").strip()

    def discord_auth_configured(self) -> bool:
        return bool(DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET and DISCORD_REDIRECT_URI)

    def parse_cookies(self) -> dict[str, str]:
        raw = self.headers.get("Cookie", "")
        cookies: dict[str, str] = {}
        for part in raw.split(";"):
            if "=" not in part:
                continue
            key, value = part.split("=", 1)
            cookies[key.strip()] = value.strip()
        return cookies

    def discord_session_token(self) -> str:
        return self.parse_cookies().get("discord_forms_user", "")

    def discord_user(self) -> dict | None:
        token = self.discord_session_token()
        if not token:
            return None
        return DISCORD_SESSIONS.get(token)

    def send_redirect(self, location: str):
        self.send_response(HTTPStatus.FOUND)
        self.send_header("Location", location)
        self.end_headers()

    def set_cookie(self, name: str, value: str, *, max_age: int | None = None):
        cookie = f"{name}={value}; Path=/; HttpOnly; SameSite=Lax"
        if max_age is not None:
            cookie = f"{cookie}; Max-Age={max_age}"
        self.send_header("Set-Cookie", cookie)

    def authenticated(self) -> bool:
        token = self.auth_token()
        return bool(token and token in SESSIONS)

    def handle_auth_status(self):
        self.send_json(
            {
                "ok": True,
                "authenticated": self.authenticated(),
                "username": SESSIONS.get(self.auth_token(), ""),
            }
        )

    def handle_site_data(self):
        payload = self.load_site_data()
        if self.authenticated():
            self.send_json({"ok": True, "data": payload})
            return
        self.send_json({"ok": True, "data": self.sanitize_site_data(payload)})

    def handle_save_site_data(self):
        if not self.authenticated():
            self.send_json({"ok": False, "error": "Admin login required."}, HTTPStatus.UNAUTHORIZED)
            return
        payload = self.parse_json_body()
        data = payload.get("data")
        if not isinstance(data, dict) or not isinstance(data.get("forms"), list):
            self.send_json({"ok": False, "error": "Invalid site data payload."}, HTTPStatus.BAD_REQUEST)
            return
        self.save_site_data(data)
        self.record_activity(category="admin", action="save_site_data", detail={"forms": len(data.get("forms", []))})
        self.send_json({"ok": True})

    def handle_submit_response(self):
        payload = self.parse_json_body()
        form_id = payload.get("form_id", "").strip()
        answers = payload.get("answers")
        meta = payload.get("meta") or {}
        site_data = self.load_site_data()
        form = next((item for item in site_data.get("forms", []) if item.get("id") == form_id), None)
        if not form:
            self.send_json({"ok": False, "error": "Form not found."}, HTTPStatus.NOT_FOUND)
            return
        if not isinstance(answers, dict):
            self.send_json({"ok": False, "error": "Invalid response payload."}, HTTPStatus.BAD_REQUEST)
            return

        response = {
            "id": uuid.uuid4().hex,
            "createdAt": int(time.time() * 1000),
            "answers": answers,
            "meta": {
                "source": str(meta.get("source", "")),
                "customSource": str(meta.get("customSource", "")),
                "platformLabel": str(meta.get("platformLabel", "")),
                "username": str(meta.get("username", "")),
                "status": "pending",
                "decisionReason": "",
            },
        }
        form.setdefault("responses", [])
        form["responses"].insert(0, response)
        form["updatedAt"] = int(time.time() * 1000)
        self.save_site_data(site_data)
        self.record_activity(
            category="public",
            action="submit_response",
            detail={"form_id": form_id, "response_id": response["id"], "platform": response["meta"]["platformLabel"]},
        )
        self.send_json({"ok": True, "response": response})

    def handle_activity_event(self):
        payload = self.parse_json_body()
        action = str(payload.get("action", "")).strip() or "client_event"
        detail = payload.get("detail")
        if not isinstance(detail, dict):
            detail = {}
        self.record_activity(category="client", action=action, detail=detail)
        self.send_json({"ok": True})

    def handle_admin_security(self):
        if not self.authenticated():
            self.send_json({"ok": False, "error": "Admin login required."}, HTTPStatus.UNAUTHORIZED)
            return
        security = self.load_security()
        visitors = list(security.get("visitors", {}).values())
        visitors.sort(key=lambda item: item.get("last_seen", 0), reverse=True)
        self.send_json(
            {
                "ok": True,
                "security": {
                    "banned_device_ips": security.get("banned_device_ips", []),
                    "banned_network_ips": security.get("banned_network_ips", []),
                    "activity_log": list(reversed(security.get("activity_log", [])[-500:])),
                    "visitors": visitors[:500],
                    "deployments": list(reversed(security.get("deployments", [])[-25:])),
                },
            }
        )

    def deploy_config_status(self) -> dict:
        github_push_token = os.environ.get("GITHUB_PUSH_TOKEN", "").strip()
        github_deploy_repo_url = self.git_deploy_repo_url()
        github_deploy_branch = self.git_deploy_branch()
        render_public_url = os.environ.get("RENDER_PUBLIC_URL", "").strip()
        deploy_method = os.environ.get("DEPLOY_METHOD", "").strip()
        deploy_local_dir = os.environ.get("DEPLOY_LOCAL_DIR", "").strip()
        deploy_user = os.environ.get("DEPLOY_USER", "").strip()
        deploy_host = os.environ.get("DEPLOY_HOST", "").strip()
        deploy_path = os.environ.get("DEPLOY_PATH", "").strip()
        deploy_ssh_port = os.environ.get("DEPLOY_SSH_PORT", "22").strip() or "22"

        inferred_method = deploy_method
        if github_push_token and github_deploy_repo_url:
            inferred_method = "github-render"
        elif not inferred_method:
            if deploy_local_dir:
                inferred_method = "local-copy"
            elif deploy_host and deploy_path:
                inferred_method = "rsync"

        configured = False
        target_summary = "Not configured"

        if inferred_method == "github-render" and github_push_token and github_deploy_repo_url:
            configured = True
            render_target = f" -> {render_public_url}" if render_public_url else ""
            target_summary = f"GitHub push: {github_deploy_repo_url} ({github_deploy_branch}){render_target}"
        elif inferred_method == "local-copy" and deploy_local_dir:
            configured = True
            target_summary = f"Local directory: {deploy_local_dir}"
        elif inferred_method == "rsync" and deploy_host and deploy_path:
            configured = True
            remote_host = f"{deploy_user}@{deploy_host}" if deploy_user else deploy_host
            target_summary = f"Remote rsync: {remote_host}:{deploy_path} (SSH port {deploy_ssh_port})"

        return {
            "configured": configured,
            "method": inferred_method or "not-configured",
            "target_summary": target_summary,
            "script_exists": (self.root / "deploy_website.sh").exists(),
            "git_push_ready": bool(github_push_token and github_deploy_repo_url),
            "webhooks": {
                "reset": bool(RESET_WEBHOOK_URL),
                "submission": bool(SUBMISSION_WEBHOOK_URL),
                "decision": bool(DECISION_WEBHOOK_URL),
            },
            "discord_oauth": {
                "configured": self.discord_auth_configured(),
            },
        }

    def run_command(self, args: list[str], *, timeout: int = 300) -> subprocess.CompletedProcess:
        return subprocess.run(
            args,
            cwd=str(self.root),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )

    def git_command_output(self, args: list[str]) -> str:
        result = self.run_command(args, timeout=30)
        if result.returncode != 0:
            return ""
        return (result.stdout or "").strip()

    def git_deploy_repo_url(self) -> str:
        return os.environ.get("GITHUB_DEPLOY_REPO_URL", "").strip() or self.git_command_output(
            ["git", "config", "--get", "remote.origin.url"]
        )

    def git_deploy_branch(self) -> str:
        return os.environ.get("GITHUB_DEPLOY_BRANCH", "").strip() or self.git_command_output(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"]
        ) or "main"

    def redacted_output(self, text: str, secret: str) -> str:
        if not secret:
            return text
        return text.replace(secret, "[REDACTED]")

    def github_authenticated_repo_url(self, repo_url: str, token: str) -> str:
        if repo_url.startswith("https://github.com/"):
            prefix = "https://github.com/"
            return f"https://x-access-token:{urllib.parse.quote(token, safe='')}@github.com/{repo_url[len(prefix):]}"
        return repo_url

    def handle_github_render_deploy(self):
        github_push_token = os.environ.get("GITHUB_PUSH_TOKEN", "").strip()
        github_deploy_repo_url = self.git_deploy_repo_url()
        github_deploy_branch = self.git_deploy_branch()

        if not github_push_token or not github_deploy_repo_url:
            return {
                "ok": False,
                "status": "failed",
                "exit_code": 1,
                "stdout": "",
                "stderr": "",
                "error": "GitHub/Render deploy is not configured. Set GITHUB_PUSH_TOKEN and make sure the repo remote exists.",
            }

        status_result = self.run_command(["git", "status", "--porcelain"])
        if status_result.returncode != 0:
            return {
                "ok": False,
                "status": "failed",
                "exit_code": status_result.returncode,
                "stdout": self.redacted_output(status_result.stdout or "", github_push_token),
                "stderr": self.redacted_output(status_result.stderr or "", github_push_token),
                "error": "Could not read git status.",
            }

        if (status_result.stdout or "").strip():
            add_result = self.run_command(["git", "add", "-A"])
            if add_result.returncode != 0:
                return {
                    "ok": False,
                    "status": "failed",
                    "exit_code": add_result.returncode,
                    "stdout": self.redacted_output(add_result.stdout or "", github_push_token),
                    "stderr": self.redacted_output(add_result.stderr or "", github_push_token),
                    "error": "Could not stage website changes for deploy.",
                }
            commit_message = f"Auto deploy website {time.strftime('%Y-%m-%d %H:%M:%S')}"
            commit_result = self.run_command(["git", "commit", "-m", commit_message], timeout=60)
            if commit_result.returncode != 0:
                combined = f"{commit_result.stdout or ''}\n{commit_result.stderr or ''}".lower()
                if "nothing to commit" not in combined:
                    return {
                        "ok": False,
                        "status": "failed",
                        "exit_code": commit_result.returncode,
                        "stdout": self.redacted_output(commit_result.stdout or "", github_push_token),
                        "stderr": self.redacted_output(commit_result.stderr or "", github_push_token),
                        "error": "Could not commit website changes for deploy.",
                    }

        push_result = self.run_command(
            ["git", "push", self.github_authenticated_repo_url(github_deploy_repo_url, github_push_token), github_deploy_branch],
            timeout=300,
        )
        stdout = self.redacted_output(push_result.stdout or "", github_push_token).strip()
        stderr = self.redacted_output(push_result.stderr or "", github_push_token).strip()
        success = push_result.returncode == 0
        if success:
            extra_line = "Pushed to GitHub. Render should auto-deploy the new commit."
            stdout = f"{stdout}\n{extra_line}".strip()
        return {
            "ok": success,
            "status": "success" if success else "failed",
            "exit_code": push_result.returncode,
            "stdout": stdout,
            "stderr": stderr,
            "error": "" if success else "GitHub push failed.",
        }

    def handle_admin_deploy_status(self):
        if not self.authenticated():
            self.send_json({"ok": False, "error": "Admin login required."}, HTTPStatus.UNAUTHORIZED)
            return
        self.send_json({"ok": True, "deploy_status": self.deploy_config_status()})

    def handle_ban_ip(self):
        if not self.authenticated():
            self.send_json({"ok": False, "error": "Admin login required."}, HTTPStatus.UNAUTHORIZED)
            return
        payload = self.parse_json_body()
        scope = str(payload.get("scope", "")).strip()
        value = str(payload.get("value", "")).strip()
        reason = str(payload.get("reason", "")).strip()
        if scope not in {"device", "network"} or not value:
            self.send_json({"ok": False, "error": "Invalid ban request."}, HTTPStatus.BAD_REQUEST)
            return
        security = self.load_security()
        key = "banned_device_ips" if scope == "device" else "banned_network_ips"
        existing = next((entry for entry in security[key] if entry.get("value", "") == value), None)
        if existing:
            existing["reason"] = reason
            existing["created_at"] = existing.get("created_at", 0) or int(time.time() * 1000)
        else:
            security[key].append(
                {
                    "value": value,
                    "reason": reason,
                    "scope": scope,
                    "created_at": int(time.time() * 1000),
                }
            )
        self.save_security(security)
        self.record_activity(category="admin", action="ban_ip", detail={"scope": scope, "value": value, "reason": reason})
        self.send_json({"ok": True})

    def handle_unban_ip(self):
        if not self.authenticated():
            self.send_json({"ok": False, "error": "Admin login required."}, HTTPStatus.UNAUTHORIZED)
            return
        payload = self.parse_json_body()
        scope = str(payload.get("scope", "")).strip()
        value = str(payload.get("value", "")).strip()
        if scope not in {"device", "network"} or not value:
            self.send_json({"ok": False, "error": "Invalid unban request."}, HTTPStatus.BAD_REQUEST)
            return
        security = self.load_security()
        key = "banned_device_ips" if scope == "device" else "banned_network_ips"
        security[key] = [item for item in security.get(key, []) if item.get("value", "") != value]
        self.save_security(security)
        self.record_activity(category="admin", action="unban_ip", detail={"scope": scope, "value": value})
        self.send_json({"ok": True})

    def handle_deploy_site(self):
        if not self.authenticated():
            self.send_json({"ok": False, "error": "Admin login required."}, HTTPStatus.UNAUTHORIZED)
            return

        if os.environ.get("GITHUB_PUSH_TOKEN", "").strip() and self.git_deploy_repo_url():
            deploy_result = self.handle_github_render_deploy()
        else:
            script_path = self.root / "deploy_website.sh"
            if not script_path.exists():
                self.send_json({"ok": False, "error": "Deploy script is missing."}, HTTPStatus.NOT_FOUND)
                return

            result = self.run_command([str(script_path)], timeout=300)
            deploy_result = {
                "ok": result.returncode == 0,
                "status": "success" if result.returncode == 0 else "failed",
                "exit_code": result.returncode,
                "stdout": (result.stdout or "").strip(),
                "stderr": (result.stderr or "").strip(),
                "error": "" if result.returncode == 0 else "Website deploy failed.",
            }

        security = self.load_security()
        security.setdefault("deployments", [])
        security["deployments"].append(
            {
                "timestamp": int(time.time() * 1000),
                "status": deploy_result["status"],
                "exit_code": deploy_result["exit_code"],
                "stdout": deploy_result["stdout"][-4000:],
                "stderr": deploy_result["stderr"][-4000:],
                "ran_by": self.current_actor_name(),
            }
        )
        security["deployments"] = security["deployments"][-100:]
        self.save_security(security)
        self.record_activity(category="admin", action="deploy_site", detail={"exit_code": deploy_result["exit_code"]})

        status = HTTPStatus.OK if deploy_result["ok"] else HTTPStatus.BAD_GATEWAY
        self.send_json(deploy_result, status)

    def handle_discord_auth_status(self):
        user = self.discord_user()
        self.send_json(
            {
                "ok": True,
                "configured": self.discord_auth_configured(),
                "authenticated": bool(user),
                "id": (user or {}).get("id", ""),
                "username": (user or {}).get("username", ""),
                "display_name": (user or {}).get("global_name") or (user or {}).get("username", ""),
                "avatar_url": (user or {}).get("avatar_url", ""),
            }
        )

    def handle_login(self):
        payload = self.parse_json_body()
        username = payload.get("username", "").strip()
        password = payload.get("password", "")
        accounts = self.normalize_accounts()

        matched_account = next(
            (
                account for account in accounts
                if username == account.get("username", "") and password_hash(password) == account.get("password_hash", "")
            ),
            None,
        )

        if not matched_account:
            self.send_json(
                {"ok": False, "error": "Invalid login."},
                HTTPStatus.UNAUTHORIZED,
            )
            return

        token = uuid.uuid4().hex
        SESSIONS[token] = username
        self.send_json({"ok": True, "token": token, "username": username})

    def handle_create_account(self):
        payload = self.parse_json_body()
        code = payload.get("code", "").strip()
        username = payload.get("username", "").strip()
        password = payload.get("password", "")

        if not ACCOUNT_CREATE_CODE:
            self.send_json({"ok": False, "error": "Extra account creation is not configured."}, HTTPStatus.SERVICE_UNAVAILABLE)
            return

        if code != ACCOUNT_CREATE_CODE:
            self.send_json({"ok": False, "error": "Wrong account code."}, HTTPStatus.FORBIDDEN)
            return

        if not username or not password:
            self.send_json({"ok": False, "error": "Username and password are required."}, HTTPStatus.BAD_REQUEST)
            return

        accounts = self.normalize_accounts()
        if any(account.get("username", "").lower() == username.lower() for account in accounts):
            self.send_json({"ok": False, "error": "That username already exists."}, HTTPStatus.CONFLICT)
            return

        accounts.append(
            {
                "username": username,
                "password_hash": password_hash(password),
            }
        )
        self.write_accounts(accounts)
        self.send_json({"ok": True})

    def handle_logout(self):
        token = self.auth_token()
        if token:
            SESSIONS.pop(token, None)
        self.send_json({"ok": True})

    def handle_discord_logout(self):
        token = self.discord_session_token()
        if token:
            DISCORD_SESSIONS.pop(token, None)
        self.send_response(HTTPStatus.OK)
        self.set_cookie("discord_forms_user", "", max_age=0)
        body = json.dumps({"ok": True}).encode("utf-8")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        self.wfile.flush()

    def handle_discord_oauth_start(self):
        if not self.discord_auth_configured():
            self.send_json({"ok": False, "error": "Discord OAuth is not configured."}, HTTPStatus.SERVICE_UNAVAILABLE)
            return

        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        next_hash = params.get("next", ["#dashboard"])[0]
        state_token = uuid.uuid4().hex
        DISCORD_OAUTH_STATES[state_token] = {
            "created_at": time.time(),
            "next_hash": next_hash,
        }
        query = urllib.parse.urlencode(
            {
                "client_id": DISCORD_CLIENT_ID,
                "redirect_uri": DISCORD_REDIRECT_URI,
                "response_type": "code",
                "scope": DISCORD_OAUTH_SCOPE,
                "state": state_token,
                "prompt": "consent",
            }
        )
        self.send_redirect(f"https://discord.com/oauth2/authorize?{query}")

    def discord_avatar_url(self, user: dict) -> str:
        avatar = user.get("avatar")
        user_id = user.get("id")
        if not avatar or not user_id:
            return ""
        extension = "gif" if str(avatar).startswith("a_") else "png"
        return f"https://cdn.discordapp.com/avatars/{user_id}/{avatar}.{extension}?size=256"

    def handle_discord_oauth_callback(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        code = params.get("code", [""])[0]
        state_token = params.get("state", [""])[0]
        oauth_state = DISCORD_OAUTH_STATES.pop(state_token, None)

        if not code or not oauth_state or time.time() - oauth_state["created_at"] > DISCORD_STATE_TTL_SECONDS:
            self.send_redirect("/#dashboard")
            return

        token_request_body = urllib.parse.urlencode(
            {
                "client_id": DISCORD_CLIENT_ID,
                "client_secret": DISCORD_CLIENT_SECRET,
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": DISCORD_REDIRECT_URI,
            }
        ).encode("utf-8")
        token_request = urllib.request.Request(
            "https://discord.com/api/oauth2/token",
            data=token_request_body,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "discord-forms-local/1.0",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(token_request, timeout=10) as response:
                token_payload = json.loads(response.read().decode("utf-8"))
            access_token = token_payload.get("access_token", "")
            user_request = urllib.request.Request(
                "https://discord.com/api/users/@me",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "User-Agent": "discord-forms-local/1.0",
                },
            )
            with urllib.request.urlopen(user_request, timeout=10) as response:
                user_payload = json.loads(response.read().decode("utf-8"))
        except Exception:
            self.send_redirect(f"/{oauth_state['next_hash']}")
            return

        session_token = uuid.uuid4().hex
        user_payload["avatar_url"] = self.discord_avatar_url(user_payload)
        DISCORD_SESSIONS[session_token] = user_payload

        self.send_response(HTTPStatus.FOUND)
        self.set_cookie("discord_forms_user", session_token, max_age=60 * 60 * 24 * 14)
        self.send_header("Location", f"/{oauth_state['next_hash']}")
        self.end_headers()

    def handle_send_reset_link(self):
        payload = self.parse_json_body()
        code = payload.get("code", "").strip()
        base_url = payload.get("base_url", "").strip()

        if not RESET_CODE:
            self.send_json({"ok": False, "error": "Reset links are not configured on this server."}, HTTPStatus.SERVICE_UNAVAILABLE)
            return

        if code != RESET_CODE:
            self.send_json({"ok": False, "error": "Wrong reset code."}, HTTPStatus.FORBIDDEN)
            return

        if not base_url:
            self.send_json({"ok": False, "error": "Missing base URL."}, HTTPStatus.BAD_REQUEST)
            return

        if not RESET_WEBHOOK_URL:
            self.send_json({"ok": False, "error": "Reset webhook is not configured on this server."}, HTTPStatus.SERVICE_UNAVAILABLE)
            return

        token = uuid.uuid4().hex
        RESET_TOKENS[token] = time.time()
        reset_link = f"{base_url}#reset/{token}"
        webhook_payload = json.dumps(
            {
                "content": (
                    "Discord Forms reset link:\n"
                    f"{reset_link}"
                    + (f"\n\nAccount create code:\n{ACCOUNT_CREATE_CODE}" if ACCOUNT_CREATE_CODE else "")
                )
            }
        ).encode("utf-8")

        request = urllib.request.Request(
            RESET_WEBHOOK_URL,
            data=webhook_payload,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "discord-forms-local/1.0",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=10):
                pass
        except urllib.error.HTTPError as exc:
            error_body = ""
            try:
                error_body = exc.read().decode("utf-8", errors="replace").strip()
            except Exception:
                error_body = ""
            message = f"Webhook rejected the request ({exc.code} {exc.reason})."
            if error_body:
                message = f"{message} {error_body}"
            self.send_json({"ok": False, "error": message}, HTTPStatus.BAD_GATEWAY)
            return
        except urllib.error.URLError as exc:
            reason = getattr(exc, "reason", exc)
            self.send_json(
                {"ok": False, "error": f"Could not reach the webhook: {reason}"},
                HTTPStatus.BAD_GATEWAY,
            )
            return
        except Exception as exc:
            self.send_json(
                {"ok": False, "error": f"Could not send reset link to webhook: {exc}"},
                HTTPStatus.BAD_GATEWAY,
            )
            return

        self.send_json({"ok": True})

    def post_webhook_json(self, webhook_url: str, payload: dict):
        if not webhook_url:
            return "Webhook is not configured on this server."
        request = urllib.request.Request(
            webhook_url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "User-Agent": "discord-forms-local/1.0",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=10):
                return None
        except urllib.error.HTTPError as exc:
            error_body = ""
            try:
                error_body = exc.read().decode("utf-8", errors="replace").strip()
            except Exception:
                error_body = ""
            message = f"Webhook rejected the request ({exc.code} {exc.reason})."
            if error_body:
                message = f"{message} {error_body}"
            return message
        except urllib.error.URLError as exc:
            reason = getattr(exc, "reason", exc)
            return f"Could not reach the webhook: {reason}"
        except Exception as exc:
            return f"Could not send webhook request: {exc}"

    def handle_submit_response_notice(self):
        payload = self.parse_json_body()
        form_title = payload.get("form_title", "").strip() or "Untitled Form"
        form_id = payload.get("form_id", "").strip()
        response_id = payload.get("response_id", "").strip()
        form_link = payload.get("form_link", "").strip()
        review_link = payload.get("review_link", "").strip()
        actions_link = payload.get("actions_link", "").strip()
        platform_label = payload.get("platform_label", "").strip() or "Unknown"
        username = payload.get("username", "").strip() or "Unknown"

        if not SUBMISSION_WEBHOOK_URL:
            self.send_json({"ok": True, "skipped": True, "reason": "submission_webhook_not_configured"})
            return

        webhook_payload = {
            "content": "New form submission",
            "embeds": [
                {
                    "title": form_title,
                    "color": 5793266,
                    "fields": [
                        {"name": "Platform", "value": platform_label, "inline": True},
                        {"name": "Username", "value": f"@{username}", "inline": True},
                        {"name": "Form ID", "value": form_id or "Unknown", "inline": False},
                        {"name": "Response ID", "value": response_id or "Unknown", "inline": False},
                        {"name": "Form Link", "value": form_link or "Missing", "inline": False},
                        {"name": "Review Link", "value": review_link or "Missing", "inline": False},
                        {
                            "name": "Actions",
                            "value": (
                                f"[Open Form]({form_link})\n[Review Submission]({review_link})\n[Approve Or Reject]({actions_link})"
                                if form_link and review_link and actions_link else "Links missing"
                            ),
                            "inline": False,
                        },
                    ],
                }
            ],
        }

        error = self.post_webhook_json(SUBMISSION_WEBHOOK_URL, webhook_payload)
        if error:
            self.send_json({"ok": False, "error": error}, HTTPStatus.BAD_GATEWAY)
            return

        self.send_json({"ok": True})

    def handle_submission_decision(self):
        payload = self.parse_json_body()
        decision = payload.get("decision", "").strip().lower()
        reason = payload.get("reason", "").strip()
        form_title = payload.get("form_title", "").strip() or "Untitled Form"
        form_link = payload.get("form_link", "").strip()
        platform_label = payload.get("platform_label", "").strip() or "Unknown"
        username = payload.get("username", "").strip() or "Unknown"

        if decision not in {"approved", "rejected"}:
            self.send_json({"ok": False, "error": "Invalid decision."}, HTTPStatus.BAD_REQUEST)
            return

        if decision == "rejected" and not reason:
            self.send_json({"ok": False, "error": "Reject reason is required."}, HTTPStatus.BAD_REQUEST)
            return

        if not DECISION_WEBHOOK_URL:
            self.send_json({"ok": True, "skipped": True, "reason": "decision_webhook_not_configured"})
            return

        status_text = "APPROVED" if decision == "approved" else "REJECTED"
        description = [
            f"@everyone {status_text}",
            f"Platform: {platform_label}",
            f"Username: @{username}",
            f"Form: {form_title}",
        ]
        if form_link:
            description.append(f"Form Link: {form_link}")
        if reason:
            description.append(f"Reason: {reason}")

        error = self.post_webhook_json(
            DECISION_WEBHOOK_URL,
            {
                "content": "\n".join(description)
            },
        )
        if error:
            self.send_json({"ok": False, "error": error}, HTTPStatus.BAD_GATEWAY)
            return

        self.send_json({"ok": True})

    def handle_reset_password(self):
        payload = self.parse_json_body()
        token = payload.get("token", "").strip()
        username = payload.get("username", "").strip()
        password = payload.get("password", "")

        created_at = RESET_TOKENS.get(token)
        if not created_at or time.time() - created_at > RESET_TOKEN_TTL_SECONDS:
            self.send_json({"ok": False, "error": "Reset link is invalid or expired."}, HTTPStatus.FORBIDDEN)
            return

        if not username or not password:
            self.send_json({"ok": False, "error": "Username and password are required."}, HTTPStatus.BAD_REQUEST)
            return

        self.save_auth(username, password)
        RESET_TOKENS.pop(token, None)
        SESSIONS.clear()
        self.send_json({"ok": True})

    def handle_pdf_import(self):
        content_length = int(self.headers.get("Content-Length", "0"))
        pdf_bytes = self.rfile.read(content_length)

        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as pdf_file:
          pdf_file.write(pdf_bytes)
          pdf_path = Path(pdf_file.name)

        try:
            result = subprocess.run(
                ["pdftotext", str(pdf_path), "-"],
                capture_output=True,
                text=True,
                check=True,
            )
        except subprocess.CalledProcessError as exc:
            body = json.dumps({
                "ok": False,
                "error": exc.stderr.strip() or "PDF extraction failed"
            }).encode("utf-8")
            self.send_response(HTTPStatus.BAD_REQUEST)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            self.wfile.flush()
            return
        finally:
            try:
                os.unlink(pdf_path)
            except FileNotFoundError:
                pass

        body = json.dumps({
            "ok": True,
            "text": result.stdout
        }).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        self.wfile.flush()

    def log_message(self, format: str, *args):
        return


def parse_args():
    parser = argparse.ArgumentParser(description="Discord Forms Local server")
    parser.add_argument("--host", default=os.environ.get("HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8134")))
    parser.add_argument("--root", required=True)
    parser.add_argument("--data-dir", default=os.environ.get("DATA_DIR", ""))
    return parser.parse_args()


def main():
    args = parse_args()
    root = Path(args.root).resolve()
    data_dir = Path(args.data_dir).resolve() if args.data_dir else root

    def handler(*handler_args, **handler_kwargs):
        return DiscordFormsHandler(*handler_args, directory=str(root), data_directory=str(data_dir), **handler_kwargs)

    server = ThreadingHTTPServer((args.host, args.port), handler)
    server.serve_forever()


if __name__ == "__main__":
    main()

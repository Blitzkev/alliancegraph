"""AllyGraph backend: a tiny JSON API over a JSON file, plus static hosting of the built frontend."""

import json
import os
import re
import tempfile
import threading
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_from_directory

ROOT_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DATA_FILE = Path(os.environ.get("ALLYGRAPH_DATA", ROOT_DIR / "data" / "alliances.json"))
DIST_DIR = ROOT_DIR / "web" / "dist"

TYPES = ("root", "family", "academy")
NAME_MAX = 256
TAG_MAX = 4
SERVER_RE = re.compile(r"^[0-9]{4}$")


def _now():
    return datetime.now(timezone.utc).isoformat()


class Store:
    """Servers and alliances persisted to a JSON file. All access goes through a lock."""

    def __init__(self, path):
        self.path = Path(path)
        self.lock = threading.Lock()

    def load(self):
        if not self.path.exists():
            return {"servers": [], "alliances": []}
        with self.path.open(encoding="utf-8") as f:
            data = json.load(f)
        if "servers" not in data:
            # Files written before servers existed: create a server for each one alliances use.
            numbers = sorted({a["server"] for a in data["alliances"]})
            data["servers"] = [{"number": n, "createdAt": _now()} for n in numbers]
        return data

    def save(self, data):
        # Write to a temp file and rename so a crash never leaves a half-written file.
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, self.path)


def _clean_text(value):
    return unicodedata.normalize("NFC", value).strip() if isinstance(value, str) else None


def _clean_server(value):
    value = value.strip() if isinstance(value, str) else None
    return value if value and SERVER_RE.match(value) else None


def validate_alliance(payload, data):
    """Return (alliance_fields, errors). errors maps field name -> message."""
    errors = {}
    alliances = data["alliances"]

    name = _clean_text(payload.get("name"))
    if not name:
        errors["name"] = "Name is required."
    elif len(name) > NAME_MAX:
        errors["name"] = f"Name must be at most {NAME_MAX} characters."

    tag = _clean_text(payload.get("tag"))
    if not tag:
        errors["tag"] = "Tag is required."
    elif len(tag) > TAG_MAX:
        errors["tag"] = f"Tag must be 1-{TAG_MAX} characters."

    server = _clean_server(payload.get("server"))
    if server is None or not any(s["number"] == server for s in data["servers"]):
        errors["server"] = "Select an existing server."

    kind = payload.get("type")
    if kind not in TYPES:
        errors["type"] = f"Type must be one of: {', '.join(TYPES)}."

    root_id = payload.get("rootId")
    if kind == "root":
        root_id = None
    elif kind in ("family", "academy"):
        root = next((a for a in alliances if a["id"] == root_id), None)
        if root is None or root["type"] != "root":
            errors["rootId"] = "A valid root alliance must be selected."
        elif "server" not in errors and root["server"] != server:
            errors["rootId"] = f"The root alliance must be on server {server}."

    if "tag" not in errors and "server" not in errors:
        if any(a["server"] == server and a["tag"] == tag for a in alliances):
            errors["tag"] = f"Tag [#{tag}] is already used on server {server}."

    fields = {"name": name, "tag": tag, "server": server, "type": kind, "rootId": root_id}
    return fields, errors


def create_app(data_file=DEFAULT_DATA_FILE):
    app = Flask(__name__, static_folder=None)
    store = Store(data_file)

    def bad_body():
        return jsonify({"errors": {"_": "Request body must be a JSON object."}}), 400

    @app.get("/api/servers")
    def list_servers():
        with store.lock:
            return jsonify(store.load()["servers"])

    @app.post("/api/servers")
    def create_server():
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return bad_body()
        number = _clean_server(payload.get("number"))
        if number is None:
            return jsonify({"errors": {"number": "Server must be exactly 4 digits (e.g. 0042)."}}), 400
        with store.lock:
            data = store.load()
            if any(s["number"] == number for s in data["servers"]):
                return jsonify({"errors": {"number": f"Server {number} already exists."}}), 400
            server = {"number": number, "createdAt": _now()}
            data["servers"].append(server)
            store.save(data)
        return jsonify(server), 201

    @app.delete("/api/servers/<number>")
    def delete_server(number):
        # Deleting a server also deletes every alliance on it.
        with store.lock:
            data = store.load()
            if not any(s["number"] == number for s in data["servers"]):
                return jsonify({"errors": {"_": "Server not found."}}), 404
            deleted = sorted(a["id"] for a in data["alliances"] if a["server"] == number)
            data["servers"] = [s for s in data["servers"] if s["number"] != number]
            data["alliances"] = [a for a in data["alliances"] if a["server"] != number]
            store.save(data)
        return jsonify({"deleted": deleted})

    @app.get("/api/alliances")
    def list_alliances():
        with store.lock:
            return jsonify(store.load()["alliances"])

    @app.post("/api/alliances")
    def create_alliance():
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return bad_body()
        with store.lock:
            data = store.load()
            fields, errors = validate_alliance(payload, data)
            if errors:
                return jsonify({"errors": errors}), 400
            alliance = {"id": str(uuid.uuid4()), **fields, "createdAt": _now()}
            data["alliances"].append(alliance)
            store.save(data)
        return jsonify(alliance), 201

    @app.delete("/api/alliances/<alliance_id>")
    def delete_alliance(alliance_id):
        # Deleting a root also deletes every family/academy alliance under it.
        with store.lock:
            data = store.load()
            alliances = data["alliances"]
            if not any(a["id"] == alliance_id for a in alliances):
                return jsonify({"errors": {"_": "Alliance not found."}}), 404
            deleted = {a["id"] for a in alliances if a["id"] == alliance_id or a["rootId"] == alliance_id}
            data["alliances"] = [a for a in alliances if a["id"] not in deleted]
            store.save(data)
        return jsonify({"deleted": sorted(deleted)})

    @app.get("/")
    @app.get("/<path:path>")
    def frontend(path="index.html"):
        if path.startswith("api/"):
            abort(404)
        if not (DIST_DIR / "index.html").exists():
            return "Frontend not built. Run `npm run build` in web/.", 503
        if (DIST_DIR / path).is_file():
            return send_from_directory(DIST_DIR, path)
        return send_from_directory(DIST_DIR, "index.html")

    return app


if __name__ == "__main__":
    # Localhost only by default; set HOST=0.0.0.0 to accept connections from other machines.
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", 5050))
    create_app().run(host=host, port=port, debug=os.environ.get("FLASK_DEBUG") == "1")

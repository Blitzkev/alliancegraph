"""AllyGraph backend: a tiny JSON API over per-user JSON files, plus static hosting of the built frontend."""

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
DEFAULT_DATA_DIR = Path(os.environ.get("ALLYGRAPH_DATA_DIR", ROOT_DIR / "data"))
DIST_DIR = ROOT_DIR / "web" / "dist"

TYPES = ("family", "academy")
NAME_MAX = 256
TAG_MAX = 4
USER_NAME_MAX = 64
NOTES_MAX = 200_000
POWER_MAX = 2**64 - 1  # unsigned 64-bit; power is never negative
SERVER_RE = re.compile(r"^[0-9]{4}$")
USER_ID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def _now():
    return datetime.now(timezone.utc).isoformat()


def _read_json(path):
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def _write_json(path, data):
    # Write to a temp file and rename so a crash never leaves a half-written file.
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def _upgrade(data):
    """Bring a data file written by an older version up to date. Returns True if anything changed."""
    changed = False
    if "servers" not in data:
        # Files written before servers existed: create a server for each one alliances use.
        numbers = sorted({a["server"] for a in data["alliances"]})
        data["servers"] = [{"number": n, "createdAt": _now()} for n in numbers]
        changed = True
    if "families" not in data:
        # Before families, a "root" alliance headed each tree and members pointed at it via rootId.
        # Each root becomes the root family alliance of a new family that its members join.
        data["families"] = []
        family_of_root = {}
        for a in data["alliances"]:
            if a.get("type") == "root":
                family = {"id": str(uuid.uuid4()), "server": a["server"], "createdAt": _now()}
                if "position" in a:
                    family["position"] = a.pop("position")
                data["families"].append(family)
                family_of_root[a["id"]] = family["id"]
                a.update(type="family", isRoot=True, familyId=family["id"])
        for a in data["alliances"]:
            root_id = a.pop("rootId", None)
            if root_id:
                a.update(familyId=family_of_root[root_id], isRoot=False)
        changed = True
    return changed


class Store:
    """One JSON file per user under <data_dir>/users/, each holding that user's graph.

    A single lock covers every file: requests are tiny, so per-user locks aren't worth it.
    """

    def __init__(self, data_dir):
        self.users_dir = Path(data_dir) / "users"
        self.lock = threading.Lock()
        self._import_legacy(Path(data_dir) / "alliances.json")

    def _import_legacy(self, legacy):
        # Before multi-user support all data lived in one file; adopt it as user "Default".
        if legacy.exists() and not self.list_users():
            data = _read_json(legacy)
            _upgrade(data)
            user = self.create_user("Default")
            self.save(user["id"], {"user": user, **{k: data[k] for k in ("servers", "families", "alliances")}})
            legacy.rename(legacy.with_name(legacy.name + ".imported"))

    def _path(self, user_id):
        return self.users_dir / f"{user_id}.json"

    def exists(self, user_id):
        # The id format check also stops path tricks like "../x" from reaching the filesystem.
        return bool(USER_ID_RE.match(user_id)) and self._path(user_id).is_file()

    def list_users(self):
        if not self.users_dir.is_dir():
            return []
        users = [_read_json(p)["user"] for p in self.users_dir.glob("*.json")]
        return sorted(users, key=lambda u: u["name"].casefold())

    def create_user(self, name):
        user = {"id": str(uuid.uuid4()), "name": name, "createdAt": _now()}
        _write_json(self._path(user["id"]), {"user": user, "servers": [], "families": [], "alliances": []})
        return user

    def load(self, user_id):
        data = _read_json(self._path(user_id))
        if _upgrade(data):
            # Persist right away so ids created during the upgrade stay stable between requests.
            self.save(user_id, data)
        return data

    def save(self, user_id, data):
        _write_json(self._path(user_id), data)


def _clean_text(value):
    return unicodedata.normalize("NFC", value).strip() if isinstance(value, str) else None


def _clean_server(value):
    value = value.strip() if isinstance(value, str) else None
    return value if value and SERVER_RE.match(value) else None


def _clean_power(value):
    """Parse power to a canonical digit string ("0" if missing), or None if invalid.

    Kept as a string in JSON because browsers can't represent integers above 2**53 exactly.
    Commas, underscores and spaces are allowed as digit separators.
    """
    if value is None or value == "":
        return "0"
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        number = value
    elif isinstance(value, str):
        digits = re.sub(r"[,_\s]", "", value)
        if not re.fullmatch(r"[0-9]+", digits):
            return None
        number = int(digits)
    else:
        return None
    return str(number) if 0 <= number <= POWER_MAX else None


def _members(data, family_id, kind=None, exclude=None):
    return [
        a
        for a in data["alliances"]
        if a.get("familyId") == family_id and (kind is None or a["type"] == kind) and a is not exclude
    ]


def _strongest(alliances):
    """Highest power; ties go to the alphabetically first name."""
    return min(alliances, key=lambda a: (-int(a.get("power") or 0), a["name"].casefold()))


def _tidy_families(data):
    """Drop families with no alliances left and make sure each remaining one has exactly one root."""
    used = {a.get("familyId") for a in data["alliances"]}
    data["families"] = [f for f in data["families"] if f["id"] in used]
    for family in data["families"]:
        members = _members(data, family["id"], "family")
        roots = [a for a in members if a.get("isRoot")]
        if not roots and members:
            # The root left: promote the strongest remaining family alliance.
            _strongest(members)["isRoot"] = True
        for extra in roots[1:]:
            extra["isRoot"] = False


def validate_alliance(payload, data, existing=None):
    """Return (alliance_fields, errors). errors maps field name -> message.

    familyId None on a family alliance means "start a new family". With `existing`, validates an
    update to that alliance; its server can't change.
    """
    errors = {}
    others = [a for a in data["alliances"] if a is not existing]

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

    server = existing["server"] if existing else _clean_server(payload.get("server"))
    if server is None or not any(s["number"] == server for s in data["servers"]):
        errors["server"] = "Select an existing server."

    kind = payload.get("type")
    if kind not in TYPES:
        errors["type"] = f"Type must be one of: {', '.join(TYPES)}."

    family_id = payload.get("familyId") or None
    family = next((f for f in data["families"] if f["id"] == family_id), None)
    if family_id is not None and (family is None or family["server"] != server):
        errors["familyId"] = "Select a family on this alliance's server."
    elif kind == "academy":
        if family is None:
            errors["familyId"] = "An academy must belong to an existing family."
        elif not _members(data, family_id, "family", exclude=existing):
            errors["familyId"] = "That family has no family alliance left to protect an academy."

    is_root = kind == "family" and (family_id is None or bool(payload.get("isRoot")))
    if existing and existing.get("isRoot") and not is_root and family_id == existing["familyId"] and kind == "family":
        errors["isRoot"] = "A family always has a root. Set another family alliance as root to change it."

    # A family alliance can't leave (move or become an academy) if that would strand academies.
    if existing and existing["type"] == "family" and (family_id != existing["familyId"] or kind != "family"):
        old = existing["familyId"]
        if not _members(data, old, "family", exclude=existing) and _members(data, old, "academy", exclude=existing):
            count = len(_members(data, old, "academy", exclude=existing))
            errors["familyId"] = (
                f"This is the last family alliance in its family, which still has {count} academy "
                f"alliance(s). Move or delete those academies first."
            )

    # Notes are stored exactly as given: no trimming or normalization, so all whitespace survives.
    notes = payload.get("notes", "")
    if notes is None:
        notes = ""
    if not isinstance(notes, str):
        errors["notes"] = "Notes must be text."
    elif len(notes) > NOTES_MAX:
        errors["notes"] = f"Notes must be at most {NOTES_MAX:,} characters."

    power = _clean_power(payload.get("power"))
    if power is None:
        errors["power"] = f"Power must be a whole number from 0 to {POWER_MAX:,}."

    if "tag" not in errors and "server" not in errors:
        if any(a["server"] == server and a["tag"] == tag for a in others):
            errors["tag"] = f"Tag [#{tag}] is already used on server {server}."

    fields = {
        "name": name,
        "tag": tag,
        "server": server,
        "type": kind,
        "familyId": family_id,
        "isRoot": is_root,
        "notes": notes,
        "power": power,
    }
    return fields, errors


def apply_alliance(data, alliance, fields):
    """Write validated fields onto `alliance` (already in data), creating a family if asked."""
    if fields["familyId"] is None:
        family = {"id": str(uuid.uuid4()), "server": fields["server"], "createdAt": _now()}
        data["families"].append(family)
        fields = {**fields, "familyId": family["id"]}
    # Moving to another family or row makes the old display position meaningless.
    if alliance.get("familyId") not in (None, fields["familyId"]) or alliance.get("type") not in (None, fields["type"]):
        alliance.pop("position", None)
    if fields["isRoot"]:
        for other in _members(data, fields["familyId"], "family", exclude=alliance):
            other["isRoot"] = False
    alliance.update(fields)
    _tidy_families(data)


def create_app(data_dir=DEFAULT_DATA_DIR):
    app = Flask(__name__, static_folder=None)
    # Largest legitimate request is an alliance with 200k characters of notes (~800 KB as UTF-8).
    app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024
    store = Store(data_dir)

    def bad_body():
        return jsonify({"errors": {"_": "Request body must be a JSON object."}}), 400

    def require_user(user_id):
        if not store.exists(user_id):
            abort(404)

    @app.errorhandler(404)
    def not_found(_):
        if request.path.startswith("/api/"):
            return jsonify({"errors": {"_": "Not found."}}), 404
        return "Not found", 404

    @app.get("/api/users")
    def list_users():
        with store.lock:
            return jsonify(store.list_users())

    @app.post("/api/users")
    def create_user():
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return bad_body()
        name = _clean_text(payload.get("name"))
        if not name:
            return jsonify({"errors": {"name": "Name is required."}}), 400
        if len(name) > USER_NAME_MAX:
            return jsonify({"errors": {"name": f"Name must be at most {USER_NAME_MAX} characters."}}), 400
        with store.lock:
            if any(u["name"].casefold() == name.casefold() for u in store.list_users()):
                return jsonify({"errors": {"name": f"User \"{name}\" already exists."}}), 400
            user = store.create_user(name)
        return jsonify(user), 201

    @app.get("/api/users/<user_id>/graph")
    def get_graph(user_id):
        """Everything the page needs in one request."""
        with store.lock:
            require_user(user_id)
            data = store.load(user_id)
            return jsonify({k: data[k] for k in ("servers", "families", "alliances")})

    @app.get("/api/users/<user_id>/servers")
    def list_servers(user_id):
        with store.lock:
            require_user(user_id)
            return jsonify(store.load(user_id)["servers"])

    @app.post("/api/users/<user_id>/servers")
    def create_server(user_id):
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return bad_body()
        number = _clean_server(payload.get("number"))
        if number is None:
            return jsonify({"errors": {"number": "Server must be exactly 4 digits (e.g. 0042)."}}), 400
        with store.lock:
            require_user(user_id)
            data = store.load(user_id)
            if any(s["number"] == number for s in data["servers"]):
                return jsonify({"errors": {"number": f"Server {number} already exists."}}), 400
            server = {"number": number, "createdAt": _now()}
            data["servers"].append(server)
            store.save(user_id, data)
        return jsonify(server), 201

    @app.delete("/api/users/<user_id>/servers/<number>")
    def delete_server(user_id, number):
        # Deleting a server also deletes every family and alliance on it.
        with store.lock:
            require_user(user_id)
            data = store.load(user_id)
            if not any(s["number"] == number for s in data["servers"]):
                abort(404)
            deleted = sorted(a["id"] for a in data["alliances"] if a["server"] == number)
            data["servers"] = [s for s in data["servers"] if s["number"] != number]
            data["families"] = [f for f in data["families"] if f["server"] != number]
            data["alliances"] = [a for a in data["alliances"] if a["server"] != number]
            store.save(user_id, data)
        return jsonify({"deleted": deleted})

    @app.get("/api/users/<user_id>/families")
    def list_families(user_id):
        with store.lock:
            require_user(user_id)
            return jsonify(store.load(user_id)["families"])

    @app.get("/api/users/<user_id>/alliances")
    def list_alliances(user_id):
        with store.lock:
            require_user(user_id)
            return jsonify(store.load(user_id)["alliances"])

    @app.post("/api/users/<user_id>/alliances")
    def create_alliance(user_id):
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return bad_body()
        with store.lock:
            require_user(user_id)
            data = store.load(user_id)
            fields, errors = validate_alliance(payload, data)
            if errors:
                return jsonify({"errors": errors}), 400
            alliance = {"id": str(uuid.uuid4()), "createdAt": _now()}
            data["alliances"].append(alliance)
            apply_alliance(data, alliance, fields)
            store.save(user_id, data)
        return jsonify(alliance), 201

    def reorder(user_id, collection):
        # Sets each listed item's display position to its index in `ids` (e.g. one row).
        payload = request.get_json(silent=True)
        ids = payload.get("ids") if isinstance(payload, dict) else None
        if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids) or len(set(ids)) != len(ids):
            return jsonify({"errors": {"ids": "ids must be a list of distinct ids."}}), 400
        with store.lock:
            require_user(user_id)
            data = store.load(user_id)
            by_id = {item["id"]: item for item in data[collection]}
            missing = [i for i in ids if i not in by_id]
            if missing:
                return jsonify({"errors": {"ids": f"Unknown ids: {', '.join(missing)}"}}), 400
            for position, item_id in enumerate(ids):
                by_id[item_id]["position"] = position
            store.save(user_id, data)
        return jsonify([by_id[i] for i in ids])

    @app.put("/api/users/<user_id>/alliances/order")
    def reorder_alliances(user_id):
        return reorder(user_id, "alliances")

    @app.put("/api/users/<user_id>/families/order")
    def reorder_families(user_id):
        return reorder(user_id, "families")

    @app.patch("/api/users/<user_id>/alliances/<alliance_id>")
    def update_alliance(user_id, alliance_id):
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return bad_body()
        with store.lock:
            require_user(user_id)
            data = store.load(user_id)
            existing = next((a for a in data["alliances"] if a["id"] == alliance_id), None)
            if existing is None:
                abort(404)
            # Fields left out of the request keep their current values, except that moving to
            # another family doesn't carry root status along unless asked for.
            merged = {**existing, **payload}
            if "isRoot" not in payload and (merged.get("familyId") or None) != existing["familyId"]:
                merged["isRoot"] = False
            fields, errors = validate_alliance(merged, data, existing)
            if errors:
                return jsonify({"errors": errors}), 400
            apply_alliance(data, existing, {**fields, "updatedAt": _now()})
            store.save(user_id, data)
        return jsonify(existing)

    @app.delete("/api/users/<user_id>/alliances/<alliance_id>")
    def delete_alliance(user_id, alliance_id):
        """Delete one alliance. If it's the last family alliance of a family that still has
        academies, the request must say what happens to them: ?academies=delete, or
        ?academies=move&moveTo=<family id> (another family on the same server)."""
        with store.lock:
            require_user(user_id)
            data = store.load(user_id)
            target = next((a for a in data["alliances"] if a["id"] == alliance_id), None)
            if target is None:
                abort(404)
            deleted = {target["id"]}
            family_id = target["familyId"]
            academies = _members(data, family_id, "academy", exclude=target)
            stranded = target["type"] == "family" and not _members(data, family_id, "family", exclude=target)
            if stranded and academies:
                mode = request.args.get("academies")
                if mode == "delete":
                    deleted |= {a["id"] for a in academies}
                elif mode == "move":
                    dest_id = request.args.get("moveTo")
                    dest = next((f for f in data["families"] if f["id"] == dest_id), None)
                    if dest is None or dest_id == family_id or dest["server"] != target["server"]:
                        return jsonify({"errors": {"moveTo": "Pick another family on the same server."}}), 400
                    for a in academies:
                        a["familyId"] = dest_id
                        a.pop("position", None)
                else:
                    return jsonify({
                        "errors": {"academies": "This family's academies need a new family or must be deleted."},
                        "academyCount": len(academies),
                    }), 409
            data["alliances"] = [a for a in data["alliances"] if a["id"] not in deleted]
            _tidy_families(data)
            store.save(user_id, data)
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

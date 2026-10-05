"""AllyGraph backend: a tiny JSON API over per-user JSON files, plus static hosting of the built frontend.

Data model (one file per user):
  servers    [{number}]
  families   [{id, name, server, rootId}]      rootId: one member alliance, or null when empty
  academies  [{id, name, server, familyIds}]   familyIds: the families that protect it
  alliances  [{id, name, tag, server, power, notes, familyIds, academyIds, alliedFamilyIds, position?}]
             alliedFamilyIds: families it's allied with but not a member of
Families, academies and their members/allies always share a server.
"""

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

COLLECTIONS = ("servers", "families", "academies", "alliances")
GROUPS = {"families": "family", "academies": "academy"}  # collection -> singular, for messages
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


def _strongest(alliances):
    """Highest power; ties go to the alphabetically first name."""
    return min(alliances, key=lambda a: (-int(a.get("power") or 0), a["name"].casefold()))


def _unique_name(name, server, groups):
    taken = {g["name"].casefold() for g in groups if g["server"] == server}
    candidate, n = name, 2
    while candidate.casefold() in taken:
        candidate, n = f"{name} {n}", n + 1
    return candidate


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
                data["families"].append(family)
                family_of_root[a["id"]] = family["id"]
                a.update(type="family", isRoot=True, familyId=family["id"])
        for a in data["alliances"]:
            root_id = a.pop("rootId", None)
            if root_id:
                a.update(familyId=family_of_root[root_id], isRoot=False)
        changed = True
    if "academies" not in data:
        # Before groups, each alliance was a "family" or "academy" alliance in exactly one family.
        # Each family becomes a named family group keeping its root; its academy alliances join a
        # new academy group linked to that family.
        families, academies = [], []
        for old in data["families"]:
            members = [a for a in data["alliances"] if a.get("familyId") == old["id"]]
            root = next((a for a in members if a.get("isRoot")), None)
            base = root["name"] if root else "Unnamed"
            families.append({
                "id": old["id"],
                "name": _unique_name(f"{base} family", old["server"], families),
                "server": old["server"],
                "rootId": root["id"] if root else None,
                "createdAt": old.get("createdAt", _now()),
            })
            academy_members = [a for a in members if a.get("type") == "academy"]
            if academy_members:
                academy = {
                    "id": str(uuid.uuid4()),
                    "name": _unique_name(f"{base} academy", old["server"], academies),
                    "server": old["server"],
                    "familyIds": [old["id"]],
                    "createdAt": _now(),
                }
                academies.append(academy)
                for a in academy_members:
                    a["academyIds"] = [academy["id"]]
        for a in data["alliances"]:
            family_id, kind = a.pop("familyId", None), a.pop("type", None)
            a.pop("isRoot", None)
            a.pop("position", None)  # positions were per family row; the layout is different now
            a["familyIds"] = [family_id] if family_id and kind == "family" else []
            a.setdefault("academyIds", [])
        data["families"], data["academies"] = families, academies
        changed = True
    for a in data["alliances"]:
        if "alliedFamilyIds" not in a:
            a["alliedFamilyIds"] = []
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
            self.save(user["id"], {"user": user, **{k: data[k] for k in COLLECTIONS}})
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
        _write_json(self._path(user["id"]), {"user": user, **{k: [] for k in COLLECTIONS}})
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


def _members(data, family_or_academy_id, field):
    return [a for a in data["alliances"] if family_or_academy_id in a[field]]


def tidy(data):
    """Restore invariants after any change: no links to deleted things, and every family with
    members has one member as its root (the strongest, if its root left)."""
    family_ids = {f["id"] for f in data["families"]}
    academy_ids = {a["id"] for a in data["academies"]}
    for a in data["alliances"]:
        a["familyIds"] = [i for i in a["familyIds"] if i in family_ids]
        a["academyIds"] = [i for i in a["academyIds"] if i in academy_ids]
        a["alliedFamilyIds"] = [i for i in a["alliedFamilyIds"] if i in family_ids]
    for academy in data["academies"]:
        academy["familyIds"] = [i for i in academy["familyIds"] if i in family_ids]
    for family in data["families"]:
        members = _members(data, family["id"], "familyIds")
        if family.get("rootId") not in {a["id"] for a in members}:
            family["rootId"] = _strongest(members)["id"] if members else None


def _clean_ids(value, items, server, what):
    """Validate a list of ids of `items` on `server`. Returns (ids, error)."""
    if value is None:
        return [], None
    if not isinstance(value, list) or not all(isinstance(i, str) for i in value):
        return None, f"{what} must be a list of ids."
    ids = list(dict.fromkeys(value))  # drop duplicates, keep order
    by_id = {i["id"]: i for i in items}
    if any(i not in by_id or by_id[i]["server"] != server for i in ids):
        return None, f"Each {GROUPS[what]} must exist on server {server}."
    return ids, None


def _validate_server(payload, data, existing):
    server = existing["server"] if existing else _clean_server(payload.get("server"))
    if server is None or not any(s["number"] == server for s in data["servers"]):
        return server, "Select an existing server."
    return server, None


def validate_alliance(payload, data, existing=None):
    """Return (fields, errors). errors maps field name -> message. An alliance's server can't change."""
    errors = {}

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

    server, error = _validate_server(payload, data, existing)
    if error:
        errors["server"] = error

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

    family_ids = academy_ids = allied_ids = []
    if "server" not in errors:
        family_ids, error = _clean_ids(payload.get("familyIds"), data["families"], server, "families")
        if error:
            errors["familyIds"] = error
        academy_ids, error = _clean_ids(payload.get("academyIds"), data["academies"], server, "academies")
        if error:
            errors["academyIds"] = error
        allied_ids, error = _clean_ids(payload.get("alliedFamilyIds"), data["families"], server, "families")
        if error:
            errors["alliedFamilyIds"] = error
        elif family_ids and set(allied_ids) & set(family_ids):
            errors["alliedFamilyIds"] = "An alliance can't be allied with a family it's a member of."

    if "tag" not in errors and "server" not in errors:
        others = [a for a in data["alliances"] if a is not existing]
        if any(a["server"] == server and a["tag"] == tag for a in others):
            errors["tag"] = f"Tag [#{tag}] is already used on server {server}."

    fields = {
        "name": name,
        "tag": tag,
        "server": server,
        "power": power,
        "notes": notes,
        "familyIds": family_ids,
        "academyIds": academy_ids,
        "alliedFamilyIds": allied_ids,
    }
    return fields, errors


def validate_group(collection, payload, data, existing=None):
    """Validate a family or academy. Return (fields, errors). A group's server can't change."""
    errors = {}
    kind = GROUPS[collection]

    name = _clean_text(payload.get("name"))
    server, error = _validate_server(payload, data, existing)
    if error:
        errors["server"] = error
    if not name:
        errors["name"] = "Name is required."
    elif len(name) > NAME_MAX:
        errors["name"] = f"Name must be at most {NAME_MAX} characters."
    elif server and any(
        g is not existing and g["server"] == server and g["name"].casefold() == name.casefold()
        for g in data[collection]
    ):
        errors["name"] = f"There's already a {kind} named \"{name}\" on server {server}."

    fields = {"name": name, "server": server}
    if collection == "families":
        root_id = payload.get("rootId") or None
        members = {a["id"] for a in _members(data, existing["id"], "familyIds")} if existing else set()
        if root_id is not None and root_id not in members:
            errors["rootId"] = "The root must be one of the family's alliances."
        fields["rootId"] = root_id
    else:
        family_ids, error = (
            _clean_ids(payload.get("familyIds"), data["families"], server, "families")
            if "server" not in errors
            else ([], None)
        )
        if error:
            errors["familyIds"] = error
        fields["familyIds"] = family_ids
    return fields, errors


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

    def find(items, item_id):
        item = next((i for i in items if i["id"] == item_id), None)
        if item is None:
            abort(404)
        return item

    def body():
        payload = request.get_json(silent=True)
        return payload if isinstance(payload, dict) else None

    @app.errorhandler(404)
    def not_found(_):
        if request.path.startswith("/api/"):
            return jsonify({"errors": {"_": "Not found."}}), 404
        return "Not found", 404

    @app.get("/api/health")
    def health():
        # Lets `make run` confirm that this app (not something else on the port) is serving.
        return jsonify({"app": "allygraph", "ok": True})

    @app.get("/api/users")
    def list_users():
        with store.lock:
            return jsonify(store.list_users())

    @app.post("/api/users")
    def create_user():
        payload = body()
        if payload is None:
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
            return jsonify({k: data[k] for k in COLLECTIONS})

    @app.get("/api/users/<user_id>/<any(servers, families, academies, alliances):collection>")
    def list_collection(user_id, collection):
        with store.lock:
            require_user(user_id)
            return jsonify(store.load(user_id)[collection])

    # --- servers ---

    @app.post("/api/users/<user_id>/servers")
    def create_server(user_id):
        payload = body()
        if payload is None:
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
        # Deleting a server also deletes every family, academy and alliance on it.
        with store.lock:
            require_user(user_id)
            data = store.load(user_id)
            if not any(s["number"] == number for s in data["servers"]):
                abort(404)
            deleted = sorted(a["id"] for a in data["alliances"] if a["server"] == number)
            data["servers"] = [s for s in data["servers"] if s["number"] != number]
            for collection in ("families", "academies", "alliances"):
                data[collection] = [x for x in data[collection] if x["server"] != number]
            tidy(data)
            store.save(user_id, data)
        return jsonify({"deleted": deleted})

    # --- families and academies ---

    @app.post("/api/users/<user_id>/<any(families, academies):collection>")
    def create_group(user_id, collection):
        payload = body()
        if payload is None:
            return bad_body()
        with store.lock:
            require_user(user_id)
            data = store.load(user_id)
            fields, errors = validate_group(collection, payload, data)
            if errors:
                return jsonify({"errors": errors}), 400
            group = {"id": str(uuid.uuid4()), **fields, "createdAt": _now()}
            data[collection].append(group)
            tidy(data)
            store.save(user_id, data)
        return jsonify(group), 201

    @app.patch("/api/users/<user_id>/<any(families, academies):collection>/<group_id>")
    def update_group(user_id, collection, group_id):
        payload = body()
        if payload is None:
            return bad_body()
        with store.lock:
            require_user(user_id)
            data = store.load(user_id)
            group = find(data[collection], group_id)
            # Fields left out of the request keep their current values.
            fields, errors = validate_group(collection, {**group, **payload}, data, group)
            if errors:
                return jsonify({"errors": errors}), 400
            group.update(fields, updatedAt=_now())
            tidy(data)
            store.save(user_id, data)
        return jsonify(group)

    @app.delete("/api/users/<user_id>/<any(families, academies):collection>/<group_id>")
    def delete_group(user_id, collection, group_id):
        # Member alliances are kept; they just leave the group.
        with store.lock:
            require_user(user_id)
            data = store.load(user_id)
            find(data[collection], group_id)
            data[collection] = [g for g in data[collection] if g["id"] != group_id]
            tidy(data)
            store.save(user_id, data)
        return jsonify({"deleted": [group_id]})

    # --- alliances ---

    @app.post("/api/users/<user_id>/alliances")
    def create_alliance(user_id):
        payload = body()
        if payload is None:
            return bad_body()
        with store.lock:
            require_user(user_id)
            data = store.load(user_id)
            fields, errors = validate_alliance(payload, data)
            if errors:
                return jsonify({"errors": errors}), 400
            alliance = {"id": str(uuid.uuid4()), **fields, "createdAt": _now()}
            data["alliances"].append(alliance)
            tidy(data)
            store.save(user_id, data)
        return jsonify(alliance), 201

    @app.put("/api/users/<user_id>/alliances/order")
    def reorder_alliances(user_id):
        # Sets each listed alliance's display position to its index in `ids` (one server's row).
        payload = body()
        ids = payload.get("ids") if payload else None
        if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids) or len(set(ids)) != len(ids):
            return jsonify({"errors": {"ids": "ids must be a list of distinct ids."}}), 400
        with store.lock:
            require_user(user_id)
            data = store.load(user_id)
            by_id = {a["id"]: a for a in data["alliances"]}
            missing = [i for i in ids if i not in by_id]
            if missing:
                return jsonify({"errors": {"ids": f"Unknown ids: {', '.join(missing)}"}}), 400
            for position, alliance_id in enumerate(ids):
                by_id[alliance_id]["position"] = position
            store.save(user_id, data)
        return jsonify([by_id[i] for i in ids])

    @app.patch("/api/users/<user_id>/alliances/<alliance_id>")
    def update_alliance(user_id, alliance_id):
        payload = body()
        if payload is None:
            return bad_body()
        with store.lock:
            require_user(user_id)
            data = store.load(user_id)
            alliance = find(data["alliances"], alliance_id)
            # Fields left out of the request keep their current values.
            fields, errors = validate_alliance({**alliance, **payload}, data, alliance)
            if errors:
                return jsonify({"errors": errors}), 400
            alliance.update(fields, updatedAt=_now())
            tidy(data)
            store.save(user_id, data)
        return jsonify(alliance)

    @app.delete("/api/users/<user_id>/alliances/<alliance_id>")
    def delete_alliance(user_id, alliance_id):
        # If it was a family's root, tidy() promotes the strongest remaining member.
        with store.lock:
            require_user(user_id)
            data = store.load(user_id)
            find(data["alliances"], alliance_id)
            data["alliances"] = [a for a in data["alliances"] if a["id"] != alliance_id]
            tidy(data)
            store.save(user_id, data)
        return jsonify({"deleted": [alliance_id]})

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

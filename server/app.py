"""AllyGraph backend: a tiny JSON API over per-user JSON files, plus static hosting of the built frontend.

Data model (one file per user, "version": DATA_VERSION):
  servers    [{number}]
  families   [{id, server, createdAt, layout?, academyLayout?}]   an unnamed set of alliances; exists
             while it has a member. layout/academyLayout: where its bubbles were dragged ({x, y}).
  alliances  [{id, name, tag, server, power, notes, familyId, academyOf, alliedFamilyIds, position?,
              layout?}]   position: order within its bubble; layout: where an independent was dragged
An alliance is a member of at most one family (familyId), OR an academy of exactly one family
(academyOf), or neither. It can also be allied with any number of other families. A family is led by
its strongest member (highest power, ties by name). Families and their alliances share a server.
"""

import json
import math
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

COLLECTIONS = ("servers", "families", "alliances")
DATA_VERSION = 2
ROLES = ("family", "academy", "none")  # family member, academy of a family, independent
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
    if data.get("version") == DATA_VERSION:
        return False
    # Files from before versioning go through the old upgrade chain (ending in named groups), then
    # become unnamed families.
    _upgrade_unversioned(data)
    _groups_to_families(data)
    data["version"] = DATA_VERSION
    return True


def _groups_to_families(data):
    """Named family/academy groups (0-N per alliance) -> unnamed, non-overlapping families.

    An alliance in several families keeps the oldest as its family and is allied with the rest.
    Academy members become an academy of their academy's first protecting family that still has
    members (else independent). Names and roots are dropped; the strongest member leads instead.
    """
    order = {f["id"]: i for i, f in enumerate(sorted(data["families"], key=lambda f: f.get("createdAt", "")))}
    for a in data["alliances"]:
        family_ids = sorted(a.get("familyIds", []), key=lambda i: order.get(i, len(order)))
        a["familyId"] = family_ids[0] if family_ids else None
        a["alliedFamilyIds"] = list(dict.fromkeys(family_ids[1:] + a.get("alliedFamilyIds", [])))
    used = {a["familyId"] for a in data["alliances"]}
    protector = {
        g["id"]: next((f for f in g.get("familyIds", []) if f in used), None) for g in data.get("academies", [])
    }
    for a in data["alliances"]:
        academy_of = next((protector[g] for g in a.get("academyIds", []) if protector.get(g)), None)
        a["academyOf"] = academy_of if a["familyId"] is None else None
        for key in ("familyIds", "academyIds"):
            a.pop(key, None)
    data["families"] = [
        {"id": f["id"], "server": f["server"], "createdAt": f.get("createdAt", _now())} for f in data["families"]
    ]
    data.pop("academies", None)
    tidy(data)


def _upgrade_unversioned(data):
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
            self.save(user["id"], {"user": user, "version": DATA_VERSION, **{k: data[k] for k in COLLECTIONS}})
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
        _write_json(self._path(user["id"]), {"user": user, "version": DATA_VERSION, **{k: [] for k in COLLECTIONS}})
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


def _role(alliance):
    if alliance.get("familyId"):
        return "family"
    return "academy" if alliance.get("academyOf") else "none"


def _members(data, family_id, exclude=None):
    return [a for a in data["alliances"] if a.get("familyId") == family_id and a is not exclude]


def _academies(data, family_id, exclude=None):
    return [a for a in data["alliances"] if a.get("academyOf") == family_id and a is not exclude]


def tidy(data):
    """Restore invariants after any change: families exist only while they have members, and no
    alliance points at a family that's gone, or is allied with its own family."""
    used = {a.get("familyId") for a in data["alliances"]}
    data["families"] = [f for f in data["families"] if f["id"] in used]
    family_ids = {f["id"] for f in data["families"]}
    for a in data["alliances"]:
        if a.get("familyId") not in family_ids:
            a["familyId"] = None
        if a.get("academyOf") not in family_ids or a["familyId"]:
            a["academyOf"] = None
        own = {a["familyId"], a["academyOf"]}
        a["alliedFamilyIds"] = list(dict.fromkeys(i for i in a.get("alliedFamilyIds", []) if i in family_ids and i not in own))


def _validate_server(payload, data, existing):
    server = existing["server"] if existing else _clean_server(payload.get("server"))
    if server is None or not any(s["number"] == server for s in data["servers"]):
        return server, "Select an existing server."
    return server, None


def _id_list(value):
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(i, str) for i in value):
        return None
    return list(dict.fromkeys(value))


def validate_alliance(payload, data, existing=None):
    """Return (fields, errors). errors maps field name -> message.

    Relationship fields: role ("family" | "academy" | "none"); familyWith, the alliances to be in a
    family with (their families are merged; empty starts a new family); academyOf, a family id; and
    alliedFamilyIds. An alliance's server can't change.
    """
    errors = {}
    by_id = {a["id"]: a for a in data["alliances"]}
    family_by_id = {f["id"]: f for f in data["families"]}

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

    role = payload.get("role", "none")
    if role not in ROLES:
        errors["role"] = f"Role must be one of: {', '.join(ROLES)}."

    family_with = _id_list(payload.get("familyWith")) if role == "family" else []
    if family_with is None:
        errors["familyWith"] = "familyWith must be a list of alliance ids."
        family_with = []
    for alliance_id in family_with:
        other = by_id.get(alliance_id)
        if other is None or other["server"] != server or other is existing:
            errors["familyWith"] = "Pick other alliances on the same server."
        elif other.get("academyOf"):
            errors["familyWith"] = f"{other['name']} is an academy, so it can't be in a family."

    academy_of = payload.get("academyOf") if role == "academy" else None
    if role == "academy":
        family = family_by_id.get(academy_of)
        if family is None or family["server"] != server:
            errors["academyOf"] = "Pick the family this alliance is an academy of."
        elif existing and existing.get("familyId") == academy_of and not _members(data, academy_of, existing):
            errors["academyOf"] = "A family can't be left without members while it has academies."

    allied = _id_list(payload.get("alliedFamilyIds"))
    if allied is None or any(i not in family_by_id or family_by_id[i]["server"] != server for i in allied):
        errors["alliedFamilyIds"] = "Pick families on the same server."
        allied = []

    # A family member can't leave if that would leave its family's academies without a family.
    if existing and existing.get("familyId") and "familyWith" not in errors:
        old = existing["familyId"]
        joining = {by_id[i].get("familyId") for i in family_with if i in by_id}
        # A family of one is kept (and grows) rather than replaced when its member picks others.
        staying = role == "family" and (old in joining or not _members(data, old, existing))
        stranded = _academies(data, old, existing)
        if not staying and not _members(data, old, existing) and stranded:
            errors["role"] = (
                f"This is the last member of its family, which has {len(stranded)} academy alliance(s). "
                "Move them to another family or make them independent first."
            )

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
        "role": role,
        "familyWith": family_with,
        "academyOf": academy_of,
        "alliedFamilyIds": allied,
    }
    return fields, errors


def apply_alliance(data, alliance, fields):
    """Write validated fields onto `alliance` (already in data), joining/merging families as asked."""
    fields = dict(fields)
    role, family_with = fields.pop("role"), fields.pop("familyWith")
    before = (alliance.get("familyId"), alliance.get("academyOf"))
    alliance.update(fields)
    by_id = {a["id"]: a for a in data["alliances"]}
    created = {f["id"]: f.get("createdAt", "") for f in data["families"]}

    if role == "family":
        others = [by_id[i] for i in family_with]
        families = {o["familyId"] for o in others if o.get("familyId")}
        old = alliance.get("familyId")
        if old and not _members(data, old, alliance):
            families.add(old)  # a family of one keeps its identity (and academies) as it grows
        families = sorted(families, key=lambda i: created.get(i, ""))
        if families:
            target = families[0]  # join the oldest picked family; the others merge into it
        else:
            target = str(uuid.uuid4())
            data["families"].append({"id": target, "server": alliance["server"], "createdAt": _now()})
        merged = set(families[1:])
        for a in data["alliances"]:
            if a.get("familyId") in merged:
                a["familyId"] = target
                a.pop("position", None)
            if a.get("academyOf") in merged:
                a["academyOf"] = target
            a["alliedFamilyIds"] = [target if i in merged else i for i in a.get("alliedFamilyIds", [])]
        for o in others:
            if o.get("familyId") != target:
                o["familyId"] = target
                o.pop("position", None)
        alliance["familyId"] = target
        alliance["academyOf"] = None
    else:
        alliance["familyId"] = None
        # academyOf already set from fields (None for an independent alliance)

    if (alliance["familyId"], alliance["academyOf"]) != before:
        # Its old order and dragged spot mean nothing in a different group.
        alliance.pop("position", None)
        alliance.pop("layout", None)
    tidy(data)


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

    @app.get("/api/users/<user_id>/<any(servers, families, alliances):collection>")
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
        # Deleting a server also deletes every family and alliance on it.
        with store.lock:
            require_user(user_id)
            data = store.load(user_id)
            if not any(s["number"] == number for s in data["servers"]):
                abort(404)
            deleted = sorted(a["id"] for a in data["alliances"] if a["server"] == number)
            data["servers"] = [s for s in data["servers"] if s["number"] != number]
            for collection in ("families", "alliances"):
                data[collection] = [x for x in data[collection] if x["server"] != number]
            tidy(data)
            store.save(user_id, data)
        return jsonify({"deleted": deleted})

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
            alliance = {"id": str(uuid.uuid4()), "createdAt": _now()}
            data["alliances"].append(alliance)
            apply_alliance(data, alliance, fields)
            store.save(user_id, data)
        return jsonify(alliance), 201

    @app.put("/api/users/<user_id>/alliances/order")
    def reorder_alliances(user_id):
        # Sets each listed alliance's display position to its index in `ids` (one row).
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

    @app.put("/api/users/<user_id>/layout")
    def save_layout(user_id):
        """Remember where things were dragged in the graph. Body: {items: [{kind, id, x, y}]} with kind
        "family" (its bubble), "academy" (its academies' bubble) or "alliance" (an independent);
        x and y null clear the saved spot."""
        payload = body()
        items = payload.get("items") if payload else None
        number = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
        if not isinstance(items, list) or not all(
            isinstance(i, dict)
            and i.get("kind") in ("family", "academy", "alliance")
            and isinstance(i.get("id"), str)
            and ((number(i.get("x")) and number(i.get("y"))) or (i.get("x") is None and i.get("y") is None))
            for i in items
        ):
            return jsonify({"errors": {"items": "items must be [{kind, id, x, y}] with numeric (or null) x and y."}}), 400
        with store.lock:
            require_user(user_id)
            data = store.load(user_id)
            families = {f["id"]: f for f in data["families"]}
            alliances = {a["id"]: a for a in data["alliances"]}
            for item in items:
                target, key = (alliances, "layout") if item["kind"] == "alliance" else (
                    families, "layout" if item["kind"] == "family" else "academyLayout")
                if item["id"] not in target:
                    return jsonify({"errors": {"items": f"Unknown {item['kind']}: {item['id']}"}}), 400
                if item["x"] is None:
                    target[item["id"]].pop(key, None)
                else:
                    target[item["id"]][key] = {"x": item["x"], "y": item["y"]}
            store.save(user_id, data)
        return jsonify({"ok": True})

    @app.patch("/api/users/<user_id>/alliances/<alliance_id>")
    def update_alliance(user_id, alliance_id):
        payload = body()
        if payload is None:
            return bad_body()
        with store.lock:
            require_user(user_id)
            data = store.load(user_id)
            alliance = find(data["alliances"], alliance_id)
            # Fields left out of the request keep their current values: same role, same family.
            current = {
                **alliance,
                "role": _role(alliance),
                "familyWith": [a["id"] for a in _members(data, alliance.get("familyId"), alliance)]
                if alliance.get("familyId")
                else [],
            }
            fields, errors = validate_alliance({**current, **payload}, data, alliance)
            if errors:
                return jsonify({"errors": errors}), 400
            apply_alliance(data, alliance, {**fields, "updatedAt": _now()})
            store.save(user_id, data)
        return jsonify(alliance)

    @app.delete("/api/users/<user_id>/alliances/<alliance_id>")
    def delete_alliance(user_id, alliance_id):
        """Delete one alliance. If it's the last member of a family that has academies, the request
        must say what happens to them: ?academies=detach (they become independent),
        ?academies=delete, or ?academies=move&moveTo=<family id> (another family, same server)."""
        with store.lock:
            require_user(user_id)
            data = store.load(user_id)
            target = find(data["alliances"], alliance_id)
            deleted = {target["id"]}
            family_id = target.get("familyId")
            academies = _academies(data, family_id) if family_id else []
            if family_id and academies and not _members(data, family_id, target):
                mode = request.args.get("academies")
                if mode == "delete":
                    deleted |= {a["id"] for a in academies}
                elif mode == "detach":
                    for a in academies:
                        a["academyOf"] = None
                        a.pop("position", None)
                elif mode == "move":
                    dest_id = request.args.get("moveTo")
                    dest = next((f for f in data["families"] if f["id"] == dest_id), None)
                    if dest is None or dest_id == family_id or dest["server"] != target["server"]:
                        return jsonify({"errors": {"moveTo": "Pick another family on the same server."}}), 400
                    for a in academies:
                        a["academyOf"] = dest_id
                        a.pop("position", None)
                else:
                    return jsonify({
                        "errors": {"academies": "This family's academies need a new family, to become independent, or to be deleted."},
                        "academyCount": len(academies),
                    }), 409
            data["alliances"] = [a for a in data["alliances"] if a["id"] not in deleted]
            tidy(data)
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

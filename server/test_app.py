import json

import pytest

from app import create_app


class UserClient:
    """Test client whose paths are relative to one user's /api/users/<id>/ prefix."""

    def __init__(self, client, user_id):
        self.client = client
        self.prefix = f"/api/users/{user_id}"

    def get(self, path):
        return self.client.get(self.prefix + path)

    def post(self, path, **kwargs):
        return self.client.post(self.prefix + path, **kwargs)

    def put(self, path, **kwargs):
        return self.client.put(self.prefix + path, **kwargs)

    def patch(self, path, **kwargs):
        return self.client.patch(self.prefix + path, **kwargs)

    def delete(self, path):
        return self.client.delete(self.prefix + path)


def new_user(client, name):
    res = client.post("/api/users", json={"name": name})
    assert res.status_code == 201
    return UserClient(client, res.get_json()["id"])


@pytest.fixture
def app_client(tmp_path):
    app = create_app(tmp_path)
    app.config["TESTING"] = True
    return app.test_client()


@pytest.fixture
def client(app_client):
    user = new_user(app_client, "alice")
    for number in ("4180", "4181", "0042"):
        user.post("/servers", json={"number": number})
    return user


def make(client, **overrides):
    body = {"name": "Path of Exiles", "tag": "G~4", "server": "4180", "type": "root", **overrides}
    return client.post("/alliances", json=body)


# --- users ---


def test_create_and_list_users(app_client):
    new_user(app_client, "bob")
    new_user(app_client, "Alice")
    names = [u["name"] for u in app_client.get("/api/users").get_json()]
    assert names == ["Alice", "bob"]


@pytest.mark.parametrize("name", ["", "   ", "x" * 65, None])
def test_bad_user_name_rejected(app_client, name):
    assert app_client.post("/api/users", json={"name": name}).status_code == 400


def test_duplicate_user_name_rejected_case_insensitively(app_client):
    new_user(app_client, "Alice")
    assert app_client.post("/api/users", json={"name": "alice"}).status_code == 400


def test_users_have_separate_graphs(app_client):
    alice = new_user(app_client, "alice")
    bob = new_user(app_client, "bob")
    alice.post("/servers", json={"number": "4180"})
    make(alice)
    assert bob.get("/servers").get_json() == []
    assert bob.get("/alliances").get_json() == []
    # Same server and tag is fine for a different user.
    bob.post("/servers", json={"number": "4180"})
    assert make(bob).status_code == 201


@pytest.mark.parametrize("user_id", ["nope", "..", "00000000-0000-0000-0000-000000000000"])
def test_unknown_user_is_404(app_client, user_id):
    res = app_client.get(f"/api/users/{user_id}/alliances")
    assert res.status_code == 404
    assert "errors" in res.get_json()


def test_imports_legacy_single_file(tmp_path):
    old = {"id": "a1", "name": "Old", "tag": "OLD", "server": "0042", "type": "root", "rootId": None}
    (tmp_path / "alliances.json").write_text(json.dumps({"alliances": [old]}))
    client = create_app(tmp_path).test_client()
    users = client.get("/api/users").get_json()
    assert [u["name"] for u in users] == ["Default"]
    user = UserClient(client, users[0]["id"])
    # Servers are derived from the alliances in files that predate servers.
    assert [s["number"] for s in user.get("/servers").get_json()] == ["0042"]
    assert make(user, server="0042", type="family", tag="F1", rootId="a1").status_code == 201
    assert not (tmp_path / "alliances.json").exists()
    assert (tmp_path / "alliances.json.imported").exists()


def test_persists_across_app_instances(tmp_path):
    first = new_user(create_app(tmp_path).test_client(), "alice")
    first.post("/servers", json={"number": "4180"})
    make(first)
    second = UserClient(create_app(tmp_path).test_client(), first.prefix.rsplit("/", 1)[1])
    assert len(second.get("/servers").get_json()) == 1
    assert len(second.get("/alliances").get_json()) == 1


# --- servers ---


def test_create_server_keeps_leading_zeros(client):
    numbers = [s["number"] for s in client.get("/servers").get_json()]
    assert numbers == ["4180", "4181", "0042"]


@pytest.mark.parametrize("number", ["123", "12345", "abcd", 4180, "", "١٢٣٤"])
def test_bad_server_number_rejected(client, number):
    res = client.post("/servers", json={"number": number})
    assert res.status_code == 400
    assert "number" in res.get_json()["errors"]


def test_duplicate_server_rejected(client):
    assert client.post("/servers", json={"number": "4180"}).status_code == 400


def test_delete_server_cascades(client):
    root = make(client).get_json()
    fam = make(client, type="family", tag="F1", rootId=root["id"]).get_json()
    keep = make(client, server="4181").get_json()
    res = client.delete("/servers/4180")
    assert set(res.get_json()["deleted"]) == {root["id"], fam["id"]}
    assert [s["number"] for s in client.get("/servers").get_json()] == ["4181", "0042"]
    assert client.get("/alliances").get_json() == [keep]


# --- alliances ---


def test_create_and_list_root(client):
    res = make(client)
    assert res.status_code == 201
    alliance = res.get_json()
    assert alliance["rootId"] is None
    assert client.get("/alliances").get_json() == [alliance]


def test_alliance_requires_existing_server(client):
    res = make(client, server="9999")
    assert res.status_code == 400
    assert "server" in res.get_json()["errors"]


def test_utf8_limits(client):
    assert make(client, name="名" * 256, tag="名前ab").status_code == 201
    errors = make(client, name="名" * 257, tag="12345").get_json()["errors"]
    assert set(errors) == {"name", "tag"}


def test_duplicate_tag_on_same_server_rejected(client):
    make(client)
    assert make(client, name="Other").status_code == 400
    assert make(client, name="Other", server="4181").status_code == 201


def test_family_requires_existing_root(client):
    assert "rootId" in make(client, type="family").get_json()["errors"]
    root = make(client).get_json()
    fam = make(client, type="family", tag="F1", rootId=root["id"]).get_json()
    assert fam["rootId"] == root["id"]
    # A family alliance can't be used as a root.
    res = make(client, type="academy", tag="A1", rootId=fam["id"])
    assert "rootId" in res.get_json()["errors"]


def test_family_must_share_root_server(client):
    root = make(client).get_json()
    res = make(client, type="family", tag="F1", server="4181", rootId=root["id"])
    assert res.status_code == 400
    assert "rootId" in res.get_json()["errors"]


def test_delete_root_cascades(client):
    root = make(client).get_json()
    other = make(client, tag="R2").get_json()
    fam = make(client, type="family", tag="F1", rootId=root["id"]).get_json()
    aca = make(client, type="academy", tag="A1", rootId=root["id"]).get_json()
    res = client.delete(f"/alliances/{root['id']}")
    assert set(res.get_json()["deleted"]) == {root["id"], fam["id"], aca["id"]}
    assert client.get("/alliances").get_json() == [other]


def test_delete_missing_is_404(client):
    assert client.delete("/alliances/nope").status_code == 404
    assert client.delete("/servers/9999").status_code == 404


# --- updating alliances ---


def test_update_name_and_tag(client):
    root = make(client).get_json()
    res = client.patch(f"/alliances/{root['id']}", json={"name": "Renamed", "tag": "NEW"})
    assert res.status_code == 200
    updated = res.get_json()
    assert (updated["name"], updated["tag"], updated["server"]) == ("Renamed", "NEW", "4180")
    assert client.get("/alliances").get_json() == [updated]


def test_update_keeping_own_tag_is_allowed(client):
    root = make(client).get_json()
    res = client.patch(f"/alliances/{root['id']}", json={"name": "Same tag"})
    assert res.status_code == 200


def test_update_rejects_tag_used_by_another(client):
    make(client, tag="TAKE")
    root = make(client).get_json()
    res = client.patch(f"/alliances/{root['id']}", json={"tag": "TAKE"})
    assert "tag" in res.get_json()["errors"]


def test_update_moves_member_and_changes_type(client):
    r1 = make(client).get_json()
    r2 = make(client, tag="R2").get_json()
    fam = make(client, type="family", tag="F1", rootId=r1["id"]).get_json()
    res = client.patch(f"/alliances/{fam['id']}", json={"type": "academy", "rootId": r2["id"]})
    assert (res.get_json()["type"], res.get_json()["rootId"]) == ("academy", r2["id"])


def test_update_cannot_change_server_or_root_status(client):
    root = make(client).get_json()
    fam = make(client, type="family", tag="F1", rootId=root["id"]).get_json()
    patch = lambda a, body: client.patch(f"/alliances/{a['id']}", json=body)
    assert patch(root, {"server": "4181"}).get_json()["server"] == "4180"
    assert "type" in patch(root, {"type": "family", "rootId": root["id"]}).get_json()["errors"]
    assert "type" in patch(fam, {"type": "root"}).get_json()["errors"]
    other = make(client, server="4181", tag="R9").get_json()
    assert "rootId" in patch(fam, {"rootId": other["id"]}).get_json()["errors"]


def test_update_missing_is_404(client):
    assert client.patch(f"/alliances/nope", json={}).status_code == 404


# --- ordering ---


def test_reorder_sets_positions(client):
    root = make(client).get_json()
    f1 = make(client, type="family", tag="F1", rootId=root["id"]).get_json()
    f2 = make(client, type="family", tag="F2", rootId=root["id"]).get_json()
    res = client.put("/alliances/order", json={"ids": [f2["id"], f1["id"]]})
    assert res.status_code == 200
    positions = {a["id"]: a.get("position") for a in client.get("/alliances").get_json()}
    assert positions == {root["id"]: None, f2["id"]: 0, f1["id"]: 1}


@pytest.mark.parametrize("ids", [None, "x", [1], ["nope"]])
def test_reorder_rejects_bad_ids(client, ids):
    res = client.put("/alliances/order", json={"ids": ids})
    assert res.status_code == 400


def test_reorder_rejects_duplicates(client):
    root = make(client).get_json()
    res = client.put("/alliances/order", json={"ids": [root["id"], root["id"]]})
    assert res.status_code == 400


# --- notes ---


def test_notes_default_to_empty(client):
    assert make(client).get_json()["notes"] == ""


def test_notes_keep_whitespace_and_unicode_exactly(client):
    notes = "  leading spaces\n\n\tTabbed line ✨\r\nWindows line\n  trailing  \n\n"
    alliance = make(client, notes=notes).get_json()
    assert alliance["notes"] == notes
    assert client.get("/alliances").get_json()[0]["notes"] == notes


def test_notes_length_limit_counts_characters(client):
    assert make(client, notes="名" * 200_000).status_code == 201
    res = make(client, tag="T2", notes="x" * 200_001)
    assert "notes" in res.get_json()["errors"]


def test_notes_must_be_text(client):
    assert "notes" in make(client, notes=123).get_json()["errors"]


def test_update_notes(client):
    root = make(client, notes="old").get_json()
    res = client.patch(f"/alliances/{root['id']}", json={"notes": "  new\n"})
    assert res.get_json()["notes"] == "  new\n"
    # Other edits leave notes alone.
    res = client.patch(f"/alliances/{root['id']}", json={"name": "Renamed"})
    assert res.get_json()["notes"] == "  new\n"


# --- power ---


def test_power_defaults_to_zero(client):
    assert make(client).get_json()["power"] == "0"


@pytest.mark.parametrize(
    "given, stored",
    [("1200000", "1200000"), ("1,200,000", "1200000"), (" 1 200_000 ", "1200000"), (42, "42"), ("007", "7"),
     ("18446744073709551615", "18446744073709551615")],
)
def test_power_is_stored_as_canonical_digit_string(client, given, stored):
    assert make(client, power=given).get_json()["power"] == stored


@pytest.mark.parametrize("power", ["-1", -1, "1.5", 1.5, "abc", "18446744073709551616", True, [1]])
def test_bad_power_rejected(client, power):
    assert "power" in make(client, power=power).get_json()["errors"]


def test_update_power(client):
    root = make(client, power="5").get_json()
    assert client.patch(f"/alliances/{root['id']}", json={"power": "1,000"}).get_json()["power"] == "1000"
    assert client.patch(f"/alliances/{root['id']}", json={"name": "X"}).get_json()["power"] == "1000"

import json

import pytest

from app import create_app


class UserClient:
    """Test client whose paths are relative to one user's /api/users/<id>/ prefix."""

    def __init__(self, client, user_id):
        self.client = client
        self.user_id = user_id
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

    def alliance(self, alliance_id):
        return next(a for a in self.get("/alliances").get_json() if a["id"] == alliance_id)

    def families(self):
        return self.get("/families").get_json()


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


_tags = iter(f"T{i}" for i in range(10_000))


def make(client, **overrides):
    """Create an alliance; by default a family alliance founding a new family on server 4180."""
    body = {"name": "Path of Exiles", "tag": next(_tags), "server": "4180", "type": "family", **overrides}
    return client.post("/alliances", json=body)


def family_of(client, **overrides):
    """Create a new family and return its root alliance."""
    res = make(client, **overrides)
    assert res.status_code == 201, res.get_json()
    return res.get_json()


def test_health(app_client):
    assert app_client.get("/api/health").get_json() == {"app": "allygraph", "ok": True}


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
    make(alice, tag="SAME")
    assert bob.get("/graph").get_json() == {"servers": [], "families": [], "alliances": []}
    bob.post("/servers", json={"number": "4180"})
    assert make(bob, tag="SAME").status_code == 201


@pytest.mark.parametrize("user_id", ["nope", "..", "00000000-0000-0000-0000-000000000000"])
def test_unknown_user_is_404(app_client, user_id):
    res = app_client.get(f"/api/users/{user_id}/alliances")
    assert res.status_code == 404
    assert "errors" in res.get_json()


def test_persists_across_app_instances(tmp_path):
    first = new_user(create_app(tmp_path).test_client(), "alice")
    first.post("/servers", json={"number": "4180"})
    make(first)
    second = UserClient(create_app(tmp_path).test_client(), first.user_id)
    graph = second.get("/graph").get_json()
    assert (len(graph["servers"]), len(graph["families"]), len(graph["alliances"])) == (1, 1, 1)


# --- servers ---


def test_create_server_keeps_leading_zeros(client):
    assert [s["number"] for s in client.get("/servers").get_json()] == ["4180", "4181", "0042"]


@pytest.mark.parametrize("number", ["123", "12345", "abcd", 4180, "", "١٢٣٤"])
def test_bad_server_number_rejected(client, number):
    res = client.post("/servers", json={"number": number})
    assert "number" in res.get_json()["errors"]


def test_duplicate_server_rejected(client):
    assert client.post("/servers", json={"number": "4180"}).status_code == 400


def test_delete_server_cascades_to_families_and_alliances(client):
    root = family_of(client)
    make(client, type="academy", familyId=root["familyId"])
    keep = family_of(client, server="4181")
    res = client.delete("/servers/4180")
    assert len(res.get_json()["deleted"]) == 2
    graph = client.get("/graph").get_json()
    assert graph["alliances"] == [keep]
    assert [f["server"] for f in graph["families"]] == ["4181"]


# --- creating alliances and families ---


def test_family_alliance_without_family_founds_one_as_root(client):
    root = family_of(client)
    assert root["isRoot"] is True
    assert [f["id"] for f in client.families()] == [root["familyId"]]


def test_family_alliance_joining_a_family_is_not_root_by_default(client):
    root = family_of(client)
    member = make(client, familyId=root["familyId"]).get_json()
    assert (member["familyId"], member["isRoot"]) == (root["familyId"], False)
    assert len(client.families()) == 1


def test_setting_root_on_another_member_moves_it(client):
    root = family_of(client)
    member = make(client, familyId=root["familyId"], isRoot=True).get_json()
    assert member["isRoot"] is True
    assert client.alliance(root["id"])["isRoot"] is False


def test_academy_requires_existing_family(client):
    assert "familyId" in make(client, type="academy").get_json()["errors"]
    assert "familyId" in make(client, type="academy", familyId="nope").get_json()["errors"]
    root = family_of(client)
    academy = make(client, type="academy", familyId=root["familyId"], isRoot=True).get_json()
    assert (academy["familyId"], academy["isRoot"]) == (root["familyId"], False)


def test_family_must_be_on_same_server(client):
    root = family_of(client)
    res = make(client, server="4181", familyId=root["familyId"])
    assert "familyId" in res.get_json()["errors"]


def test_root_type_no_longer_exists(client):
    assert "type" in make(client, type="root").get_json()["errors"]


def test_alliance_requires_existing_server(client):
    assert "server" in make(client, server="9999").get_json()["errors"]


def test_utf8_limits(client):
    assert make(client, name="名" * 256, tag="名前ab").status_code == 201
    errors = make(client, name="名" * 257, tag="12345").get_json()["errors"]
    assert set(errors) == {"name", "tag"}


def test_duplicate_tag_on_same_server_rejected(client):
    make(client, tag="DUP")
    assert make(client, tag="DUP").status_code == 400
    assert make(client, tag="DUP", server="4181").status_code == 201


# --- updating alliances ---


def test_update_name_and_tag(client):
    root = family_of(client)
    res = client.patch(f"/alliances/{root['id']}", json={"name": "Renamed", "tag": "NEW"})
    updated = res.get_json()
    assert (updated["name"], updated["tag"], updated["server"]) == ("Renamed", "NEW", "4180")


def test_update_rejects_tag_used_by_another(client):
    make(client, tag="TAKE")
    root = family_of(client)
    assert "tag" in client.patch(f"/alliances/{root['id']}", json={"tag": "TAKE"}).get_json()["errors"]


def test_server_cannot_change(client):
    root = family_of(client)
    assert client.patch(f"/alliances/{root['id']}", json={"server": "4181"}).get_json()["server"] == "4180"


def test_cannot_unset_root_directly(client):
    root = family_of(client)
    make(client, familyId=root["familyId"])
    res = client.patch(f"/alliances/{root['id']}", json={"isRoot": False})
    assert "isRoot" in res.get_json()["errors"]


def test_set_root_via_update_moves_it(client):
    root = family_of(client)
    member = make(client, familyId=root["familyId"]).get_json()
    assert client.patch(f"/alliances/{member['id']}", json={"isRoot": True}).get_json()["isRoot"] is True
    assert client.alliance(root["id"])["isRoot"] is False


def test_moving_root_away_promotes_strongest_remaining(client):
    root = family_of(client)
    weak = make(client, familyId=root["familyId"], power="10").get_json()
    strong = make(client, familyId=root["familyId"], power="99").get_json()
    other = family_of(client)
    moved = client.patch(f"/alliances/{root['id']}", json={"familyId": other["familyId"]}).get_json()
    assert (moved["familyId"], moved["isRoot"]) == (other["familyId"], False)
    assert client.alliance(strong["id"])["isRoot"] is True
    assert client.alliance(weak["id"])["isRoot"] is False


def test_moving_to_no_family_founds_a_new_one(client):
    root = family_of(client)
    member = make(client, familyId=root["familyId"]).get_json()
    split = client.patch(f"/alliances/{member['id']}", json={"familyId": None}).get_json()
    assert split["isRoot"] is True and split["familyId"] != root["familyId"]
    assert len(client.families()) == 2


def test_family_and_academy_can_switch(client):
    root = family_of(client)
    member = make(client, familyId=root["familyId"]).get_json()
    academy = client.patch(f"/alliances/{member['id']}", json={"type": "academy"}).get_json()
    assert (academy["type"], academy["isRoot"]) == ("academy", False)
    back = client.patch(f"/alliances/{member['id']}", json={"type": "family"}).get_json()
    assert back["type"] == "family"


def test_root_becoming_academy_promotes_another(client):
    root = family_of(client)
    member = make(client, familyId=root["familyId"]).get_json()
    client.patch(f"/alliances/{root['id']}", json={"type": "academy"})
    assert client.alliance(member["id"])["isRoot"] is True


def test_last_family_alliance_cannot_leave_while_academies_remain(client):
    root = family_of(client)
    make(client, type="academy", familyId=root["familyId"])
    other = family_of(client)
    for change in ({"type": "academy"}, {"familyId": other["familyId"]}, {"familyId": None}):
        res = client.patch(f"/alliances/{root['id']}", json=change)
        assert res.status_code == 400, change


def test_moving_last_member_out_removes_empty_family(client):
    root = family_of(client)
    other = family_of(client)
    client.patch(f"/alliances/{root['id']}", json={"familyId": other["familyId"]})
    assert [f["id"] for f in client.families()] == [other["familyId"]]


def test_update_missing_is_404(client):
    assert client.patch("/alliances/nope", json={}).status_code == 404


# --- deleting alliances ---


def test_delete_root_promotes_strongest(client):
    root = family_of(client)
    make(client, familyId=root["familyId"], power="1", name="b")
    a = make(client, familyId=root["familyId"], power="5", name="z").get_json()
    b = make(client, familyId=root["familyId"], power="5", name="a").get_json()
    client.delete(f"/alliances/{root['id']}")
    assert client.alliance(b["id"])["isRoot"] is True  # tie on power -> alphabetical
    assert client.alliance(a["id"])["isRoot"] is False


def test_delete_last_alliance_removes_family(client):
    root = family_of(client)
    assert client.delete(f"/alliances/{root['id']}").get_json() == {"deleted": [root["id"]]}
    assert client.families() == []


def test_delete_last_family_alliance_needs_academy_choice(client):
    root = family_of(client)
    make(client, type="academy", familyId=root["familyId"])
    res = client.delete(f"/alliances/{root['id']}")
    assert res.status_code == 409
    assert res.get_json()["academyCount"] == 1


def test_delete_last_family_alliance_and_its_academies(client):
    root = family_of(client)
    academy = make(client, type="academy", familyId=root["familyId"]).get_json()
    res = client.delete(f"/alliances/{root['id']}?academies=delete")
    assert set(res.get_json()["deleted"]) == {root["id"], academy["id"]}
    assert client.families() == []


def test_delete_last_family_alliance_moving_academies(client):
    root = family_of(client)
    academy = make(client, type="academy", familyId=root["familyId"]).get_json()
    other = family_of(client)
    res = client.delete(f"/alliances/{root['id']}?academies=move&moveTo={other['familyId']}")
    assert res.get_json()["deleted"] == [root["id"]]
    assert client.alliance(academy["id"])["familyId"] == other["familyId"]
    assert [f["id"] for f in client.families()] == [other["familyId"]]


def test_move_academies_rejects_bad_destination(client):
    root = family_of(client)
    make(client, type="academy", familyId=root["familyId"])
    elsewhere = family_of(client, server="4181")
    for dest in ("nope", root["familyId"], elsewhere["familyId"]):
        res = client.delete(f"/alliances/{root['id']}?academies=move&moveTo={dest}")
        assert res.status_code == 400, dest


def test_delete_missing_is_404(client):
    assert client.delete("/alliances/nope").status_code == 404
    assert client.delete("/servers/9999").status_code == 404


# --- notes ---


def test_notes_default_to_empty(client):
    assert family_of(client)["notes"] == ""


def test_notes_keep_whitespace_and_unicode_exactly(client):
    notes = "  leading spaces\n\n\tTabbed line ✨\r\nWindows line\n  trailing  \n\n"
    alliance = family_of(client, notes=notes)
    assert client.alliance(alliance["id"])["notes"] == notes


def test_notes_length_limit_counts_characters(client):
    assert make(client, notes="名" * 200_000).status_code == 201
    assert "notes" in make(client, notes="x" * 200_001).get_json()["errors"]


def test_notes_must_be_text(client):
    assert "notes" in make(client, notes=123).get_json()["errors"]


def test_update_notes(client):
    root = family_of(client, notes="old")
    assert client.patch(f"/alliances/{root['id']}", json={"notes": "  new\n"}).get_json()["notes"] == "  new\n"
    assert client.patch(f"/alliances/{root['id']}", json={"name": "X"}).get_json()["notes"] == "  new\n"


# --- power ---


def test_power_defaults_to_zero(client):
    assert family_of(client)["power"] == "0"


@pytest.mark.parametrize(
    "given, stored",
    [("1200000", "1200000"), ("1,200,000", "1200000"), (" 1 200_000 ", "1200000"), (42, "42"), ("007", "7"),
     ("18446744073709551615", "18446744073709551615")],
)
def test_power_is_stored_as_canonical_digit_string(client, given, stored):
    assert family_of(client, power=given)["power"] == stored


@pytest.mark.parametrize("power", ["-1", -1, "1.5", 1.5, "abc", "18446744073709551616", True, [1]])
def test_bad_power_rejected(client, power):
    assert "power" in make(client, power=power).get_json()["errors"]


# --- ordering ---


def test_reorder_alliances_sets_positions(client):
    root = family_of(client)
    a = make(client, familyId=root["familyId"]).get_json()
    b = make(client, familyId=root["familyId"]).get_json()
    assert client.put("/alliances/order", json={"ids": [b["id"], a["id"]]}).status_code == 200
    assert (client.alliance(b["id"])["position"], client.alliance(a["id"])["position"]) == (0, 1)


def test_reorder_families_sets_positions(client):
    f1 = family_of(client)["familyId"]
    f2 = family_of(client)["familyId"]
    assert client.put("/families/order", json={"ids": [f2, f1]}).status_code == 200
    positions = {f["id"]: f["position"] for f in client.families()}
    assert positions == {f2: 0, f1: 1}


@pytest.mark.parametrize("ids", [None, "x", [1], ["nope"]])
def test_reorder_rejects_bad_ids(client, ids):
    assert client.put("/alliances/order", json={"ids": ids}).status_code == 400
    assert client.put("/families/order", json={"ids": ids}).status_code == 400


def test_moving_to_another_family_clears_position(client):
    root = family_of(client)
    member = make(client, familyId=root["familyId"]).get_json()
    client.put("/alliances/order", json={"ids": [member["id"]]})
    other = family_of(client)
    moved = client.patch(f"/alliances/{member['id']}", json={"familyId": other["familyId"]}).get_json()
    assert "position" not in moved


# --- migrating old data ---


OLD_ROOT_MODEL = {
    "alliances": [
        {"id": "r1", "name": "Root", "tag": "R", "server": "0042", "type": "root", "rootId": None, "position": 3},
        {"id": "f1", "name": "Fam", "tag": "F", "server": "0042", "type": "family", "rootId": "r1", "position": 0},
        {"id": "a1", "name": "Aca", "tag": "A", "server": "0042", "type": "academy", "rootId": "r1"},
        {"id": "r2", "name": "Lonely", "tag": "L", "server": "0042", "type": "root", "rootId": None},
    ]
}


def check_migrated(user):
    graph = user.get("/graph").get_json()
    assert [s["number"] for s in graph["servers"]] == ["0042"]
    by_id = {a["id"]: a for a in graph["alliances"]}
    assert all("rootId" not in a for a in graph["alliances"])
    assert (by_id["r1"]["type"], by_id["r1"]["isRoot"]) == ("family", True)
    assert (by_id["f1"]["type"], by_id["f1"]["isRoot"], by_id["f1"]["position"]) == ("family", False, 0)
    assert (by_id["a1"]["type"], by_id["a1"]["isRoot"]) == ("academy", False)
    assert by_id["f1"]["familyId"] == by_id["a1"]["familyId"] == by_id["r1"]["familyId"]
    assert by_id["r2"]["familyId"] != by_id["r1"]["familyId"]
    families = {f["id"]: f for f in graph["families"]}
    assert set(families) == {by_id["r1"]["familyId"], by_id["r2"]["familyId"]}
    # The old root's umbrella position becomes its family's position.
    assert families[by_id["r1"]["familyId"]]["position"] == 3
    return graph


def write_old_model(tmp_path, user):
    path = tmp_path / "users" / f"{user.user_id}.json"
    stored = json.loads(path.read_text())
    path.write_text(json.dumps({"user": stored["user"], **OLD_ROOT_MODEL}))
    return path


def test_migrates_user_file_from_root_model(tmp_path):
    user = new_user(create_app(tmp_path).test_client(), "old")
    path = write_old_model(tmp_path, user)
    first = check_migrated(user)
    # Saved on first load, so family ids are stable from then on.
    assert user.get("/graph").get_json() == first
    assert "families" in json.loads(path.read_text())


def test_imports_legacy_single_file(tmp_path):
    (tmp_path / "alliances.json").write_text(json.dumps(OLD_ROOT_MODEL))
    client = create_app(tmp_path).test_client()
    users = client.get("/api/users").get_json()
    assert [u["name"] for u in users] == ["Default"]
    check_migrated(UserClient(client, users[0]["id"]))
    assert (tmp_path / "alliances.json.imported").exists()


def test_migrate_script(tmp_path, capsys):
    import migrate

    user = new_user(create_app(tmp_path).test_client(), "old")
    path = write_old_model(tmp_path, user)
    migrate.main(tmp_path)
    assert "migrated  old" in capsys.readouterr().out
    assert "families" in json.loads(path.read_text())
    check_migrated(user)
    migrate.main(tmp_path)
    assert "current   old" in capsys.readouterr().out

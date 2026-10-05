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

    def one(self, collection, item_id):
        return next(x for x in self.get(f"/{collection}").get_json() if x["id"] == item_id)


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


_n = iter(range(100_000))


def make(client, **overrides):
    """Create an alliance (unique tag) on server 4180 unless overridden."""
    body = {"name": "Path of Exiles", "tag": f"T{next(_n)}", "server": "4180", **overrides}
    return client.post("/alliances", json=body)


def alliance(client, **overrides):
    res = make(client, **overrides)
    assert res.status_code == 201, res.get_json()
    return res.get_json()


def group(client, collection, **overrides):
    body = {"name": f"Group {next(_n)}", "server": "4180", **overrides}
    res = client.post(f"/{collection}", json=body)
    assert res.status_code == 201, res.get_json()
    return res.get_json()


def family(client, **overrides):
    return group(client, "families", **overrides)


def academy(client, **overrides):
    return group(client, "academies", **overrides)


def test_health(app_client):
    assert app_client.get("/api/health").get_json() == {"app": "allygraph", "ok": True}


# --- users ---


def test_create_and_list_users(app_client):
    new_user(app_client, "bob")
    new_user(app_client, "Alice")
    assert [u["name"] for u in app_client.get("/api/users").get_json()] == ["Alice", "bob"]


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
    assert bob.get("/graph").get_json() == {"servers": [], "families": [], "academies": [], "alliances": []}
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
    f = family(first)
    alliance(first, familyIds=[f["id"]])
    graph = UserClient(create_app(tmp_path).test_client(), first.user_id).get("/graph").get_json()
    assert [len(graph[k]) for k in ("servers", "families", "academies", "alliances")] == [1, 1, 0, 1]


# --- servers ---


def test_create_server_keeps_leading_zeros(client):
    assert [s["number"] for s in client.get("/servers").get_json()] == ["4180", "4181", "0042"]


@pytest.mark.parametrize("number", ["123", "12345", "abcd", 4180, "", "١٢٣٤"])
def test_bad_server_number_rejected(client, number):
    assert "number" in client.post("/servers", json={"number": number}).get_json()["errors"]


def test_duplicate_server_rejected(client):
    assert client.post("/servers", json={"number": "4180"}).status_code == 400


def test_delete_server_cascades(client):
    f = family(client)
    a = academy(client, familyIds=[f["id"]])
    alliance(client, familyIds=[f["id"]], academyIds=[a["id"]])
    keep = alliance(client, server="4181")
    other_family = family(client, server="4181")
    res = client.delete("/servers/4180")
    assert len(res.get_json()["deleted"]) == 1
    graph = client.get("/graph").get_json()
    assert graph["alliances"] == [keep]
    assert [f["id"] for f in graph["families"]] == [other_family["id"]]
    assert graph["academies"] == []


# --- families and academies ---


def test_create_family_and_academy(client):
    f = family(client, name="Exiles")
    assert (f["name"], f["server"], f["rootId"]) == ("Exiles", "4180", None)
    a = academy(client, name="Pups", familyIds=[f["id"]])
    assert a["familyIds"] == [f["id"]]


@pytest.mark.parametrize("collection", ["families", "academies"])
def test_group_name_required_and_unique_per_server(client, collection):
    assert "name" in client.post(f"/{collection}", json={"server": "4180"}).get_json()["errors"]
    group(client, collection, name="Same")
    res = client.post(f"/{collection}", json={"name": "same", "server": "4180"})
    assert "name" in res.get_json()["errors"]
    group(client, collection, name="Same", server="4181")


def test_family_and_academy_names_dont_clash(client):
    family(client, name="Wolves")
    academy(client, name="Wolves")


def test_group_requires_existing_server(client):
    res = client.post("/families", json={"name": "x", "server": "9999"})
    assert "server" in res.get_json()["errors"]


def test_academy_families_must_exist_on_same_server(client):
    elsewhere = family(client, server="4181")
    for ids in (["nope"], [elsewhere["id"]], "x"):
        res = client.post("/academies", json={"name": "A", "server": "4180", "familyIds": ids})
        assert "familyIds" in res.get_json()["errors"], ids


def test_update_group_name_and_links(client):
    f1, f2 = family(client), family(client)
    a = academy(client, familyIds=[f1["id"]])
    res = client.patch(f"/academies/{a['id']}", json={"name": "Renamed", "familyIds": [f2["id"], f1["id"]]})
    assert (res.get_json()["name"], res.get_json()["familyIds"]) == ("Renamed", [f2["id"], f1["id"]])


def test_group_server_cannot_change(client):
    f = family(client)
    assert client.patch(f"/families/{f['id']}", json={"server": "4181"}).get_json()["server"] == "4180"


def test_delete_family_keeps_alliances_and_unlinks(client):
    f = family(client)
    a = academy(client, familyIds=[f["id"]])
    member = alliance(client, familyIds=[f["id"]])
    assert client.delete(f"/families/{f['id']}").get_json() == {"deleted": [f["id"]]}
    assert client.one("alliances", member["id"])["familyIds"] == []
    assert client.one("academies", a["id"])["familyIds"] == []


def test_delete_academy_keeps_alliances(client):
    a = academy(client)
    member = alliance(client, academyIds=[a["id"]])
    client.delete(f"/academies/{a['id']}")
    assert client.one("alliances", member["id"])["academyIds"] == []


def test_delete_missing_is_404(client):
    for path in ("/alliances/nope", "/families/nope", "/academies/nope", "/servers/9999"):
        assert client.delete(path).status_code == 404, path


# --- roots ---


def test_first_member_becomes_root(client):
    f = family(client)
    first = alliance(client, familyIds=[f["id"]])
    alliance(client, familyIds=[f["id"]], power="999")
    assert client.one("families", f["id"])["rootId"] == first["id"]


def test_set_root_to_a_member(client):
    f = family(client)
    alliance(client, familyIds=[f["id"]])
    second = alliance(client, familyIds=[f["id"]])
    res = client.patch(f"/families/{f['id']}", json={"rootId": second["id"]})
    assert res.get_json()["rootId"] == second["id"]


def test_root_must_be_a_member(client):
    f = family(client)
    outsider = alliance(client)
    res = client.patch(f"/families/{f['id']}", json={"rootId": outsider["id"]})
    assert "rootId" in res.get_json()["errors"]


def test_root_leaving_promotes_strongest(client):
    f = family(client)
    root = alliance(client, familyIds=[f["id"]])
    alliance(client, familyIds=[f["id"]], power="5", name="z")
    tie_winner = alliance(client, familyIds=[f["id"]], power="5", name="a")
    client.patch(f"/alliances/{root['id']}", json={"familyIds": []})
    assert client.one("families", f["id"])["rootId"] == tie_winner["id"]


def test_deleting_root_promotes_strongest(client):
    f = family(client)
    root = alliance(client, familyIds=[f["id"]])
    strong = alliance(client, familyIds=[f["id"]], power="10")
    client.delete(f"/alliances/{root['id']}")
    assert client.one("families", f["id"])["rootId"] == strong["id"]


def test_last_member_leaving_clears_root(client):
    f = family(client)
    only = alliance(client, familyIds=[f["id"]])
    client.delete(f"/alliances/{only['id']}")
    assert client.one("families", f["id"])["rootId"] is None


def test_alliance_can_be_root_of_several_families(client):
    f1, f2 = family(client), family(client)
    a = alliance(client, familyIds=[f1["id"], f2["id"]])
    assert client.one("families", f1["id"])["rootId"] == a["id"]
    assert client.one("families", f2["id"])["rootId"] == a["id"]


# --- alliances ---


def test_alliance_with_no_groups(client):
    a = alliance(client)
    assert (a["familyIds"], a["academyIds"]) == ([], [])


def test_alliance_in_many_groups(client):
    f1, f2 = family(client), family(client)
    a1, a2 = academy(client), academy(client)
    a = alliance(client, familyIds=[f1["id"], f2["id"]], academyIds=[a1["id"], a2["id"]])
    assert a["familyIds"] == [f1["id"], f2["id"]]
    assert a["academyIds"] == [a1["id"], a2["id"]]


def test_alliance_groups_must_exist_on_same_server(client):
    elsewhere = family(client, server="4181")
    assert "familyIds" in make(client, familyIds=[elsewhere["id"]]).get_json()["errors"]
    assert "familyIds" in make(client, familyIds=["nope"]).get_json()["errors"]
    assert "academyIds" in make(client, academyIds=["nope"]).get_json()["errors"]
    assert "familyIds" in make(client, familyIds="x").get_json()["errors"]


def test_duplicate_group_ids_are_collapsed(client):
    f = family(client)
    assert alliance(client, familyIds=[f["id"], f["id"]])["familyIds"] == [f["id"]]


def test_update_alliance_groups(client):
    f = family(client)
    acad = academy(client)
    a = alliance(client)
    res = client.patch(f"/alliances/{a['id']}", json={"familyIds": [f["id"]], "academyIds": [acad["id"]]})
    assert (res.get_json()["familyIds"], res.get_json()["academyIds"]) == ([f["id"]], [acad["id"]])
    # Other edits leave memberships alone.
    assert client.patch(f"/alliances/{a['id']}", json={"name": "X"}).get_json()["familyIds"] == [f["id"]]


def test_alliance_requires_existing_server(client):
    assert "server" in make(client, server="9999").get_json()["errors"]


def test_alliance_server_cannot_change(client):
    a = alliance(client)
    assert client.patch(f"/alliances/{a['id']}", json={"server": "4181"}).get_json()["server"] == "4180"


def test_utf8_limits(client):
    assert make(client, name="名" * 256, tag="名前ab").status_code == 201
    errors = make(client, name="名" * 257, tag="12345").get_json()["errors"]
    assert set(errors) == {"name", "tag"}


def test_duplicate_tag_on_same_server_rejected(client):
    make(client, tag="DUP")
    assert make(client, tag="DUP").status_code == 400
    assert make(client, tag="DUP", server="4181").status_code == 201


def test_update_rejects_tag_used_by_another(client):
    make(client, tag="TAKE")
    a = alliance(client)
    assert "tag" in client.patch(f"/alliances/{a['id']}", json={"tag": "TAKE"}).get_json()["errors"]


def test_update_missing_is_404(client):
    assert client.patch("/alliances/nope", json={}).status_code == 404
    assert client.patch("/families/nope", json={}).status_code == 404


# --- notes ---


def test_notes_keep_whitespace_and_unicode_exactly(client):
    notes = "  leading spaces\n\n\tTabbed line ✨\r\nWindows line\n  trailing  \n\n"
    a = alliance(client, notes=notes)
    assert client.one("alliances", a["id"])["notes"] == notes


def test_notes_default_and_limits(client):
    assert alliance(client)["notes"] == ""
    assert make(client, notes="名" * 200_000).status_code == 201
    assert "notes" in make(client, notes="x" * 200_001).get_json()["errors"]
    assert "notes" in make(client, notes=123).get_json()["errors"]


# --- power ---


@pytest.mark.parametrize(
    "given, stored",
    [(None, "0"), ("1200000", "1200000"), ("1,200,000", "1200000"), (" 1 200_000 ", "1200000"), (42, "42"),
     ("007", "7"), ("18446744073709551615", "18446744073709551615")],
)
def test_power_is_stored_as_canonical_digit_string(client, given, stored):
    assert alliance(client, power=given)["power"] == stored


@pytest.mark.parametrize("power", ["-1", -1, "1.5", 1.5, "abc", "18446744073709551616", True, [1]])
def test_bad_power_rejected(client, power):
    assert "power" in make(client, power=power).get_json()["errors"]


# --- ordering ---


def test_reorder_alliances_sets_positions(client):
    a, b = alliance(client), alliance(client)
    assert client.put("/alliances/order", json={"ids": [b["id"], a["id"]]}).status_code == 200
    assert (client.one("alliances", b["id"])["position"], client.one("alliances", a["id"])["position"]) == (0, 1)


@pytest.mark.parametrize("ids", [None, "x", [1], ["nope"]])
def test_reorder_rejects_bad_ids(client, ids):
    assert client.put("/alliances/order", json={"ids": ids}).status_code == 400


# --- migrating old data ---


ROOT_MODEL = {
    "alliances": [
        {"id": "r1", "name": "Root", "tag": "R", "server": "0042", "type": "root", "rootId": None, "position": 3},
        {"id": "f1", "name": "Fam", "tag": "F", "server": "0042", "type": "family", "rootId": "r1", "position": 0},
        {"id": "a1", "name": "Aca", "tag": "A", "server": "0042", "type": "academy", "rootId": "r1"},
        {"id": "r2", "name": "Lonely", "tag": "L", "server": "0042", "type": "root", "rootId": None},
    ]
}

FAMILY_MODEL = {
    "servers": [{"number": "0042"}],
    "families": [{"id": "F1", "server": "0042", "position": 1}, {"id": "F2", "server": "0042"}],
    "alliances": [
        {"id": "r1", "name": "Root", "tag": "R", "server": "0042", "type": "family", "familyId": "F1", "isRoot": True},
        {"id": "f1", "name": "Fam", "tag": "F", "server": "0042", "type": "family", "familyId": "F1", "isRoot": False,
         "position": 0},
        {"id": "a1", "name": "Aca", "tag": "A", "server": "0042", "type": "academy", "familyId": "F1",
         "isRoot": False},
        {"id": "r2", "name": "Lonely", "tag": "L", "server": "0042", "type": "family", "familyId": "F2",
         "isRoot": True},
    ],
}


def check_migrated(user):
    """Both old models describe: Root (root) + Fam + academy Aca in one family; Lonely alone."""
    graph = user.get("/graph").get_json()
    assert [s["number"] for s in graph["servers"]] == ["0042"]
    by_id = {a["id"]: a for a in graph["alliances"]}
    for a in graph["alliances"]:
        assert not {"type", "familyId", "isRoot", "rootId", "position"} & set(a), a
    families = {f["name"]: f for f in graph["families"]}
    assert set(families) == {"Root family", "Lonely family"}
    main, lonely = families["Root family"], families["Lonely family"]
    assert (main["rootId"], lonely["rootId"]) == ("r1", "r2")
    assert by_id["r1"]["familyIds"] == by_id["f1"]["familyIds"] == [main["id"]]
    assert by_id["r2"]["familyIds"] == [lonely["id"]]
    assert by_id["a1"]["familyIds"] == []
    [academy_group] = graph["academies"]
    assert (academy_group["name"], academy_group["familyIds"]) == ("Root academy", [main["id"]])
    assert by_id["a1"]["academyIds"] == [academy_group["id"]]
    assert by_id["r1"]["academyIds"] == []
    return graph


def write_old(tmp_path, user, model):
    path = tmp_path / "users" / f"{user.user_id}.json"
    stored = json.loads(path.read_text())
    path.write_text(json.dumps({"user": stored["user"], **model}))
    return path


@pytest.mark.parametrize("model", [ROOT_MODEL, FAMILY_MODEL], ids=["root-model", "family-model"])
def test_migrates_old_models(tmp_path, model):
    user = new_user(create_app(tmp_path).test_client(), "old")
    path = write_old(tmp_path, user, model)
    first = check_migrated(user)
    # Saved on first load, so generated ids are stable from then on.
    assert user.get("/graph").get_json() == first
    assert "academies" in json.loads(path.read_text())


def test_migration_keeps_group_names_unique(tmp_path):
    user = new_user(create_app(tmp_path).test_client(), "old")
    twins = {
        "alliances": [
            {"id": "x", "name": "Twin", "tag": "X", "server": "0042", "type": "root", "rootId": None},
            {"id": "y", "name": "Twin", "tag": "Y", "server": "0042", "type": "root", "rootId": None},
        ]
    }
    write_old(tmp_path, user, twins)
    names = sorted(f["name"] for f in user.get("/families").get_json())
    assert names == ["Twin family", "Twin family 2"]


def test_imports_legacy_single_file(tmp_path):
    (tmp_path / "alliances.json").write_text(json.dumps(ROOT_MODEL))
    client = create_app(tmp_path).test_client()
    users = client.get("/api/users").get_json()
    assert [u["name"] for u in users] == ["Default"]
    check_migrated(UserClient(client, users[0]["id"]))
    assert (tmp_path / "alliances.json.imported").exists()


def test_migrate_script(tmp_path, capsys):
    import migrate

    user = new_user(create_app(tmp_path).test_client(), "old")
    path = write_old(tmp_path, user, FAMILY_MODEL)
    migrate.main(tmp_path)
    assert "migrated  old" in capsys.readouterr().out
    assert "academies" in json.loads(path.read_text())
    check_migrated(user)
    migrate.main(tmp_path)
    assert "current   old" in capsys.readouterr().out

import json

import pytest

from app import DATA_VERSION, create_app


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


_n = iter(range(100_000))


def make(client, **overrides):
    """Create an alliance (unique tag) on server 4180 unless overridden; independent by default."""
    body = {"name": f"Alliance {next(_n)}", "tag": f"T{next(_n)}", "server": "4180", **overrides}
    return client.post("/alliances", json=body)


def alliance(client, **overrides):
    res = make(client, **overrides)
    assert res.status_code == 201, res.get_json()
    return res.get_json()


def pair(client, server="4180", **overrides):
    """A family of two: (the alliance created to join, its mate). Families need two or more members."""
    mate = alliance(client, server=server)
    lead = alliance(client, server=server, role="family", familyWith=[mate["id"]], **overrides)
    return lead, client.alliance(mate["id"])


def founder(client, **overrides):
    """An alliance in a (new) family of two."""
    return pair(client, **overrides)[0]


def solo_with_academy(client, server="4180"):
    """A family of one alliance plus its academy: (member, academy)."""
    member = alliance(client, server=server)
    academy = alliance(client, server=server, role="academy", academyOfAlliance=member["id"])
    return client.alliance(member["id"]), academy


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
    founder(first)
    graph = UserClient(create_app(tmp_path).test_client(), first.user_id).get("/graph").get_json()
    assert [len(graph[k]) for k in ("servers", "families", "alliances")] == [1, 1, 2]


# --- servers ---


def test_create_server_keeps_leading_zeros(client):
    assert [s["number"] for s in client.get("/servers").get_json()] == ["4180", "4181", "0042"]


@pytest.mark.parametrize("number", ["123", "12345", "abcd", 4180, "", "١٢٣٤"])
def test_bad_server_number_rejected(client, number):
    assert "number" in client.post("/servers", json={"number": number}).get_json()["errors"]


def test_duplicate_server_rejected(client):
    assert client.post("/servers", json={"number": "4180"}).status_code == 400


def test_delete_server_cascades(client):
    lead = founder(client)
    alliance(client, role="academy", academyOf=lead["familyId"])
    keep = alliance(client, server="4181")
    res = client.delete("/servers/4180")
    assert len(res.get_json()["deleted"]) == 3
    graph = client.get("/graph").get_json()
    assert (graph["alliances"], graph["families"]) == ([keep], [])


# --- families ---


def test_independent_by_default(client):
    a = alliance(client)
    assert (a["familyId"], a["academyOf"], a["alliedFamilyIds"]) == (None, None, [])
    assert client.families() == []


def test_family_needs_someone_to_be_in_a_family_with(client):
    res = make(client, role="family", familyWith=[])
    assert "familyWith" in res.get_json()["errors"]


def test_family_with_independent_alliances_forms_a_family(client):
    x, y = alliance(client), alliance(client)
    z = alliance(client, role="family", familyWith=[x["id"], y["id"]])
    assert client.alliance(x["id"])["familyId"] == client.alliance(y["id"])["familyId"] == z["familyId"]
    assert len(client.families()) == 1


def test_picking_one_member_joins_the_whole_family(client):
    lead, mate = pair(client)
    newcomer = alliance(client, role="family", familyWith=[mate["id"]])
    assert newcomer["familyId"] == lead["familyId"]
    assert len(client.families()) == 1


def test_picking_two_families_merges_them_into_the_oldest(client):
    old, _ = pair(client)
    young, _ = pair(client)
    academy = alliance(client, role="academy", academyOf=young["familyId"])  # only one: merge allowed
    ally = alliance(client, alliedFamilyIds=[old["familyId"], young["familyId"]])
    bridge = alliance(client, role="family", familyWith=[young["id"], old["id"]])
    assert bridge["familyId"] == old["familyId"]
    assert client.alliance(young["id"])["familyId"] == old["familyId"]
    assert client.alliance(academy["id"])["academyOf"] == old["familyId"]
    assert client.alliance(ally["id"])["alliedFamilyIds"] == [old["familyId"]]
    assert [f["id"] for f in client.families()] == [old["familyId"]]


def test_family_with_must_be_other_alliances_on_same_server(client):
    elsewhere = alliance(client, server="4181")
    for ids in (["nope"], [elsewhere["id"]], "x"):
        assert "familyWith" in make(client, role="family", familyWith=ids).get_json()["errors"], ids


def test_academy_cannot_be_picked_as_family_mate(client):
    lead = founder(client)
    academy = alliance(client, role="academy", academyOf=lead["familyId"])
    res = make(client, role="family", familyWith=[academy["id"]])
    assert "familyWith" in res.get_json()["errors"]


def test_bad_role_rejected(client):
    assert "role" in make(client, role="root").get_json()["errors"]


def test_families_never_span_servers(client):
    lead = founder(client)
    assert "academyOf" in make(client, server="4181", role="academy", academyOf=lead["familyId"]).get_json()["errors"]
    assert "alliedFamilyIds" in make(client, server="4181", alliedFamilyIds=[lead["familyId"]]).get_json()["errors"]


# --- academies ---


def test_academy_of_a_family(client):
    lead = founder(client)
    academy = alliance(client, role="academy", academyOf=lead["familyId"])
    assert (academy["familyId"], academy["academyOf"]) == (None, lead["familyId"])


def test_academy_of_an_alliance_in_a_family_picks_its_family(client):
    lead, mate = pair(client)
    academy = alliance(client, role="academy", academyOfAlliance=mate["id"])
    assert academy["academyOf"] == lead["familyId"]


def test_academy_of_an_independent_forms_a_family_of_one_plus_academy(client):
    member, academy = solo_with_academy(client)
    assert member["familyId"] is not None
    assert academy["academyOf"] == member["familyId"]
    assert [f["id"] for f in client.families()] == [member["familyId"]]


def test_academy_of_alliance_must_be_valid(client):
    member, academy = solo_with_academy(client)
    elsewhere = alliance(client, server="4181")
    for target in ("nope", elsewhere["id"], academy["id"]):
        res = make(client, role="academy", academyOfAlliance=target)
        assert "academyOf" in res.get_json()["errors"], target


def test_family_has_at_most_one_academy(client):
    lead = founder(client)
    alliance(client, role="academy", academyOf=lead["familyId"])
    res = make(client, role="academy", academyOf=lead["familyId"])
    assert "academyOf" in res.get_json()["errors"]


def test_keeping_own_academy_role_is_fine_on_edit(client):
    lead = founder(client)
    academy = alliance(client, role="academy", academyOf=lead["familyId"])
    assert client.patch(f"/alliances/{academy['id']}", json={"name": "Renamed"}).status_code == 200


def test_cannot_merge_two_families_with_academies(client):
    a, _ = solo_with_academy(client)
    b, _ = solo_with_academy(client)
    # a is alone in its family, so picking b would merge the two families.
    res = client.patch(f"/alliances/{a['id']}", json={"role": "family", "familyWith": [b["id"]]})
    assert "familyWith" in res.get_json()["errors"]


def test_academy_requires_existing_family(client):
    assert "academyOf" in make(client, role="academy").get_json()["errors"]
    assert "academyOf" in make(client, role="academy", academyOf="nope").get_json()["errors"]


def test_academy_of_is_ignored_unless_role_is_academy(client):
    lead = founder(client)
    a = alliance(client, academyOf=lead["familyId"])  # role defaults to "none"
    assert a["academyOf"] is None


def test_family_dissolves_when_its_academy_leaves(client):
    member, academy = solo_with_academy(client)
    client.patch(f"/alliances/{academy['id']}", json={"role": "none"})
    assert client.alliance(member["id"])["familyId"] is None
    assert client.families() == []


# --- editing ---


def test_edit_keeps_family_when_relationship_not_sent(client):
    lead, mate = pair(client)
    res = client.patch(f"/alliances/{mate['id']}", json={"name": "Renamed"})
    assert (res.get_json()["name"], res.get_json()["familyId"]) == ("Renamed", lead["familyId"])


def test_leaving_a_family_of_two_dissolves_it(client):
    lead, mate = pair(client)
    res = client.patch(f"/alliances/{mate['id']}", json={"role": "none"})
    assert res.get_json()["familyId"] is None
    assert client.alliance(lead["id"])["familyId"] is None  # alone now: independent
    assert client.families() == []


def test_leaving_a_bigger_family_keeps_it(client):
    lead, mate = pair(client)
    third = alliance(client, role="family", familyWith=[lead["id"]])
    client.patch(f"/alliances/{third['id']}", json={"role": "none"})
    assert client.alliance(mate["id"])["familyId"] == lead["familyId"]


def test_switch_from_family_to_academy_of_another(client):
    a, b = founder(client), founder(client)
    mate = alliance(client, role="family", familyWith=[a["id"]])
    res = client.patch(f"/alliances/{mate['id']}", json={"role": "academy", "academyOf": b["familyId"]})
    assert (res.get_json()["familyId"], res.get_json()["academyOf"]) == (None, b["familyId"])


def test_member_can_become_academy_of_its_own_family(client):
    lead, mate = pair(client)
    res = client.patch(f"/alliances/{mate['id']}", json={"role": "academy", "academyOf": lead["familyId"]})
    assert res.get_json()["academyOf"] == lead["familyId"]
    assert client.alliance(lead["id"])["familyId"] == lead["familyId"]  # one member plus its academy


def test_cannot_become_academy_of_own_family_as_last_member(client):
    member, _ = solo_with_academy(client)
    res = client.patch(f"/alliances/{member['id']}", json={"role": "academy", "academyOf": member["familyId"]})
    assert "academyOf" in res.get_json()["errors"]


def test_last_member_cannot_leave_while_academy_remains(client):
    member, _ = solo_with_academy(client)
    other = founder(client)
    for change in ({"role": "none"}, {"role": "academy", "academyOf": other["familyId"]}):
        assert "role" in client.patch(f"/alliances/{member['id']}", json=change).get_json()["errors"], change
    # Picking a family without an academy instead merges the two, so the academy keeps a family.
    res = client.patch(f"/alliances/{member['id']}", json={"role": "family", "familyWith": [other["id"]]})
    assert res.status_code == 200
    assert client.alliance(other["id"])["familyId"] == member["familyId"]


def test_family_of_one_with_academy_stays_put_when_saved_unchanged(client):
    member, _ = solo_with_academy(client)
    res = client.patch(f"/alliances/{member['id']}", json={"role": "family", "familyWith": []})
    assert res.get_json()["familyId"] == member["familyId"]


def test_family_of_one_grows_instead_of_being_replaced(client):
    member, academy = solo_with_academy(client)
    loner = alliance(client)
    res = client.patch(f"/alliances/{member['id']}", json={"role": "family", "familyWith": [loner["id"]]})
    assert res.get_json()["familyId"] == member["familyId"]
    assert client.alliance(loner["id"])["familyId"] == member["familyId"]
    assert client.alliance(academy["id"])["academyOf"] == member["familyId"]


def test_server_and_tag_rules_on_edit(client):
    a = alliance(client)
    make(client, tag="TAKE")
    assert client.patch(f"/alliances/{a['id']}", json={"server": "4181"}).get_json()["server"] == "4180"
    assert "tag" in client.patch(f"/alliances/{a['id']}", json={"tag": "TAKE"}).get_json()["errors"]


def test_update_missing_is_404(client):
    assert client.patch("/alliances/nope", json={}).status_code == 404


# --- allied families ---


def test_allied_with_families(client):
    a, b = founder(client), founder(client)
    loner = alliance(client, alliedFamilyIds=[a["familyId"], b["familyId"]])
    assert loner["alliedFamilyIds"] == [a["familyId"], b["familyId"]]


def test_not_allied_with_own_family(client):
    lead = founder(client)
    mate = alliance(client, role="family", familyWith=[lead["id"]], alliedFamilyIds=[lead["familyId"]])
    assert mate["alliedFamilyIds"] == []


def test_allied_link_removed_when_family_dissolves(client):
    lead, mate = pair(client)
    ally = alliance(client, alliedFamilyIds=[lead["familyId"]])
    client.delete(f"/alliances/{lead['id']}")
    assert client.alliance(mate["id"])["familyId"] is None
    assert client.alliance(ally["id"])["alliedFamilyIds"] == []


def test_allied_with_alliances_is_mutual(client):
    a, b, c = alliance(client), alliance(client), alliance(client)
    res = client.patch(f"/alliances/{a['id']}", json={"alliedAllianceIds": [b["id"], c["id"]]})
    assert res.get_json()["alliedAllianceIds"] == [b["id"], c["id"]]
    assert client.alliance(b["id"])["alliedAllianceIds"] == [a["id"]]
    # Removing it from the other side removes it from both.
    client.patch(f"/alliances/{b['id']}", json={"alliedAllianceIds": []})
    assert client.alliance(a["id"])["alliedAllianceIds"] == [c["id"]]


def test_any_alliance_can_have_allied_alliances(client):
    lead, mate = pair(client)
    academy = alliance(client, role="academy", academyOf=lead["familyId"])
    loner = alliance(client)
    for who in (lead, academy):
        res = client.patch(f"/alliances/{who['id']}", json={"alliedAllianceIds": [loner["id"]]})
        assert res.get_json()["alliedAllianceIds"] == [loner["id"]]
    assert set(client.alliance(loner["id"])["alliedAllianceIds"]) == {lead["id"], academy["id"]}


def test_allied_alliances_must_be_others_on_same_server(client):
    a = alliance(client)
    elsewhere = alliance(client, server="4181")
    for ids in (["nope"], [elsewhere["id"]], "x"):
        assert "alliedAllianceIds" in make(client, alliedAllianceIds=ids).get_json()["errors"], ids
    assert "alliedAllianceIds" in client.patch(f"/alliances/{a['id']}", json={"alliedAllianceIds": [a["id"]]}).get_json()["errors"]


def test_no_alliance_links_within_a_family(client):
    lead, mate = pair(client)
    academy = alliance(client, role="academy", academyOf=lead["familyId"])
    res = client.patch(f"/alliances/{lead['id']}", json={"alliedAllianceIds": [mate["id"], academy["id"]]})
    assert res.get_json()["alliedAllianceIds"] == []


def test_alliance_link_stays_when_other_joins_a_family(client):
    a, b = alliance(client), alliance(client)
    client.patch(f"/alliances/{a['id']}", json={"alliedAllianceIds": [b["id"]]})
    other = founder(client)
    client.patch(f"/alliances/{b['id']}", json={"role": "family", "familyWith": [other["id"]]})
    assert client.alliance(a["id"])["alliedAllianceIds"] == [b["id"]]
    assert client.alliance(a["id"])["alliedFamilyIds"] == []


def test_alliance_link_dropped_when_they_become_family_mates(client):
    a, b = alliance(client), alliance(client)
    client.patch(f"/alliances/{a['id']}", json={"alliedAllianceIds": [b["id"]]})
    client.patch(f"/alliances/{a['id']}", json={"role": "family", "familyWith": [b["id"]]})
    assert client.alliance(a["id"])["alliedAllianceIds"] == client.alliance(b["id"])["alliedAllianceIds"] == []


def test_alliance_link_removed_when_ally_deleted(client):
    a, b = alliance(client), alliance(client)
    client.patch(f"/alliances/{a['id']}", json={"alliedAllianceIds": [b["id"]]})
    client.delete(f"/alliances/{b['id']}")
    assert client.alliance(a["id"])["alliedAllianceIds"] == []


def test_create_with_allied_alliance_links_both(client):
    b = alliance(client)
    a = alliance(client, alliedAllianceIds=[b["id"]])
    assert client.alliance(b["id"])["alliedAllianceIds"] == [a["id"]]


# --- deleting ---


def test_delete_alliance(client):
    a = alliance(client)
    assert client.delete(f"/alliances/{a['id']}").get_json() == {"deleted": [a["id"]]}


def test_delete_member_keeps_bigger_family(client):
    lead, mate = pair(client)
    third = alliance(client, role="family", familyWith=[lead["id"]])
    client.delete(f"/alliances/{lead['id']}")
    assert client.alliance(mate["id"])["familyId"] == client.alliance(third["id"])["familyId"] == lead["familyId"]


def test_delete_last_member_with_academy_needs_a_choice(client):
    member, _ = solo_with_academy(client)
    res = client.delete(f"/alliances/{member['id']}")
    assert (res.status_code, res.get_json()["academyCount"]) == (409, 1)


def test_delete_last_member_and_academy(client):
    member, academy = solo_with_academy(client)
    res = client.delete(f"/alliances/{member['id']}?academies=delete")
    assert set(res.get_json()["deleted"]) == {member["id"], academy["id"]}


def test_delete_last_member_detaching_academy(client):
    member, academy = solo_with_academy(client)
    client.delete(f"/alliances/{member['id']}?academies=detach")
    assert client.alliance(academy["id"])["academyOf"] is None
    assert client.families() == []


def test_delete_last_member_moving_academy(client):
    member, academy = solo_with_academy(client)
    other = founder(client)
    client.delete(f"/alliances/{member['id']}?academies=move&moveTo={other['familyId']}")
    assert client.alliance(academy["id"])["academyOf"] == other["familyId"]


def test_move_academy_rejects_bad_destination(client):
    member, _ = solo_with_academy(client)
    elsewhere = founder(client, server="4181")
    taken, _ = solo_with_academy(client)
    for dest in ("nope", member["familyId"], elsewhere["familyId"], taken["familyId"]):
        res = client.delete(f"/alliances/{member['id']}?academies=move&moveTo={dest}")
        assert res.status_code == 400, dest


def test_delete_missing_is_404(client):
    assert client.delete("/alliances/nope").status_code == 404
    assert client.delete("/servers/9999").status_code == 404


# --- fields ---


def test_utf8_limits(client):
    assert make(client, name="名" * 256, tag="名前ab").status_code == 201
    errors = make(client, name="名" * 257, tag="12345").get_json()["errors"]
    assert set(errors) == {"name", "tag"}


def test_duplicate_tag_on_same_server_rejected(client):
    make(client, tag="DUP")
    assert make(client, tag="DUP").status_code == 400
    assert make(client, tag="DUP", server="4181").status_code == 201


def test_notes_keep_whitespace_and_unicode_exactly(client):
    notes = "  leading spaces\n\n\tTabbed line ✨\r\nWindows line\n  trailing  \n\n"
    a = alliance(client, notes=notes)
    assert client.alliance(a["id"])["notes"] == notes


def test_notes_default_and_limits(client):
    assert alliance(client)["notes"] == ""
    assert make(client, notes="名" * 200_000).status_code == 201
    assert "notes" in make(client, notes="x" * 200_001).get_json()["errors"]
    assert "notes" in make(client, notes=123).get_json()["errors"]


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


def test_reorder_alliances_sets_positions(client):
    a, b = alliance(client), alliance(client)
    assert client.put("/alliances/order", json={"ids": [b["id"], a["id"]]}).status_code == 200
    assert (client.alliance(b["id"])["position"], client.alliance(a["id"])["position"]) == (0, 1)


@pytest.mark.parametrize("ids", [None, "x", [1], ["nope"]])
def test_reorder_rejects_bad_ids(client, ids):
    assert client.put("/alliances/order", json={"ids": ids}).status_code == 400


# --- dragged layout ---


def test_save_and_clear_layout(client):
    lead = founder(client)
    loner = alliance(client)
    items = [
        {"kind": "family", "id": lead["familyId"], "x": 10, "y": -20.5},
        {"kind": "academy", "id": lead["familyId"], "x": 3, "y": 4},
        {"kind": "alliance", "id": loner["id"], "x": 0, "y": 99},
    ]
    assert client.put("/layout", json={"items": items}).status_code == 200
    family = client.families()[0]
    assert (family["layout"], family["academyLayout"]) == ({"x": 10, "y": -20.5}, {"x": 3, "y": 4})
    assert client.alliance(loner["id"])["layout"] == {"x": 0, "y": 99}
    clear = [{**i, "x": None, "y": None} for i in items]
    client.put("/layout", json={"items": clear})
    assert "layout" not in client.families()[0] and "layout" not in client.alliance(loner["id"])


@pytest.mark.parametrize(
    "item",
    [{"kind": "nope", "id": "x", "x": 1, "y": 1}, {"kind": "family", "id": "missing", "x": 1, "y": 1},
     {"kind": "alliance", "id": "x", "x": "1", "y": 1}, {"kind": "alliance", "id": "x", "x": True, "y": 1},
     {"kind": "alliance", "id": "x", "x": 1, "y": None}],
)
def test_bad_layout_rejected(client, item):
    assert client.put("/layout", json={"items": [item]}).status_code == 400


def test_joining_a_family_forgets_dragged_spot(client):
    lead = founder(client)
    loner = alliance(client)
    client.put("/layout", json={"items": [{"kind": "alliance", "id": loner["id"], "x": 5, "y": 5}]})
    client.patch(f"/alliances/{loner['id']}", json={"role": "family", "familyWith": [lead["id"]]})
    assert "layout" not in client.alliance(loner["id"])


# --- migrating old data ---


ROOT_MODEL = {
    "alliances": [
        {"id": "r1", "name": "Root", "tag": "R", "server": "0042", "type": "root", "rootId": None},
        {"id": "f1", "name": "Fam", "tag": "F", "server": "0042", "type": "family", "rootId": "r1"},
        {"id": "a1", "name": "Aca", "tag": "A", "server": "0042", "type": "academy", "rootId": "r1"},
        {"id": "r2", "name": "Lonely", "tag": "L", "server": "0042", "type": "root", "rootId": None},
    ]
}

FAMILY_MODEL = {
    "servers": [{"number": "0042"}],
    "families": [{"id": "F1", "server": "0042"}, {"id": "F2", "server": "0042"}],
    "alliances": [
        {"id": "r1", "name": "Root", "tag": "R", "server": "0042", "type": "family", "familyId": "F1", "isRoot": True},
        {"id": "f1", "name": "Fam", "tag": "F", "server": "0042", "type": "family", "familyId": "F1", "isRoot": False},
        {"id": "a1", "name": "Aca", "tag": "A", "server": "0042", "type": "academy", "familyId": "F1",
         "isRoot": False},
        {"id": "r2", "name": "Lonely", "tag": "L", "server": "0042", "type": "family", "familyId": "F2",
         "isRoot": True},
    ],
}

GROUP_MODEL = {
    "servers": [{"number": "0042"}],
    "families": [
        {"id": "F1", "name": "Root family", "server": "0042", "rootId": "r1", "createdAt": "2026-01-01"},
        {"id": "F2", "name": "Lonely family", "server": "0042", "rootId": "r2", "createdAt": "2026-01-02"},
    ],
    "academies": [
        {"id": "A1", "name": "Root academy", "server": "0042", "familyIds": ["F1"]},
        {"id": "A2", "name": "Orphan academy", "server": "0042", "familyIds": []},
    ],
    "alliances": [
        {"id": "r1", "name": "Root", "tag": "R", "server": "0042", "familyIds": ["F1"], "academyIds": [],
         "alliedFamilyIds": []},
        {"id": "f1", "name": "Fam", "tag": "F", "server": "0042", "familyIds": ["F1"], "academyIds": [],
         "alliedFamilyIds": [], "position": 2},
        {"id": "a1", "name": "Aca", "tag": "A", "server": "0042", "familyIds": [], "academyIds": ["A1"],
         "alliedFamilyIds": []},
        {"id": "r2", "name": "Lonely", "tag": "L", "server": "0042", "familyIds": ["F2"], "academyIds": [],
         "alliedFamilyIds": []},
    ],
}


def check_migrated(user):
    """Every old model describes: Root + Fam in one family, Aca its academy, and Lonely, whose family of
    one (no academy) is now just an independent alliance."""
    graph = user.get("/graph").get_json()
    assert [s["number"] for s in graph["servers"]] == ["0042"]
    by_id = {a["id"]: a for a in graph["alliances"]}
    for a in graph["alliances"]:
        assert not {"type", "isRoot", "rootId", "familyIds", "academyIds"} & set(a), a
        assert a["alliedAllianceIds"] == []
    assert by_id["r1"]["familyId"] == by_id["f1"]["familyId"] is not None
    assert by_id["a1"]["familyId"] is None
    assert by_id["a1"]["academyOf"] == by_id["r1"]["familyId"]
    assert by_id["r2"]["familyId"] is None
    assert {f["id"] for f in graph["families"]} == {by_id["r1"]["familyId"]}
    assert all(set(f) == {"id", "server", "createdAt"} for f in graph["families"])
    return graph


def write_old(tmp_path, user, model):
    path = tmp_path / "users" / f"{user.user_id}.json"
    stored = json.loads(path.read_text())
    path.write_text(json.dumps({"user": stored["user"], **model}))
    return path


@pytest.mark.parametrize("model", [ROOT_MODEL, FAMILY_MODEL, GROUP_MODEL], ids=["root", "family", "group"])
def test_migrates_old_models(tmp_path, model):
    user = new_user(create_app(tmp_path).test_client(), "old")
    path = write_old(tmp_path, user, model)
    first = check_migrated(user)
    # Saved on first load, so generated ids are stable from then on.
    assert user.get("/graph").get_json() == first
    saved = json.loads(path.read_text())
    assert saved["version"] == DATA_VERSION
    assert "academies" not in saved


def test_migration_turns_extra_families_into_allies(tmp_path):
    user = new_user(create_app(tmp_path).test_client(), "old")
    model = json.loads(json.dumps(GROUP_MODEL))
    model["alliances"][3]["familyIds"] = ["F2", "F1"]  # Lonely was in both families...
    for extra in ("x", "y"):  # ...and F2 has two other members, so it survives the migration.
        model["alliances"].append(
            {"id": extra, "name": extra, "tag": extra, "server": "0042", "familyIds": ["F2"], "academyIds": [],
             "alliedFamilyIds": []}
        )
    write_old(tmp_path, user, model)
    lonely = user.alliance("r2")
    # It keeps the oldest family (F1) and is allied with the other.
    assert (lonely["familyId"], lonely["alliedFamilyIds"]) == ("F1", ["F2"])


def test_migration_makes_unprotected_academy_members_independent(tmp_path):
    user = new_user(create_app(tmp_path).test_client(), "old")
    model = json.loads(json.dumps(GROUP_MODEL))
    model["alliances"][2]["academyIds"] = ["A2"]
    write_old(tmp_path, user, model)
    aca = user.alliance("a1")
    assert (aca["familyId"], aca["academyOf"]) == (None, None)


def test_migration_keeps_one_academy_per_family(tmp_path):
    user = new_user(create_app(tmp_path).test_client(), "old")
    v2 = {
        "version": 2,
        "servers": [{"number": "0042"}],
        "families": [{"id": "F", "server": "0042", "createdAt": "2026-01-01"}],
        "alliances": [
            {"id": "m", "name": "M", "tag": "M", "server": "0042", "power": "1", "notes": "", "familyId": "F",
             "academyOf": None, "alliedFamilyIds": []},
            {"id": "weak", "name": "Weak", "tag": "W", "server": "0042", "power": "5", "notes": "",
             "familyId": None, "academyOf": "F", "alliedFamilyIds": []},
            {"id": "strong", "name": "Strong", "tag": "S", "server": "0042", "power": "9", "notes": "",
             "familyId": None, "academyOf": "F", "alliedFamilyIds": []},
        ],
    }
    write_old(tmp_path, user, v2)
    assert user.alliance("strong")["academyOf"] == "F"
    weak = user.alliance("weak")
    assert (weak["academyOf"], weak["alliedFamilyIds"]) == (None, ["F"])


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
    path = write_old(tmp_path, user, GROUP_MODEL)
    migrate.main(tmp_path)
    assert "migrated  old" in capsys.readouterr().out
    assert json.loads(path.read_text())["version"] == DATA_VERSION
    check_migrated(user)
    migrate.main(tmp_path)
    assert "current   old" in capsys.readouterr().out

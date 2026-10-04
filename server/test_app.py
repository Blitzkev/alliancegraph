import json

import pytest

from app import create_app


@pytest.fixture
def client(tmp_path):
    app = create_app(tmp_path / "alliances.json")
    app.config["TESTING"] = True
    client = app.test_client()
    for number in ("4180", "4181", "0042"):
        client.post("/api/servers", json={"number": number})
    return client


def make(client, **overrides):
    body = {"name": "Path of Exiles", "tag": "G~4", "server": "4180", "type": "root", **overrides}
    return client.post("/api/alliances", json=body)


def test_create_and_list_root(client):
    res = make(client)
    assert res.status_code == 201
    alliance = res.get_json()
    assert alliance["rootId"] is None
    assert client.get("/api/alliances").get_json() == [alliance]


def test_persists_across_app_instances(tmp_path):
    path = tmp_path / "alliances.json"
    first = create_app(path).test_client()
    first.post("/api/servers", json={"number": "4180"})
    make(first)
    second = create_app(path).test_client()
    assert len(second.get("/api/servers").get_json()) == 1
    assert len(second.get("/api/alliances").get_json()) == 1


def test_create_server_keeps_leading_zeros(client):
    numbers = [s["number"] for s in client.get("/api/servers").get_json()]
    assert numbers == ["4180", "4181", "0042"]


@pytest.mark.parametrize("number", ["123", "12345", "abcd", 4180, "", "١٢٣٤"])
def test_bad_server_number_rejected(client, number):
    res = client.post("/api/servers", json={"number": number})
    assert res.status_code == 400
    assert "number" in res.get_json()["errors"]


def test_duplicate_server_rejected(client):
    res = client.post("/api/servers", json={"number": "4180"})
    assert res.status_code == 400


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
    res = client.delete(f"/api/alliances/{root['id']}")
    assert set(res.get_json()["deleted"]) == {root["id"], fam["id"], aca["id"]}
    assert client.get("/api/alliances").get_json() == [other]


def test_delete_server_cascades(client):
    root = make(client).get_json()
    fam = make(client, type="family", tag="F1", rootId=root["id"]).get_json()
    keep = make(client, server="4181").get_json()
    res = client.delete("/api/servers/4180")
    assert set(res.get_json()["deleted"]) == {root["id"], fam["id"]}
    assert [s["number"] for s in client.get("/api/servers").get_json()] == ["4181", "0042"]
    assert client.get("/api/alliances").get_json() == [keep]


def test_delete_missing_is_404(client):
    assert client.delete("/api/alliances/nope").status_code == 404
    assert client.delete("/api/servers/9999").status_code == 404


def test_migrates_file_without_servers(tmp_path):
    path = tmp_path / "alliances.json"
    old = {"id": "a1", "name": "Old", "tag": "OLD", "server": "0042", "type": "root", "rootId": None}
    path.write_text(json.dumps({"alliances": [old]}))
    client = create_app(path).test_client()
    assert [s["number"] for s in client.get("/api/servers").get_json()] == ["0042"]
    # The migrated server is usable straight away.
    assert make(client, server="0042", type="family", tag="F1", rootId="a1").status_code == 201

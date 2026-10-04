import pytest

from app import create_app


@pytest.fixture
def client(tmp_path):
    app = create_app(tmp_path / "alliances.json")
    app.config["TESTING"] = True
    return app.test_client()


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
    make(create_app(path).test_client())
    assert len(create_app(path).test_client().get("/api/alliances").get_json()) == 1


def test_leading_zero_server_kept(client):
    assert make(client, server="0042").get_json()["server"] == "0042"


@pytest.mark.parametrize("server", ["123", "12345", "abcd", 4180, "", "١٢٣٤"])
def test_bad_server_rejected(client, server):
    res = make(client, server=server)
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


def test_delete_root_cascades(client):
    root = make(client).get_json()
    other = make(client, tag="R2").get_json()
    fam = make(client, type="family", tag="F1", rootId=root["id"]).get_json()
    aca = make(client, type="academy", tag="A1", rootId=root["id"]).get_json()
    res = client.delete(f"/api/alliances/{root['id']}")
    assert set(res.get_json()["deleted"]) == {root["id"], fam["id"], aca["id"]}
    assert client.get("/api/alliances").get_json() == [other]


def test_delete_missing_is_404(client):
    assert client.delete("/api/alliances/nope").status_code == 404

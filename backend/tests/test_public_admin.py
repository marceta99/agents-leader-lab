from app.db import SessionLocal
from app.models import Experiment
from app.settings_store import DEFAULTS
from tests.test_results import CONFIG, make_experiment


async def test_share_token_grants_only_that_run(auth_client, client):
    _, (run_a, run_b) = await make_experiment("user@example.com", n_runs=2)
    token = (await auth_client.post(f"/api/runs/{run_a}/share")).json()["token"]
    assert (await auth_client.post(f"/api/runs/{run_a}/share")).json()["token"] == token  # reused
    r = await client.get(f"/api/public/runs/{token}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == run_a and body["is_owner"] is False and "share_token" not in body
    assert body["experiment_name"] == "exp" and body["result"]["solved"] is True
    events = (await client.get(f"/api/public/runs/{token}/events")).json()
    assert [e["seq"] for e in events] == [1, 2] and set(events[0]) == {"seq", "t", "type", "data"}
    assert "user@example.com" not in r.text
    # the token is not a login: the anonymous client still can't touch the experiment or the other run
    assert (await client.get(f"/api/experiments/{body['experiment_id']}/results")).status_code == 401
    assert (await client.post(f"/api/runs/{run_b}/share")).status_code == 401
    assert (await client.get("/api/public/runs/not-a-token")).status_code == 404


async def test_revoked_token_404(auth_client, client):
    _, (run_id,) = await make_experiment("user@example.com")
    token = (await auth_client.post(f"/api/runs/{run_id}/share")).json()["token"]
    assert (await auth_client.delete(f"/api/runs/{run_id}/share")).status_code == 204
    assert (await client.get(f"/api/public/runs/{token}")).status_code == 404
    assert (await client.get(f"/api/public/runs/{token}/events")).status_code == 404
    new = (await auth_client.post(f"/api/runs/{run_id}/share")).json()["token"]
    assert new != token


async def test_demo_visible_logged_out(admin_client, client):
    demo_id, (run_id,) = await make_experiment("admin@example.com", is_demo=True)
    await make_experiment("admin@example.com")  # not a demo
    r = await client.get("/api/public/demos")
    assert r.status_code == 200
    demos = r.json()
    assert [d["experiment"]["id"] for d in demos] == [demo_id]
    assert demos[0]["runs"][0]["id"] == run_id and demos[0]["runs"][0]["measured_leader"] == "Sky"
    assert "admin@example.com" not in r.text and "user_id" not in demos[0]["experiment"]


async def test_non_admin_403_on_settings(auth_client, client):
    assert (await auth_client.get("/api/admin/settings")).status_code == 403
    assert (await auth_client.put("/api/admin/settings", json={"effort": "high"})).status_code == 403
    assert (await auth_client.post("/api/admin/experiments/1/demo", json={"is_demo": True})).status_code == 403
    assert (await client.get("/api/admin/settings")).status_code == 401


async def test_settings_put_validates(admin_client):
    assert (await admin_client.get("/api/admin/settings")).json() == DEFAULTS
    for bad in ({"cell_seconds": -1}, {"call_limit": "many"}, {"max_runs": True}, {"models": []},
                {"models": ["gpt-9"]}, {"effort": "extreme"}):
        assert (await admin_client.put("/api/admin/settings", json=bad)).status_code == 422, bad
    r = await admin_client.put("/api/admin/settings", json={"effort": "high", "models": ["claude-haiku-5-5"]})
    assert r.status_code == 200 and r.json()["effort"] == "high"
    r = await admin_client.put("/api/admin/settings", json={"max_runs": 10})  # partial PUT keeps earlier changes
    assert r.json()["effort"] == "high" and r.json()["max_runs"] == 10
    assert (await admin_client.get("/api/admin/settings")).json()["models"] == ["claude-haiku-5-5"]


async def test_settings_snapshot_not_retroactive(admin_client):
    exp_id, _ = await make_experiment("admin@example.com")
    r = await admin_client.put("/api/admin/settings", json={"cell_seconds": 9.0})
    assert r.status_code == 200
    async with SessionLocal() as db:
        assert (await db.get(Experiment, exp_id)).config == CONFIG


async def test_demo_toggle_only_own_experiment(admin_client, auth_client):
    other_id, _ = await make_experiment("user@example.com")
    own_id, _ = await make_experiment("admin@example.com")
    assert (await admin_client.post(f"/api/admin/experiments/{other_id}/demo", json={"is_demo": True})).status_code == 404
    assert (await admin_client.post("/api/admin/experiments/9999/demo", json={"is_demo": True})).status_code == 404
    assert (await admin_client.post(f"/api/admin/experiments/{own_id}/demo", json={"is_demo": True})).status_code == 204
    async with SessionLocal() as db:
        assert (await db.get(Experiment, own_id)).is_demo is True
        assert (await db.get(Experiment, other_id)).is_demo is False
    demos = (await auth_client.get("/api/public/demos")).json()
    assert [d["experiment"]["id"] for d in demos] == [own_id]

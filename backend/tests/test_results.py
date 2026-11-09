import io
import zipfile
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import ApiKey, Decision, Experiment, Run, RunEvent, User
from app.results import aggregate

CONFIG = {"name": "x", "model": "claude-haiku-5-5", "add_leader": True, "settings": {"cell_seconds": 2.0}}
RESULT = {
    "solved": True, "duration_ms": 120000, "leader_agent": "Sky", "richest_agent": "Sky", "leader_is_richest": True,
    "measured_leader": "Sky", "influence_share": {"Sam": 0.0, "Sky": 0.8, "Sol": 0.2, "Sage": 0.0},
    "instructions": [{"message_id": 1, "from": "Sky", "to": "Sol", "followed": True, "score": 0.67}],
    "styles": {"1": "directive"}, "style_mix": {"Sky": {"directive": 1, "non_directive": 0, "other": 0}},
    "partial": False,
}


async def user_id(email: str) -> int:
    async with SessionLocal() as db:
        return await db.scalar(select(User.id).where(User.email == email))


async def make_experiment(email: str, is_demo: bool = False, n_runs: int = 1) -> tuple[int, list[int]]:
    """Experiment with n finished free-group runs, each with a message event and a decision."""
    uid = await user_id(email)
    async with SessionLocal() as db:
        exp = Experiment(user_id=uid, name="exp", config=CONFIG, status="finished", is_demo=is_demo)
        db.add(exp)
        await db.flush()
        runs = [Run(experiment_id=exp.id, group="free", layout_no=i + 1, status="finished", end_reason="solved",
                    result=RESULT) for i in range(n_runs)]
        db.add_all(runs)
        await db.flush()
        for r in runs:
            db.add_all([
                RunEvent(run_id=r.id, seq=2, t_ms=500, type="message", data={"agent": "Sky", "id": 1, "text": "Sol, flip 2"}),
                RunEvent(run_id=r.id, seq=1, t_ms=0, type="run_started", data={}),
                Decision(run_id=r.id, agent="Sky", seq=1, t_ms=0, trigger=["start"], request={"system": "s"},
                         response={}, outcome="ok"),
            ])
        await db.commit()
        return exp.id, [r.id for r in runs]


def _run(status, group, **res):
    return SimpleNamespace(status=status, group=group, result=res)


FIXTURE = [
    _run("finished", "free", solved=True, duration_ms=100000, measured_leader="Sky", leader_agent="Sky",
         richest_agent="Sky", leader_is_richest=True, influence_share={"Sky": 0.8},
         style_mix={"Sky": {"directive": 2, "non_directive": 1, "other": 0}}),
    _run("finished", "free", solved=False, duration_ms=200000, measured_leader=None, leader_agent="Sol",
         richest_agent="Sam", leader_is_richest=False, influence_share={"Sol": 0.1}),
    _run("finished", "none", solved=True, duration_ms=300000, measured_leader="Sam", leader_agent=None,
         richest_agent="Sage", leader_is_richest=None),
    _run("finished", "free", solved=True, partial=True, leader_agent="Sky", leader_is_richest=False),
]


def test_aggregates_fixture():
    out = aggregate(FIXTURE, "any")
    o = out["overall"]
    assert out["excluded"] == 1
    assert o["runs"] == 3
    assert o["solved_rate"] == pytest.approx(2 / 3)
    assert o["leader_rate"] == pytest.approx(2 / 3)
    assert o["richest_leader_rate"] == pytest.approx(0.5)  # runs 1 (Sky==Sky) and 3 (Sam!=Sage)
    assert o["avg_duration_s"] == pytest.approx(200)
    assert o["leader_became_measured_rate"] == pytest.approx(0.5)
    assert o["target_share_avg"] == pytest.approx(0.45)  # legacy results: share of the told leader
    assert o["target_share_runs"] == 2
    assert o["share_by_goal_runs"] == 0 and o["share_by_goal_avg"] == {}
    goal = aggregate([_run("finished", "none", share_by_goal={"square": 0.75, "touching": 0.25, "one_zone": None}),
                      _run("finished", "none", share_by_goal={"square": None})], "any")["overall"]
    assert goal["share_by_goal_runs"] == 1 and goal["share_by_goal_avg"] == {"square": 0.75, "touching": 0.25}
    assert o["leader_rate_strict"] == 0.0
    assert o["style_mix"] == {"directive": 2, "non_directive": 1, "other": 0}
    assert list(out["groups"]) == ["none", "free"]
    assert out["groups"]["none"]["leader_became_measured_rate"] is None
    assert out["groups"]["free"]["runs"] == 2


def test_richest_filter():
    yes = aggregate(FIXTURE, "leader_is_richest")
    assert yes["overall"]["runs"] == 1 and yes["overall"]["solved_rate"] == 1.0 and yes["excluded"] == 0
    no = aggregate(FIXTURE, "leader_not_richest")
    assert no["overall"]["runs"] == 1 and no["overall"]["solved_rate"] == 0.0 and no["excluded"] == 1
    empty = aggregate([], "any")
    assert empty["overall"]["solved_rate"] is None and empty["groups"] == {}


async def test_results_owner_only_404(auth_client, admin_client):
    exp_id, (run_id,) = await make_experiment("admin@example.com")
    r = await admin_client.get(f"/api/experiments/{exp_id}/results")
    assert r.status_code == 200 and r.json()["overall"]["runs"] == 1
    for path in ("results", "export.json", "export.zip"):
        assert (await auth_client.get(f"/api/experiments/{exp_id}/{path}")).status_code == 404
    assert (await auth_client.get("/api/experiments/9999/results")).status_code == 404
    assert (await auth_client.post(f"/api/runs/{run_id}/share")).status_code == 404
    assert (await auth_client.delete(f"/api/runs/{run_id}/share")).status_code == 404
    assert (await admin_client.get(f"/api/experiments/{exp_id}/results?richest=bad")).status_code == 422


async def test_export_contains_no_key_or_email(auth_client):
    exp_id, _ = await make_experiment("user@example.com")
    async with SessionLocal() as db:
        db.add(ApiKey(user_id=await user_id("user@example.com"), ciphertext="SECRETCIPHER", last4="WXYZ"))
        await db.commit()
    r = await auth_client.get(f"/api/experiments/{exp_id}/export.json")
    assert r.status_code == 200
    assert 'filename="experiment-' in r.headers["content-disposition"]
    body = r.text
    for bad in ("user@example.com", "SECRETCIPHER", "WXYZ", "password"):
        assert bad not in body
    data = r.json()
    run = data["runs"][0]
    assert [e["seq"] for e in run["events"]] == [1, 2]
    assert run["decisions"][0]["agent"] == "Sky"
    assert data["experiment"]["config"] == CONFIG
    zbytes = (await auth_client.get(f"/api/experiments/{exp_id}/export.zip")).content
    with zipfile.ZipFile(io.BytesIO(zbytes)) as z:
        for name in z.namelist():
            text = z.read(name).decode()
            assert "user@example.com" not in text and "SECRETCIPHER" not in text


async def test_export_zip_has_three_csvs(auth_client):
    exp_id, run_ids = await make_experiment("user@example.com", n_runs=2)
    r = await auth_client.get(f"/api/experiments/{exp_id}/export.zip")
    assert r.status_code == 200
    assert f'filename="experiment-{exp_id}.zip"' in r.headers["content-disposition"]
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        assert sorted(z.namelist()) == ["instructions.csv", "messages.csv", "runs.csv"]
        ins_lines = z.read("instructions.csv").decode().splitlines()
        runs_lines = z.read("runs.csv").decode().splitlines()
        msg_lines = z.read("messages.csv").decode().splitlines()
    assert runs_lines[0].startswith("run_id,group,layout_no") and "influence_share_Sky" in runs_lines[0]
    assert len(runs_lines) == 3 and runs_lines[1].startswith(f"{run_ids[0]},free,1,,finished,solved,True,,120.0,Sky")
    assert len(msg_lines) == 3
    assert ins_lines[0].startswith("run_id,message_id,from,to,type") and len(ins_lines) == 3
    assert ins_lines[1] == f"{run_ids[0]},1,Sky,Sol,instruction,,,,None,True,,,0.67,"
    assert msg_lines[1] == f"{run_ids[0]},1,0.5,Sky,\"Sol, flip 2\",directive,True,Sol,True,0.67"

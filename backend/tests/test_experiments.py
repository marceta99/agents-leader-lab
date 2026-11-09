import asyncio
from collections import Counter

from sqlalchemy import select, update

from app import runner, scheduler
from app.db import SessionLocal
from app.models import Run
from app.settings_store import DEFAULTS
from tests.test_runner import add_key, create, fast, state, use_client, wait_all, wait_exp, wait_for  # noqa: F401

BODY = {"budget": [5, 5, 5, 5], "runs": 1, "model": "claude-haiku-5-5", "cap_usd": 5.0}


async def test_budget_validation(auth_client, monkeypatch):
    monkeypatch.setattr(scheduler, "launch", lambda exp_id: None)
    r = await auth_client.post("/api/experiments", json=BODY)
    assert r.status_code == 400 and r.json()["detail"] == "Add your Anthropic API key first"
    await add_key()
    for budget in ([13, 5, 5, 5], [5, 5, 5, 0], [5, 5, 5], [5, 5, 5, 5.5], [-1, 12, 5, 5]):
        r = await auth_client.post("/api/experiments", json={**BODY, "budget": budget})
        assert r.status_code == 422, (budget, r.text)
    for bad in ({"runs": 0}, {"runs": 1001}, {"model": "gpt-4"}, {"cap_usd": 0}):
        assert (await auth_client.post("/api/experiments", json={**BODY, **bad})).status_code == 422, bad
    r = await auth_client.post("/api/experiments", json={**BODY, "budget": [12, 4, 0, 0]})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "queued" and d["runs_total"] == 1 and d["config"]["settings"]["cell_seconds"] == 0.02
    assert d["config"]["layout_version"] == 2 and d["config"]["budget"] == [12, 4, 0, 0]


async def test_estimate(auth_client):
    one = (await auth_client.post("/api/experiments/estimate", json={**BODY, "runs": 2})).json()
    four = (await auth_client.post("/api/experiments/estimate", json={**BODY, "runs": 2, "add_leader": True})).json()
    assert one["runs_total"] == 2 and four["runs_total"] == 4
    assert four["calls_estimate"] == 2 * one["calls_estimate"] and four["usd_estimate"] > one["usd_estimate"] > 0
    assert (await auth_client.post("/api/experiments/estimate", json={**BODY, "budget": [13, 5, 5, 5]})).status_code == 422


async def test_leader_creates_2_groups_x_n_runs(auth_client, monkeypatch):
    monkeypatch.setattr(scheduler, "launch", lambda exp_id: None)
    await add_key()
    d = (await auth_client.post("/api/experiments", json={**BODY, "runs": 3, "add_leader": True})).json()
    assert d["runs_total"] == 6
    assert Counter(r["group"] for r in d["runs"]) == {"directive": 3, "nondirective": 3}
    assert [(r["layout_no"], r["group"]) for r in d["runs"][:4]] == [
        (1, "directive"), (1, "nondirective"), (2, "directive"), (2, "nondirective")]
    assert sorted({r["layout_no"] for r in d["runs"]}) == [1, 2, 3]


async def test_name_seeds_and_leader_prompts(auth_client, monkeypatch):
    monkeypatch.setattr(scheduler, "launch", lambda exp_id: None)
    await add_key()
    d = (await auth_client.post("/api/experiments", json={**BODY, "budget": [6, 6, 6, 6], "runs": 2})).json()
    assert d["name"] == "Goals hidden · Equal budget 6 · No leader" and d["config"]["leader_prompts"] is None
    body = {**BODY, "budget": [9, 5, 3, 3], "know_all_goals": True, "add_leader": True,
            "leader_prompts": {"directive": "  Tell the others exactly what to do.  "}}
    d = (await auth_client.post("/api/experiments", json=body)).json()
    assert d["name"] == "Goals known · Budget 9-5-3-3 · Directive vs non-directive leader"
    lp = d["config"]["leader_prompts"]
    assert lp["directive"] == "Tell the others exactly what to do." and lp["nondirective"].startswith("Lead by asking") and "free" not in lp
    async with SessionLocal() as db:
        seeds = [r.seed for r in (await db.scalars(select(Run).where(Run.experiment_id == d["id"]))).all()]
    assert len(seeds) == 2 and all(isinstance(s, int) for s in seeds) and len(set(seeds)) == 2
    bad = {**body, "leader_prompts": {"free": "x"}}
    assert (await auth_client.post("/api/experiments", json=bad)).status_code == 422
    listed = (await auth_client.get("/api/experiments")).json()
    assert [e["id"] for e in listed] == [d["id"], d["id"] - 1]  # newest first


async def test_max_parallel_runs(auth_client, monkeypatch):
    monkeypatch.setitem(DEFAULTS, "parallel_runs", 2)
    live, peak, order = set(), [0], []

    async def fake_execute(run_id, **kw):
        order.append(run_id)  # before any await: the start order the scheduler chose
        async with SessionLocal() as db:
            run = await db.get(Run, run_id)
            run.status = "running"
            await db.commit()
        live.add(run_id)
        peak[0] = max(peak[0], len(live))
        await asyncio.sleep(0.05)
        live.discard(run_id)
        async with SessionLocal() as db:
            await db.execute(update(Run).where(Run.id == run_id).values(status="finished", end_reason="solved"))
            await db.commit()

    monkeypatch.setattr(runner, "execute_run", fake_execute)
    await add_key()
    exp, runs = await wait_exp(await create(auth_client, runs=3, add_leader=True), statuses=("finished",))
    assert peak[0] == 2
    assert all(r.status == "finished" for r in runs) and len(runs) == 6
    expected = sorted(runs, key=lambda r: (r.layout_no, scheduler.GROUP_ORDER[r.group]))
    # runs start in (layout, group) order; two that acquire a slot together may record in either order
    assert all(abs(order.index(r.id) - i) <= 1 for i, r in enumerate(expected))
    assert [(r.layout_no, r.group) for r in expected[:4]] == [(1, "directive"), (1, "nondirective"), (2, "directive"), (2, "nondirective")]


async def test_delete_removes_everything(auth_client, monkeypatch):
    use_client(monkeypatch, wait_all)
    await add_key()
    exp_id = await create(auth_client, runs=2)
    await wait_exp(exp_id)
    assert (await auth_client.delete(f"/api/experiments/{exp_id}")).status_code == 204
    assert (await auth_client.get(f"/api/experiments/{exp_id}")).status_code == 404
    from sqlalchemy import func, select

    from app.models import Decision, RunEvent

    async with SessionLocal() as db:
        assert await db.scalar(select(func.count()).select_from(Run)) == 0
        assert await db.scalar(select(func.count()).select_from(RunEvent)) == 0
        assert await db.scalar(select(func.count()).select_from(Decision)) == 0


async def test_other_user_gets_404(auth_client, admin_client, monkeypatch):
    monkeypatch.setattr(scheduler, "launch", lambda exp_id: None)
    await add_key()
    exp_id = await create(auth_client)
    for call in (admin_client.get(f"/api/experiments/{exp_id}"), admin_client.post(f"/api/experiments/{exp_id}/stop"),
                 admin_client.delete(f"/api/experiments/{exp_id}")):
        assert (await call).status_code == 404
    _, runs = await state(exp_id)
    assert (await admin_client.get(f"/api/runs/{runs[0].id}")).status_code == 404
    assert (await auth_client.get(f"/api/runs/{runs[0].id}")).json()["is_owner"] is True


async def test_pause_lets_the_current_run_finish_then_resume_plays_the_rest(auth_client, monkeypatch):
    monkeypatch.setitem(DEFAULTS, "parallel_runs", 1)
    gate = asyncio.Event()
    started = []

    async def fake_execute(run_id, **kw):
        started.append(run_id)
        async with SessionLocal() as db:
            await db.execute(update(Run).where(Run.id == run_id).values(status="running"))
            await db.commit()
        if len(started) == 1:
            await gate.wait()  # the first run is still playing when the pause arrives
        async with SessionLocal() as db:
            await db.execute(update(Run).where(Run.id == run_id).values(status="finished", end_reason="solved"))
            await db.commit()

    monkeypatch.setattr(runner, "execute_run", fake_execute)
    await add_key()
    exp_id = await create(auth_client, runs=3)
    await wait_for(lambda: asyncio.sleep(0, bool(started)))
    assert (await auth_client.post(f"/api/experiments/{exp_id}/pause")).status_code == 204
    gate.set()

    async def paused_and_idle():
        exp, runs = await state(exp_id)
        return exp.status == "paused" and not scheduler.is_active(exp_id) and [r.status for r in runs]

    assert await wait_for(paused_and_idle) == ["finished", "queued", "queued"]  # current run finished, no new one
    assert len(started) == 1
    assert (await auth_client.get(f"/api/experiments/{exp_id}")).json()["status"] == "paused"

    assert (await auth_client.post(f"/api/experiments/{exp_id}/resume")).status_code == 204
    exp, runs = await wait_exp(exp_id, statuses=("finished",))
    assert [r.status for r in runs] == ["finished"] * 3 and len(started) == 3


async def test_stop_while_paused(auth_client, monkeypatch):
    monkeypatch.setattr(scheduler, "launch", lambda exp_id: None)  # nothing plays: pause and stop act on the rows
    await add_key()
    exp_id = await create(auth_client, runs=2)
    assert (await auth_client.post(f"/api/experiments/{exp_id}/pause")).status_code == 204
    assert (await auth_client.post(f"/api/experiments/{exp_id}/resume")).status_code == 204
    assert (await auth_client.post(f"/api/experiments/{exp_id}/pause")).status_code == 204
    assert (await auth_client.post(f"/api/experiments/{exp_id}/stop")).status_code == 204
    exp, runs = await state(exp_id)
    assert exp.status == "stopped" and [r.status for r in runs] == ["stopped", "stopped"]


async def test_custom_goals_and_prompts(auth_client, monkeypatch):
    monkeypatch.setattr(scheduler, "launch", lambda exp_id: None)
    await add_key()
    goals = ["square", "upside_down", "one_zone", "Keep chair 1 where it is."]
    for bad in ({"goals": goals[:3]}, {"goals": ["square", "square", "one_zone", "touching"]},
                {"goals": [*goals[:3], "ab"]}, {"agent_prompts": [None] * 3}, {"agent_prompts": ["x" * 2001, None, None, None]}):
        assert (await auth_client.post("/api/experiments", json={**BODY, **bad})).status_code == 422, bad
    d = (await auth_client.post("/api/experiments", json={**BODY, "goals": goals,
                                                           "agent_prompts": [" ", "You are {name}. {goal}", None, None]})).json()
    assert d["config"]["goals"] == goals and d["config"]["agent_prompts"] == [None, "You are {name}. {goal}", None, None]
    assert d["name"].endswith("· Custom goals and prompts")
    d = (await auth_client.post("/api/experiments", json={**BODY, "goals": ["square", "upside_down", "one_zone", "touching"],
                                                           "agent_prompts": [None] * 4})).json()
    assert d["config"]["goals"] is None and d["config"]["agent_prompts"] is None and "Custom" not in d["name"]

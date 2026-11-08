"""Pure result helpers: summaries, aggregates and exports. No DB access here."""

import csv
import io
import zipfile

from app.game.board import AGENTS
from app.game.layouts import rich_agent

GROUP_ORDER = ["none", "free", "directive", "nondirective"]
DONE = {"finished", "stopped", "failed"}
STYLES = ("directive", "non_directive", "other")


def _iso(dt):
    return dt.isoformat() if dt else None


def run_summary(run, budgets: list[int] | None = None) -> dict:
    r = run.result or {}
    rich = r["richest_agent"] if "richest_agent" in r else (
        rich_agent(run.layout_no, budgets, run.seed if run.seed is not None else run.layout_no) if budgets else None)
    return {
        "id": run.id, "group": run.group, "layout_no": run.layout_no, "status": run.status,
        "end_reason": run.end_reason, "solved": r.get("solved"), "completion": r.get("completion"),
        "seed": run.seed, "measured_leader": r.get("measured_leader"),
        "leader_agent": r.get("leader_agent"), "rich_agent": rich, "cost_usd": run.cost_usd,
    }


def experiment_summary(exp, runs) -> dict:
    cfg = exp.config or {}
    return {
        "id": exp.id, "name": exp.name, "status": exp.status, "created_at": _iso(exp.created_at),
        "runs_done": sum(r.status in DONE for r in runs), "runs_total": len(runs),
        "spent_usd": exp.spent_usd, "cap_usd": exp.cap_usd, "model": cfg.get("model"),
        "add_leader": bool(cfg.get("add_leader")), "is_demo": exp.is_demo,
    }


def _rate(num: int, den: int):
    return num / den if den else None


def _target_share(r: dict):
    """Primary outcome: influence share of the agent told to lead, else the richest one (None if undefined).
    Results measured before measure_version 2 have no target_share: derived from their influence_share."""
    if "target_share" in r:
        return r["target_share"]
    target = r.get("leader_agent") or r.get("richest_agent")
    return (r.get("influence_share") or {}).get(target) if target else None


def _mean(values: list):
    return sum(values) / len(values) if values else None


def _group_stats(results: list[dict]) -> dict:
    with_leader = [r for r in results if r.get("leader_agent")]
    richest = [r for r in results if r.get("richest_agent") and r.get("measured_leader")]
    durations = [r["duration_ms"] / 1000 for r in results if r.get("duration_ms") is not None]
    completions = [r["completion"] for r in results if r.get("completion") is not None]
    targets = [s for s in map(_target_share, results) if s is not None]
    by_goal: dict[str, list] = {}
    for r in results:
        for goal, s in (r.get("share_by_goal") or {}).items():
            if s is not None:
                by_goal.setdefault(goal, []).append(s)
    scored = sum((r.get("tests") or {}).get("entries_scored", 0) for r in results)
    missing = sum(sum(((r.get("tests") or {}).get("untested") or {}).values()) for r in results)
    mix = dict.fromkeys(STYLES, 0)
    for r in results:
        for counts in (r.get("style_mix") or {}).values():
            for k in STYLES:
                mix[k] += counts.get(k, 0)
    return {
        "runs": len(results),
        "solved_rate": _rate(sum(bool(r.get("solved")) for r in results), len(results)),
        "completion_avg": sum(completions) / len(completions) if completions else None,
        "target_share_avg": _mean(targets),  # primary outcome, against the 25% chance line
        "target_share_runs": len(targets),  # runs where it is defined (someone influenced someone)
        "share_by_goal_avg": {g: _mean(v) for g, v in by_goal.items()},
        "untested_rate": _rate(missing, scored + missing),  # followed instructions that could not be tested
        "leader_rate": _rate(sum(bool(r.get("measured_leader")) for r in results), len(results)),
        "leader_rate_strict": _rate(sum(bool(r.get("measured_leader_strict")) for r in results), len(results)),
        "avg_duration_s": sum(durations) / len(durations) if durations else None,
        "richest_leader_rate": _rate(sum(r["measured_leader"] == r["richest_agent"] for r in richest), len(richest)),
        "leader_became_measured_rate": _rate(
            sum(r.get("measured_leader") == r["leader_agent"] for r in with_leader), len(with_leader)
        ),
        "style_mix": mix,
    }


def aggregate(runs, richest_filter: str = "any") -> dict:
    groups = sorted({r.group for r in runs}, key=lambda g: GROUP_ORDER.index(g) if g in GROUP_ORDER else 99)
    want = {"leader_is_richest": True, "leader_not_richest": False}.get(richest_filter)
    if want is not None:
        runs = [r for r in runs if (r.result or {}).get("leader_is_richest") is want]
    counted = [r for r in runs if r.status == "finished" and not (r.result or {}).get("partial")]
    return {
        "groups": {g: _group_stats([r.result or {} for r in counted if r.group == g]) for g in groups},
        "overall": _group_stats([r.result or {} for r in counted]),
        "excluded": len(runs) - len(counted),
    }


def _event(e) -> dict:
    return {"seq": e.seq, "t": e.t_ms, "type": e.type, "data": e.data}


def _decision(d) -> dict:
    return {
        "id": d.id, "agent": d.agent, "seq": d.seq, "t_ms": d.t_ms, "trigger": d.trigger, "request": d.request,
        "response": d.response, "action": d.action, "outcome": d.outcome, "input_tokens": d.input_tokens,
        "output_tokens": d.output_tokens, "cost_usd": d.cost_usd,
    }


def export_json(exp, runs, events_by_run: dict, decisions_by_run: dict) -> dict:
    """Full experiment. Built from explicit fields only, so no user/key data can leak in."""
    return {
        "experiment": {
            **experiment_summary(exp, runs), "config": exp.config, "stop_reason": exp.stop_reason,
            "finished_at": _iso(exp.finished_at),
        },
        "runs": [
            {
                **run_summary(r, (exp.config or {}).get("budget")), "result": r.result,
                "started_at": _iso(r.started_at), "ended_at": _iso(r.ended_at),
                "events": [_event(e) for e in events_by_run.get(r.id, [])],
                "decisions": [_decision(d) for d in decisions_by_run.get(r.id, [])],
            }
            for r in runs
        ],
    }


def _csv(header: list, rows: list) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    w.writerows(rows)
    return buf.getvalue()


def export_zip(exp, runs, events_by_run: dict, decisions_by_run: dict | None = None) -> bytes:
    run_rows, msg_rows, ins_rows = [], [], []
    for run in runs:
        res = run.result or {}
        dur = res.get("duration_ms")
        share = res.get("influence_share") or {}
        run_rows.append([
            run.id, run.group, run.layout_no, run.seed, run.status, run.end_reason, res.get("solved"),
            res.get("completion"),
            dur / 1000 if dur is not None else None, res.get("measured_leader"), res.get("leader_agent"),
            res.get("richest_agent"), res.get("leader_is_richest"), *(share.get(a) for a in AGENTS), run.cost_usd,
            res.get("measure_version", 1), res.get("target_agent"), _target_share(res), res.get("measured_leader_strict"),
            (res.get("tests") or {}).get("entries_scored"), sum(((res.get("tests") or {}).get("untested") or {}).values()),
        ])
        for i in res.get("instructions") or []:
            a = i.get("action") or {}
            ins_rows.append([
                run.id, i.get("message_id"), i.get("from"), i.get("to"), i.get("type", "instruction"), a.get("kind"),
                a.get("chair"), a.get("cell"), ";".join(str(x.get("chair")) for x in i.get("actions") or [a]),
                i.get("followed"), i.get("p_with"), i.get("p_without"), i.get("score"), i.get("untested_reason"),
            ])
        styles = res.get("styles") or {}
        instr: dict = {}
        for i in res.get("instructions") or []:
            instr.setdefault(i.get("message_id"), []).append(i)
        for e in events_by_run.get(run.id, []):
            if e.type != "message":
                continue
            mid = e.data.get("id")
            ins = instr.get(mid, [])  # a message can hold several instructions: joined with ";"
            msg_rows.append([
                run.id, mid, e.t_ms / 1000, e.data.get("agent"), e.data.get("text"), styles.get(str(mid)), bool(ins),
                ";".join(str(i.get("to")) for i in ins), ";".join(str(i.get("followed")) for i in ins),
                ";".join(str(i.get("score")) for i in ins),
            ])
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("runs.csv", _csv(
            ["run_id", "group", "layout_no", "seed", "status", "end_reason", "solved", "completion", "duration_s", "measured_leader",
             "leader_agent", "richest_agent", "leader_is_richest", *(f"influence_share_{a}" for a in AGENTS),
             "cost_usd", "measure_version", "target_agent", "target_share", "measured_leader_strict",
             "instructions_scored", "instructions_untested"], run_rows))
        z.writestr("instructions.csv", _csv(
            ["run_id", "message_id", "from", "to", "type", "kind", "chair", "cell", "chairs_asked", "followed", "p_with", "p_without",
             "score", "untested_reason"], ins_rows))
        z.writestr("messages.csv", _csv(
            ["run_id", "message_id", "t_s", "agent", "text", "style", "is_instruction", "to", "followed", "score"],
            msg_rows))
    return buf.getvalue()

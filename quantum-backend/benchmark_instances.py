"""Deterministic multi-family CampusPilot scheduling benchmark dataset."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from itertools import product
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np

from campus_adapter import generate_candidates, parse_time
from compactness_qubo import build_compactness_qubo, solve_compactness_exact
from scheduling_qubo import decode_schedule
from qubo_model import qubo_cost


EASTERN = ZoneInfo("America/New_York")
BASE_DATE = datetime(2026, 11, 2, tzinfo=EASTERN)
WINDOW_START_HOUR = 9
WINDOW_END_HOUR = 17
DEFAULT_ALPHA = 0.05
DEFAULT_BETA = 0.005
OPTIMALITY_TOLERANCE = 1e-8

FAMILY_INFO = {
    "A": "Sparse time conflicts",
    "B": "Dense overlapping conflicts",
    "C": "Tight deadlines and notBefore constraints",
    "D": "Heterogeneous task priorities",
    "E": "Fragmented availability from classes and unavailable periods",
    "F": "Equal-priority schedules with compactness tradeoffs",
}


def _instance_day(seed: int) -> datetime:
    rng = np.random.default_rng(seed)
    return BASE_DATE + timedelta(days=int(rng.integers(0, 7)))


def _iso(value: datetime) -> str:
    return value.isoformat(timespec="minutes")


def _task(task_id: str, start: datetime, duration: int, priority: str, *,
          not_before: datetime | None = None, due: datetime | None = None) -> dict[str, Any]:
    end = start + timedelta(minutes=duration)
    return {
        "id": task_id,
        "title": f"{task_id} study task",
        "durationMinutes": duration,
        "dueAt": _iso(due or end),
        "notBefore": _iso(not_before or start),
        "priority": priority,
    }


def _event(event_id: str, title: str, start: datetime, end: datetime) -> dict[str, str]:
    return {"id": event_id, "title": title, "start": _iso(start), "end": _iso(end)}


def _request(day: datetime, start_hour: int, end_hour: int,
             tasks: list[dict[str, Any]], classes: list[dict[str, str]] | None = None,
             unavailable: list[dict[str, str]] | None = None) -> dict[str, Any]:
    start = day.replace(hour=start_hour, minute=0)
    end = day.replace(hour=end_hour, minute=0)
    return {
        "windowStart": _iso(start),
        "windowEnd": _iso(end),
        "tasks": tasks,
        "classes": classes or [],
        "unavailablePeriods": unavailable or [],
    }


def _one_candidate_tasks(
    day: datetime,
    positions: list[tuple[int, int]],
    priorities: list[str],
    *,
    start_hour: int = 9,
) -> list[dict[str, Any]]:
    tasks = []
    base = day.replace(hour=start_hour, minute=0)
    for index, ((offset_minutes, duration), priority) in enumerate(zip(positions, priorities)):
        start = base + timedelta(minutes=offset_minutes)
        tasks.append(_task(f"task-{index + 1}", start, duration, priority))
    return tasks


def _make_family(family: str, candidate_count: int, seed: int) -> tuple[dict[str, Any], int, str]:
    """Create one ScheduleRequest and its candidate-grid setting."""
    rng = np.random.default_rng(seed)
    day = _instance_day(seed)

    if family == "A":
        # One task every two hours; all candidate intervals are disjoint.
        offsets = [(index * 120, 60) for index in range(candidate_count)]
        priorities = ["high", "medium", "low"] * ((candidate_count + 2) // 3)
        rng.shuffle(priorities)
        tasks = _one_candidate_tasks(day, offsets, priorities[:candidate_count], start_hour=8)
        return _request(day, 8, 22, tasks), 60, f"{candidate_count} isolated 60-minute options, spaced 120 minutes apart"

    if family == "B":
        # A 60-minute task every 15 minutes creates a dense interval graph.
        offsets = [(index * 15, 60) for index in range(candidate_count)]
        priorities = rng.choice(["low", "medium", "high"], size=candidate_count).tolist()
        tasks = _one_candidate_tasks(day, offsets, priorities)
        return _request(day, 9, 17, tasks), 15, "60-minute tasks start every 15 minutes"

    if family == "C":
        # Fixed starts with no deadline slack and a precise earliest-start bound.
        offsets = [(index * 60, 60) for index in range(candidate_count)]
        tasks = _one_candidate_tasks(day, offsets, ["medium"] * candidate_count)
        return _request(day, 9, 17, tasks), 30, "Each task has one grid-aligned start, notBefore=start and dueAt=end"

    if family == "D":
        offsets = [(index * 30, 60) for index in range(candidate_count)]
        priorities = (["high", "low", "medium"] * ((candidate_count + 2) // 3))[:candidate_count]
        rng.shuffle(priorities)
        # Guarantee all three priority weights in every instance.
        priorities[:3] = ["high", "medium", "low"]
        tasks = _one_candidate_tasks(day, offsets, priorities)
        return _request(day, 9, 17, tasks), 15, "Overlapping options with all three priority levels represented"

    if family == "E":
        # Short study blocks alternate with classes/unavailable periods,
        # creating fragmented open windows across the day.
        base = day.replace(hour=9, minute=0)
        tasks = []
        classes, unavailable = [], []
        for index in range(candidate_count):
            start = base + timedelta(hours=index)
            tasks.append(_task(f"task-{index + 1}", start, 30, "medium"))
            if index < candidate_count - 1:
                busy_start = start + timedelta(minutes=30)
                busy_end = busy_start + timedelta(minutes=30)
                item = _event(f"busy-{index + 1}", "Campus commitment", busy_start, busy_end)
                (classes if index % 2 == 0 else unavailable).append(item)
        return _request(day, 9, 17, tasks, classes, unavailable), 30, "30-minute study blocks separated by alternating 30-minute commitments"

    if family == "F":
        # Two equal-priority tasks have alternative exact schedules:
        # A at 09:00 leaves a 120-minute gap before B at 12:00; A at 11:00
        # makes B adjacent. A class blocks the 10:00 alternative. Extra fixed
        # tasks extend the family to n=5 and n=7 without changing the n=3 case.
        base = day.replace(hour=9, minute=0)
        tasks = [
            _task("task-A", base, 60, "high", not_before=base, due=base + timedelta(hours=3)),
            _task("task-B", base + timedelta(hours=3), 60, "high"),
        ]
        for index in range(candidate_count - 3):
            start = base + timedelta(hours=4 + index)
            tasks.append(_task(f"task-extra-{index + 1}", start, 30, "high"))
        blocked = _event(
            "class-filter", "Class", base + timedelta(hours=1), base + timedelta(hours=2)
        )
        return _request(day, 9, 17, tasks, [blocked]), 60, "Equal-priority alternatives trade early completion against real internal gaps"

    raise ValueError(f"Unknown family: {family}")


def _busy_union_minutes(request: dict[str, Any]) -> float:
    intervals = sorted(
        (parse_time(event["start"]), parse_time(event["end"]))
        for event in request["classes"] + request["unavailablePeriods"]
    )
    if not intervals:
        return 0.0
    merged = []
    for start, end in intervals:
        if not merged or start > merged[-1][1]:
            merged.append([start, end])
        else:
            merged[-1][1] = max(merged[-1][1], end)
    return sum((end - start).total_seconds() / 60 for start, end in merged)


def validate_instance(instance: dict[str, Any]) -> None:
    """Validate generated candidate duration, time zone, deadlines and blocks."""
    request = instance["request"]
    tasks = {task["id"]: task for task in request["tasks"]}
    window_start = parse_time(request["windowStart"])
    window_end = parse_time(request["windowEnd"])
    busy = [
        (parse_time(event["start"]), parse_time(event["end"]))
        for event in request["classes"] + request["unavailablePeriods"]
    ]
    if not instance["candidates"]:
        raise ValueError("Benchmark instance generated no candidates")
    for candidate in instance["candidates"]:
        task = tasks[candidate["taskId"]]
        start = parse_time(candidate["start"])
        end = parse_time(candidate["end"])
        due = parse_time(task["dueAt"])
        not_before = parse_time(task["notBefore"])
        if start.tzinfo is None or end.tzinfo is None:
            raise ValueError("Candidate timestamps must include a time zone")
        if start < window_start or end > window_end or end <= start:
            raise ValueError("Candidate interval lies outside the scheduling window")
        if (end - start).total_seconds() / 60 != task["durationMinutes"]:
            raise ValueError("Candidate duration differs from task duration")
        if start < not_before or end > due:
            raise ValueError("Candidate violates notBefore or deadline")
        if any(start < busy_end and busy_start < end for busy_start, busy_end in busy):
            raise ValueError("Candidate overlaps a class or unavailable period")


def _conflict_free(bits: tuple[int, ...], conflicts: list[dict[str, Any]]) -> bool:
    return all(not (bits[edge["i"]] and bits[edge["j"]]) for edge in conflicts)


def _analyze_instance(instance: dict[str, Any]) -> dict[str, Any]:
    candidates = instance["candidates"]
    request = instance["request"]
    n = len(candidates)
    alpha, beta = DEFAULT_ALPHA, DEFAULT_BETA
    model = build_compactness_qubo(
        candidates, request["windowStart"], request["windowEnd"], alpha, beta
    )
    pair_count = n * (n - 1) / 2
    conflict_density = len(model["conflicts"]) / pair_count if pair_count else 0.0
    window_minutes = (
        parse_time(request["windowEnd"]) - parse_time(request["windowStart"])
    ).total_seconds() / 60
    available_minutes = max(1.0, window_minutes - _busy_union_minutes(request))
    scheduled_demand = sum(task["durationMinutes"] for task in request["tasks"])
    scheduling_density = scheduled_demand / available_minutes

    feasible_count = complete_count = 0
    exact_cost = float("inf")
    optimal_count = 0
    expected_task_ids = {task["id"] for task in request["tasks"]}
    for values in product((0, 1), repeat=n):
        if not _conflict_free(values, model["conflicts"]):
            continue
        feasible_count += 1
        selected_task_ids = {
            candidates[i]["taskId"] for i, bit in enumerate(values) if bit
        }
        selected_count = sum(values)
        if selected_count == len(expected_task_ids) and selected_task_ids == expected_task_ids:
            complete_count += 1
        cost = float(qubo_cost(values, model["Q"]))
        if cost < exact_cost - OPTIMALITY_TOLERANCE:
            exact_cost, optimal_count = cost, 1
        elif abs(cost - exact_cost) <= OPTIMALITY_TOLERANCE:
            optimal_count += 1

    exact = solve_compactness_exact(
        candidates, request["windowStart"], request["windowEnd"],
        alpha=alpha, beta=beta, max_variables=12,
    )
    if not np.isclose(exact["cost"], exact_cost, atol=OPTIMALITY_TOLERANCE, rtol=0):
        raise AssertionError("Independent enumeration and exact solver disagree")
    tasks_by_priority = {priority: 0 for priority in ("low", "medium", "high")}
    for task in request["tasks"]:
        tasks_by_priority[task["priority"]] += 1
    deadline_constraints = {
        task["id"]: {
            "notBefore": task["notBefore"],
            "dueAt": task["dueAt"],
            "slackMinutes": (
                parse_time(task["dueAt"]) - parse_time(task["notBefore"])
            ).total_seconds() / 60 - task["durationMinutes"],
        }
        for task in request["tasks"]
    }
    return {
        "conflict_graph_density": float(conflict_density),
        "scheduling_density": float(scheduling_density),
        "priority_distribution": tasks_by_priority,
        "deadline_constraints": deadline_constraints,
        "feasible_assignment_count": feasible_count,
        "complete_assignment_count": complete_count,
        "exact_optimal_value": exact_cost,
        "equivalent_global_optima": optimal_count,
        "conflict_edge_count": len(model["conflicts"]),
        "conflicts": model["conflicts"],
        "classical_optimal_schedule": exact["schedule"],
        "classical_optimal_assignment": exact["assignment"],
        "alpha": alpha,
        "beta": beta,
    }


def build_benchmark_instances() -> list[dict[str, Any]]:
    """Return 18 validated, deterministic instances: three per family."""
    plans = {
        "A": (3, 5, 7),
        "B": (5, 9, 12),
        "C": (3, 5, 7),
        "D": (5, 9, 12),
        "E": (3, 5, 7),
        "F": (3, 5, 7),
    }
    instances = []
    for family_index, family in enumerate("ABCDEF"):
        for variant_index, candidate_count in enumerate(plans[family]):
            seed = 22100 + family_index * 100 + variant_index
            request, slot_minutes, structure = _make_family(
                family, candidate_count, seed
            )
            candidates = generate_candidates(request, slot_minutes=slot_minutes)
            instance_id = f"{family}{variant_index + 1}-n{candidate_count}"
            instance = {
                "instance_id": instance_id,
                "family": family,
                "family_name": FAMILY_INFO[family],
                "generator_seed": seed,
                "candidate_count": len(candidates),
                "task_count": len(request["tasks"]),
                "slot_minutes": slot_minutes,
                "structure": structure,
                "request": request,
                "candidates": candidates,
            }
            if len(candidates) != candidate_count:
                raise ValueError(
                    f"{instance_id}: expected {candidate_count} candidates, got {len(candidates)}"
                )
            validate_instance(instance)
            instance.update(_analyze_instance(instance))
            instances.append(instance)
    return instances


def manifest_rows(instances: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Return CSV-safe per-instance metadata."""
    instances = build_benchmark_instances() if instances is None else instances
    fields = (
        "instance_id", "generator_seed", "family", "family_name", "task_count",
        "candidate_count", "slot_minutes", "conflict_edge_count",
        "conflict_graph_density", "scheduling_density", "priority_distribution",
        "deadline_constraints", "feasible_assignment_count",
        "complete_assignment_count", "exact_optimal_value",
        "equivalent_global_optima", "structure",
    )
    rows = []
    for instance in instances:
        row = {key: instance[key] for key in fields}
        row["priority_distribution"] = json.dumps(row["priority_distribution"], sort_keys=True)
        row["deadline_constraints"] = json.dumps(row["deadline_constraints"], sort_keys=True)
        rows.append(row)
    return rows

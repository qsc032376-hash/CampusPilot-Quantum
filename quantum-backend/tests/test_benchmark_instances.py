import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from benchmark_instances import (
    build_benchmark_instances,
    validate_instance,
)
from campus_adapter import parse_time
from compactness_qubo import solve_compactness_exact
from schedule_metrics import evaluate_schedule


@pytest.fixture(scope="module")
def instances():
    return build_benchmark_instances()


def test_dataset_has_six_families_and_eighteen_instances(instances):
    assert len(instances) == 18
    assert {item["family"] for item in instances} == set("ABCDEF")
    assert all(sum(item["family"] == family for item in instances) == 3 for family in "ABCDEF")
    assert {item["candidate_count"] for item in instances} >= {3, 5, 7, 9, 12}


def test_generation_is_deterministic(instances):
    second = build_benchmark_instances()
    assert [item["instance_id"] for item in instances] == [item["instance_id"] for item in second]
    for first, again in zip(instances, second):
        assert first["generator_seed"] == again["generator_seed"]
        assert first["request"] == again["request"]
        assert first["candidates"] == again["candidates"]
        assert first["exact_optimal_value"] == pytest.approx(again["exact_optimal_value"])


def test_all_instances_preserve_timezones_durations_and_constraints(instances):
    for instance in instances:
        validate_instance(instance)
        tasks = {task["id"]: task for task in instance["request"]["tasks"]}
        for candidate in instance["candidates"]:
            task = tasks[candidate["taskId"]]
            start = parse_time(candidate["start"])
            end = parse_time(candidate["end"])
            assert start.tzinfo is not None and end.tzinfo is not None
            assert (end - start).total_seconds() / 60 == task["durationMinutes"]
            assert parse_time(task["notBefore"]) <= start
            assert end <= parse_time(task["dueAt"])


def test_feasible_and_complete_assignment_counts_are_distinct(instances):
    sparse = next(item for item in instances if item["instance_id"] == "A1-n3")
    assert sparse["feasible_assignment_count"] == 8
    assert sparse["complete_assignment_count"] == 1

    dense = next(item for item in instances if item["instance_id"] == "B1-n5")
    assert dense["feasible_assignment_count"] < 2 ** dense["candidate_count"]
    assert dense["complete_assignment_count"] == 0


def test_dense_family_has_more_conflicts_than_sparse_family(instances):
    sparse = next(item for item in instances if item["instance_id"] == "A2-n5")
    dense = next(item for item in instances if item["instance_id"] == "B1-n5")
    assert sparse["conflict_graph_density"] == 0
    assert dense["conflict_graph_density"] > 0.5


def test_family_f_beta_improves_exact_actual_gaps(instances):
    instance = next(item for item in instances if item["instance_id"] == "F1-n3")
    low = solve_compactness_exact(
        instance["candidates"], instance["request"]["windowStart"],
        instance["request"]["windowEnd"], alpha=0.05, beta=0.005,
        max_variables=12,
    )
    high = solve_compactness_exact(
        instance["candidates"], instance["request"]["windowStart"],
        instance["request"]["windowEnd"], alpha=0.05, beta=0.1,
        max_variables=12,
    )
    conflicts = instance["conflicts"]
    low_metrics = evaluate_schedule(
        low["assignment"], instance["candidates"], conflicts,
        instance["request"]["windowStart"], instance["request"]["windowEnd"],
    )
    high_metrics = evaluate_schedule(
        high["assignment"], instance["candidates"], conflicts,
        instance["request"]["windowStart"], instance["request"]["windowEnd"],
    )
    assert instance["complete_assignment_count"] == 2
    assert low_metrics["selectedTaskCount"] == high_metrics["selectedTaskCount"] == 2
    assert low_metrics["internalGapMinutes"] == 120
    assert high_metrics["internalGapMinutes"] == 0

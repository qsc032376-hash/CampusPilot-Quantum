import csv
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from compactness_benchmark import (
    CSV_COLUMNS,
    EXCLUSION_COLUMNS,
    _experiment_plan,
    analyze_probability_distribution,
    build_synthetic_instance,
    run_configuration,
    validate_weight_configuration,
    write_csv,
)


START = "2026-11-02T09:00:00-05:00"
END = "2026-11-02T17:00:00-05:00"


def two_equivalent_optima_fixture():
    candidates = [
        {
            "taskId": "A", "title": "A", "priorityWeight": 5,
            "start": "2026-11-02T09:00:00-05:00",
            "end": "2026-11-02T10:00:00-05:00",
        },
        {
            "taskId": "B", "title": "B", "priorityWeight": 5,
            "start": "2026-11-02T09:00:00-05:00",
            "end": "2026-11-02T10:00:00-05:00",
        },
    ]
    conflicts = [{"i": 0, "j": 1, "reason": "time-overlap"}]
    # Both individual candidates are globally optimal and feasible; choosing
    # both incurs a conflict penalty. The state order is 00, 10, 01, 11.
    Q = np.array([[-5.0, 6.0], [6.0, -5.0]])
    return candidates, conflicts, Q


def test_probability_metrics_sum_over_equivalent_global_optima():
    candidates, conflicts, Q = two_equivalent_optima_fixture()
    result = analyze_probability_distribution(
        np.array([0.1, 0.2, 0.3, 0.4]), Q, conflicts, candidates,
        exact_cost=-5.0, window_start=START, window_end=END,
    )

    assert result["feasible_probability"] == pytest.approx(0.6)
    assert result["optimal_probability"] == pytest.approx(0.5)
    assert result["optimal_assignment_count"] == 2
    assert result["expected_feasible_reward"] == pytest.approx(2.5)


def test_probability_metrics_are_bounded_and_nested():
    candidates, conflicts, Q = two_equivalent_optima_fixture()
    result = analyze_probability_distribution(
        np.array([0.1, 0.2, 0.3, 0.4]), Q, conflicts, candidates,
        exact_cost=-5.0, window_start=START, window_end=END,
    )
    assert 0 <= result["feasible_probability"] <= 1
    assert 0 <= result["optimal_probability"] <= 1
    assert result["optimal_probability"] <= result["feasible_probability"]


def test_invalid_alpha_beta_is_excluded_with_reason():
    valid, reason = validate_weight_configuration(12, 0.05, 0.01)
    assert not valid
    assert "bound" in reason

    assert validate_weight_configuration(12, 0.05, 0.005)[0]

    plans, _ = _experiment_plan("quick")
    bound_checks = [plan for plan in plans if plan[0] == "weight_bound_guard"]
    assert bound_checks == [("weight_bound_guard", 12, 0.02, 2, 42)]
    assert not validate_weight_configuration(12, 0.05, bound_checks[0][2])[0]


def test_optimality_gap_is_nonnegative_and_run_is_feasible():
    instance = build_synthetic_instance(3)
    result = run_configuration(
        "test", instance, alpha=0.05, beta=0.005, p=1,
        seed=42, maxiter=5, shots=32,
    )
    assert result["optimality_gap"] >= 0
    assert result["is_feasible"]
    assert result["candidate_count"] == 3


def test_deterministic_run_reproduces_mathematical_metrics():
    instance_a = build_synthetic_instance(3)
    instance_b = build_synthetic_instance(3)
    run_a = run_configuration(
        "test", instance_a, beta=0.005, p=1, seed=42,
        maxiter=5, shots=32,
    )
    run_b = run_configuration(
        "test", instance_b, beta=0.005, p=1, seed=42,
        maxiter=5, shots=32,
    )
    for key in (
        "classical_cost", "qaoa_best_cost", "qaoa_expected_cost",
        "optimality_gap", "feasible_probability", "optimal_probability",
        "expected_feasible_reward", "priority_satisfaction",
    ):
        assert run_a[key] == pytest.approx(run_b[key])


def test_csv_output_columns_are_stable(tmp_path):
    row = {name: None for name in CSV_COLUMNS}
    row.update({"experiment_id": "test", "instance_id": "test-n3"})
    target = tmp_path / "runs.csv"
    write_csv(target, [row], CSV_COLUMNS)
    with target.open(newline="", encoding="utf-8") as handle:
        assert next(csv.reader(handle)) == CSV_COLUMNS

    exclusion_path = tmp_path / "excluded_configurations.csv"
    write_csv(exclusion_path, [{name: "test" for name in EXCLUSION_COLUMNS}], EXCLUSION_COLUMNS)
    with exclusion_path.open(newline="", encoding="utf-8") as handle:
        assert next(csv.reader(handle)) == EXCLUSION_COLUMNS


def test_synthetic_candidates_preserve_deadlines_and_duration():
    instance = build_synthetic_instance(12)
    tasks = {task["id"]: task for task in instance["request"]["tasks"]}
    for candidate in instance["candidates"]:
        task = tasks[candidate["taskId"]]
        start = datetime.fromisoformat(candidate["start"])
        end = datetime.fromisoformat(candidate["end"])
        deadline = datetime.fromisoformat(task["dueAt"])
        assert (end - start).total_seconds() / 60 == task["durationMinutes"]
        assert end <= deadline


def test_empty_probability_distribution_input_is_rejected():
    with pytest.raises(ValueError, match=r"2\*\*n"):
        analyze_probability_distribution(
            np.array([]), np.zeros((0, 0)), [], [], -1.0, START, END
        )


def test_infeasible_weight_configuration_does_not_silently_clip():
    valid, reason = validate_weight_configuration(12, 0.05, 0.02)
    assert not valid
    assert reason

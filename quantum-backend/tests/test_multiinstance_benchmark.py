import csv
import json
import sys
from pathlib import Path

import numpy as np
import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from benchmark_instances import build_benchmark_instances
from compactness_benchmark import analyze_probability_distribution, run_configuration
from compactness_qubo import build_compactness_qubo
from multiinstance_benchmark import (
    RUN_COLUMNS,
    aggregate_runs,
    run_benchmark,
)
from multiobjective_qubo import build_multiobjective_qubo


@pytest.fixture(scope="module")
def family_f():
    return next(item for item in build_benchmark_instances() if item["instance_id"] == "F1-n3")


def test_probability_metrics_are_normalized_and_bounded(family_f):
    model = build_compactness_qubo(
        family_f["candidates"], family_f["request"]["windowStart"],
        family_f["request"]["windowEnd"], alpha=0.05, beta=0.005,
    )
    probabilities = np.full(2 ** len(family_f["candidates"]), 1 / 2 ** len(family_f["candidates"]))
    result = analyze_probability_distribution(
        probabilities, model["Q"], model["conflicts"], family_f["candidates"],
        family_f["exact_optimal_value"], family_f["request"]["windowStart"],
        family_f["request"]["windowEnd"],
    )
    assert 0 <= result["feasible_probability"] <= 1
    assert 0 <= result["optimal_probability"] <= result["feasible_probability"]


def test_zero_beta_matches_existing_multiobjective_qubo(family_f):
    candidates = family_f["candidates"]
    request = family_f["request"]
    compact = build_compactness_qubo(
        candidates, request["windowStart"], request["windowEnd"],
        alpha=0.05, beta=0,
    )
    existing = build_multiobjective_qubo(
        candidates, request["windowStart"], request["windowEnd"], alpha=0.05,
    )
    assert np.allclose(compact["Q"], existing["Q"])


def test_weight_bound_accepts_baseline_and_rejects_invalid_beta(family_f):
    valid = build_compactness_qubo(
        family_f["candidates"], family_f["request"]["windowStart"],
        family_f["request"]["windowEnd"], alpha=0.05, beta=0.005,
    )
    assert np.allclose(valid["Q"], valid["Q"].T)
    with pytest.raises(ValueError, match="Secondary objective weights"):
        build_compactness_qubo(
            family_f["candidates"], family_f["request"]["windowStart"],
            family_f["request"]["windowEnd"], alpha=0.05, beta=0.4,
        )


def test_repeated_seed_reproduces_mathematical_results(family_f):
    request = family_f["request"]
    kwargs = dict(alpha=0.05, beta=0.005, p=1, seed=42, maxiter=5, shots=32)
    one = run_configuration(
        "determinism", {
            "instance_id": family_f["instance_id"],
            "candidate_count": family_f["candidate_count"],
            "request": request,
            "candidates": family_f["candidates"],
            "window_start": request["windowStart"],
            "window_end": request["windowEnd"],
        }, **kwargs,
    )
    two = run_configuration(
        "determinism", {
            "instance_id": family_f["instance_id"],
            "candidate_count": family_f["candidate_count"],
            "request": request,
            "candidates": family_f["candidates"],
            "window_start": request["windowStart"],
            "window_end": request["windowEnd"],
        }, **kwargs,
    )
    for key in (
        "classical_cost", "qaoa_best_cost", "qaoa_expected_cost",
        "optimality_gap", "feasible_probability", "optimal_probability",
        "priority_satisfaction", "internal_gap_minutes", "compactness",
    ):
        assert one[key] == pytest.approx(two[key])


def test_summary_reports_trials_and_descriptive_statistics():
    rows = [
        {"experiment_id": "seed_robustness", "family": "F", "instance_id": "F1", "candidate_count": 3,
         "beta": 0.005, "p": 2, "maxiter": 5, "shots": 32, "seed": seed,
         "finite_shot_optimal_hit": hit, "optimality_gap": gap}
        for seed, hit, gap in ((42, True, 0.0), (43, False, 2.0), (44, True, 0.0))
    ]
    summary = aggregate_runs(rows)[0]
    assert summary["trial_count"] == 3
    assert summary["optimality_gap_mean"] == pytest.approx(2 / 3)
    assert summary["optimality_gap_median"] == 0
    assert summary["optimality_gap_min"] == 0
    assert summary["optimality_gap_max"] == 2
    assert summary["exact_optimum_hit_rate"] == pytest.approx(2 / 3)


def test_quick_cli_outputs_artifacts_and_records_invalid_configuration(tmp_path):
    output = tmp_path / "multiinstance-quick"
    result = run_benchmark("quick", output)
    expected = {
        "instances.json", "instance_manifest.csv", "runs.csv", "summary.csv",
        "excluded_configurations.csv", "config.json", "report.md",
    }
    assert expected.issubset({path.name for path in output.iterdir()})
    plots = list(output.glob("*.png"))
    assert len(plots) >= 6
    assert len(result["instances"]) == 18
    assert len(result["runs"]) >= 6
    assert any("bound" in row["reason"] for row in result["excluded"])
    config = json.loads((output / "config.json").read_text())
    assert config["executed_runs"] == len(result["runs"])
    with (output / "runs.csv").open(newline="", encoding="utf-8") as handle:
        assert next(csv.reader(handle)) == RUN_COLUMNS

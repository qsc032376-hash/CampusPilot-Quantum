import csv
import json
import sys
from pathlib import Path

import numpy as np

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import initialization_benchmark as bench
from benchmark_instances import build_benchmark_instances
from compactness_benchmark import analyze_probability_distribution
from compactness_benchmark import validate_weight_configuration
from compactness_qubo import build_compactness_qubo
from qaoa_initialization import relaxation_solution


def test_experiment_matrix_is_bounded_and_covers_dataset_and_research_sweeps():
    instances = build_benchmark_instances()
    plans, settings = bench.experiment_matrix("full", instances)
    core = [row for row in plans if row["experiment_id"] == "cross_instance"]
    assert len(core) == 54
    assert {row["instance"]["instance_id"] for row in core} == {item["instance_id"] for item in instances}
    assert {row["strategy"] for row in core} == {"standard", "multi_start", "warm_start"}
    assert {row["restart_count"] for row in plans if row["experiment_id"] == "restart_scaling"} == {1, 3, 5, 10}
    assert {row["seed"] for row in plans if row["experiment_id"] == "seed_robustness"} == set(range(42, 52))
    assert settings["matched_total_maxiter"] == 3 * settings["per_restart_maxiter"]


def test_relaxation_and_quantum_use_same_symmetric_objective():
    instance = next(item for item in build_benchmark_instances() if item["instance_id"] == "F1-n3")
    model = build_compactness_qubo(
        instance["candidates"], instance["request"]["windowStart"], instance["request"]["windowEnd"],
        alpha=0.05, beta=0.005,
    )
    assert np.allclose(model["Q"], model["Q"].T)
    relaxed = relaxation_solution(model["Q"])
    assert np.all(relaxed["probabilities"] >= 0.02)
    assert np.all(relaxed["probabilities"] <= 0.98)


def test_alpha_beta_configuration_obeys_existing_bound():
    assert validate_weight_configuration(12, 0.05, 0.005)[0] is True
    valid, reason = validate_weight_configuration(12, 0.05, 0.02)
    assert valid is False
    assert "bound" in reason


def test_probability_analysis_sums_equivalent_optima_and_bounds_metrics():
    instance = next(item for item in build_benchmark_instances() if item["instance_id"] == "F1-n3")
    req = instance["request"]
    model = build_compactness_qubo(instance["candidates"], req["windowStart"], req["windowEnd"], alpha=0.05, beta=0.005)
    # The uniform distribution must produce valid aggregate probabilities.
    probs = np.full(2 ** len(instance["candidates"]), 1 / 2 ** len(instance["candidates"]))
    result = analyze_probability_distribution(probs, model["Q"], model["conflicts"], instance["candidates"], instance["exact_optimal_value"], req["windowStart"], req["windowEnd"])
    assert 0 <= result["optimal_probability"] <= result["feasible_probability"] <= 1
    assert result["optimal_assignment_count"] >= 1


def test_quick_run_writes_consistent_csv_config_report_and_six_figures(tmp_path, monkeypatch):
    all_instances = build_benchmark_instances()
    instance = next(item for item in all_instances if item["instance_id"] == "F1-n3")
    monkeypatch.setattr(bench, "build_benchmark_instances", lambda: [instance])
    plans = []
    for strategy in ("standard", "multi_start", "warm_start"):
        plans.append({
            "experiment_id": "cross_instance", "budget_mode": "fixed_per_restart",
            "instance": instance, "strategy": strategy, "p": 1, "seed": 42,
            "maxiter_per_restart": 4, "restart_count": 3 if strategy == "multi_start" else 1,
        })
    monkeypatch.setattr(bench, "experiment_matrix", lambda mode, data: (plans, {
        "mode": "quick", "alpha": 0.05, "beta": 0.005, "per_restart_maxiter": 4,
        "matched_total_maxiter": 12, "primary_p": 1, "primary_seed": 42, "shots": 32,
        "restart_counts": [1, 3], "depth_values": [1, 2, 3], "robustness_seeds": [42],
        "quick_instance_ids": [instance["instance_id"]], "matched_budget_instance_ids": [],
        "selection_rule": "minimum expected cost",
    }))
    out = tmp_path / "phase222"
    result = bench.run_benchmark("quick", out)
    assert len(result["runs"]) == 3
    assert set(result["figures"]) >= {
        "strategy_vs_optimal_probability.png", "strategy_vs_feasible_probability.png",
        "strategy_vs_optimality_gap.png", "evaluations_vs_optimal_probability.png",
        "runtime_vs_exact_hit.png", "dense_conflict_strategy_comparison.png",
    }
    with (out / "runs.csv").open(newline="", encoding="utf-8") as f:
        assert next(csv.reader(f)) == bench.RUN_COLUMNS
    config = json.loads((out / "config.json").read_text())
    assert config["executed_runs"] == 3
    assert config["warm_start"]["preprocessing_included_in_total_runtime"] is True
    assert "no quantum advantage" in (out / "report.md").read_text().lower()

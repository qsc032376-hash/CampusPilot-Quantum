import csv
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import generalization_analysis as ga


@pytest.fixture(scope="module")
def loaded():
    sources = ga.load_sources()
    rows, exclusions, features = ga._harmonize(sources, "full")
    return sources, rows, exclusions, features


def test_correct_schema_harmonization_across_existing_sources(loaded):
    sources, rows, exclusions, _ = loaded
    assert len(rows) == 345
    assert not [x for x in exclusions if x.get("reason") != "excluded by source experiment"]
    assert {r["source_phase"] for r in rows} == {"2.2.1", "2.2.2", "2.2.3"}
    phase3 = next(r for r in rows if r["source_phase"] == "2.2.3")
    assert phase3["candidate_count"] == 3  # joined from the instance manifest; omitted in source run schema
    assert phase3["conditional_optimal_probability"] is not None
    assert len(sources) == 3


def test_incompatible_experiment_settings_are_reported_not_pooled(loaded):
    sources, rows, _, _ = loaded
    assessment = ga.compatibility_assessment(sources, rows)
    cross_phase = [r for r in assessment if r["comparison_scope"] == "cross-phase non-pooling"]
    assert len(cross_phase) == 3
    assert all(not r["directly_comparable"] for r in cross_phase)
    within = [r for r in assessment if r["comparison_scope"].startswith("within Phase")]
    assert all(r["directly_comparable"] for r in within)


def test_duplicate_run_identification_and_exclusion(loaded):
    all_sources = loaded[0]
    source = next(s for s in all_sources if s["phase"] == "2.2.3")
    duplicate_source = {**source, "rows": [source["rows"][0], dict(source["rows"][0])], "excluded_rows": []}
    supporting_sources = [{**s, "rows": []} for s in all_sources if s["phase"] != "2.2.3"]
    rows, exclusions, _ = ga._harmonize(supporting_sources + [duplicate_source], "full")
    assert rows == []
    assert sum("duplicate composite run key" in r["reason"] for r in exclusions) == 2


def test_safe_handling_of_missing_required_fields(loaded):
    source = next(s for s in loaded[0] if s["phase"] == "2.2.3")
    raw = dict(source["rows"][0])
    raw["optimal_probability"] = ""
    item, errors = ga._normalise_row(source, raw, loaded[3])
    assert item is None
    assert any("optimal_probability" in error for error in errors)


def test_pair_matching_uses_instance_and_all_shared_settings(loaded):
    _, rows, _, _ = loaded
    pairs = ga._pair_rows(rows, "2.2.3", "core_18_instances", "COBYLA", "Powell", "optimizer")
    assert len(pairs) == 18
    assert len({row[0] for row in pairs}) == 18
    strategy_pairs = ga._pair_rows(rows, "2.2.2", "matched_total_budget:matched_total", "standard", "warm_start", "strategy")
    assert len(strategy_pairs) == 6


def _summary_row(instance, value):
    return {
        "source_phase": "2.2.3", "experiment_stratum": "core_18_instances",
        "family": "A", "strategy": "standard", "optimizer": "COBYLA",
        "p": 2, "optimization_budget": 100, "budget_mode": "hard_objective_evaluation_cap",
        "instance_id": instance, "empirical_hit_rate": None,
        "sampling_batch_count": None, "observed_single_batch_hit": None,
        "optimal_probability": value, "feasible_probability": 0.8,
        "conditional_optimal_probability": value / 0.8,
        "optimality_gap": 1.0, "theoretical_hit_probability": 0.5,
        "objective_function_evaluations": 100, "optimization_runtime_seconds": 1.0,
        "total_runtime_seconds": 1.2, "preprocessing_seconds": None,
    }


def test_cluster_aware_summary_weights_instances_not_seed_repetitions():
    rows = [_summary_row("A1-n3", 0.0), _summary_row("A1-n3", 1.0), _summary_row("A2-n5", 0.8)]
    summary = ga.family_summaries(rows)
    family = next(r for r in summary if r["summary_level"] == "family")
    assert family["instance_count"] == 2
    assert family["trial_count"] == 3
    assert family["optimal_probability_mean"] == pytest.approx(0.65)
    instance = next(r for r in summary if r["summary_level"] == "instance" and r["instance_id"] == "A1-n3")
    assert instance["trial_count"] == 2
    assert instance["optimal_probability_mean"] == pytest.approx(0.5)


def test_cluster_bootstrap_confidence_interval_is_correct_and_seeded():
    assert ga.paired_bootstrap_ci([1.0, 1.0, 1.0], seed=4, replicates=1000) == (1.0, 1.0)
    first = ga.paired_bootstrap_ci([-.2, .1, .3, .4, -.1], seed=9, replicates=1000)
    second = ga.paired_bootstrap_ci([-.2, .1, .3, .4, -.1], seed=9, replicates=1000)
    assert first == second
    assert first[0] <= sum([-.2, .1, .3, .4, -.1]) / 5 <= first[1]


def test_holm_multiple_testing_adjustment():
    assert ga.holm_adjust([0.01, 0.04, 0.03]) == pytest.approx([0.03, 0.06, 0.06])
    assert ga.holm_adjust([None, 0.5]) == [None, 0.5]


def test_conditional_optimal_probability():
    assert ga.conditional_optimal_probability(0.8, 0.2) == pytest.approx(0.25)
    assert ga.conditional_optimal_probability(0.0, 0.0) is None
    with pytest.raises(ValueError):
        ga.conditional_optimal_probability(0.2, 0.3)


def test_zero_feasibility_is_explicitly_missing():
    assert ga.conditional_optimal_probability(0.0, 0.0) is None
    with pytest.raises(ValueError):
        ga.conditional_optimal_probability(0.0, 0.01)


def test_sampling_hit_probability_is_stable_at_extreme_probabilities():
    assert ga.theoretical_hit_probability(0.0, 2048) == 0.0
    assert ga.theoretical_hit_probability(1.0, 2048) == 1.0
    assert ga.theoretical_hit_probability(1e-14, 2048) == pytest.approx(2.048e-11, rel=1e-6)
    assert ga.theoretical_hit_probability(0.5, 1) == pytest.approx(0.5)


def test_noncomparable_cross_phase_rows_are_excluded_from_paired_analysis(loaded):
    sources, rows, _, _ = loaded
    comparisons, effects = ga.paired_analysis(rows)
    assert {r["source_phase"] for r in comparisons} == {"2.2.2", "2.2.3"}
    assert not any("2.2.1" in r["source_phase"] for r in effects)
    assessment = ga.compatibility_assessment(sources, rows)
    assert all(not row["directly_comparable"] for row in assessment if row["comparison_scope"] == "cross-phase non-pooling")


def test_source_provenance_preserves_hashes_and_config(loaded):
    manifest = ga._source_manifest(loaded[0], loaded[2], "quick")
    assert manifest["repository_revision"]
    phase3 = next(r for r in manifest["datasets"] if r["phase"] == "2.2.3")
    assert phase3["config"]["matrix_run_count"] == 168
    assert any(file["path"].endswith("runs.csv") and len(file["sha256"]) == 64 for file in phase3["files"])
    assert any(r["reason"] == "excluded by source experiment" for r in manifest["excluded_records"])


def test_required_artifacts_and_figures_are_generated(tmp_path):
    result = ga.run_analysis("quick", tmp_path / "analysis")
    output = Path(result["output"])
    required = {
        "source_manifest.json", "harmonized_runs.csv", "comparability_report.csv",
        "family_summary.csv", "paired_comparisons.csv", "effect_sizes.csv",
        "sampling_calibration.csv", "config.json", "report.md",
    }
    assert required.issubset({p.name for p in output.iterdir()})
    assert len(list(output.glob("*.png"))) >= 8
    assert result["harmonized_records"] > 0
    assert "Completion decision" in (output / "report.md").read_text()


def test_analysis_is_reproducible_and_does_not_run_solvers(tmp_path):
    a = ga.run_analysis("quick", tmp_path / "a")
    b = ga.run_analysis("quick", tmp_path / "b")
    assert a["harmonized_records"] == b["harmonized_records"]
    with (Path(a["output"]) / "effect_sizes.csv").open() as fa, (Path(b["output"]) / "effect_sizes.csv").open() as fb:
        assert fa.read() == fb.read()
    config = __import__("json").loads((Path(a["output"]) / "config.json").read_text())
    assert config["solver_execution"] is False

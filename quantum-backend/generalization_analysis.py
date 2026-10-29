"""Cross-instance generalization and statistical robustness analysis.

The analysis deliberately keeps benchmark phases separate unless their
configuration semantics match. It never runs a solver or modifies production
QAOA/QUBO behavior.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import platform
import statistics
import subprocess
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import scipy
from scipy import stats


ROOT = Path(__file__).resolve().parent
REPOSITORY_ROOT = ROOT.parent
OUTPUT_ROOT = ROOT / "output"
PHASE_DIRS = {
    "2.2.1": OUTPUT_ROOT / "phase2_2_1_full",
    "2.2.2": OUTPUT_ROOT / "phase2_2_2_full",
    "2.2.3": OUTPUT_ROOT / "phase2_2_3_full",
}
BOOTSTRAP_REPLICATES = 10_000
BOOTSTRAP_SEED = 20261030
PROBABILITY_TOLERANCE = 1e-8

HARMONIZED_FIELDS = [
    "source_phase", "source_label", "source_experiment_id", "experiment_stratum",
    "run_key", "instance_id", "family", "candidate_count", "alpha", "beta",
    "p", "initialization_seed", "optimization_budget", "budget_mode", "shots",
    "objective_definition", "optimizer", "initialization_strategy", "strategy",
    "method_label", "restart_count", "feasible_probability", "optimal_probability",
    "conditional_optimal_probability", "optimality_gap", "best_expected_cost",
    "observed_single_batch_hit", "empirical_hit_rate", "sampling_batch_count",
    "theoretical_hit_probability", "objective_function_evaluations",
    "optimization_runtime_seconds", "total_runtime_seconds", "preprocessing_seconds",
    "priority_satisfaction", "internal_gap_minutes", "compactness", "fallback_used",
    "conflict_graph_density", "scheduling_density", "feasible_assignment_count",
    "feasible_assignment_ratio", "priority_heterogeneity", "priority_level_count",
    "mean_deadline_slack_minutes", "zero_slack_deadline_fraction",
    "busy_period_count", "busy_minutes_fraction", "duplicate_run_count",
    "pareto_optimal_by_runtime", "pareto_optimal_by_evaluations",
]

SUMMARY_METRICS = (
    "feasible_probability", "optimal_probability", "conditional_optimal_probability",
    "optimality_gap", "theoretical_hit_probability", "observed_single_batch_hit",
    "empirical_hit_rate", "objective_function_evaluations",
    "optimization_runtime_seconds", "total_runtime_seconds", "preprocessing_seconds",
)


class DataIntegrityError(ValueError):
    """Raised when input data cannot be safely harmonized."""


def _read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(newline="", encoding="utf-8-sig") as stream:
        reader = csv.DictReader(stream)
        if not reader.fieldnames:
            raise DataIntegrityError(f"CSV has no header: {path}")
        return list(reader.fieldnames), list(reader)


def _load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as stream:
        return json.load(stream)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _number(value: Any, *, integer: bool = False) -> int | float | None:
    if value is None or value == "":
        return None
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("non-finite numeric value")
    if integer:
        if number != int(number):
            raise ValueError("expected an integer")
        return int(number)
    return number


def _bool(value: Any) -> bool | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        return value
    token = str(value).strip().lower()
    if token in {"true", "1", "yes"}:
        return True
    if token in {"false", "0", "no"}:
        return False
    raise ValueError(f"invalid boolean value: {value}")


def theoretical_hit_probability(optimal_probability: float, shots: int) -> float:
    """Stable probability of one or more hits in independent shots."""
    p = float(optimal_probability)
    if not math.isfinite(p) or not 0 <= p <= 1 or type(shots) is not int or shots < 1:
        raise ValueError("optimal_probability must be in [0,1] and shots positive")
    if p == 0:
        return 0.0
    if p == 1:
        return 1.0
    return float(np.clip(-math.expm1(shots * math.log1p(-p)), 0.0, 1.0))


def conditional_optimal_probability(
    feasible_probability: float, optimal_probability: float
) -> float | None:
    """Return P(optimal | feasible), or None when feasibility has zero mass."""
    feasible, optimal = float(feasible_probability), float(optimal_probability)
    if not (math.isfinite(feasible) and math.isfinite(optimal)):
        raise ValueError("probabilities must be finite")
    if not (0 <= optimal <= feasible + PROBABILITY_TOLERANCE <= 1 + PROBABILITY_TOLERANCE):
        raise ValueError("optimal probability must be between zero and feasible probability")
    if feasible <= PROBABILITY_TOLERANCE:
        if optimal > PROBABILITY_TOLERANCE:
            raise ValueError("positive optimal probability with zero feasible probability")
        return None
    return float(np.clip(optimal / feasible, 0.0, 1.0))


def holm_adjust(p_values: Iterable[float | None]) -> list[float | None]:
    """Holm step-down adjusted p-values; None values remain unavailable."""
    values = list(p_values)
    valid = [(i, float(p)) for i, p in enumerate(values) if p is not None and math.isfinite(float(p))]
    if any(p < 0 or p > 1 for _, p in valid):
        raise ValueError("p-values must be in [0,1]")
    valid.sort(key=lambda pair: pair[1])
    adjusted = [None] * len(values)
    total = len(valid)
    running = 0.0
    for rank, (index, p) in enumerate(valid):
        running = max(running, min(1.0, (total - rank) * p))
        adjusted[index] = running
    return adjusted


def paired_bootstrap_ci(
    differences: Iterable[float], *, seed: int = BOOTSTRAP_SEED,
    replicates: int = BOOTSTRAP_REPLICATES, confidence: float = 0.95,
) -> tuple[float | None, float | None]:
    """Percentile CI for a mean difference, resampling independent instances."""
    values = np.asarray(list(differences), dtype=float)
    values = values[np.isfinite(values)]
    if len(values) < 2 or not 0 < confidence < 1 or replicates < 100:
        return None, None
    rng = np.random.default_rng(seed)
    samples = rng.choice(values, size=(replicates, len(values)), replace=True).mean(axis=1)
    tail = (1 - confidence) / 2
    low, high = np.quantile(samples, [tail, 1 - tail])
    return float(low), float(high)


def load_sources(phase_dirs: dict[str, Path] | None = None) -> list[dict[str, Any]]:
    """Read the three existing full experiments and retain file provenance."""
    phase_dirs = PHASE_DIRS if phase_dirs is None else phase_dirs
    sources = []
    for phase, directory in phase_dirs.items():
        runs_path, config_path = directory / "runs.csv", directory / "config.json"
        if not runs_path.exists() or not config_path.exists():
            sources.append({
                "phase": phase, "available": False, "directory": str(directory),
                "missing": [str(p) for p in (runs_path, config_path) if not p.exists()],
            })
            continue
        headers, rows = _read_csv(runs_path)
        config = _load_json(config_path)
        source = {
            "phase": phase, "available": True, "directory": directory,
            "runs_path": runs_path, "config_path": config_path,
            "headers": headers, "rows": rows, "config": config,
            "manifest_path": directory / "instance_manifest.csv",
            "instances_path": directory / "instances.json",
        }
        for key, filename in (("instance_manifest_path", "instance_manifest.csv"), ("instances_path", "instances.json")):
            path = directory / filename
            source[key] = path if path.exists() else None
        excluded_path = directory / "excluded_configurations.csv"
        source["excluded_path"] = excluded_path if excluded_path.exists() else None
        source["excluded_rows"] = _read_csv(excluded_path)[1] if excluded_path.exists() else []
        sources.append(source)
    return sources


def _feature_map(sources: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    manifest: dict[str, dict[str, Any]] = {}
    for source in sources:
        if source.get("phase") != "2.2.1" or not source.get("available"):
            continue
        path = source.get("instance_manifest_path")
        if path:
            _, rows = _read_csv(path)
            for row in rows:
                manifest[row["instance_id"]] = dict(row)
        instances_path = source.get("instances_path")
        if instances_path:
            for item in _load_json(instances_path):
                row = manifest.setdefault(item["instance_id"], {})
                row["instance_json"] = item
                for field in (
                    "family", "family_name", "candidate_count", "task_count",
                    "conflict_graph_density", "scheduling_density", "feasible_assignment_count",
                    "priority_distribution", "deadline_constraints",
                ):
                    if field not in row and field in item:
                        row[field] = item[field]
    for instance_id, row in manifest.items():
        try:
            n = _number(row.get("candidate_count"), integer=True)
            feasible_count = _number(row.get("feasible_assignment_count"), integer=True)
            row["feasible_assignment_ratio"] = feasible_count / (2 ** n) if n is not None and feasible_count is not None else None
            priorities = row.get("priority_distribution", {})
            if isinstance(priorities, str):
                priorities = json.loads(priorities) if priorities else {}
            counts = [float(v) for v in priorities.values() if float(v) > 0]
            total = sum(counts)
            probs = [v / total for v in counts] if total else []
            entropy = -sum(p * math.log(p) for p in probs if p > 0)
            row["priority_heterogeneity"] = entropy / math.log(len(probs)) if len(probs) > 1 else 0.0
            row["priority_level_count"] = len(probs)
            deadlines = row.get("deadline_constraints", {})
            if isinstance(deadlines, str):
                deadlines = json.loads(deadlines) if deadlines else {}
            slacks = [float(v["slackMinutes"]) for v in deadlines.values() if "slackMinutes" in v]
            row["mean_deadline_slack_minutes"] = statistics.fmean(slacks) if slacks else None
            row["zero_slack_deadline_fraction"] = sum(abs(x) <= 1e-9 for x in slacks) / len(slacks) if slacks else None
            request = row.get("instance_json", {}).get("request", {})
            events = request.get("classes", []) + request.get("unavailablePeriods", [])
            row["busy_period_count"] = len(events)
            start = datetime.fromisoformat(request["windowStart"])
            end = datetime.fromisoformat(request["windowEnd"])
            window_minutes = (end - start).total_seconds() / 60
            intervals = sorted((datetime.fromisoformat(e["start"]), datetime.fromisoformat(e["end"])) for e in events)
            merged: list[list[datetime]] = []
            for begin, finish in intervals:
                if not merged or begin > merged[-1][1]:
                    merged.append([begin, finish])
                else:
                    merged[-1][1] = max(merged[-1][1], finish)
            busy_minutes = sum((end_time - begin).total_seconds() / 60 for begin, end_time in merged)
            row["busy_minutes_fraction"] = busy_minutes / window_minutes if window_minutes > 0 else None
        except (ValueError, TypeError, KeyError, ZeroDivisionError) as exc:
            row["feature_error"] = str(exc)
    return manifest


def _normalise_row(source: dict[str, Any], row: dict[str, str], features: dict[str, dict[str, Any]]) -> tuple[dict[str, Any] | None, list[str]]:
    phase = source["phase"]
    missing: list[str] = []
    try:
        if phase == "2.2.1":
            fields = {
                "instance_id": "instance_id", "family": "family", "candidate_count": "candidate_count",
                "alpha": "alpha", "beta": "beta", "p": "p", "seed": "seed",
                "budget": "maxiter", "shots": "shots", "feasible": "feasible_probability",
                "optimal": "optimal_probability", "gap": "optimality_gap",
                "evals": "function_evaluations", "optimizer": None,
            }
            stratum = row.get("experiment_id", "unknown")
            method_strategy, optimizer, init = "standard", "COBYLA", "uniform_seeded"
            budget_mode = "scipy_maxiter"
            runtime = row.get("qaoa_runtime_seconds")
            total_runtime = runtime
            preprocessing = None
            hit = _bool(row.get("finite_shot_optimal_hit"))
            empirical = None
            batch_count = 1 if hit is not None else None
            best_cost = row.get("qaoa_expected_cost")
            priority = row.get("priority_satisfaction")
            gap_minutes, compactness = row.get("internal_gap_minutes"), row.get("compactness")
            fallback = _bool(row.get("fallback_used"))
            objective = "compactness_qubo_xTQx"
        elif phase == "2.2.2":
            fields = {
                "instance_id": "instance_id", "family": "family", "candidate_count": "candidate_count",
                "alpha": "alpha", "beta": "beta", "p": "p", "seed": "seed",
                "budget": "optimizer_function_evaluations", "shots": "shots",
                "feasible": "feasible_probability", "optimal": "optimal_probability",
                "gap": "optimality_gap", "evals": "optimizer_function_evaluations",
            }
            stratum = f"{row.get('experiment_id', 'unknown')}:{row.get('budget_mode', 'unknown')}"
            method_strategy = row.get("strategy", "unknown")
            optimizer, init = "COBYLA", {"warm_start": "continuous_relaxation_product_state", "multi_start": "multi_start_uniform", "standard": "uniform_seeded"}.get(method_strategy, method_strategy)
            budget_mode = row.get("budget_mode", "unknown")
            if budget_mode == "matched_total":
                nominal_budget = int(source["config"].get("matched_total_maxiter", 0))
            else:
                nominal_budget = int(source["config"].get("per_restart_maxiter", 0)) * int(row.get("restart_count") or 1)
            runtime = row.get("optimization_runtime_seconds")
            total_runtime = row.get("total_runtime_seconds")
            preprocessing = row.get("warm_start_preprocessing_seconds")
            hit = _bool(row.get("exact_optimum_hit"))
            empirical, batch_count = None, 1 if hit is not None else None
            best_cost = row.get("optimized_expected_cost")
            priority, gap_minutes, compactness = row.get("priority_satisfaction"), row.get("internal_gap_minutes"), row.get("compactness")
            fallback = _bool(row.get("fallback_used"))
            objective = "compactness_qubo_xTQx"
        else:
            fields = {
                "instance_id": "instance_id", "family": "family", "candidate_count": "candidate_count",
                "alpha": "alpha", "beta": "beta", "p": "p", "seed": "seed",
                "budget": "budget", "shots": "shots_per_batch", "feasible": "feasible_probability",
                "optimal": "optimal_probability", "gap": "optimality_gap",
                "evals": "actual_objective_evaluations",
            }
            stratum = row.get("study", "unknown")
            method_strategy, optimizer, init = "standard", row.get("optimizer", "unknown"), "uniform_seeded"
            budget_mode = "hard_objective_evaluation_cap"
            runtime, total_runtime, preprocessing = row.get("optimizer_runtime_seconds"), row.get("total_runtime_seconds"), None
            hit = None
            empirical = _number(row.get("empirical_hit_rate"))
            batch_count = _number(row.get("empirical_hit_trials"), integer=True)
            best_cost = row.get("best_expected_cost")
            priority, gap_minutes, compactness = row.get("priority_satisfaction"), row.get("internal_gap_minutes"), row.get("compactness")
            fallback = _bool(row.get("fallback_used"))
            objective = "compactness_qubo_xTQx"

        # A run schema must have the required identifiers and probability metrics.
        required_keys = ("instance_id", "family", "candidate_count", "alpha", "beta", "p", "seed", "feasible", "optimal")
        for key in required_keys:
            field = fields[key]
            value = row.get(field, "")
            if key == "candidate_count" and value == "":
                value = features.get(row.get(fields["instance_id"], ""), {}).get("candidate_count", "")
            if value == "":
                missing.append(field)
        if missing:
            return None, ["missing required fields: " + ", ".join(missing)]
        numeric_names = ("candidate_count", "alpha", "beta", "p", "seed", "budget", "shots", "feasible", "optimal", "gap", "evals")
        nums = {
            name: _number(
                row.get(fields[name]) or (features.get(row.get(fields["instance_id"], ""), {}).get("candidate_count") if name == "candidate_count" else None),
                integer=name in {"candidate_count", "p", "seed", "budget", "shots", "evals"},
            )
            for name in numeric_names if fields.get(name)
        }
        feasible, optimal = float(nums["feasible"]), float(nums["optimal"])
        if not (-PROBABILITY_TOLERANCE <= feasible <= 1 + PROBABILITY_TOLERANCE and -PROBABILITY_TOLERANCE <= optimal <= 1 + PROBABILITY_TOLERANCE):
            raise ValueError("probability is outside [0,1]")
        if optimal > feasible + PROBABILITY_TOLERANCE:
            raise ValueError("optimal_probability exceeds feasible_probability")
        n, p = int(nums["candidate_count"]), int(nums["p"])
        if n < 1 or n > 12 or p < 1:
            raise ValueError("candidate_count or p is outside supported positive range")
        if float(nums["alpha"]) < 0 or float(nums["beta"]) < 0:
            raise ValueError("QUBO weights alpha and beta must be nonnegative")
        for name in ("budget", "shots", "evals"):
            if nums.get(name) is not None and nums[name] < 1:
                raise ValueError(f"{name} must be positive")
        instance_id = str(row[fields["instance_id"]])
        if instance_id not in features:
            missing.append("instance feature record")
        feature = features.get(instance_id, {})
        if feature and (int(float(feature.get("candidate_count", n))) != n or str(feature.get("family", row["family"])) != str(row["family"])):
            raise ValueError("instance_id does not match manifest family/candidate count")
        shots = nums.get("shots")
        theoretical = theoretical_hit_probability(optimal, int(shots)) if shots else None
        runtime_values = [_number(runtime), _number(total_runtime), _number(preprocessing)]
        if any(value is not None and value < 0 for value in runtime_values):
            raise ValueError("runtime fields must be nonnegative")
        if empirical is not None and not 0 <= empirical <= 1:
            raise ValueError("empirical hit rate is outside [0,1]")
        if batch_count is not None and batch_count < 1:
            raise ValueError("sampling batch count must be positive")
        if priority is not None and not 0 <= float(priority) <= 1:
            raise ValueError("priority satisfaction is outside [0,1]")
        if feature.get("conflict_graph_density") not in (None, "") and not 0 <= float(feature["conflict_graph_density"]) <= 1:
            raise ValueError("conflict graph density is outside [0,1]")
        if feature.get("feasible_assignment_count") not in (None, "") and not 0 <= int(float(feature["feasible_assignment_count"])) <= 2 ** n:
            raise ValueError("feasible assignment count is outside [0,2**candidate_count]")
        strategy_label = str(method_strategy)
        source_label = f"Phase {phase}"
        values = {
            "source_phase": phase, "source_label": source_label,
            "source_experiment_id": row.get("experiment_id", ""), "experiment_stratum": stratum,
            "instance_id": instance_id, "family": str(row["family"]), "candidate_count": n,
            "alpha": nums.get("alpha"), "beta": nums.get("beta"), "p": p,
            "initialization_seed": int(nums["seed"]), "optimization_budget": nominal_budget if phase == "2.2.2" else nums.get("budget"),
            "budget_mode": budget_mode, "shots": shots, "objective_definition": objective,
            "optimizer": optimizer, "initialization_strategy": init, "strategy": strategy_label,
            "method_label": f"{strategy_label} / {optimizer}",
            "restart_count": int(row.get("restart_count") or 1) if phase == "2.2.2" else 1,
            "feasible_probability": feasible, "optimal_probability": optimal,
            "conditional_optimal_probability": conditional_optimal_probability(feasible, optimal),
            "optimality_gap": _number(row.get(fields["gap"])) if fields.get("gap") else None,
            "best_expected_cost": _number(best_cost), "observed_single_batch_hit": hit,
            "empirical_hit_rate": empirical, "sampling_batch_count": batch_count,
            "theoretical_hit_probability": theoretical,
            "objective_function_evaluations": nums.get("evals"),
            "optimization_runtime_seconds": _number(runtime),
            "total_runtime_seconds": _number(total_runtime),
            "preprocessing_seconds": _number(preprocessing),
            "priority_satisfaction": _number(priority), "internal_gap_minutes": _number(gap_minutes),
            "compactness": _number(compactness), "fallback_used": fallback,
            "conflict_graph_density": _number(feature.get("conflict_graph_density")),
            "scheduling_density": _number(feature.get("scheduling_density")),
            "feasible_assignment_count": _number(feature.get("feasible_assignment_count"), integer=True),
            "feasible_assignment_ratio": feature.get("feasible_assignment_ratio"),
            "priority_heterogeneity": feature.get("priority_heterogeneity"),
            "priority_level_count": feature.get("priority_level_count"),
            "mean_deadline_slack_minutes": feature.get("mean_deadline_slack_minutes"),
            "zero_slack_deadline_fraction": feature.get("zero_slack_deadline_fraction"),
            "busy_period_count": feature.get("busy_period_count"),
            "busy_minutes_fraction": feature.get("busy_minutes_fraction"),
            "duplicate_run_count": 1,
        }
        if nums.get("budget") is None:
            missing.append("optimization budget")
        if nums.get("shots") is None:
            missing.append("shots")
        if values["objective_function_evaluations"] is None:
            missing.append("objective function evaluations")
        values["run_key"] = _run_key(values)
        values["_missing_optional"] = missing
        return values, []
    except (ValueError, TypeError, OverflowError, KeyError) as exc:
        return None, [str(exc)]


def _run_key(row: dict[str, Any]) -> str:
    fields = (
        "source_phase", "source_experiment_id", "experiment_stratum", "instance_id",
        "candidate_count", "alpha", "beta", "p", "initialization_seed",
        "optimization_budget", "shots", "objective_definition", "optimizer",
        "initialization_strategy", "strategy", "restart_count",
    )
    return json.dumps([row.get(field) for field in fields], separators=(",", ":"), default=str)


def _harmonize(sources: list[dict[str, Any]], mode: str) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, dict[str, Any]]]:
    features = _feature_map(sources)
    normalized: list[dict[str, Any]] = []
    exclusions: list[dict[str, Any]] = []
    for source in sources:
        if not source.get("available"):
            exclusions.append({"source_phase": source["phase"], "reason": "source files unavailable", "details": json.dumps(source.get("missing", []))})
            continue
        for excluded in source.get("excluded_rows", []):
            exclusions.append({
                "source_phase": source["phase"], "instance_id": excluded.get("instance_id", ""),
                "reason": "excluded by source experiment", "details": json.dumps(excluded, sort_keys=True),
            })
        for index, raw in enumerate(source["rows"]):
            item, errors = _normalise_row(source, raw, features)
            if errors:
                exclusions.append({"source_phase": source["phase"], "row_number": index + 2, "instance_id": raw.get("instance_id", ""), "reason": "; ".join(errors), "details": ""})
            elif item:
                normalized.append(item)
    # Identify exact duplicates using the full composite comparison key.
    counts: dict[str, int] = defaultdict(int)
    for row in normalized:
        counts[row["run_key"]] += 1
    duplicates: set[str] = {key for key, count in counts.items() if count > 1}
    clean: list[dict[str, Any]] = []
    for row in normalized:
        row["duplicate_run_count"] = counts[row["run_key"]]
        if row["run_key"] in duplicates:
            exclusions.append({"source_phase": row["source_phase"], "instance_id": row["instance_id"], "reason": "duplicate composite run key", "details": row["run_key"]})
            continue
        clean.append(row)
    if mode == "quick":
        chosen = {"A2-n5", "B2-n9", "C2-n5", "D2-n9", "E2-n5", "F2-n5"}
        clean = [row for row in clean if row["instance_id"] in chosen]
    return clean, exclusions, features


def compatibility_assessment(sources: list[dict[str, Any]], rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Document within-study comparison permissions and cross-study exclusions."""
    available = {s["phase"]: s for s in sources if s.get("available")}
    assessment = []

    def add(scope: str, a: str, b: str, allowed: bool, matched: int, reason: str, unit: str) -> None:
        assessment.append({
            "comparison_scope": scope, "source_a": a, "source_b": b,
            "directly_comparable": allowed, "shared_or_matched_instances": matched,
            "independent_unit": unit, "decision_reason": reason,
        })

    phase23 = [r for r in rows if r["source_phase"] == "2.2.3" and r["experiment_stratum"] == "core_18_instances"]
    optimizer_keys: dict[tuple[Any, ...], set[str]] = defaultdict(set)
    optimizer_instances: set[str] = set()
    for r in phase23:
        key = (r["instance_id"], r["candidate_count"], r["alpha"], r["beta"], r["p"], r["initialization_seed"], r["optimization_budget"], r["shots"], r["objective_definition"], r["initialization_strategy"])
        optimizer_keys[key].add(r["optimizer"])
        optimizer_instances.add(r["instance_id"])
    optimizer_paired = sum(methods >= {"COBYLA", "Powell", "Nelder-Mead", "SLSQP"} for methods in optimizer_keys.values())
    add("within Phase 2.2.3 core optimizer comparison", "COBYLA", "Powell / Nelder-Mead / SLSQP", optimizer_paired > 0, len(optimizer_instances),
        "Same instance, QUBO weights/objective, p, seed, hard evaluation budget, shots and initialization; report retains one independent unit per instance.", "instance")

    phase22 = [r for r in rows if r["source_phase"] == "2.2.2" and r["source_experiment_id"] == "matched_total_budget"]
    strategy_keys: dict[tuple[Any, ...], set[str]] = defaultdict(set)
    strategy_instances: set[str] = set()
    for r in phase22:
        key = (r["instance_id"], r["candidate_count"], r["alpha"], r["beta"], r["p"], r["initialization_seed"], r["optimization_budget"], r["shots"], r["objective_definition"], r["optimizer"])
        strategy_keys[key].add(r["strategy"])
        strategy_instances.add(r["instance_id"])
    strategy_paired = sum(methods >= {"standard", "multi_start", "warm_start"} for methods in strategy_keys.values())
    add("within Phase 2.2.2 matched-total strategy comparison", "standard", "multi_start / warm_start", strategy_paired > 0, strategy_paired,
        "Matched-total cap, p, seed, QUBO weights, objective, shot count and underlying COBYLA; actual evaluations may stop below the shared cap. Multi-start/restart and warm-start remain strategy labels, not factorial optimizer levels.", "instance")

    for a, b, reason in (
        ("2.2.1", "2.2.2", "Different evaluation budgets/restart protocols and different parameter-preparation strategies; retain phase-specific strata."),
        ("2.2.1", "2.2.3", "Although baseline weights, p, seed and standard QAOA intent match, selection semantics differ (SciPy result.x vs best evaluated incumbent), and phase 2.2.1 has only a single sampled hit event."),
        ("2.2.2", "2.2.3", "Different optimization budget policy, initialization strategies, restart protocol, and single-batch vs repeated-batch sampling evidence."),
    ):
        matched_ids = {r["instance_id"] for r in rows if r["source_phase"] == a} & {r["instance_id"] for r in rows if r["source_phase"] == b}
        add("cross-phase non-pooling", a, b, False, len(matched_ids), reason, "shared instance IDs are not independent replications")
    for phase, description in (
        ("2.2.1", "Different experiment_id values encode baseline, depth, seed, and beta sensitivity; compare only within a matching stratum/configuration."),
        ("2.2.2", "Fixed-per-restart, matched-total, depth, seed, and restart-scaling experiments are separate; do not collapse them."),
        ("2.2.3", "Core, budget, depth, and seed studies have different configurations; optimizer paired inference uses core only."),
    ):
        add("within-phase configuration separation", phase, phase, False, len({r["instance_id"] for r in rows if r["source_phase"] == phase}), description, "instance within configuration stratum")
    if not available:
        add("data availability", "all", "all", False, 0, "No source experiments available.", "none")
    return assessment


def _mean_or_none(values: Iterable[Any]) -> float | None:
    vals = [float(x) for x in values if x is not None and x != "" and math.isfinite(float(x))]
    return statistics.fmean(vals) if vals else None


def family_summaries(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Summaries weight independent instances equally, not repeated seeds."""
    strata: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    group_fields = ("source_phase", "experiment_stratum", "family", "strategy", "optimizer", "p", "optimization_budget", "budget_mode", "restart_count", "alpha", "beta", "shots")
    for row in rows:
        strata[tuple(row.get(field) for field in group_fields)].append(row)
    output: list[dict[str, Any]] = []
    for key, trials in sorted(strata.items(), key=lambda pair: tuple(map(str, pair[0]))):
        instance_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for trial in trials:
            instance_groups[trial["instance_id"]].append(trial)
        base = dict(zip(group_fields, key))
        def summarize(selected: list[tuple[str, list[dict[str, Any]]]], level: str) -> dict[str, Any]:
            record = {**base, "summary_level": level,
                      "instance_id": selected[0][0] if level == "instance" else "",
                      "instance_count": len(selected), "trial_count": sum(len(v) for _, v in selected)}
            evidence_types = {
                "repeated_independent_batches" if t["empirical_hit_rate"] is not None and t["sampling_batch_count"] and t["sampling_batch_count"] > 1
                else "single_batch_observation" if t["observed_single_batch_hit"] is not None else "unavailable"
                for _, instance_trials in selected for t in instance_trials
            }
            record["hit_rate_evidence_type"] = ";".join(sorted(evidence_types))
            metric_instance_means: dict[str, list[float]] = defaultdict(list)
            hit_rates: list[float] = []
            for _, instance_trials in selected:
                for metric in SUMMARY_METRICS:
                    value = _mean_or_none(t.get(metric) for t in instance_trials)
                    if value is not None:
                        metric_instance_means[metric].append(value)
                run_hit_rates = [
                    float(t["empirical_hit_rate"] if t["empirical_hit_rate"] is not None else t["observed_single_batch_hit"])
                    for t in instance_trials
                    if t["empirical_hit_rate"] is not None or t["observed_single_batch_hit"] is not None
                ]
                if run_hit_rates:
                    hit_rates.append(statistics.fmean(run_hit_rates))
            record["exact_optimum_hit_rate_mean_of_instance_rates"] = _mean_or_none(hit_rates)
            if hit_rates:
                record["exact_optimum_hit_rate_sd_across_instances"] = float(np.std(hit_rates, ddof=1)) if len(hit_rates) > 1 else None
                record["exact_optimum_hit_rate_median"] = float(np.median(hit_rates))
                record["exact_optimum_hit_rate_iqr"] = float(np.quantile(hit_rates, .75) - np.quantile(hit_rates, .25))
                record["exact_optimum_hit_rate_min"] = float(np.min(hit_rates))
                record["exact_optimum_hit_rate_max"] = float(np.max(hit_rates))
            for metric, instance_values in metric_instance_means.items():
                vals = np.asarray(instance_values, dtype=float)
                record[f"{metric}_mean"] = float(np.mean(vals))
                record[f"{metric}_sd_across_instances"] = float(np.std(vals, ddof=1)) if len(vals) > 1 else None
                record[f"{metric}_median"] = float(np.median(vals))
                record[f"{metric}_iqr"] = float(np.quantile(vals, .75) - np.quantile(vals, .25))
                record[f"{metric}_min"] = float(np.min(vals))
                record[f"{metric}_max"] = float(np.max(vals))
            return record

        output.append(summarize(list(instance_groups.items()), "family"))
        for instance_id, instance_trials in instance_groups.items():
            output.append(summarize([(instance_id, instance_trials)], "instance"))
    return output


def _pair_rows(rows: list[dict[str, Any]], phase: str, stratum: str,
               method_a: str, method_b: str, method_field: str) -> list[tuple[str, dict[str, Any], dict[str, Any]]]:
    selected = [r for r in rows if r["source_phase"] == phase and r["experiment_stratum"] == stratum]
    by_key: dict[tuple[Any, ...], dict[str, dict[str, Any]]] = defaultdict(dict)
    keys = ("instance_id", "candidate_count", "alpha", "beta", "p", "initialization_seed", "optimization_budget", "shots", "objective_definition")
    for row in selected:
        key = tuple(row.get(k) for k in keys)
        by_key[key][str(row.get(method_field))] = row
    pairs = []
    for key, methods in by_key.items():
        if method_a in methods and method_b in methods:
            pairs.append((str(key[0]), methods[method_a], methods[method_b]))
    return pairs


def paired_analysis(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Create matched rows and cluster-aware estimates for five planned contrasts."""
    contrasts = [
        ("2.2.2", "matched_total_budget:matched_total", "standard", "multi_start", "strategy", "standard vs multi_start"),
        ("2.2.2", "matched_total_budget:matched_total", "standard", "warm_start", "strategy", "standard vs warm_start"),
        ("2.2.3", "core_18_instances", "COBYLA", "Powell", "optimizer", "COBYLA vs Powell"),
        ("2.2.3", "core_18_instances", "COBYLA", "Nelder-Mead", "optimizer", "COBYLA vs Nelder-Mead"),
        ("2.2.3", "core_18_instances", "COBYLA", "SLSQP", "optimizer", "COBYLA vs SLSQP"),
    ]
    per_instance: list[dict[str, Any]] = []
    estimates: list[dict[str, Any]] = []
    staged_p: list[tuple[dict[str, Any], float | None]] = []
    for phase, stratum, a, b, field, label in contrasts:
        pairs = _pair_rows(rows, phase, stratum, a, b, field)
        key = ("2.2.2", "matched_total_budget:matched_total") if phase == "2.2.2" else ("2.2.3", "core_18_instances")
        # Harmonized phase 2.2.2 strata include a :matched_total suffix.
        if phase == "2.2.2":
            pairs = _pair_rows(rows, phase, "matched_total_budget:matched_total", a, b, field)
        for instance_id, left, right in pairs:
            record = {"source_phase": phase, "comparison_stratum": stratum, "comparison": label,
                      "instance_id": instance_id, "method_a": a, "method_b": b,
                      "independent_unit": "instance", "n_matched_observations": 1}
            for metric in ("optimal_probability", "feasible_probability", "conditional_optimal_probability",
                           "optimality_gap", "optimization_runtime_seconds", "objective_function_evaluations",
                           "empirical_hit_rate"):
                av, bv = left.get(metric), right.get(metric)
                record[f"{metric}_a"] = av
                record[f"{metric}_b"] = bv
                record[f"{metric}_difference_b_minus_a"] = float(bv) - float(av) if av is not None and bv is not None else None
            per_instance.append(record)
        grouped: dict[str, list[tuple[dict[str, Any], dict[str, Any]]]] = defaultdict(list)
        for instance_id, left, right in pairs:
            grouped[instance_id].append((left, right))
        diffs = []
        quality_pairs = []
        runtime_diffs = []
        for instance_id, matched_rows in grouped.items():
            l_mean = _mean_or_none(x[0]["optimal_probability"] for x in matched_rows)
            r_mean = _mean_or_none(x[1]["optimal_probability"] for x in matched_rows)
            if l_mean is not None and r_mean is not None:
                diffs.append(r_mean - l_mean)
                quality_pairs.append((instance_id, r_mean, l_mean))
            rt_a = _mean_or_none(x[0]["total_runtime_seconds"] for x in matched_rows)
            rt_b = _mean_or_none(x[1]["total_runtime_seconds"] for x in matched_rows)
            if rt_a is not None and rt_b is not None:
                runtime_diffs.append(rt_b - rt_a)
        n = len(diffs)
        sd = float(np.std(diffs, ddof=1)) if n > 1 else None
        cohens_dz = float(np.mean(diffs) / sd) if sd and sd > 0 else None
        ci_low, ci_high = paired_bootstrap_ci(diffs, seed=BOOTSTRAP_SEED + len(estimates))
        raw_p = None
        if n >= 6:
            try:
                raw_p = float(stats.wilcoxon(diffs, alternative="two-sided", method="auto").pvalue)
            except ValueError:
                raw_p = 1.0
        estimate = {
            "analysis_type": "paired_method_contrast", "source_phase": phase,
            "comparison_stratum": stratum, "comparison": label,
            "metric": "optimal_probability", "n_independent_instances": n,
            "n_matched_observations": len(pairs), "paired_mean_difference_b_minus_a": _mean_or_none(diffs),
            "paired_median_difference_b_minus_a": float(np.median(diffs)) if diffs else None,
            "cohens_dz": cohens_dz, "bootstrap_ci95_low": ci_low,
            "bootstrap_ci95_high": ci_high, "raw_p_value": raw_p,
            "holm_adjusted_p_value": None,
            "inference_status": "small-sample exploratory" if 0 < n < 10 else "paired inference available" if n >= 10 else "unavailable: fewer than 6 independent instances",
            "mean_runtime_difference_b_minus_a": _mean_or_none(runtime_diffs),
        }
        estimates.append(estimate)
        staged_p.append((estimate, raw_p))
    adjusted = holm_adjust([p for _, p in staged_p])
    for (estimate, _), p_adj in zip(staged_p, adjusted):
        estimate["holm_adjusted_p_value"] = p_adj
    return per_instance, estimates


def structural_correlations(rows: list[dict[str, Any]], features: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Exploratory instance-level associations on the 2.2.1 baseline only."""
    baseline = [r for r in rows if r["source_phase"] == "2.2.1" and r["experiment_stratum"] == "cross_instance" and r["initialization_seed"] == 42 and r["p"] == 2 and r["alpha"] == .05 and r["beta"] == .005]
    per_instance: dict[str, dict[str, Any]] = {}
    for row in baseline:
        per_instance.setdefault(row["instance_id"], row)
    predictors = (
        ("conflict_graph_density", "Conflict graph density"),
        ("candidate_count", "Candidate count"),
        ("scheduling_density", "Scheduling density"),
        ("feasible_assignment_count", "Feasible assignment count"),
        ("feasible_assignment_ratio", "Feasible assignments / 2^n"),
        ("priority_heterogeneity", "Normalized priority entropy"),
        ("mean_deadline_slack_minutes", "Mean deadline slack (minutes)"),
        ("zero_slack_deadline_fraction", "Fraction of zero-slack deadlines"),
        ("busy_period_count", "Busy-period count (availability-fragmentation proxy)"),
        ("busy_minutes_fraction", "Busy minutes / planning window"),
    )
    output = []
    for feature, label in predictors:
        pairs = [(float(r[feature]), float(r["optimal_probability"])) for r in per_instance.values() if r.get(feature) is not None and r.get("optimal_probability") is not None]
        if len(pairs) < 8:
            continue
        x, y = np.asarray(pairs).T
        if np.std(x) == 0 or np.std(y) == 0:
            continue
        pearson = stats.pearsonr(x, y)
        spearman = stats.spearmanr(x, y)
        rng = np.random.default_rng(BOOTSTRAP_SEED + len(output))
        boot = []
        for _ in range(BOOTSTRAP_REPLICATES):
            indices = rng.integers(0, len(x), len(x))
            if np.std(x[indices]) > 0 and np.std(y[indices]) > 0:
                boot.append(float(np.corrcoef(x[indices], y[indices])[0, 1]))
        ci_low, ci_high = (np.quantile(boot, [.025, .975]).tolist() if boot else (None, None))
        output.append({
            "analysis_type": "exploratory_structural_correlation", "feature": feature,
            "feature_label": label, "outcome": "optimal_probability",
            "n_independent_instances": len(pairs), "pearson_r": float(pearson.statistic),
            "pearson_ci95_low": float(ci_low) if ci_low is not None else None,
            "pearson_ci95_high": float(ci_high) if ci_high is not None else None,
            "pearson_raw_p": float(pearson.pvalue), "spearman_rho": float(spearman.statistic),
            "spearman_raw_p": float(spearman.pvalue),
            "model_scope": "unadjusted one-feature association; family/candidate-count confounding remains",
        })
    adjusted = holm_adjust([row["pearson_raw_p"] for row in output])
    for row, value in zip(output, adjusted):
        row["pearson_holm_adjusted_p"] = value
    return output


def mark_pareto_efficiency(rows: list[dict[str, Any]]) -> None:
    """Mark non-dominated quality-cost points only inside matched study cells."""
    cells: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        row["pareto_optimal_by_runtime"] = False
        row["pareto_optimal_by_evaluations"] = False
        if row["source_phase"] == "2.2.3" and row["experiment_stratum"] == "core_18_instances":
            cell = (row["source_phase"], row["experiment_stratum"], row["instance_id"], row["p"], row["initialization_seed"], row["optimization_budget"])
        elif row["source_phase"] == "2.2.2" and row["source_experiment_id"] == "matched_total_budget":
            cell = (row["source_phase"], row["experiment_stratum"], row["instance_id"], row["p"], row["initialization_seed"], row["optimization_budget"])
        else:
            continue
        cells[cell].append(row)
    for candidates in cells.values():
        for candidate in candidates:
            q = candidate.get("optimal_probability")
            rt = candidate.get("total_runtime_seconds")
            ev = candidate.get("objective_function_evaluations")
            if q is None:
                continue
            candidate["pareto_optimal_by_runtime"] = not any(
                other is not candidate and other.get("optimal_probability") is not None and other.get("total_runtime_seconds") is not None
                and other["optimal_probability"] >= q and other["total_runtime_seconds"] <= rt
                and (other["optimal_probability"] > q or other["total_runtime_seconds"] < rt)
                for other in candidates
            ) if rt is not None else False
            candidate["pareto_optimal_by_evaluations"] = not any(
                other is not candidate and other.get("optimal_probability") is not None and other.get("objective_function_evaluations") is not None
                and other["optimal_probability"] >= q and other["objective_function_evaluations"] <= ev
                and (other["optimal_probability"] > q or other["objective_function_evaluations"] < ev)
                for other in candidates
            ) if ev is not None else False


def sampling_calibration(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Bin predicted batch-hit probabilities against repeated-batch rates."""
    repeated = [r for r in rows if r["empirical_hit_rate"] is not None and r["sampling_batch_count"] and r["sampling_batch_count"] > 1 and r["theoretical_hit_probability"] is not None]
    edges = np.linspace(0, 1, 11)
    output = []
    for index in range(10):
        lo, hi = edges[index], edges[index + 1]
        subset = [r for r in repeated if lo <= r["theoretical_hit_probability"] <= hi and (index == 9 or r["theoretical_hit_probability"] < hi)]
        if not subset:
            continue
        predictions = [r["theoretical_hit_probability"] for r in subset]
        observed = [r["empirical_hit_rate"] for r in subset]
        output.append({
            "predicted_bin_low": float(lo), "predicted_bin_high": float(hi),
            "run_count": len(subset), "independent_batches_total": sum(int(r["sampling_batch_count"]) for r in subset),
            "mean_predicted_hit_probability": statistics.fmean(predictions),
            "mean_empirical_hit_rate": statistics.fmean(observed),
            "empirical_hit_rate_sd_across_runs": statistics.stdev(observed) if len(observed) > 1 else 0.0,
        })
    return output


def _write_csv(path: Path, rows: list[dict[str, Any]], fields: list[str] | None = None) -> None:
    if fields is None:
        fields = list(dict.fromkeys(field for row in rows for field in row)) or ["status"]
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: "" if row.get(key) is None else row.get(key) for key in fields})


def _source_manifest(sources: list[dict[str, Any]], exclusions: list[dict[str, Any]], mode: str) -> dict[str, Any]:
    datasets = []
    for source in sources:
        if not source.get("available"):
            datasets.append({"phase": source["phase"], "available": False, "directory": source["directory"], "missing": source.get("missing", [])})
            continue
        files = []
        for path in (source["runs_path"], source["config_path"], source.get("instance_manifest_path"), source.get("instances_path"), source["directory"] / "excluded_configurations.csv"):
            if path and path.exists():
                files.append({"path": str(path.relative_to(REPOSITORY_ROOT)), "sha256": _sha256(path), "bytes": path.stat().st_size})
        datasets.append({
            "phase": source["phase"], "available": True,
            "directory": str(source["directory"].relative_to(REPOSITORY_ROOT)),
            "config": source["config"], "runs_rows": len(source["rows"]),
            "runs_schema": source["headers"], "files": files,
        })
    try:
        revision = subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPOSITORY_ROOT, check=True, text=True, capture_output=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        revision = None
    return {
        "analysis_mode": mode, "created_utc": datetime.now().astimezone().isoformat(),
        "repository_revision": revision, "datasets": datasets,
        "excluded_record_count": len(exclusions), "excluded_records": exclusions,
        "important_note": "Source experiment outputs are read-only inputs; no solver was executed by this analysis.",
    }


def _figure_paths(rows: list[dict[str, Any]], features: dict[str, dict[str, Any]], paired: list[dict[str, Any]], calibration: list[dict[str, Any]], output: Path) -> list[str]:
    paths: list[str] = []
    phases = ["2.2.1", "2.2.2", "2.2.3"]
    palette = {"COBYLA": "#4477AA", "Powell": "#EE6677", "Nelder-Mead": "#228833", "SLSQP": "#CCBB44", "standard": "#4477AA", "multi_start": "#AA3377", "warm_start": "#66CCEE"}

    def save(fig: Any, filename: str) -> None:
        fig.tight_layout()
        fig.savefig(output / filename, dpi=150)
        plt.close(fig)
        paths.append(filename)

    def family_rows(phase: str) -> list[dict[str, Any]]:
        if phase == "2.2.1":
            return [r for r in rows if r["source_phase"] == phase and r["experiment_stratum"] == "cross_instance"]
        if phase == "2.2.2":
            return [r for r in rows if r["source_phase"] == phase and r["source_experiment_id"] == "cross_instance"]
        return [r for r in rows if r["source_phase"] == phase and r["experiment_stratum"] == "core_18_instances"]

    for metric, filename, title, ylabel in (
        ("optimal_probability", "family_optimal_probability.png", "Optimal probability by family and method", "Mean optimal probability"),
        ("feasible_probability", "family_feasible_probability.png", "Feasible probability by family and method", "Mean feasible probability"),
    ):
        fig, axes = plt.subplots(1, 3, figsize=(16, 5), sharey=True)
        for ax, phase in zip(axes, phases):
            subset = family_rows(phase)
            methods = sorted({r["strategy"] if phase == "2.2.2" else r["optimizer"] for r in subset})
            families = list("ABCDEF")
            width = .8 / max(len(methods), 1)
            for m_index, method in enumerate(methods):
                means, sds = [], []
                for family in families:
                    vals = [r[metric] for r in subset if r["family"] == family and (r["strategy"] if phase == "2.2.2" else r["optimizer"]) == method and r[metric] is not None]
                    means.append(statistics.fmean(vals) if vals else np.nan)
                    sds.append(statistics.stdev(vals) if len(vals) > 1 else 0.0 if vals else 0.0)
                positions = np.arange(len(families)) - .4 + width / 2 + m_index * width
                ax.bar(positions, means, width=width, yerr=sds, capsize=2, label=method, color=palette.get(method))
            ax.set_title(f"Phase {phase}")
            ax.set_xticks(range(len(families)), families)
            ax.set_xlabel("Scheduling family")
            ax.grid(axis="y", alpha=.2)
        axes[0].set_ylabel(ylabel)
        if axes[-1].get_legend_handles_labels()[0]:
            axes[-1].legend(fontsize=8, loc="best")
        fig.suptitle(title + " (phase-specific; no cross-phase pooling)")
        save(fig, filename)

    # Conditional optimality is summarized separately by phase and method.
    fig, ax = plt.subplots(figsize=(10, 5))
    groups = []
    for phase in phases:
        subset = [r for r in rows if r["source_phase"] == phase and r["conditional_optimal_probability"] is not None]
        if phase == "2.2.1":
            subset = [r for r in subset if r["experiment_stratum"] == "cross_instance"]
        elif phase == "2.2.2":
            subset = [r for r in subset if r["source_experiment_id"] == "cross_instance"]
        else:
            subset = [r for r in subset if r["experiment_stratum"] == "core_18_instances"]
        label_field = "strategy" if phase == "2.2.2" else "optimizer"
        methods = sorted({r[label_field] for r in subset})
        for method in methods:
            vals = [r["conditional_optimal_probability"] for r in subset if r[label_field] == method]
            groups.append((f"{phase}\n{method}", vals))
    if groups:
        ax.boxplot([v for _, v in groups], tick_labels=[k for k, _ in groups], showfliers=False)
    ax.set_ylim(0, 1.02)
    ax.set_ylabel("P(optimal | feasible)")
    ax.set_title("Conditional optimal probability, separated by phase")
    ax.tick_params(axis="x", labelrotation=45)
    ax.grid(axis="y", alpha=.2)
    save(fig, "conditional_optimal_probability.png")

    optimizer_pairs = [r for r in paired if r["source_phase"] == "2.2.3"]
    strategy_pairs = [r for r in paired if r["source_phase"] == "2.2.2"]
    comparison_groups = []
    for label in sorted({r["comparison"] for r in strategy_pairs + optimizer_pairs}):
        vals = [r["optimal_probability_difference_b_minus_a"] for r in strategy_pairs + optimizer_pairs if r["comparison"] == label and r["optimal_probability_difference_b_minus_a"] is not None]
        if vals:
            comparison_groups.append((label, vals))
    fig, ax = plt.subplots(figsize=(10, 5))
    if comparison_groups:
        ax.boxplot([v for _, v in comparison_groups], tick_labels=[label for label, _ in comparison_groups], showfliers=True)
    ax.axhline(0, color="black", linewidth=1)
    ax.set_ylabel("Paired Δ optimal probability (method B − A)")
    ax.set_title("Paired performance differences on compatible within-phase subsets")
    ax.tick_params(axis="x", labelrotation=25)
    ax.grid(axis="y", alpha=.2)
    save(fig, "paired_method_differences.png")

    fig, ax = plt.subplots(figsize=(8, 6))
    markers = {"2.2.1": "o", "2.2.2": "s", "2.2.3": "^"}
    for phase in phases:
        subset = [r for r in rows if r["source_phase"] == phase and r["objective_function_evaluations"] is not None]
        ax.scatter([r["objective_function_evaluations"] for r in subset], [r["optimal_probability"] for r in subset], label=f"Phase {phase}", alpha=.55, marker=markers[phase])
    ax.set_xlabel("Actual objective evaluations")
    ax.set_ylabel("Optimal probability")
    ax.set_title("Quality vs objective evaluations (phase settings differ)")
    ax.legend()
    ax.grid(alpha=.2)
    save(fig, "quality_vs_evaluations.png")

    fig, ax = plt.subplots(figsize=(8, 6))
    for phase in phases:
        subset = [r for r in rows if r["source_phase"] == phase and r["total_runtime_seconds"] is not None]
        ax.scatter([r["total_runtime_seconds"] for r in subset], [r["optimal_probability"] for r in subset], label=f"Phase {phase}", alpha=.55, marker=markers[phase])
    ax.set_xlabel("Recorded total runtime (seconds; definitions vary by phase)")
    ax.set_ylabel("Optimal probability")
    ax.set_title("Quality vs runtime (do not compare timing across phases)")
    ax.legend()
    ax.grid(alpha=.2)
    save(fig, "quality_vs_runtime.png")

    structural = [r for r in rows if r["source_phase"] == "2.2.1" and r["experiment_stratum"] == "cross_instance" and r["initialization_seed"] == 42 and r["p"] == 2]
    predictors = [
        ("conflict_graph_density", "Conflict density"), ("candidate_count", "Candidate count"),
        ("scheduling_density", "Scheduling density"), ("feasible_assignment_count", "Feasible assignment count"),
        ("feasible_assignment_ratio", "Feasible assignment ratio"), ("priority_heterogeneity", "Priority heterogeneity"),
        ("mean_deadline_slack_minutes", "Mean deadline slack"), ("zero_slack_deadline_fraction", "Zero-slack deadline fraction"),
        ("busy_period_count", "Busy-period count"), ("busy_minutes_fraction", "Busy minutes fraction"),
    ]
    fig, axes = plt.subplots(2, 5, figsize=(18, 8))
    for ax, (feature, label) in zip(axes.flat, predictors):
        points = [r for r in structural if r.get(feature) is not None]
        ax.scatter([r[feature] for r in points], [r["optimal_probability"] for r in points], alpha=.8)
        for r in points:
            ax.annotate(r["family"], (r[feature], r["optimal_probability"]), fontsize=7, alpha=.7)
        ax.set_xlabel(label)
        ax.set_ylabel("Optimal probability")
        ax.grid(alpha=.2)
    fig.suptitle("Exploratory structural associations (Phase 2.2.1 baseline, n≤18)")
    save(fig, "structural_predictors_vs_optimal_probability.png")

    fig, ax = plt.subplots(figsize=(7, 6))
    if calibration:
        x = [r["mean_predicted_hit_probability"] for r in calibration]
        y = [r["mean_empirical_hit_rate"] for r in calibration]
        sizes = [40 + 8 * r["run_count"] for r in calibration]
        ax.scatter(x, y, s=sizes)
        for r in calibration:
            ax.annotate(f"n={r['run_count']}", (r["mean_predicted_hit_probability"], r["mean_empirical_hit_rate"]), xytext=(3, 4), textcoords="offset points", fontsize=8)
    ax.plot([0, 1], [0, 1], "--", color="gray")
    ax.set_xlim(-.03, 1.03)
    ax.set_ylim(-.03, 1.03)
    ax.set_xlabel("Theoretical hit probability per 2048-shot batch")
    ax.set_ylabel("Observed hit fraction across independent batches")
    ax.set_title("Phase 2.2.3 repeated-batch sampling calibration")
    ax.grid(alpha=.2)
    save(fig, "predicted_vs_empirical_sampling_hit.png")
    return paths


def _fmt(value: Any, digits: int = 4) -> str:
    return "n/a" if value is None or value == "" else f"{float(value):.{digits}f}"


def _report(
    rows: list[dict[str, Any]], family_rows: list[dict[str, Any]], paired: list[dict[str, Any]],
    effects: list[dict[str, Any]], structural: list[dict[str, Any]], calibration: list[dict[str, Any]],
    assessment: list[dict[str, Any]], exclusions: list[dict[str, Any]], mode: str, figures: list[str],
) -> str:
    phase3 = [r for r in rows if r["source_phase"] == "2.2.3" and r["experiment_stratum"] == "core_18_instances"]
    family_winners = []
    for family in "ABCDEF":
        candidates = [r for r in family_rows if r.get("source_phase") == "2.2.3" and r.get("experiment_stratum") == "core_18_instances" and r.get("summary_level") == "family" and r.get("family") == family]
        candidates = [r for r in candidates if r.get("optimal_probability_mean") is not None]
        if candidates:
            best = max(candidates, key=lambda r: float(r["optimal_probability_mean"]))
            family_winners.append((family, best["optimizer"], best["optimal_probability_mean"]))
    sig = [r for r in effects if r.get("analysis_type") == "paired_method_contrast"]
    family_summary_index = {(r.get("source_phase"), r.get("experiment_stratum"), r.get("family"), r.get("strategy"), r.get("optimizer")): r for r in family_rows if r.get("summary_level") == "family"}
    p23_fam = [r for r in rows if r["source_phase"] == "2.2.3" and r["experiment_stratum"] == "core_18_instances"]
    feasible_conditional: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for row in p23_fam:
        if row["feasible_probability"] is not None and row["conditional_optimal_probability"] is not None:
            feasible_conditional[row["optimizer"]].append((row["feasible_probability"], row["conditional_optimal_probability"]))
    comparisons = {row["comparison"]: row for row in paired}
    contrast_findings = []
    for label, comparison in comparisons.items():
        dq = [r["optimal_probability_difference_b_minus_a"] for r in paired if r["comparison"] == label and r["optimal_probability_difference_b_minus_a"] is not None]
        df = [r["feasible_probability_difference_b_minus_a"] for r in paired if r["comparison"] == label and r["feasible_probability_difference_b_minus_a"] is not None]
        dc = [r["conditional_optimal_probability_difference_b_minus_a"] for r in paired if r["comparison"] == label and r["conditional_optimal_probability_difference_b_minus_a"] is not None]
        contrast_findings.append(f"- **{label}** (n={len(dq)} instances): ΔP(optimal)={_fmt(_mean_or_none(dq))}, ΔP(feasible)={_fmt(_mean_or_none(df))}, ΔP(optimal|feasible)={_fmt(_mean_or_none(dc))}.")
    best_by_family_text = "; ".join(f"{f}: {method} ({float(value):.3f})" for f, method, value in family_winners) or "not available in this analysis subset"
    winner_counts: dict[str, int] = defaultdict(int)
    for _, method, _ in family_winners:
        winner_counts[method] += 1
    winner_pattern = "the same optimizer leads in all observed families" if len(winner_counts) == 1 and family_winners else f"top methods vary across families ({dict(winner_counts)})" if winner_counts else "not enough data to assess"
    runtime_pareto = defaultdict(int)
    eval_pareto = defaultdict(int)
    for row in rows:
        if row.get("pareto_optimal_by_runtime"):
            runtime_pareto[f"Phase {row['source_phase']} {row['method_label']}"] += 1
        if row.get("pareto_optimal_by_evaluations"):
            eval_pareto[f"Phase {row['source_phase']} {row['method_label']}"] += 1
    calibration_n = sum(int(r["run_count"]) for r in calibration)
    calibration_mae = _mean_or_none(abs(r["mean_predicted_hit_probability"] - r["mean_empirical_hit_rate"]) for r in calibration)
    p3_hit_rows = [r for r in rows if r["source_phase"] == "2.2.3" and r["empirical_hit_rate"] is not None]
    mismatch = [abs(r["theoretical_hit_probability"] - r["empirical_hit_rate"]) for r in p3_hit_rows]
    q_f_groups: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for r in p23_fam:
        if r["feasible_probability"] is not None and r["conditional_optimal_probability"] is not None:
            q_f_groups[r["instance_id"]].append((r["feasible_probability"], r["conditional_optimal_probability"]))
    q_f = [(statistics.fmean(v[0] for v in vals), statistics.fmean(v[1] for v in vals)) for vals in q_f_groups.values()]
    r_feasible_conditional = float(np.corrcoef(np.asarray(q_f).T)[0, 1]) if len(q_f) > 2 and np.std(np.asarray(q_f)[:, 0]) and np.std(np.asarray(q_f)[:, 1]) else None
    rows_by_source = defaultdict(int)
    for row in rows:
        rows_by_source[row["source_phase"]] += 1
    lines = [
        "# Phase 2.2.4 — Cross-Instance Generalization & Statistical Robustness", "",
        f"Analysis mode: **{mode}**. Harmonized valid records: **{len(rows)}** (" + ", ".join(f"Phase {p}: {n}" for p, n in sorted(rows_by_source.items())) + ").", "",
        "## A. Implementation summary", "",
        "The analysis reads existing full-phase outputs only; it does not execute a solver or change production algorithms. It validates schemas and numeric ranges, creates composite provenance keys, flags duplicates and missing data, computes conditional optimality, independent-instance summaries, paired contrasts, Holm adjustments, bootstrap intervals, and sampling calibration.", "",
        "## B. Data integrity and compatibility", "",
        f"Source-designated exclusions, invalid records, and unavailable inputs: **{len(exclusions)}**. See `source_manifest.json` for paths, configs, SHA-256 hashes, schemas, and exclusion reasons. Missing cells are kept empty and never fabricated.", "",
        "| Comparison scope | Directly comparable | Shared instances | Decision |", "|---|---:|---:|---|",
    ]
    for item in assessment:
        lines.append(f"| {item['comparison_scope']} ({item['source_a']} vs {item['source_b']}) | {'yes' if item['directly_comparable'] else 'no'} | {item['shared_or_matched_instances']} | {item['decision_reason']} |")
    lines += ["", "Phase 2.2.2 strategy comparisons use its `matched_total` subset only. Phase 2.2.3 optimizer comparisons use its `core_18_instances` subset only. Cross-phase results are not pooled. Phase 2.2.1 and 2.2.2 hit columns represent one sampled batch per run; only Phase 2.2.3 has repeated independent batches and contributes to empirical calibration.", "",
        "## C. Statistical results", "",
        "Family and instance summaries are in `family_summary.csv`. Family means weight each instance equally; repeated seeds are first averaged within instance. The family table reports trial counts separately from independent instance counts.", "",
        "| Paired contrast | Independent instances | Mean Δ optimal probability | 95% cluster bootstrap CI | Cohen dz | Raw p | Holm p |", "|---|---:|---:|---:|---:|---:|---:|"]
    for effect in sig:
        ci = f"[{_fmt(effect.get('bootstrap_ci95_low'))}, {_fmt(effect.get('bootstrap_ci95_high'))}]" if effect.get("bootstrap_ci95_low") is not None else "n/a"
        lines.append(f"| {effect['comparison']} | {effect['n_independent_instances']} | {_fmt(effect.get('paired_mean_difference_b_minus_a'))} | {ci} | {_fmt(effect.get('cohens_dz'))} | {_fmt(effect.get('raw_p_value'))} | {_fmt(effect.get('holm_adjusted_p_value'))} |")
    lines += ["", "Differences use method B minus A. Bootstrap resampling uses independent instance IDs as clusters. Wilcoxon p-values are only computed with at least six independent instances; Holm correction is applied within the five pre-specified method contrasts. Confidence intervals and p-values are exploratory at these small sample sizes; significance is not treated as practical superiority.", "",
        "### Paired differences in feasibility and conditional optimality", ""] + contrast_findings + ["",
        "## D. Generalization findings across six families", "",
        f"For the Phase 2.2.3 core optimizer matrix, family-level highest mean optimal-probability methods were: {best_by_family_text}.",
        f"Observed top-method pattern: {winner_pattern}. Each family contains only three deterministic instances and the core optimizer matrix uses one initialization seed; these are structure-specific descriptive results, not population-level rankings.", "",
        f"RQ1 — **Cross-instance generalization:** family winners are shown above; {winner_pattern}. These data do not establish a stable population ranking.",
        "RQ2 — **Statistical robustness:** see paired estimates and instance-cluster bootstrap intervals. The 2.2.3 optimizer contrasts have up to 18 independent instances; strategy contrasts have six. Treat all intervals as uncertain, especially the six-instance contrasts.",
        f"RQ3 — **Feasibility–optimality tradeoff:** instance-averaged correlation across the 18 Phase 2.2.3 core instances between feasible probability and conditional optimal probability is {_fmt(r_feasible_conditional)}. Paired changes in P(feasible), P(optimal), and P(optimal|feasible) are shown above; these metrics are distinct and zero-feasibility cases have conditional probability recorded as missing.",
        "RQ4 — **Computational efficiency:** use the quality-vs-evaluations and quality-vs-runtime figures within their phase strata. Pareto counts below are computed only inside matched Phase 2.2.2 matched-total cells and Phase 2.2.3 core cells; runtime is not compared across phases.",
        f"- Runtime Pareto-efficient run counts: {dict(runtime_pareto) or 'none identified'}.",
        f"- Evaluation-count Pareto-efficient run counts: {dict(eval_pareto) or 'none identified'}.",
        "Classical preprocessing time is separately available for warm-start; QAOA statevector time and sampling overhead are not isolated consistently, so those costs cannot be compared independently.", "",
        "### RQ5 — Structural predictors (exploratory)", "",
        "Associations use the Phase 2.2.1 baseline (at most 18 independent instances), with unadjusted one-feature correlations. Family and candidate count can confound these associations; no causal or validated prediction claim is made.", "",
        "| Feature | n | Pearson r (95% bootstrap CI) | Spearman ρ | Holm-adjusted Pearson p |", "|---|---:|---:|---:|---:|"]
    for item in structural:
        ci = f"[{_fmt(item.get('pearson_ci95_low'))}, {_fmt(item.get('pearson_ci95_high'))}]"
        lines.append(f"| {item['feature_label']} | {item['n_independent_instances']} | {_fmt(item['pearson_r'])} {ci} | {_fmt(item['spearman_rho'])} | {_fmt(item.get('pearson_holm_adjusted_p'))} |")
    lines += ["", "RQ6 — **Strategy selection:** the data support no automatic selector or firm family-specific recommendation. Matched-total strategy comparisons have only six instances, and restart, initialization, and optimizer effects are not factorial. More instances and multiple seeds per family are needed.", "",
        "## E. Sampling analysis", "",
        f"Repeated-batch calibration uses {len(p3_hit_rows)} Phase 2.2.3 runs and {calibration_n} run-level batch estimates. Mean absolute difference between theoretical and empirical batch hit rates across runs is {_fmt(_mean_or_none(mismatch))}. Calibration bins and their run counts are in `sampling_calibration.csv`; each plotted marker is annotated with its bin count.",
        "High shot counts can saturate batch hit probability: a small single-shot optimum mass may still produce near-certain success in a 2048-shot batch. Thus the batch-hit probability is not the same as the single-shot optimal probability. One 2048-shot outcome from Phases 2.2.1/2.2.2 is not used as an empirical rate.",
        "RQ7 — **Sampling reliability:** the comparison of theoretical and observed repeated-batch hit rates appears in `sampling_calibration.csv` and the calibration figure; only 2.2.3 supplies repeated batches.", "",
        "## Figures", ""] + [f"- `{filename}`" for filename in figures] + ["",
        "## Limitations", "",
        "The data cover 18 deterministic synthetic instances, at most three per family; seed repetitions are correlated within the same problem instance. Results use ideal noiseless statevector simulation. Objective budgets differ between phases and exact-output selection semantics differ, so cross-phase pooling is invalid. Runtime is machine- and version-dependent, and timing boundaries differ. Compactness is a scheduling proxy. No quantum computational advantage is claimed.", "",
        "## H. Recommendations", "",
        "Use matched within-phase evidence to guide follow-up tests, not production strategy selection. Preserve all four optimizer options for now; run additional independent instances and paired seeds per family before recommending a family-specific optimizer. Compare warm-start only under a shared total-evaluation cap and include its preprocessing cost. Keep both feasible and conditional-optimal metrics when assessing scheduling quality.", "",
        "## I. Completion decision", "",
        f"**{'PASS' if len(rows) > 0 and len(figures) >= 8 and not any('unavailable' in str(s.get('decision_reason','')) for s in assessment) else 'PARTIAL PASS'}** — existing datasets were loaded, validated, retained in phase-specific strata, and analyzed with cluster-aware summaries and reproduced artifacts. Cross-phase non-pooling is intentional. Tests and command execution status are recorded in the task completion message.", ""]
    return "\n".join(lines)


def run_analysis(mode: str = "quick", output: str | Path | None = None) -> dict[str, Any]:
    if mode not in {"quick", "full"}:
        raise ValueError("mode must be quick or full")
    sources = load_sources()
    rows, exclusions, features = _harmonize(sources, mode)
    assessment = compatibility_assessment(sources, rows)
    family_rows = family_summaries(rows)
    paired, paired_effects = paired_analysis(rows)
    structural = structural_correlations(rows, features)
    effects = paired_effects + structural
    mark_pareto_efficiency(rows)
    calibration = sampling_calibration(rows)
    output_dir = Path(output) if output else OUTPUT_ROOT / f"phase2_2_4_{mode}"
    if not output_dir.is_absolute():
        output_dir = REPOSITORY_ROOT / output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    _write_csv(output_dir / "harmonized_runs.csv", rows, HARMONIZED_FIELDS)
    _write_csv(output_dir / "comparability_report.csv", assessment)
    _write_csv(output_dir / "family_summary.csv", family_rows)
    _write_csv(output_dir / "paired_comparisons.csv", paired)
    _write_csv(output_dir / "effect_sizes.csv", effects)
    _write_csv(output_dir / "sampling_calibration.csv", calibration, [
        "predicted_bin_low", "predicted_bin_high", "run_count", "independent_batches_total",
        "mean_predicted_hit_probability", "mean_empirical_hit_rate", "empirical_hit_rate_sd_across_runs",
    ])
    manifest = _source_manifest(sources, exclusions, mode)
    manifest["harmonized_missing_field_counts"] = {
        field: sum(row.get(field) is None or row.get(field) == "" for row in rows)
        for field in HARMONIZED_FIELDS
        if any(row.get(field) is None or row.get(field) == "" for row in rows)
    }
    (output_dir / "source_manifest.json").write_text(json.dumps(manifest, indent=2, default=str) + "\n", encoding="utf-8")
    analysis_config = {
        "phase": "2.2.4", "mode": mode, "created_utc": datetime.now().astimezone().isoformat(),
        "source_phases": [s["phase"] for s in sources if s.get("available")],
        "quick_instance_ids": ["A2-n5", "B2-n9", "C2-n5", "D2-n9", "E2-n5", "F2-n5"],
        "harmonized_records": len(rows), "excluded_records": len(exclusions),
        "bootstrap_replicates": BOOTSTRAP_REPLICATES, "bootstrap_seed": BOOTSTRAP_SEED,
        "holm_correction": "Holm step-down, separately within pre-specified paired contrasts and structural-correlation families",
        "versions": {"python": sys.version, "platform": platform.platform(), "numpy": np.__version__, "scipy": scipy.__version__, "matplotlib": matplotlib.__version__},
        "solver_execution": False, "cross_phase_pooling": False,
    }
    (output_dir / "config.json").write_text(json.dumps(analysis_config, indent=2, default=str) + "\n", encoding="utf-8")
    figures = _figure_paths(rows, features, paired, calibration, output_dir)
    report = _report(rows, family_rows, paired, effects, structural, calibration, assessment, exclusions, mode, figures)
    (output_dir / "report.md").write_text(report, encoding="utf-8")
    return {"mode": mode, "output": str(output_dir), "harmonized_records": len(rows), "excluded_records": len(exclusions), "paired_comparisons": len(paired), "effect_estimates": len(effects), "sampling_calibration_bins": len(calibration), "figures": figures}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("quick", "full"), default="quick")
    parser.add_argument("--output", default=None)
    args = parser.parse_args()
    print(json.dumps(run_analysis(args.mode, args.output), indent=2))


if __name__ == "__main__":
    main()

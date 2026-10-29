"""Phase 2.2.2: multi-start and warm-start QAOA benchmark.

Experiment plans are explicit and bounded. The primary full matrix compares
all 18 Phase 2.2.1 instances at p=2, seed 42 and equal 25-evaluation caps per
restart. A six-instance subset uses a matched 75-evaluation cap for Standard
and Warm-Start versus three 25-cap Multi-Start restarts. Dense instance B2
also receives p=1/2/3, seeds 42--51, and K=1/3/5/10 sweeps. Actual optimizer
function evaluations and elapsed time are recorded because COBYLA may stop
before its configured cap.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import platform
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import qiskit
import scipy

from benchmark_instances import DEFAULT_ALPHA, DEFAULT_BETA, build_benchmark_instances
from compactness_benchmark import analyze_probability_distribution
from compactness_qubo import build_compactness_qubo, solve_compactness_exact
from qaoa_initialization import relaxation_solution, run_strategy
from schedule_metrics import evaluate_schedule
from qubo_model import qubo_cost


ROOT = Path(__file__).resolve().parent
TOLERANCE = 1e-8
SHOTS = 2048
RESTARTS = 3
RUN_COLUMNS = [
    "experiment_id", "budget_mode", "instance_id", "family", "candidate_count",
    "strategy", "restart_count", "p", "seed", "alpha", "beta",
    "classical_optimal_cost", "optimized_expected_cost", "best_feasible_sampled_cost",
    "optimality_gap", "feasible_probability", "optimal_probability", "exact_optimum_hit",
    "priority_satisfaction", "internal_gap_minutes", "compactness",
    "optimizer_function_evaluations", "warm_start_preprocessing_seconds",
    "warm_start_relaxation_function_evaluations", "warm_start_relaxation_success",
    "warm_start_relaxation_fallback", "warm_start_boundary_clipped_count",
    "warm_start_probabilities",
    "optimization_runtime_seconds", "total_runtime_seconds", "circuit_depth",
    "optimization_success", "fallback_used", "restart_details",
]
EXCLUDED_COLUMNS = [
    "experiment_id", "budget_mode", "instance_id", "family", "candidate_count",
    "strategy", "restart_count", "p", "seed", "alpha", "beta", "maxiter_per_restart", "reason",
]


def experiment_matrix(mode: str, instances: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Return the exact bounded experiment matrix for quick/full execution."""
    if mode not in {"quick", "full"}:
        raise ValueError("mode must be quick or full")
    by_id = {item["instance_id"]: item for item in instances}
    if mode == "quick":
        core_ids = ["A2-n5", "B1-n5", "B2-n9", "C2-n5", "D2-n9", "E2-n5", "F1-n3"]
        matched_ids = ["B2-n9"]
        depth_values = [1, 3]
        seeds = [43]
        restart_counts = [1, 3, 5]
        per_restart, matched_total = 25, 75
    else:
        core_ids = [item["instance_id"] for item in instances]
        matched_ids = ["A2-n5", "B2-n9", "C2-n5", "D2-n9", "E2-n5", "F2-n5"]
        depth_values = [1, 2, 3]
        seeds = list(range(42, 52))
        restart_counts = [1, 3, 5, 10]
        per_restart, matched_total = 25, 75
    plans: list[dict[str, Any]] = []

    def add(experiment: str, instance_id: str, strategy: str, *, p: int = 2,
            seed: int = 42, budget_mode: str = "fixed_per_restart",
            maxiter: int = per_restart, restarts: int = 1) -> None:
        plans.append({
            "experiment_id": experiment, "budget_mode": budget_mode,
            "instance": by_id[instance_id], "strategy": strategy,
            "p": p, "seed": seed, "maxiter_per_restart": maxiter,
            "restart_count": restarts,
        })

    for instance_id in core_ids:
        add("cross_instance", instance_id, "standard")
        add("cross_instance", instance_id, "multi_start", restarts=RESTARTS)
        add("cross_instance", instance_id, "warm_start")
    for instance_id in matched_ids:
        add("matched_total_budget", instance_id, "standard", budget_mode="matched_total", maxiter=matched_total)
        add("matched_total_budget", instance_id, "multi_start", budget_mode="matched_total", restarts=RESTARTS)
        add("matched_total_budget", instance_id, "warm_start", budget_mode="matched_total", maxiter=matched_total)
    for p in depth_values:
        if mode == "quick" and p == 2:
            continue  # p=2 is already in the cross-instance core.
        for strategy in ("standard", "multi_start", "warm_start"):
            add("depth_sensitivity", "B2-n9", strategy, p=p,
                restarts=RESTARTS if strategy == "multi_start" else 1)
    for seed in seeds:
        if mode == "quick" and seed == 42:
            continue
        for strategy in ("standard", "multi_start", "warm_start"):
            add("seed_robustness", "B2-n9", strategy, seed=seed,
                restarts=RESTARTS if strategy == "multi_start" else 1)
    for count in restart_counts:
        add("restart_scaling", "B2-n9", "multi_start", restarts=count)
    return plans, {
        "mode": mode, "alpha": DEFAULT_ALPHA, "beta": DEFAULT_BETA,
        "shots": SHOTS, "per_restart_maxiter": per_restart,
        "matched_total_maxiter": matched_total, "primary_p": 2,
        "primary_seed": 42, "restart_counts": restart_counts,
        "depth_values": [1, 2, 3], "robustness_seeds": seeds,
        "quick_instance_ids": core_ids,
        "matched_budget_instance_ids": matched_ids,
        "selection_rule": "minimum optimized expected QUBO cost; exact optimum is used only after optimization for evaluation",
    }


def _prepare_instance(instance: dict[str, Any]) -> dict[str, Any]:
    request = instance["request"]
    model = build_compactness_qubo(
        instance["candidates"], request["windowStart"], request["windowEnd"],
        alpha=DEFAULT_ALPHA, beta=DEFAULT_BETA,
    )
    exact = solve_compactness_exact(
        instance["candidates"], request["windowStart"], request["windowEnd"],
        alpha=DEFAULT_ALPHA, beta=DEFAULT_BETA, max_variables=12,
    )
    if not np.allclose(model["Q"], exact["model"]["Q"], rtol=1e-10, atol=1e-10):
        raise AssertionError("exact and QAOA objectives must use identical QUBO matrices")
    return {"model": model, "exact": exact}


def _run_one(plan: dict[str, Any], prepared: dict[str, Any], shots: int) -> dict[str, Any]:
    instance = plan["instance"]
    request = instance["request"]
    model = prepared["model"]
    exact = prepared["exact"]
    strategy = plan["strategy"]
    preprocessing_seconds = 0.0
    relaxation = None
    started = __import__("time").perf_counter()
    if strategy == "warm_start":
        relaxation = relaxation_solution(model["Q"])
        preprocessing_seconds = relaxation["preprocessing_seconds"]
    result = run_strategy(
        strategy, model["Q"], instance["candidates"], model["conflicts"],
        p=plan["p"], maxiter=plan["maxiter_per_restart"], shots=shots,
        seed=plan["seed"], restart_count=plan["restart_count"],
        warm_probabilities=relaxation["probabilities"] if relaxation else None,
    )
    # Exact optimum is consulted only after all initialization, optimization,
    # and restart selection have completed.
    distribution = analyze_probability_distribution(
        result["probabilities"], model["Q"], model["conflicts"], instance["candidates"],
        exact["cost"], request["windowStart"], request["windowEnd"],
    )
    best = result["best"]
    metrics = evaluate_schedule(
        best["assignment"], instance["candidates"], model["conflicts"],
        request["windowStart"], request["windowEnd"],
    )
    restart_details = []
    for restart in result["restart_details"]:
        details = {key: value for key, value in restart.items() if not key.startswith("_")}
        restart_details.append(details)
    total_runtime = __import__("time").perf_counter() - started
    optimality_gap = max(0.0, float(best["cost"]) - float(exact["cost"]))
    return {
        "experiment_id": plan["experiment_id"], "budget_mode": plan["budget_mode"],
        "instance_id": instance["instance_id"], "family": instance["family"],
        "candidate_count": instance["candidate_count"], "strategy": strategy,
        "restart_count": result["restart_count"], "p": plan["p"], "seed": plan["seed"],
        "alpha": DEFAULT_ALPHA, "beta": DEFAULT_BETA,
        "classical_optimal_cost": float(exact["cost"]),
        "optimized_expected_cost": float(result["expected_cost"]),
        "best_feasible_sampled_cost": float(best["cost"]),
        "optimality_gap": optimality_gap,
        "feasible_probability": distribution["feasible_probability"],
        "optimal_probability": distribution["optimal_probability"],
        "exact_optimum_hit": bool(optimality_gap <= TOLERANCE),
        "priority_satisfaction": float(metrics["prioritySatisfaction"]),
        "internal_gap_minutes": float(metrics["internalGapMinutes"]),
        "compactness": float(metrics["compactness"]),
        "optimizer_function_evaluations": int(result["function_evaluations"]),
        "warm_start_preprocessing_seconds": float(preprocessing_seconds),
        "warm_start_relaxation_function_evaluations": int(relaxation["function_evaluations"]) if relaxation else 0,
        "warm_start_relaxation_success": bool(relaxation["success"]) if relaxation else None,
        "warm_start_relaxation_fallback": bool(relaxation["fallback_used"]) if relaxation else False,
        "warm_start_boundary_clipped_count": int(relaxation["boundary_clipped_count"]) if relaxation else 0,
        "warm_start_probabilities": json.dumps([float(v) for v in relaxation["probabilities"]]) if relaxation else "",
        "optimization_runtime_seconds": float(result["optimization_runtime_seconds"]),
        "total_runtime_seconds": float(total_runtime),
        "circuit_depth": int(result["circuit"].depth()),
        "optimization_success": bool(result["optimization_success"]),
        "fallback_used": bool(result["fallback_used"] or (relaxation and relaxation["fallback_used"])),
        "restart_details": json.dumps(restart_details, sort_keys=True),
        "_restart_probabilities": [row.get("_probabilities") for row in result["restart_details"]],
        "_restart_exact": float(exact["cost"]),
        "_conflicts": model["conflicts"], "_candidates": instance["candidates"],
        "_window_start": request["windowStart"], "_window_end": request["windowEnd"], "_Q": model["Q"],
        "_relaxation": relaxation,
    }


def _finalize_restart_details(row: dict[str, Any]) -> None:
    details = json.loads(row["restart_details"])
    for index, probabilities in enumerate(row.pop("_restart_probabilities")):
        if probabilities is None:
            continue
        metrics = analyze_probability_distribution(
            probabilities, row["_Q"], row["_conflicts"], row["_candidates"],
            row["_restart_exact"], row["_window_start"], row["_window_end"],
        )
        if index < len(details):
            details[index]["feasible_probability"] = metrics["feasible_probability"]
            details[index]["optimal_probability"] = metrics["optimal_probability"]
    row["restart_details"] = json.dumps(details, sort_keys=True)
    for key in tuple(row):
        if key.startswith("_"):
            row.pop(key)


def summarize(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    keys = ("experiment_id", "budget_mode", "family", "strategy", "restart_count", "p")
    for row in rows:
        groups[tuple(row[key] for key in keys)].append(row)
    summary = []
    metrics = (
        "optimal_probability", "feasible_probability", "optimality_gap",
        "optimizer_function_evaluations", "warm_start_preprocessing_seconds",
        "optimization_runtime_seconds", "total_runtime_seconds", "internal_gap_minutes",
    )
    for group, trials in sorted(groups.items(), key=lambda item: str(item[0])):
        item = dict(zip(keys, group))
        for metric in metrics:
            values = np.asarray([float(row[metric]) for row in trials])
            item.update({
                f"{metric}_mean": float(values.mean()),
                f"{metric}_std": float(values.std(ddof=1)) if len(values) > 1 else None,
                f"{metric}_median": float(np.median(values)),
                f"{metric}_min": float(values.min()),
                f"{metric}_max": float(values.max()),
            })
        item["trial_count"] = len(trials)
        item["exact_optimum_hit_rate"] = float(np.mean([row["exact_optimum_hit"] for row in trials]))
        item["instance_count"] = len({row["instance_id"] for row in trials})
        item["seed_min"] = min(row["seed"] for row in trials)
        item["seed_max"] = max(row["seed"] for row in trials)
        summary.append(item)
    return summary


def _write_csv(path: Path, rows: list[dict[str, Any]], columns: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore", lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def make_plots(rows: list[dict[str, Any]], output: Path) -> list[str]:
    figures = []
    definitions = [
        ("optimal_probability", "Ideal optimal probability", "strategy_vs_optimal_probability.png"),
        ("feasible_probability", "Ideal feasible probability", "strategy_vs_feasible_probability.png"),
        ("optimality_gap", "Sampled optimality gap", "strategy_vs_optimality_gap.png"),
    ]
    core = [row for row in rows if row["experiment_id"] == "cross_instance"]
    labels = ("standard", "multi_start", "warm_start")
    for field, ylabel, name in definitions:
        fig, ax = plt.subplots(figsize=(8, 4.8))
        for strategy in labels:
            selected = [row for row in core if row["strategy"] == strategy]
            values = [float(row[field]) for row in selected]
            ax.scatter([strategy] * len(values), values, alpha=0.65, label=f"{strategy} (n={len(values)})")
            if values:
                ax.plot([strategy], [np.mean(values)], marker="D", color="black", markersize=7)
        ax.set_ylabel(ylabel)
        ax.set_title(f"Initialization strategy vs. {ylabel.lower()} (fixed per-restart budget)")
        ax.grid(axis="y", alpha=0.3)
        ax.legend()
        fig.tight_layout()
        fig.savefig(output / name, dpi=160)
        plt.close(fig)
        figures.append(name)
    fig, ax = plt.subplots(figsize=(7.5, 4.8))
    for strategy in labels:
        selected = [row for row in rows if row["experiment_id"] == "cross_instance" and row["strategy"] == strategy]
        ax.scatter([r["optimizer_function_evaluations"] for r in selected],
                   [r["optimal_probability"] for r in selected], label=strategy, alpha=0.7)
    ax.set_xlabel("Actual total objective evaluations")
    ax.set_ylabel("Ideal optimal probability")
    ax.set_title("Optimization evaluations vs. optimal probability")
    ax.grid(alpha=0.3); ax.legend(); fig.tight_layout()
    name = "evaluations_vs_optimal_probability.png"; fig.savefig(output / name, dpi=160); plt.close(fig); figures.append(name)
    fig, ax = plt.subplots(figsize=(7.5, 4.8))
    for strategy in labels:
        selected = [row for row in rows if row["experiment_id"] == "cross_instance" and row["strategy"] == strategy]
        hit_rates = [float(r["exact_optimum_hit"]) for r in selected]
        ax.scatter([r["total_runtime_seconds"] for r in selected], hit_rates, label=strategy, alpha=0.7)
    ax.set_xlabel("Total runtime (seconds, includes warm-start preprocessing)")
    ax.set_ylabel("Finite-shot exact-optimum hit (0/1)")
    ax.set_title("Runtime vs. finite-shot exact-optimum hit")
    ax.grid(alpha=0.3); ax.legend(); fig.tight_layout()
    name = "runtime_vs_exact_hit.png"; fig.savefig(output / name, dpi=160); plt.close(fig); figures.append(name)
    fig, ax = plt.subplots(figsize=(8, 4.8))
    dense = [row for row in rows if row["family"] == "B" and row["experiment_id"] == "cross_instance"]
    for strategy in labels:
        selected = [row for row in dense if row["strategy"] == strategy]
        ax.scatter([row["instance_id"] for row in selected], [row["optimal_probability"] for row in selected], label=strategy)
    ax.set_ylabel("Ideal optimal probability"); ax.set_title("Dense-conflict Family B comparison")
    ax.grid(axis="y", alpha=0.3); ax.legend(); fig.tight_layout()
    name = "dense_conflict_strategy_comparison.png"; fig.savefig(output / name, dpi=160); plt.close(fig); figures.append(name)
    return figures


def _mean_std(values: list[float]) -> tuple[float, float]:
    return (float(np.mean(values)), float(np.std(values, ddof=1)) if len(values) > 1 else float("nan"))


def render_report(rows: list[dict[str, Any]], excluded: list[dict[str, Any]], settings: dict[str, Any], figures: list[str]) -> str:
    core = [row for row in rows if row["experiment_id"] == "cross_instance"]
    lines = [
        "# Phase 2.2.2 — Multi-Start QAOA & Warm-Start Optimization", "",
        f"Mode: **{settings['mode']}** · Planned runs: **{settings['planned_runs']}** · Executed: **{len(rows)}** · Excluded/errors: **{len(excluded)}**", "",
        "## Solver interface and algorithm definitions", "",
        "Standard and Multi-Start call the existing `general_qaoa.solve_qaoa_from_matrix(Q, candidates, conflicts, p, maxiter, shots, seed)`. It converts the symmetric QUBO with `qubo_to_ising`, starts in uniform superposition, initializes gamma uniformly in [0,π] and beta in [0,π/2], optimizes expected `xᵀQx` with SciPy COBYLA, and returns the statevector distribution plus actual `nfev`. The baseline algorithm was not changed.", "",
        "Warm-Start minimizes the same continuous `xᵀQx` relaxation over [0,1]^n using bounded L-BFGS-B, clips boundary values to [0.02,0.98], and prepares ⊗(√(1−cᵢ)|0⟩+√cᵢ|1⟩). Its mixer is `Σᵢ[2√(cᵢ(1−cᵢ))Xᵢ+(1−2cᵢ)Zᵢ]`; each prepared qubit is a +1 eigenstate, and cᵢ=0.5 reduces to the standard X mixer. It can move among bitstrings and does not preserve scheduling feasibility. Failed relaxations fall back explicitly to cᵢ=0.5. The exact optimum is not passed into the relaxation, initialization, optimizer, or restart selector.", "",
        "Multi-Start selects the restart with minimum full-statevector expected QUBO cost. Best feasible sampled cost is reported after selection; it does not select restarts. Initial/final parameters and every restart's probabilities, evaluations and runtime are serialized in `restart_details`.", "",
        "## Experiment matrix and budget policy", "",
        f"Primary fixed per-restart matrix: {len(core)} rows over {len({r['instance_id'] for r in core})} instances, p=2, seed=42; Standard and Warm-Start cap={settings['per_restart_maxiter']} objective evaluations, Multi-Start K=3 with that cap per restart. Matched-total subset: {len(settings['matched_budget_instance_ids'])} representative instances, Standard/Warm-Start cap={settings['matched_total_maxiter']}, Multi-Start K=3×{settings['per_restart_maxiter']}. Family B2 adds p=1/2/3, seeds {min(settings['robustness_seeds'])}–{max(settings['robustness_seeds'])}, and K={','.join(map(str, settings['restart_counts']))}. Actual `nfev` is measured; caps do not imply exact equality. Quick matrix is a family-representative subset. Full matrix covers all 18 instances.", "",
        f"Objective parameters: α={DEFAULT_ALPHA}, β={DEFAULT_BETA}; shots={settings['shots']}. Python {platform.python_version()}, NumPy {np.__version__}, SciPy {scipy.__version__}, Qiskit {qiskit.__version__}. Ideal probabilities use the full noiseless statevector. Equivalent exact optima are summed with absolute cost tolerance {TOLERANCE:g}; `exact_optimum_hit` is the finite-shot best feasible sampled cost matching the exact cost.", "",
        "## Core fixed-budget results", "",
        "| Strategy | Optimal probability mean ± SD | Feasible probability mean ± SD | Sampled gap mean ± SD | Exact-hit rate | Mean actual evaluations | Mean optimization (s) | Mean preprocessing (s) | Mean total runtime (s) | Trials |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for strategy in ("standard", "multi_start", "warm_start"):
        selected = [r for r in core if r["strategy"] == strategy]
        op, ops = _mean_std([float(r["optimal_probability"]) for r in selected])
        fp, fps = _mean_std([float(r["feasible_probability"]) for r in selected])
        gap, gaps = _mean_std([float(r["optimality_gap"]) for r in selected])
        ev = float(np.mean([r["optimizer_function_evaluations"] for r in selected]))
        opt_runtime = float(np.mean([r["optimization_runtime_seconds"] for r in selected]))
        prep_runtime = float(np.mean([r["warm_start_preprocessing_seconds"] for r in selected]))
        runtime = float(np.mean([r["total_runtime_seconds"] for r in selected]))
        hit = float(np.mean([r["exact_optimum_hit"] for r in selected]))
        lines.append(f"| {strategy} | {op:.4f} ± {ops:.4f} | {fp:.4f} ± {fps:.4f} | {gap:.4f} ± {gaps:.4f} | {hit:.1%} | {ev:.1f} | {opt_runtime:.4f} | {prep_runtime:.6f} | {runtime:.4f} | {len(selected)} |")
    lines += ["", "## Cross-family generalization", "", "| Family | Strategy | Optimal probability mean ± SD | Feasible probability mean ± SD | Median optimality gap [min, max] | Exact-hit rate | n |", "|---|---|---:|---:|---:|---:|---:|"]
    for family in sorted({row["family"] for row in core}):
        for strategy in ("standard", "multi_start", "warm_start"):
            selected = [row for row in core if row["family"] == family and row["strategy"] == strategy]
            op, ops = _mean_std([float(row["optimal_probability"]) for row in selected])
            fp, fps = _mean_std([float(row["feasible_probability"]) for row in selected])
            ops_text = f"{ops:.4f}" if math.isfinite(ops) else "—"
            fps_text = f"{fps:.4f}" if math.isfinite(fps) else "—"
            gaps = [float(row["optimality_gap"]) for row in selected]
            hit = float(np.mean([row["exact_optimum_hit"] for row in selected]))
            lines.append(f"| {family} | {strategy} | {op:.4f} ± {ops_text} | {fp:.4f} ± {fps_text} | {np.median(gaps):.4f} [{min(gaps):.4f}, {max(gaps):.4f}] | {hit:.1%} | {len(selected)} |")
    lines += ["", "## Matched-total budget", "", "| Family | Strategy | Actual evaluations | Ideal optimal probability | Exact-hit | Total runtime (s) | n |", "|---|---|---:|---:|---:|---:|---:|"]
    for row in rows:
        if row["experiment_id"] != "matched_total_budget":
            continue
        lines.append(f"| {row['family']} {row['instance_id']} | {row['strategy']} K={row['restart_count']} | {row['optimizer_function_evaluations']} | {row['optimal_probability']:.4f} | {int(row['exact_optimum_hit'])} | {row['total_runtime_seconds']:.4f} | 1 |")
    lines += ["", "## Depth, seed, and restart sensitivity on B2", "", "| Experiment | Strategy | p | K | Seeds / trials | Optimal probability mean ± SD | Gap median [min, max] | Hit rate |", "|---|---|---:|---:|---:|---:|---:|---:|"]
    sweeps = [row for row in rows if row["experiment_id"] in {"depth_sensitivity", "seed_robustness", "restart_scaling"}]
    sweep_groups: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    for row in sweeps:
        keys = (row["experiment_id"], row["strategy"], row["p"], row["restart_count"])
        sweep_groups[keys].append(row)
    for (experiment, strategy, p, k), selected in sorted(sweep_groups.items(), key=lambda item: str(item[0])):
        values = [float(row["optimal_probability"]) for row in selected]
        gaps = [float(row["optimality_gap"]) for row in selected]
        mean, sd = _mean_std(values)
        sd_text = f"{sd:.4f}" if math.isfinite(sd) else "—"
        seeds = sorted({int(row["seed"]) for row in selected})
        seed_text = f"{seeds[0]}–{seeds[-1]} / {len(selected)}" if len(seeds) > 1 else f"{seeds[0]} / {len(selected)}"
        lines.append(f"| {experiment} | {strategy} | {p} | {k} | {seed_text} | {mean:.4f} ± {sd_text} | {np.median(gaps):.4f} [{min(gaps):.4f}, {max(gaps):.4f}] | {np.mean([row['exact_optimum_hit'] for row in selected]):.1%} |")
    b_rows = [r for r in core if r["family"] == "B"]
    lines += ["", "## Family B dense-conflict comparison", "", "| Instance | Strategy | Optimal probability | Feasible probability | Gap | Hit | Evaluations |", "|---|---|---:|---:|---:|---:|---:|"]
    for row in b_rows:
        lines.append(f"| {row['instance_id']} | {row['strategy']} | {row['optimal_probability']:.4f} | {row['feasible_probability']:.4f} | {row['optimality_gap']:.4f} | {int(row['exact_optimum_hit'])} | {row['optimizer_function_evaluations']} |")
    paired = {}
    for row in core:
        paired.setdefault(row["instance_id"], {})[row["strategy"]] = row
    ms_deltas = [v["multi_start"]["optimal_probability"] - v["standard"]["optimal_probability"] for v in paired.values() if "multi_start" in v and "standard" in v]
    warm_deltas = [v["warm_start"]["optimal_probability"] - v["standard"]["optimal_probability"] for v in paired.values() if "warm_start" in v and "standard" in v]
    lines += ["", "## Research questions", "",
        f"1. **Multi-Start effect:** Paired mean ideal optimal-probability change vs Standard was {np.mean(ms_deltas):+.4f} across {len(ms_deltas)} instances; its fixed per-restart run used more evaluations by design. Exact-hit rate is separately shown above.",
        f"2. **Classical initialization:** Warm-Start's paired mean optimal-probability change vs Standard was {np.mean(warm_deltas):+.4f}; report preprocessing time and end-to-end runtime separately. Relaxation objective is the same continuous QUBO, without exact-solution input.",
        "3. **Dense conflict:** Family B rows above show per-instance outcomes; conclusions are limited to three generated cases.",
        "4. **Generalization:** All six families appear in the 18-instance core. Paired per-instance outcomes are in `runs.csv`; family means are descriptive for three instances each.",
        "5. **Equal compute:** The matched-total subset compares configured caps, while `optimizer_function_evaluations` reveals actual differences. COBYLA may stop before a cap; runtime also includes warm preprocessing in total.",
        "6. **Seed and depth:** B2 seed/depth sweeps are in `summary.csv` with means, sample SD, median, range and trial counts. These controlled synthetic-instance sweeps do not establish broad robustness.",
        "", "Ideal optimal probability is not a finite-shot hit event. All reported associations are descriptive; no quantum advantage is claimed.",
        "", "## Figures", ""]
    lines += [f"- `{name}`" for name in figures]
    lines += ["", "## Limitations", "", "Small noiseless statevector instances (up to 12 variables), synthetic benchmark structures, COBYLA sensitivity, and a local continuous relaxation limit generalization. Warm-start preprocessing adds classical cost. The QUBO is held identical across strategies; the warm mixer changes only the ansatz state/mixer. The mixer does not guarantee feasible schedules. Evaluation is on the same exact optimum but it is excluded from the optimization path.", "", "## Exclusions and failures", ""]
    if excluded:
        lines += ["| Experiment | Instance | Strategy | Reason |", "|---|---|---|---|"]
        lines += [f"| {row['experiment_id']} | {row['instance_id']} | {row['strategy']} | {row['reason']} |" for row in excluded]
    else:
        lines.append("None.")
    lines += ["", f"Re-run with `python quantum-backend/initialization_benchmark.py --mode {settings['mode']} --output <directory>`.", ""]
    return "\n".join(lines)


def run_benchmark(mode: str, output: Path) -> dict[str, Any]:
    instances = build_benchmark_instances()
    plans, settings = experiment_matrix(mode, instances)
    output.mkdir(parents=True, exist_ok=True)
    prepared = {instance["instance_id"]: _prepare_instance(instance) for instance in instances}
    rows: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    for i, plan in enumerate(plans, 1):
        instance = plan["instance"]
        record = {
            "experiment_id": plan["experiment_id"], "budget_mode": plan["budget_mode"],
            "instance_id": instance["instance_id"], "family": instance["family"],
            "candidate_count": instance["candidate_count"], "strategy": plan["strategy"],
            "restart_count": plan["restart_count"], "p": plan["p"], "seed": plan["seed"],
            "alpha": DEFAULT_ALPHA, "beta": DEFAULT_BETA,
            "maxiter_per_restart": plan["maxiter_per_restart"],
        }
        print(f"[{i}/{len(plans)}] {plan['experiment_id']} {instance['instance_id']} {plan['strategy']} K={plan['restart_count']} p={plan['p']} seed={plan['seed']} cap={plan['maxiter_per_restart']}", flush=True)
        try:
            row = _run_one(plan, prepared[instance["instance_id"]], settings["shots"])
            _finalize_restart_details(row)
            rows.append(row)
        except Exception as exc:
            excluded.append({**record, "reason": f"execution failure: {type(exc).__name__}: {exc}"})
            print(f"  FAILED: {type(exc).__name__}: {exc}", flush=True)
    summaries = summarize(rows)
    _write_csv(output / "runs.csv", rows, RUN_COLUMNS)
    _write_csv(output / "summary.csv", summaries, list(summaries[0]) if summaries else [])
    _write_csv(output / "excluded_configurations.csv", excluded, EXCLUDED_COLUMNS)
    settings.update({
        "planned_runs": len(plans), "executed_runs": len(rows),
        "excluded_or_failed_runs": len(excluded), "instance_count": len(instances),
        "shots": SHOTS, "probability_method": "full ideal noiseless Qiskit Statevector distribution",
        "optimality_absolute_tolerance": TOLERANCE,
        "warm_start": {
            "relaxation": "bounded continuous x^T Q x minimized by L-BFGS-B",
            "boundary_epsilon": 0.02,
            "mixer": "sum_i 2*sqrt(c_i*(1-c_i))*X_i + (1-2*c_i)*Z_i",
            "failed_relaxation": "uniform c_i=0.5 fallback, explicitly recorded",
            "preprocessing_included_in_total_runtime": True,
        },
        "versions": {"python": platform.python_version(), "numpy": np.__version__, "scipy": scipy.__version__, "qiskit": qiskit.__version__, "matplotlib": matplotlib.__version__},
        "experiment_matrix": [
            {key: (value["instance_id"] if key == "instance" else value)
             for key, value in plan.items()} for plan in plans
        ],
    })
    (output / "config.json").write_text(json.dumps(settings, indent=2), encoding="utf-8")
    figures = make_plots(rows, output)
    (output / "report.md").write_text(render_report(rows, excluded, settings, figures), encoding="utf-8")
    return {"runs": rows, "summary": summaries, "excluded": excluded, "settings": settings, "figures": figures}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("quick", "full"), default="quick")
    parser.add_argument("--output", type=Path, default=ROOT / "output" / "phase2_2_2_quick")
    args = parser.parse_args(argv)
    result = run_benchmark(args.mode, args.output)
    print(f"Runs={len(result['runs'])}, excluded/errors={len(result['excluded'])}; output={args.output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Reproducible scientific evaluation for compactness-aware QAOA.

All quantum results use an ideal, noiseless statevector simulator. The
``shots`` setting affects only the separately recorded sampled best solution;
probability metrics are computed from the full statevector distribution.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import platform
import sys
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import qiskit
import scipy

from campus_adapter import generate_candidates
from compactness_qaoa import solve_compactness_qaoa
from compactness_qubo import build_compactness_qubo, solve_compactness_exact
from general_qaoa import validate_qubo
from qaoa_solver import index_to_assignment
from qubo_model import qubo_cost
from schedule_metrics import evaluate_schedule
from scheduling_qubo import decode_schedule


ROOT = Path(__file__).resolve().parent
CSV_COLUMNS = [
    "experiment_id", "instance_id", "candidate_count", "alpha", "beta",
    "p", "seed", "maxiter", "shots", "classical_cost",
    "qaoa_best_cost", "qaoa_expected_cost", "optimality_gap",
    "feasible_probability", "optimal_probability",
    "expected_feasible_reward", "priority_satisfaction",
    "priority_reward", "internal_gap_minutes", "compactness",
    "completion_offset_minutes", "scheduled_task_count", "is_feasible",
    "classical_priority_satisfaction", "classical_priority_reward",
    "classical_internal_gap_minutes", "classical_compactness",
    "classical_completion_offset_minutes", "classical_scheduled_task_count",
    "classical_runtime_seconds", "qaoa_runtime_seconds", "circuit_depth",
    "function_evaluations", "fallback_used", "optimizer_success",
]
EXCLUSION_COLUMNS = [
    "experiment_id", "instance_id", "candidate_count", "alpha", "beta",
    "p", "seed", "maxiter", "shots", "reason",
]
SUMMARY_METRICS = [
    "qaoa_best_cost", "qaoa_expected_cost", "optimality_gap",
    "feasible_probability", "optimal_probability",
    "expected_feasible_reward", "priority_satisfaction",
    "internal_gap_minutes", "compactness", "completion_offset_minutes",
    "classical_runtime_seconds", "qaoa_runtime_seconds", "circuit_depth",
    "function_evaluations",
]
FLOAT_TOLERANCE = 1e-8
WINDOW_START = datetime(2026, 11, 2, 9, tzinfo=timezone(timedelta(hours=-5)))
WINDOW_END = datetime(2026, 11, 2, 17, tzinfo=timezone(timedelta(hours=-5)))


def validate_weight_configuration(
    candidate_count: int, alpha: float, beta: float
) -> tuple[bool, str]:
    """Return whether secondary weights preserve the priority bound."""
    if candidate_count < 1:
        return False, "candidate_count must be positive"
    if not math.isfinite(alpha) or alpha < 0:
        return False, "alpha must be finite and nonnegative"
    if not math.isfinite(beta) or beta < 0:
        return False, "beta must be finite and nonnegative"
    bound = alpha * candidate_count + beta * candidate_count * (candidate_count - 1) / 2
    if bound >= 1:
        return False, (
            "secondary objective bound is not < 1: "
            f"alpha*n + beta*n*(n-1)/2 = {bound:.8g}"
        )
    return True, ""


def build_synthetic_instance(candidate_count: int) -> dict[str, Any]:
    """Create a deterministic, adapter-generated scheduling instance.

    Tasks have 60-minute durations and deadlines covering one to four
    120-minute candidate-grid positions. Three priority levels and overlapping
    alternatives create both same-task and time-overlap conflict edges.
    """
    if candidate_count not in (3, 5, 7, 9, 12):
        raise ValueError("candidate_count must be one of 3, 5, 7, 9, 12")

    base = [candidate_count // 3] * 3
    for index in range(candidate_count % 3):
        base[index] += 1
    priority_names = ("high", "medium", "low")
    tasks = []
    for index, slots in enumerate(base):
        last_end = WINDOW_START + timedelta(minutes=120 * (slots - 1) + 60)
        tasks.append({
            "id": f"task-{index + 1}",
            "title": f"Benchmark task {index + 1}",
            "durationMinutes": 60,
            "dueAt": last_end.isoformat(),
            "notBefore": WINDOW_START.isoformat(),
            "priority": priority_names[index],
        })

    request = {
        "windowStart": WINDOW_START.isoformat(),
        "windowEnd": WINDOW_END.isoformat(),
        "tasks": tasks,
        "classes": [],
        "unavailablePeriods": [],
    }
    candidates = generate_candidates(request, slot_minutes=120)
    if len(candidates) != candidate_count:
        raise RuntimeError(
            f"Synthetic instance requested {candidate_count} candidates, "
            f"adapter generated {len(candidates)}"
        )
    return {
        "instance_id": f"synthetic-n{candidate_count}",
        "candidate_count": candidate_count,
        "request": request,
        "candidates": candidates,
        "window_start": request["windowStart"],
        "window_end": request["windowEnd"],
    }


def analyze_probability_distribution(
    probabilities: np.ndarray,
    Q: np.ndarray,
    conflicts: list[dict[str, Any]],
    candidates: list[dict[str, Any]],
    exact_cost: float,
    window_start: str,
    window_end: str,
) -> dict[str, float]:
    """Aggregate full statevector probabilities over feasible assignments.

    Costs are considered equal to the exact optimum using absolute tolerance
    1e-8 and zero relative tolerance. The expected feasible reward is
    unconditional: infeasible probability contributes zero. It is not
    ``E[reward | feasible]``.
    """
    probabilities = np.asarray(probabilities, dtype=float)
    Q = np.asarray(Q, dtype=float)
    n = len(candidates)
    if n == 0 or probabilities.shape != (2**n,):
        raise ValueError("Probability vector must contain 2**n entries")
    if Q.shape != (n, n):
        raise ValueError("QUBO shape does not match candidate count")
    if not np.all(np.isfinite(probabilities)) or np.any(probabilities < -1e-12):
        raise ValueError("Probabilities must be finite and nonnegative")
    if not np.isclose(probabilities.sum(), 1.0, atol=1e-8):
        raise ValueError("Statevector probabilities must sum to one")

    feasible_probability = 0.0
    optimal_probability = 0.0
    expected_feasible_reward = 0.0
    feasible_count = 0
    optimal_count = 0
    for basis_index, probability in enumerate(probabilities):
        bits = index_to_assignment(basis_index, n)
        try:
            # Reuse the production decoder so feasibility uses the same
            # duplicate-task and time-conflict rules as schedule generation.
            decode_schedule(bits, candidates, conflicts)
        except ValueError:
            continue
        feasible_count += 1
        p = float(probability)
        feasible_probability += p
        metrics = evaluate_schedule(
            bits, candidates, conflicts, window_start, window_end
        )
        expected_feasible_reward += p * metrics["priorityReward"]
        cost = float(qubo_cost(bits, Q))
        if math.isclose(cost, exact_cost, rel_tol=0.0, abs_tol=FLOAT_TOLERANCE):
            optimal_probability += p
            optimal_count += 1

    if feasible_count == 0:
        raise ValueError("No feasible assignment exists for this instance")
    feasible_probability = float(np.clip(feasible_probability, 0.0, 1.0))
    optimal_probability = float(np.clip(optimal_probability, 0.0, 1.0))
    if optimal_probability > feasible_probability + 1e-10:
        raise ArithmeticError("Optimal probability exceeds feasible probability")
    return {
        "feasible_probability": feasible_probability,
        "optimal_probability": optimal_probability,
        "expected_feasible_reward": float(expected_feasible_reward),
        "feasible_assignment_count": feasible_count,
        "optimal_assignment_count": optimal_count,
    }


def run_configuration(
    experiment_id: str,
    instance: dict[str, Any],
    *,
    alpha: float = 0.05,
    beta: float = 0.005,
    p: int = 2,
    seed: int = 42,
    maxiter: int = 100,
    shots: int = 2048,
) -> dict[str, Any]:
    """Run one exact/QAOA pair on identical candidates and QUBO settings."""
    candidates = instance["candidates"]
    n = len(candidates)
    valid, reason = validate_weight_configuration(n, alpha, beta)
    if not valid:
        raise ValueError(f"Excluded configuration: {reason}")

    model = build_compactness_qubo(
        candidates, instance["window_start"], instance["window_end"],
        alpha=alpha, beta=beta,
    )
    validate_qubo(model["Q"], candidates, model["conflicts"])
    if not np.allclose(model["Q"], model["Q"].T, rtol=0, atol=1e-12):
        raise ValueError("Generated QUBO matrix is not symmetric")

    started = time.perf_counter()
    classical = solve_compactness_exact(
        candidates,
        instance["window_start"],
        instance["window_end"],
        alpha=alpha,
        beta=beta,
        max_variables=12,
    )
    classical_runtime = time.perf_counter() - started

    started = time.perf_counter()
    quantum = solve_compactness_qaoa(
        candidates,
        instance["window_start"],
        instance["window_end"],
        alpha=alpha,
        beta=beta,
        p=p,
        maxiter=maxiter,
        shots=shots,
        seed=seed,
    )
    qaoa_runtime = time.perf_counter() - started

    if not np.allclose(classical["model"]["Q"], quantum["Q"], rtol=1e-10, atol=1e-10):
        raise ValueError("Classical and QAOA QUBO matrices differ")
    exact_cost = float(classical["cost"])
    distribution = analyze_probability_distribution(
        quantum["probabilities"], model["Q"], model["conflicts"], candidates,
        exact_cost, instance["window_start"], instance["window_end"],
    )
    qaoa_best_cost = float(quantum["best"]["cost"])
    gap = qaoa_best_cost - exact_cost
    if gap < -FLOAT_TOLERANCE:
        raise ArithmeticError("Sampled QAOA cost is below the exact optimum")
    gap = max(0.0, gap)

    qaoa_metrics = evaluate_schedule(
        quantum["best"]["assignment"], candidates, model["conflicts"],
        instance["window_start"], instance["window_end"],
    )
    classical_metrics = evaluate_schedule(
        classical["assignment"], candidates, model["conflicts"],
        instance["window_start"], instance["window_end"],
    )
    return {
        "experiment_id": experiment_id,
        "instance_id": instance["instance_id"],
        "candidate_count": n,
        "alpha": alpha,
        "beta": beta,
        "p": p,
        "seed": seed,
        "maxiter": maxiter,
        "shots": shots,
        "classical_cost": exact_cost,
        "qaoa_best_cost": qaoa_best_cost,
        "qaoa_expected_cost": float(quantum["expectedCost"]),
        "optimality_gap": gap,
        "feasible_probability": distribution["feasible_probability"],
        "optimal_probability": distribution["optimal_probability"],
        "expected_feasible_reward": distribution["expected_feasible_reward"],
        "priority_satisfaction": qaoa_metrics["prioritySatisfaction"],
        "priority_reward": qaoa_metrics["priorityReward"],
        "internal_gap_minutes": qaoa_metrics["internalGapMinutes"],
        "compactness": qaoa_metrics["compactness"],
        "completion_offset_minutes": qaoa_metrics["completionOffsetMinutes"],
        "scheduled_task_count": qaoa_metrics["selectedTaskCount"],
        "is_feasible": qaoa_metrics["isFeasible"],
        "classical_priority_satisfaction": classical_metrics["prioritySatisfaction"],
        "classical_priority_reward": classical_metrics["priorityReward"],
        "classical_internal_gap_minutes": classical_metrics["internalGapMinutes"],
        "classical_compactness": classical_metrics["compactness"],
        "classical_completion_offset_minutes": classical_metrics["completionOffsetMinutes"],
        "classical_scheduled_task_count": classical_metrics["selectedTaskCount"],
        "classical_runtime_seconds": classical_runtime,
        "qaoa_runtime_seconds": qaoa_runtime,
        "circuit_depth": int(quantum["circuit"].depth()),
        "function_evaluations": int(quantum["functionEvaluations"]),
        "fallback_used": bool(quantum["fallbackUsed"]),
        "optimizer_success": bool(quantum["optimizationSuccess"]),
    }


def summarize_runs(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Aggregate repeated runs with mean, sample SD, median and range."""
    grouping = [
        "experiment_id", "instance_id", "candidate_count", "alpha", "beta",
        "p", "maxiter", "shots",
    ]
    buckets: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        buckets[tuple(row[key] for key in grouping)].append(row)
    summaries = []
    for key, trials in sorted(buckets.items(), key=lambda item: str(item[0])):
        base = dict(zip(grouping, key))
        for metric in SUMMARY_METRICS:
            values = [float(row[metric]) for row in trials if row[metric] is not None]
            if not values:
                continue
            base.update({
                f"{metric}_mean": float(np.mean(values)),
                f"{metric}_std": float(np.std(values, ddof=1)) if len(values) > 1 else None,
                f"{metric}_median": float(np.median(values)),
                f"{metric}_min": float(np.min(values)),
                f"{metric}_max": float(np.max(values)),
                f"{metric}_n": len(values),
            })
        base["trial_count"] = len(trials)
        base["exact_optimum_hit_rate"] = float(np.mean([
            row["optimality_gap"] <= FLOAT_TOLERANCE for row in trials
        ]))
        base["seed_min"] = min(row["seed"] for row in trials)
        base["seed_max"] = max(row["seed"] for row in trials)
        summaries.append(base)
    return summaries


def write_csv(path: Path, rows: list[dict[str, Any]], columns: list[str] | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if columns is None:
        columns = list(rows[0]) if rows else []
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=columns,
            extrasaction="ignore",
            lineterminator="\n",
        )
        writer.writeheader()
        writer.writerows(rows)


def _mean_std(rows: list[dict[str, Any]], field: str) -> tuple[float, float]:
    values = [float(row[field]) for row in rows if row.get(field) is not None]
    if not values:
        return float("nan"), float("nan")
    return float(np.mean(values)), float(np.std(values, ddof=1)) if len(values) > 1 else float("nan")


def make_plots(rows: list[dict[str, Any]], output: Path) -> None:
    """Create the six requested clearly labelled figures from observed rows."""
    beta_rows = [row for row in rows if row["experiment_id"] == "beta_sensitivity"]
    depth_rows = [row for row in rows if row["experiment_id"] == "depth"]
    scale_rows = [row for row in rows if row["experiment_id"] == "scaling"]
    seed_rows = [row for row in rows if row["experiment_id"] == "seed_robustness"]

    def save_beta(field: str, label: str, filename: str) -> None:
        groups: dict[float, list[dict[str, Any]]] = defaultdict(list)
        for row in beta_rows:
            if row.get(field) is not None:
                groups[float(row["beta"])].append(row)
        if not groups:
            return
        xs = sorted(groups)
        means = [_mean_std(groups[x], field)[0] for x in xs]
        stds = [_mean_std(groups[x], field)[1] for x in xs]
        fig, ax = plt.subplots(figsize=(7, 4.5))
        errorbars = stds if all(math.isfinite(value) for value in stds) else None
        ax.errorbar(xs, means, yerr=errorbars, marker="o", capsize=4, label="QAOA best feasible schedule")
        classical_field = "classical_" + field
        if all(classical_field in row for row in beta_rows):
            classical = [float(groups[x][0][classical_field]) for x in xs]
            ax.plot(xs, classical, marker="s", linestyle="--", label="Classical Exact")
        ax.set_xlabel("Compactness weight β")
        ax.set_ylabel(label)
        ax.set_title(f"β sensitivity: {label}")
        ax.grid(alpha=0.3)
        ax.legend()
        fig.tight_layout()
        fig.savefig(output / filename, dpi=160)
        plt.close(fig)

    save_beta("compactness", "Actual schedule compactness (score)", "beta_vs_compactness.png")
    save_beta("internal_gap_minutes", "Internal idle gaps (minutes)", "beta_vs_internal_gaps.png")

    if depth_rows:
        grouped: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for row in depth_rows:
            grouped[int(row["p"])].append(row)
        xs = sorted(grouped)
        for field, ylabel, filename in (
            ("optimal_probability", "Optimal probability (%)", "depth_vs_optimal_probability.png"),
            ("optimality_gap", "Sampled optimality gap (QUBO cost)", "depth_vs_optimality_gap.png"),
        ):
            means = [_mean_std(grouped[x], field)[0] for x in xs]
            stds = [_mean_std(grouped[x], field)[1] for x in xs]
            if field == "optimal_probability":
                means = [value * 100 for value in means]
                stds = [value * 100 for value in stds]
            fig, ax = plt.subplots(figsize=(7, 4.5))
            errorbars = stds if all(math.isfinite(value) for value in stds) else None
            ax.errorbar(xs, means, yerr=errorbars, marker="o", capsize=4)
            ax.set_xlabel("QAOA layers (p)")
            ax.set_ylabel(ylabel)
            ax.set_title(f"QAOA depth vs. {ylabel.lower()}")
            ax.set_xticks(xs)
            ax.grid(alpha=0.3)
            fig.tight_layout()
            fig.savefig(output / filename, dpi=160)
            plt.close(fig)

    if scale_rows:
        grouped = defaultdict(list)
        for row in scale_rows:
            grouped[int(row["candidate_count"])].append(row)
        xs = sorted(grouped)
        fig, ax = plt.subplots(figsize=(7, 4.5))
        for field, label in (("classical_runtime_seconds", "Classical Exact"), ("qaoa_runtime_seconds", "QAOA statevector")):
            means = [_mean_std(grouped[x], field)[0] for x in xs]
            stds = [_mean_std(grouped[x], field)[1] for x in xs]
            errorbars = stds if all(math.isfinite(value) for value in stds) else None
            ax.errorbar(xs, means, yerr=errorbars, marker="o", capsize=4, label=label)
        ax.set_xlabel("Candidate binary variables (n)")
        ax.set_ylabel("Runtime (seconds)")
        ax.set_title("Runtime by candidate count")
        ax.set_xticks(xs)
        ax.grid(alpha=0.3)
        ax.legend()
        fig.tight_layout()
        fig.savefig(output / "candidate_count_vs_runtime.png", dpi=160)
        plt.close(fig)

    if seed_rows:
        grouped = defaultdict(list)
        for row in seed_rows:
            grouped[int(row["seed"])].append(row)
        xs = sorted(grouped)
        means = [_mean_std(grouped[x], "optimality_gap")[0] for x in xs]
        stds = [_mean_std(grouped[x], "optimality_gap")[1] for x in xs]
        fig, ax = plt.subplots(figsize=(8, 4.5))
        errorbars = stds if all(math.isfinite(value) for value in stds) else None
        ax.errorbar(xs, means, yerr=errorbars, marker="o", capsize=4)
        ax.set_xlabel("Random initialization seed")
        ax.set_ylabel("Sampled optimality gap (QUBO cost)")
        ax.set_title("Initialization sensitivity by seed")
        ax.grid(alpha=0.3)
        fig.tight_layout()
        fig.savefig(output / "seed_robustness_optimality_gap.png", dpi=160)
        plt.close(fig)


def render_report(rows: list[dict[str, Any]], excluded: list[dict[str, Any]], mode: str, settings: dict[str, Any]) -> str:
    """Write concise, data-driven RQ results and methodological definitions."""
    by_exp: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        by_exp[row["experiment_id"]].append(row)
    lines = [
        "# Phase 2.1.5 — Compactness QAOA benchmark report", "",
        f"Mode: **{mode}** · Executed runs: **{len(rows)}** · Excluded configurations: **{len(excluded)}**", "",
        "## Experimental method", "",
        f"Settings: α={settings['alpha']}, β baseline={settings['beta']}, p baseline={settings['p']}, maxiter={settings['maxiter']}, shots={settings['shots']}, slot_minutes=120. Data are deterministic adapter-generated instances with 60-minute tasks, high/medium/low priorities, deadlines, same-task alternatives and overlapping time conflicts.", "",
        "The exact solver and QAOA use identical candidate arrays and symmetric QUBO matrices. Runtimes use `time.perf_counter()`. Probability metrics come from the full noiseless statevector; `shots` only controls finite-shot sampling used for `qaoa_best_cost`. Feasible assignments are validated with the production schedule decoder. Costs are considered tied at absolute tolerance 1e-8 (relative tolerance 0). `optimal_probability` sums probability across every feasible assignment tied at the global exact minimum. `expected_feasible_reward` is unconditional E[R·1_feasible], so infeasible outcomes contribute zero; it is not the reward conditional on feasibility.", "",
        "## RQ1 — Compactness sensitivity", "",
    ]
    beta_rows = sorted(by_exp.get("beta_sensitivity", []), key=lambda row: row["beta"])
    if beta_rows:
        lines += ["| β | Classical compactness | QAOA compactness | Classical gaps (min) | QAOA gaps (min) | Priority satisfaction | Completion offset (min) |", "|---:|---:|---:|---:|---:|---:|---:|"]
        for row in beta_rows:
            lines.append(
                f"| {row['beta']:.3f} | {row['classical_compactness']:.3f} | {row['compactness']:.3f} | {row['classical_internal_gap_minutes']:.1f} | {row['internal_gap_minutes']:.1f} | {row['priority_satisfaction']:.3f} | {row['completion_offset_minutes']:.1f} |"
            )
        lines += ["", "β-dependent QUBO costs are not compared across rows because each β defines a different objective. The table compares actual schedule metrics.", ""]
    else:
        lines += ["No β sensitivity runs were executed in this mode.", ""]

    lines += ["## RQ2 — QAOA depth", ""]
    depth_rows = sorted(by_exp.get("depth", []), key=lambda row: row["p"])
    if depth_rows:
        lines += ["| p | Mean optimal probability | Mean sampled gap | Mean feasible probability | Mean runtime (s) | Mean circuit depth | Mean evaluations |", "|---:|---:|---:|---:|---:|---:|---:|"]
        for p in sorted({row["p"] for row in depth_rows}):
            group = [row for row in depth_rows if row["p"] == p]
            opt = _mean_std(group, "optimal_probability")
            gap = _mean_std(group, "optimality_gap")
            feasible = _mean_std(group, "feasible_probability")
            runtime = _mean_std(group, "qaoa_runtime_seconds")
            depth = _mean_std(group, "circuit_depth")
            evals = _mean_std(group, "function_evaluations")
            opt_sd = f"{opt[1]:.4f}" if math.isfinite(opt[1]) else "n/a"
            gap_sd = f"{gap[1]:.3g}" if math.isfinite(gap[1]) else "n/a"
            feasible_sd = f"{feasible[1]:.4f}" if math.isfinite(feasible[1]) else "n/a"
            runtime_sd = f"{runtime[1]:.4f}" if math.isfinite(runtime[1]) else "n/a"
            lines.append(f"| {p} | {opt[0]:.4f} ± {opt_sd} | {gap[0]:.4g} ± {gap_sd} | {feasible[0]:.4f} ± {feasible_sd} | {runtime[0]:.4f} ± {runtime_sd} | {depth[0]:.1f} | {evals[0]:.1f} |")
        lines += ["", ""]
    else:
        lines += ["No depth sweep was executed in this mode.", ""]

    lines += ["## RQ3 — Initialization and seed robustness", ""]
    seed_rows = by_exp.get("seed_robustness", [])
    if seed_rows:
        gaps = np.asarray([row["optimality_gap"] for row in seed_rows], dtype=float)
        hits = sum(value <= FLOAT_TOLERANCE for value in gaps)
        lines.append(f"Across {len(gaps)} seeds, optimality gap mean ± sample SD = {np.mean(gaps):.6g} ± {np.std(gaps, ddof=1) if len(gaps) > 1 else 0.0:.6g}; median={np.median(gaps):.6g}, min={np.min(gaps):.6g}, max={np.max(gaps):.6g}; exact-optimum hit rate={hits}/{len(gaps)} ({hits/len(gaps):.1%}).")
        lines.append("A zero standard deviation only describes these runs on this instance; it does not establish robustness on unseen instances.")
    else:
        lines.append("No seed sweep was executed in this mode.")
    lines.append("")

    lines += ["## RQ4 — Candidate-count scaling", ""]
    scale_rows = sorted(by_exp.get("scaling", []), key=lambda row: row["candidate_count"])
    if scale_rows:
        lines += ["| Candidates | Classical Exact runtime (s) | QAOA runtime (s) | Sampled gap | Feasible probability |", "|---:|---:|---:|---:|---:|"]
        for row in scale_rows:
            lines.append(f"| {row['candidate_count']} | {row['classical_runtime_seconds']:.6f} | {row['qaoa_runtime_seconds']:.6f} | {row['optimality_gap']:.6g} | {row['feasible_probability']:.4f} |")
        lines += ["", "These measurements describe only small ideal statevector runs and do not predict hardware scaling.", ""]
    else:
        lines += ["No scaling sweep was executed in this mode.", ""]

    lines += ["## RQ5 — Classical Exact vs. QAOA", ""]
    if rows:
        gaps = [float(row["optimality_gap"]) for row in rows]
        hits = sum(gap <= FLOAT_TOLERANCE for gap in gaps)
        lines.append(f"QAOA's finite-shot best feasible sample reached the exact optimum in {hits}/{len(rows)} runs; observed sampled gap range was {min(gaps):.6g} to {max(gaps):.6g}. The full-statevector optimal probability is reported separately and includes all equivalent global optima.")
    else:
        lines.append("No runs were executed.")
    lines += ["", "## Limitations", "", "Instances are small; QAOA is an ideal noiseless statevector simulation; COBYLA can be sensitive to initialization and finite iteration limits; candidate generation discretizes start times; pairwise gap cost is a proxy for fragmentation rather than exact internal idle time. This convenience sample supports no broad statistical-significance claim and no quantum-advantage claim.", "", "## Excluded configurations", ""]
    if excluded:
        lines += ["| Experiment | Instance | β | Reason |", "|---|---|---:|---|"]
        lines += [f"| {row['experiment_id']} | {row['instance_id']} | {row['beta']} | {row['reason']} |" for row in excluded]
    else:
        lines.append("None.")
    lines += ["", "## Reproducibility", "", "All individual rows, aggregate statistics, settings, software versions, exclusions and plots are saved alongside this report. Re-run with `python quantum-backend/compactness_benchmark.py --mode " + mode + " --output <directory>`.", ""]
    return "\n".join(lines)


def _experiment_plan(mode: str) -> tuple[list[tuple[str, int, float, int, int]], dict[str, Any]]:
    """Return (experiment, n, beta, p, seed) plans and run controls."""
    if mode == "quick":
        maxiter, shots = 25, 256
        beta_values, depth_values = (0.0, 0.005, 0.02), (1, 2)
        seeds, depth_seeds, scale_sizes = (42, 43), (42,), (3, 5)
    else:
        maxiter, shots = 100, 2048
        beta_values, depth_values = (0.0, 0.001, 0.003, 0.005, 0.01, 0.02), (1, 2, 3)
        seeds, depth_seeds, scale_sizes = tuple(range(42, 52)), tuple(range(42, 52)), (3, 5, 7, 9, 12)
    plans = []
    for beta in beta_values:
        plans.append(("beta_sensitivity", 5, beta, 2, 42))
    for p in depth_values:
        for seed in depth_seeds:
            plans.append(("depth", 5, 0.005, p, seed))
    for seed in seeds:
        plans.append(("seed_robustness", 5, 0.005, 2, seed))
    for n in scale_sizes:
        plans.append(("scaling", n, 0.005, 2, 42))
    # Exercise the documented invalid-weight path at the largest demo size.
    # β=0.02 is valid for n=5 sensitivity, but violates the bound at n=12.
    plans.append(("weight_bound_guard", 12, 0.02, 2, 42))
    return plans, {"maxiter": maxiter, "shots": shots}


def run_benchmark(mode: str, output_dir: Path) -> dict[str, Any]:
    if mode not in ("quick", "full"):
        raise ValueError("mode must be quick or full")
    plans, controls = _experiment_plan(mode)
    settings = {
        "mode": mode, "alpha": 0.05, "beta": 0.005, "p": 2,
        "maxiter": controls["maxiter"], "shots": controls["shots"],
        "slot_minutes": 120, "random_seeds": sorted({plan[4] for plan in plans}),
        "beta_sensitivity_values": sorted({plan[2] for plan in plans if plan[0] == "beta_sensitivity"}),
        "depth_values": sorted({plan[3] for plan in plans if plan[0] == "depth"}),
        "scaling_candidate_counts": sorted({plan[1] for plan in plans if plan[0] == "scaling"}),
        "probability_method": "full noiseless Qiskit Statevector distribution",
        "optimality_absolute_tolerance": FLOAT_TOLERANCE,
        "synthetic_instance_definition": "adapter-generated 60-minute tasks, 120-minute grid, 3 priority levels, deadlines and overlapping alternatives",
        "versions": {
            "python": platform.python_version(),
            "numpy": np.__version__,
            "scipy": scipy.__version__,
            "qiskit": qiskit.__version__,
            "matplotlib": matplotlib.__version__,
        },
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    rows, excluded = [], []
    instance_cache = {n: build_synthetic_instance(n) for _, n, _, _, _ in plans}
    for experiment_id, n, beta, p, seed in plans:
        instance = instance_cache[n]
        valid, reason = validate_weight_configuration(n, settings["alpha"], beta)
        if not valid:
            excluded.append({
                "experiment_id": experiment_id,
                "instance_id": instance["instance_id"],
                "candidate_count": n, "alpha": settings["alpha"],
                "beta": beta, "p": p, "seed": seed,
                "maxiter": controls["maxiter"], "shots": controls["shots"],
                "reason": reason,
            })
            continue
        print(f"[{len(rows) + 1}/{len(plans)}] {experiment_id}: n={n}, beta={beta}, p={p}, seed={seed}", flush=True)
        rows.append(run_configuration(
            experiment_id, instance, alpha=settings["alpha"], beta=beta,
            p=p, seed=seed, maxiter=controls["maxiter"], shots=controls["shots"],
        ))

    summary = summarize_runs(rows)
    write_csv(output_dir / "runs.csv", rows, CSV_COLUMNS)
    summary_columns = list(summary[0]) if summary else []
    write_csv(output_dir / "summary.csv", summary, summary_columns)
    write_csv(output_dir / "excluded_configurations.csv", excluded, EXCLUSION_COLUMNS)
    settings["executed_runs"] = len(rows)
    settings["excluded_configurations"] = len(excluded)
    (output_dir / "config.json").write_text(json.dumps(settings, indent=2), encoding="utf-8")
    make_plots(rows, output_dir)
    (output_dir / "report.md").write_text(
        render_report(rows, excluded, mode, settings), encoding="utf-8"
    )
    return {"runs": rows, "summary": summary, "excluded": excluded, "settings": settings}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("quick", "full"), default="quick")
    parser.add_argument("--output", type=Path, default=ROOT / "output" / "phase2_1_5")
    args = parser.parse_args(argv)
    results = run_benchmark(args.mode, args.output)
    print(f"Completed {len(results['runs'])} runs; excluded {len(results['excluded'])}.")
    print(f"Results: {args.output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

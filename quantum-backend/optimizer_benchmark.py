"""Phase 2.2.3 classical-optimizer and budget-aware QAOA benchmark."""

from __future__ import annotations

import argparse
import csv
import json
import math
import platform
import statistics
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import qiskit
import scipy

from benchmark_instances import build_benchmark_instances
from compactness_benchmark import analyze_probability_distribution
from compactness_qubo import build_compactness_qubo
from general_qaoa import validate_qubo
from qaoa_optimizer_comparison import OPTIMIZERS, run_optimizer
from qaoa_solver import index_to_assignment
from qubo_model import qubo_cost
from schedule_metrics import evaluate_schedule
from scheduling_qubo import decode_schedule


ROOT = Path(__file__).resolve().parent
OUTPUT_ROOT = ROOT / "output"
SHOTS_PER_BATCH = 2048
DEFAULT_BATCHES = 50
BASELINE = {"p": 2, "seed": 42, "budget": 100, "alpha": 0.05, "beta": 0.005}
REPRESENTATIVES = ("A2-n5", "B2-n9", "F2-n5")
CSV_FIELDS = [
    "experiment_id", "study", "instance_id", "family", "optimizer", "p",
    "budget", "seed", "alpha", "beta", "shots_per_batch", "sampling_batches",
    "initial_expected_cost", "best_expected_cost", "expected_cost_improvement",
    "expected_cost_improvement_per_evaluation", "expected_cost_improvement_per_second",
    "actual_objective_evaluations", "budget_utilization", "optimizer_runtime_seconds",
    "total_runtime_seconds", "optimizer_success", "termination_reason",
    "feasible_probability", "infeasible_probability", "optimal_probability",
    "suboptimal_feasible_probability", "theoretical_batch_hit_probability",
    "empirical_hit_rate", "empirical_hit_batches", "empirical_hit_trials",
    "best_feasible_sampled_cost", "optimality_gap", "priority_satisfaction",
    "internal_gap_minutes", "compactness", "completion_offset_minutes",
    "fallback_used", "finite_difference_mode", "optimizer_iterations",
    "initial_params", "best_params",
]


def configuration_matrix(mode: str) -> list[dict[str, Any]]:
    """Return the published bounded matrix, with four paired optimizers/run."""
    instances = build_benchmark_instances()
    by_id = {instance["instance_id"]: instance for instance in instances}
    configs: dict[tuple[str, int, int, int], dict[str, Any]] = {}

    def add(instance_id: str, p: int, budget: int, seed: int, study: str) -> None:
        key = (instance_id, p, budget, seed)
        entry = configs.setdefault(key, {
            "instance_id": instance_id, "p": p, "budget": budget,
            "seed": seed, "studies": [],
        })
        if study not in entry["studies"]:
            entry["studies"].append(study)

    if mode == "quick":
        for instance_id in REPRESENTATIVES:
            add(instance_id, 2, 25, 42, "quick_baseline")
        for budget in (50, 100, 200):
            add("B2-n9", 2, budget, 42, "quick_budget")
        for p in (1, 3):
            add("B2-n9", p, 25, 42, "quick_depth")
        add("B2-n9", 2, 25, 43, "quick_seed")
    elif mode == "full":
        for instance_id in by_id:
            add(instance_id, BASELINE["p"], BASELINE["budget"], BASELINE["seed"], "core_18_instances")
        for instance_id in REPRESENTATIVES:
            for budget in (25, 50, 200):
                add(instance_id, 2, budget, 42, "budget_sensitivity")
            for p in (1, 3):
                add(instance_id, p, 100, 42, "depth_sensitivity")
        for seed in range(43, 52):
            add("B2-n9", 2, 100, seed, "seed_robustness")
    else:
        raise ValueError("mode must be 'quick' or 'full'")

    rows = []
    for entry in configs.values():
        if entry["instance_id"] not in by_id:
            raise ValueError(f"Matrix references unknown instance {entry['instance_id']}")
        for optimizer in OPTIMIZERS:
            rows.append({**entry, "optimizer": optimizer})
    return rows


def theoretical_hit_probability(optimal_probability: float, shots: int) -> float:
    """Probability of >=1 optimum hit in independent samples from Popt."""
    probability = float(optimal_probability)
    if not 0 <= probability <= 1 or type(shots) is not int or shots < 1:
        raise ValueError("probability must be in [0,1] and shots must be positive")
    if probability == 0:
        return 0.0
    if probability == 1:
        return 1.0
    return float(np.clip(-math.expm1(shots * math.log1p(-probability)), 0.0, 1.0))


def sample_independent_batches(
    probabilities: np.ndarray,
    Q: np.ndarray,
    candidates: list[dict[str, Any]],
    conflicts: list[dict[str, Any]],
    *,
    exact_cost: float,
    shots_per_batch: int,
    batches: int,
    seed: int,
    window_start: str,
    window_end: str,
) -> dict[str, Any]:
    """Sample independent batches and measure batch-level optimum hit rate."""
    probabilities = np.asarray(probabilities, dtype=float)
    if (probabilities.shape != (2 ** len(candidates),)
            or not np.all(np.isfinite(probabilities)) or np.any(probabilities < 0)
            or not np.isclose(probabilities.sum(), 1.0, atol=1e-8)):
        raise ValueError("Invalid normalized basis probability vector")
    if shots_per_batch < 1 or batches < 1:
        raise ValueError("shots_per_batch and batches must be positive")
    feasible = np.zeros(len(probabilities), dtype=bool)
    optimal = np.zeros(len(probabilities), dtype=bool)
    costs = np.empty(len(probabilities), dtype=float)
    assignments: list[tuple[int, ...]] = []
    for index in range(len(probabilities)):
        bits = index_to_assignment(index, len(candidates))
        assignments.append(bits)
        costs[index] = float(qubo_cost(bits, Q))
        try:
            decode_schedule(bits, candidates, conflicts)
            feasible[index] = True
            optimal[index] = math.isclose(
                costs[index], exact_cost, rel_tol=0.0, abs_tol=1e-8
            )
        except ValueError:
            pass
    rng = np.random.default_rng(seed)
    hit_count = 0
    best_index: int | None = None
    for _ in range(batches):
        sampled = rng.choice(len(probabilities), size=shots_per_batch, p=probabilities)
        if np.any(optimal[sampled]):
            hit_count += 1
        feasible_samples = sampled[feasible[sampled]]
        if len(feasible_samples):
            candidate_index = int(feasible_samples[np.argmin(costs[feasible_samples])])
            if best_index is None or costs[candidate_index] < costs[best_index]:
                best_index = candidate_index
    fallback_used = best_index is None
    if fallback_used:
        zero_index = 0
        best_bits = assignments[zero_index]
        best_cost = float(costs[zero_index])
        metrics = evaluate_schedule(
            best_bits, candidates, conflicts, window_start, window_end
        )
    else:
        best_bits = assignments[best_index]
        best_cost = float(costs[best_index])
        metrics = evaluate_schedule(
            best_bits, candidates, conflicts, window_start, window_end
        )
    return {
        "empirical_hit_rate": hit_count / batches,
        "empirical_hit_batches": hit_count,
        "empirical_hit_trials": batches,
        "sampling_batches": batches,
        "sampling_seed": seed,
        "best_assignment": best_bits,
        "best_feasible_sampled_cost": best_cost,
        "best_schedule_metrics": metrics,
        "fallback_used": fallback_used,
    }


def _run_configuration(
    config: dict[str, Any], instance: dict[str, Any], *, batches: int,
) -> dict[str, Any]:
    candidates = instance["candidates"]
    request = instance["request"]
    alpha, beta = 0.05, 0.005
    model = build_compactness_qubo(
        candidates, request["windowStart"], request["windowEnd"], alpha, beta
    )
    Q = validate_qubo(model["Q"], candidates, model["conflicts"])
    start = time.perf_counter()
    outcome = run_optimizer(
        config["optimizer"], Q, candidates, model["conflicts"],
        p=config["p"], budget=config["budget"], seed=config["seed"],
    )
    # Exact enumeration is deliberately kept outside the optimizer interface.
    exact_cost = float(instance["exact_optimal_value"])
    distribution = analyze_probability_distribution(
        outcome["probabilities"], Q, model["conflicts"], candidates,
        exact_cost, request["windowStart"], request["windowEnd"],
    )
    sampling = sample_independent_batches(
        outcome["probabilities"], Q, candidates, model["conflicts"],
        exact_cost=exact_cost, shots_per_batch=SHOTS_PER_BATCH,
        batches=batches, seed=config["seed"] + 900_000,
        window_start=request["windowStart"], window_end=request["windowEnd"],
    )
    total_runtime = time.perf_counter() - start
    gap = max(0.0, sampling["best_feasible_sampled_cost"] - exact_cost)
    improvement = outcome["initial_expected_cost"] - outcome["best_expected_cost"]
    evaluations = outcome["actual_objective_evaluations"]
    metrics = sampling["best_schedule_metrics"]
    study = "+".join(config["studies"])
    return {
        "experiment_id": f"{instance['instance_id']}-p{config['p']}-b{config['budget']}-s{config['seed']}-{config['optimizer']}",
        "study": study, "instance_id": instance["instance_id"],
        "family": instance["family"], "optimizer": config["optimizer"],
        "p": config["p"], "budget": config["budget"], "seed": config["seed"],
        "alpha": alpha, "beta": beta, "shots_per_batch": SHOTS_PER_BATCH,
        "sampling_batches": batches,
        "initial_expected_cost": outcome["initial_expected_cost"],
        "best_expected_cost": outcome["best_expected_cost"],
        "expected_cost_improvement": improvement,
        "expected_cost_improvement_per_evaluation": improvement / max(evaluations, 1),
        "expected_cost_improvement_per_second": improvement / max(outcome["optimizer_runtime_seconds"], 1e-12),
        "actual_objective_evaluations": evaluations,
        "budget_utilization": evaluations / config["budget"],
        "optimizer_runtime_seconds": outcome["optimizer_runtime_seconds"],
        "total_runtime_seconds": total_runtime,
        "optimizer_success": outcome["optimizer_success"],
        "termination_reason": outcome["termination_reason"],
        "feasible_probability": distribution["feasible_probability"],
        "infeasible_probability": 1.0 - distribution["feasible_probability"],
        "optimal_probability": distribution["optimal_probability"],
        "suboptimal_feasible_probability": max(0.0, distribution["feasible_probability"] - distribution["optimal_probability"]),
        "theoretical_batch_hit_probability": theoretical_hit_probability(distribution["optimal_probability"], SHOTS_PER_BATCH),
        "empirical_hit_rate": sampling["empirical_hit_rate"],
        "empirical_hit_batches": sampling["empirical_hit_batches"],
        "empirical_hit_trials": sampling["empirical_hit_trials"],
        "best_feasible_sampled_cost": sampling["best_feasible_sampled_cost"],
        "optimality_gap": gap,
        "priority_satisfaction": metrics["prioritySatisfaction"],
        "internal_gap_minutes": metrics["internalGapMinutes"],
        "compactness": metrics["compactness"],
        "completion_offset_minutes": metrics["completionOffsetMinutes"],
        "fallback_used": sampling["fallback_used"],
        "finite_difference_mode": outcome["finite_difference_mode"],
        "optimizer_iterations": outcome["optimizer_iterations"],
        "initial_params": json.dumps(outcome["initial_params"].tolist()),
        "best_params": json.dumps(outcome["best_params"].tolist()),
    }


def _write_csv(path: Path, rows: list[dict[str, Any]], fields: list[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: "" if row.get(key) is None else row.get(key) for key in fields})


def _summary(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        key = (row["study"], row["family"], row["optimizer"], row["p"], row["budget"])
        groups[key].append(row)
    fields = ("optimal_probability", "feasible_probability", "optimality_gap",
              "best_expected_cost", "actual_objective_evaluations", "optimizer_runtime_seconds",
              "theoretical_batch_hit_probability", "empirical_hit_rate",
              "expected_cost_improvement_per_evaluation")
    summary = []
    for key, items in sorted(groups.items(), key=lambda pair: tuple(map(str, pair[0]))):
        row = dict(zip(("study", "family", "optimizer", "p", "budget"), key))
        row["n"] = len(items)
        for field in fields:
            vals = [float(item[field]) for item in items if item.get(field) not in (None, "")]
            row[f"{field}_mean"] = statistics.fmean(vals) if vals else None
            row[f"{field}_sd"] = statistics.stdev(vals) if len(vals) > 1 else 0.0 if vals else None
            row[f"{field}_median"] = statistics.median(vals) if vals else None
        summary.append(row)
    return summary


def _save_figures(rows: list[dict[str, Any]], output: Path) -> list[str]:
    plots = [
        ("optimizer_optimal_probability.png", "optimizer", "optimal_probability", "Optimal probability by optimizer"),
        ("optimizer_feasible_probability.png", "optimizer", "feasible_probability", "Feasible probability by optimizer"),
        ("optimizer_optimality_gap.png", "optimizer", "optimality_gap", "Best sampled optimality gap by optimizer"),
        ("budget_expected_cost.png", "budget", "best_expected_cost", "Budget vs best expected cost"),
        ("budget_optimal_probability.png", "budget", "optimal_probability", "Budget vs optimal probability"),
        ("family_b_optimizer_comparison.png", "optimizer", "optimal_probability", "Family B optimizer comparison"),
        ("theoretical_empirical_hit_rate.png", "theoretical_batch_hit_probability", "empirical_hit_rate", "Theoretical vs empirical batch hit rate"),
        ("runtime_vs_evaluations.png", "actual_objective_evaluations", "optimizer_runtime_seconds", "Runtime vs actual objective evaluations"),
    ]
    paths = []
    for filename, xfield, yfield, title in plots:
        subset = rows if filename != "family_b_optimizer_comparison.png" else [r for r in rows if r["family"] == "B"]
        fig, ax = plt.subplots(figsize=(8, 5))
        if xfield == "theoretical_batch_hit_probability":
            ax.scatter([r[xfield] for r in subset], [r[yfield] for r in subset], alpha=.65)
            ax.plot([0, 1], [0, 1], "--", color="gray", linewidth=1)
            ax.set_xlabel("Theoretical hit probability per batch")
            ax.set_ylabel("Empirical hit rate across independent batches")
        elif xfield == "actual_objective_evaluations":
            ax.scatter([r[xfield] for r in subset], [r[yfield] for r in subset], alpha=.65)
            ax.set_xlabel("Actual objective evaluations")
            ax.set_ylabel("Optimizer runtime (seconds)")
        else:
            labels = sorted({str(r[xfield]) for r in subset}, key=lambda v: float(v) if v.replace('.', '', 1).isdigit() else v)
            for label in labels:
                group = [r for r in subset if str(r[xfield]) == label]
                vals = [float(r[yfield]) for r in group if r[yfield] not in (None, "")]
                if vals:
                    ax.boxplot(vals, positions=[labels.index(label)], widths=.6)
            ax.set_xticks(range(len(labels)), labels)
            ax.set_xlabel(xfield.replace("_", " "))
            ax.set_ylabel(yfield.replace("_", " "))
        ax.set_title(title)
        ax.grid(axis="y", alpha=.25)
        fig.tight_layout()
        path = output / filename
        fig.savefig(path, dpi=150)
        plt.close(fig)
        paths.append(filename)
    return paths


def _report(rows: list[dict[str, Any]], summary: list[dict[str, Any]], mode: str,
            batches: int, figures: list[str]) -> str:
    core_rows = [r for r in rows if "core_18_instances" in r["study"]]
    comparison_rows = core_rows or rows

    def mean(items: list[dict[str, Any]], field: str) -> float | None:
        vals = [float(r[field]) for r in items if r.get(field) not in (None, "")]
        return statistics.fmean(vals) if vals else None

    def avg(optimizer: str, field: str, family: str | None = None) -> float | None:
        items = [r for r in comparison_rows if r["optimizer"] == optimizer and (family is None or r["family"] == family)]
        vals = [float(r[field]) for r in items if r.get(field) not in (None, "")]
        return statistics.fmean(vals) if vals else None
    best_opt = max(OPTIMIZERS, key=lambda opt: avg(opt, "optimal_probability") or -1)
    fastest = min(OPTIMIZERS, key=lambda opt: avg(opt, "optimizer_runtime_seconds") or float("inf"))
    family_b = [r for r in rows if r["family"] == "B"]
    b_bad = sorted(family_b, key=lambda r: r["optimal_probability"])[:5]
    budget_rows = [r for r in rows if ("core_18_instances" in r["study"] or "budget_sensitivity" in r["study"])
                   and r["instance_id"] in REPRESENTATIVES and r["p"] == 2 and r["seed"] == 42]
    depth_rows = [r for r in rows if ("core_18_instances" in r["study"] or "depth_sensitivity" in r["study"])
                  and r["instance_id"] in REPRESENTATIVES and r["budget"] == 100 and r["seed"] == 42]
    seed_rows = [r for r in rows if ("core_18_instances" in r["study"] or "seed_robustness" in r["study"])
                 and r["instance_id"] == "B2-n9" and r["p"] == 2 and r["budget"] == 100]
    budget_means = {b: mean([r for r in budget_rows if r["budget"] == b], "optimal_probability") for b in (25, 50, 100, 200)}
    depth_means = {p: mean([r for r in depth_rows if r["p"] == p], "optimal_probability") for p in (1, 2, 3)}
    seed_means = {s: mean([r for r in seed_rows if r["seed"] == s], "optimal_probability") for s in sorted({r["seed"] for r in seed_rows})}
    hit_errors = [abs(float(r["theoretical_batch_hit_probability"]) - float(r["empirical_hit_rate"])) for r in rows]
    b_infeasible = mean(family_b, "infeasible_probability")
    b_suboptimal = mean(family_b, "suboptimal_feasible_probability")
    lines = [
        "# Phase 2.2.3 — Classical Optimizer Comparison & Budget-Aware QAOA", "",
        f"Mode: **{mode}**. Runs: **{len(rows)}** optimizer configurations. Each empirical hit rate uses **{batches} independent batches × {SHOTS_PER_BATCH} shots**.", "",
        "## Experimental controls", "",
        "- COBYLA, Powell, Nelder-Mead, and SLSQP use the standard QAOA circuit and identical seeded parameter vectors within each paired configuration.",
        "- Every expected-cost evaluation is counted by a shared hard cap. SLSQP numerical finite-difference calls pass through the same counter. The reported distribution is the best evaluated parameter vector.",
        "- Exact optima are used only after optimization to score probabilities and sampled outcomes; they are not passed to the optimizer.",
        "- Statevector feasibility and optimality probabilities include all tied exact optima. Theoretical batch hit probability is `1-(1-Popt)^2048`; empirical hit rate is the fraction of independent batches with at least one hit.",
        "- No fallback is included in the optimizer distribution. If all sampled batches miss feasibility, the zero assignment is reported and `fallback_used` is true.", "",
        "## Research questions", "",
        f"1. **Optimizer comparison:** on {len(comparison_rows)} paired core runs (all 18 instances in full mode), {best_opt} has the highest mean optimal probability ({avg(best_opt, 'optimal_probability'):.6g}); {fastest} has the lowest mean runtime ({avg(fastest, 'optimizer_runtime_seconds'):.4g} s/run). This ranks this bounded matrix only.",
        f"2. **Evaluation efficiency:** mean expected-cost improvement per objective evaluation is {mean([r for r in comparison_rows if r['optimizer'] == best_opt], 'expected_cost_improvement_per_evaluation'):.6g} for {best_opt}; inspect `runtime_vs_evaluations.png` for the per-run tradeoff.",
        "3. **Budget effect:** mean optimal probabilities across A2/B2/F2 and four optimizers are " + ", ".join(f"budget {b}: {v:.5f}" for b, v in budget_means.items() if v is not None) + ". See both budget figures; this is a bounded representative-instance sensitivity, not a full Cartesian sweep.",
        "4. **Depth effect:** mean optimal probabilities across A2/B2/F2 and four optimizers are " + ", ".join(f"p={p}: {v:.5f}" for p, v in depth_means.items() if v is not None) + ".",
        ("5. **Seed robustness:** B2 mean optimal probability across four optimizers ranges "
         + (f"from {min(seed_means.values()):.5f} to {max(seed_means.values()):.5f} across {len(seed_means)} seeds." if seed_means else "seed-level results are unavailable in this mode.")),
        f"6. **Family B diagnosis:** {len(family_b)} rows; mean infeasible probability is {b_infeasible:.5f} and mean suboptimal-feasible probability is {b_suboptimal:.5f}. The lowest-probability rows below show whether mass is lost to infeasibility or feasible-but-suboptimal schedules.",
        f"7. **Finite-shot check:** mean absolute difference between theoretical and empirical batch hit rates is {statistics.fmean(hit_errors):.5f} over {len(rows)} runs, with {batches} independent batches per run. Compare the points with the diagonal in `theoretical_empirical_hit_rate.png`.", "",
        "### Lowest Family B optimal probabilities", "",
        "| Instance | Optimizer | p | Budget | Optimal P | Infeasible P | Suboptimal feasible P | Empirical batch hit rate |", "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in b_bad:
        lines.append("| {instance_id} | {optimizer} | {p} | {budget} | {optimal_probability:.5f} | {infeasible_probability:.5f} | {suboptimal_feasible_probability:.5f} | {empirical_hit_rate:.3f} |".format(**row))
    lines += ["", "## Figures", ""] + [f"- `{name}`" for name in figures]
    lines += ["", "## Limits", "", "This is an ideal noiseless statevector study over the specified finite matrix. Runtime depends on this host and SciPy/Qiskit versions. A finite batch count estimates hit probability and should not be read as a deterministic quality measure.", ""]
    return "\n".join(lines)


def run_benchmark(mode: str = "quick", *, batches: int | None = None,
                  output_dir: str | Path | None = None) -> dict[str, Any]:
    instances = build_benchmark_instances()
    config_rows = configuration_matrix(mode)
    batches = batches if batches is not None else (20 if mode == "quick" else DEFAULT_BATCHES)
    output = Path(output_dir) if output_dir else OUTPUT_ROOT / f"phase2_2_3_{mode}"
    output.mkdir(parents=True, exist_ok=True)
    config = {
        "phase": "2.2.3", "mode": mode, "created_utc": datetime.now(timezone.utc).isoformat(),
        "alpha": 0.05, "beta": 0.005, "shots_per_batch": SHOTS_PER_BATCH,
        "independent_sampling_batches": batches, "optimizers": list(OPTIMIZERS),
        "initialization": "qaoa_initialization.initial_parameters; identical paired seeds",
        "objective_budget_semantics": "hard cap on actual QAOA expected-cost calls; includes SLSQP numerical finite differences",
        "instance_ids": [x["instance_id"] for x in instances],
        "representative_instances": list(REPRESENTATIVES),
        "matrix_configuration_count": len(config_rows),
        "matrix_run_count": len(config_rows),
        "matrix": config_rows,
        "python": sys.version, "platform": platform.platform(),
        "numpy": np.__version__, "scipy": scipy.__version__, "qiskit": qiskit.__version__,
    }
    (output / "config.json").write_text(json.dumps(config, indent=2, default=str) + "\n", encoding="utf-8")
    by_id = {instance["instance_id"]: instance for instance in instances}
    rows = []
    for position, item in enumerate(config_rows, start=1):
        instance = by_id[item["instance_id"]]
        row = _run_configuration(item, instance, batches=batches)
        row["study"] = "+".join(item["studies"])
        rows.append(row)
        if position % 10 == 0 or position == len(config_rows):
            print(f"[{mode}] completed {position}/{len(config_rows)}", flush=True)
    _write_csv(output / "runs.csv", rows, CSV_FIELDS)
    summary = _summary(rows)
    summary_fields = list(summary[0]) if summary else ["study", "family", "optimizer", "p", "budget", "n"]
    _write_csv(output / "summary.csv", summary, summary_fields)
    _write_csv(output / "excluded_configurations.csv", [], ["instance_id", "p", "budget", "seed", "optimizer", "reason"])
    figures = _save_figures(rows, output)
    (output / "report.md").write_text(_report(rows, summary, mode, batches, figures), encoding="utf-8")
    return {"output_dir": str(output), "run_count": len(rows), "configuration_count": len(config_rows), "figures": figures}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("quick", "full"), nargs="?", default="quick")
    parser.add_argument("--batches", type=int, default=None)
    parser.add_argument("--output-dir", default=None)
    args = parser.parse_args()
    print(json.dumps(run_benchmark(args.mode, batches=args.batches, output_dir=args.output_dir), indent=2))


if __name__ == "__main__":
    main()

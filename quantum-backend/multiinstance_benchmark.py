"""Cross-instance generalization benchmark for compactness-aware QAOA."""

from __future__ import annotations

import argparse
import csv
import json
import platform
from collections import defaultdict
from datetime import timedelta
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import qiskit
import scipy

from benchmark_instances import (
    DEFAULT_ALPHA,
    DEFAULT_BETA,
    FAMILY_INFO,
    OPTIMALITY_TOLERANCE,
    build_benchmark_instances,
    manifest_rows,
    validate_instance,
)
from campus_adapter import parse_time
from compactness_benchmark import (
    run_configuration,
    validate_weight_configuration,
)


ROOT = Path(__file__).resolve().parent
BASELINE_SEED = 42
BASELINE_P = 2
BASELINE_MAXITER = 100
BASELINE_SHOTS = 2048
RUN_COLUMNS = [
    "experiment_id", "instance_id", "family", "family_name", "generator_seed",
    "task_count", "candidate_count", "conflict_edge_count",
    "conflict_graph_density", "scheduling_density", "priority_distribution",
    "deadline_constraints", "feasible_assignment_count",
    "complete_assignment_count", "equivalent_global_optima",
    "alpha", "beta", "p", "seed", "maxiter", "shots",
    "classical_cost", "qaoa_best_cost", "qaoa_expected_cost", "optimality_gap",
    "feasible_probability", "optimal_probability", "finite_shot_optimal_hit",
    "expected_feasible_reward", "priority_satisfaction", "priority_reward",
    "completion_time", "completion_offset_minutes", "internal_gap_minutes",
    "compactness", "scheduled_task_count", "all_tasks_completed", "is_feasible",
    "classical_priority_satisfaction", "classical_priority_reward",
    "classical_internal_gap_minutes", "classical_compactness",
    "classical_completion_offset_minutes", "classical_scheduled_task_count",
    "classical_runtime_seconds", "qaoa_runtime_seconds", "circuit_depth",
    "function_evaluations", "fallback_used", "optimizer_success",
]
EXCLUDED_COLUMNS = [
    "experiment_id", "instance_id", "family", "candidate_count", "alpha",
    "beta", "p", "seed", "maxiter", "shots", "reason",
]
SUMMARY_FIELDS = [
    "optimality_gap", "feasible_probability", "optimal_probability",
    "expected_feasible_reward", "priority_satisfaction", "internal_gap_minutes",
    "compactness", "classical_runtime_seconds", "qaoa_runtime_seconds",
    "circuit_depth", "function_evaluations",
]


def _plan(mode: str, instances: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    by_id = {item["instance_id"]: item for item in instances}
    if mode == "quick":
        maxiter, shots = 25, 256
        baseline_ids = ["A2-n5", "B1-n5", "C2-n5", "D1-n5", "E2-n5", "F1-n3"]
        depth_ids = ["A2-n5", "B1-n5", "F1-n3"]
        robustness_ids, robustness_seeds = ["F1-n3"], (42, 43)
    elif mode == "full":
        maxiter, shots = BASELINE_MAXITER, BASELINE_SHOTS
        baseline_ids = [item["instance_id"] for item in instances]
        depth_ids = ["A2-n5", "B2-n9", "D3-n12", "F1-n3"]
        robustness_ids, robustness_seeds = ["A2-n5", "B2-n9", "F1-n3"], tuple(range(42, 52))
    else:
        raise ValueError("mode must be quick or full")

    configs = []
    def add(experiment_id: str, instance_id: str, beta: float = DEFAULT_BETA,
            p: int = BASELINE_P, seed: int = BASELINE_SEED) -> None:
        configs.append({
            "experiment_id": experiment_id,
            "instance_id": instance_id,
            "beta": beta,
            "p": p,
            "seed": seed,
            "instance": by_id[instance_id],
        })

    for instance_id in baseline_ids:
        add("cross_instance", instance_id)
    for instance_id in depth_ids:
        for p in (1, 2, 3):
            add("depth", instance_id, p=p)
    for instance_id in robustness_ids:
        for seed in robustness_seeds:
            add("seed_robustness", instance_id, seed=seed)
    for beta in (0.005, 0.1):
        add("beta_sensitivity", "F1-n3", beta=beta)
    # Exercise the explicit exclusion/reporting path in both CLI modes.
    add("weight_bound_guard", "B3-n12", beta=0.02)
    return configs, {
        "maxiter": maxiter,
        "shots": shots,
        "baseline_instance_ids": baseline_ids,
        "depth_instance_ids": depth_ids,
        "robustness_instance_ids": robustness_ids,
        "robustness_seeds": list(robustness_seeds),
    }


def _run_one(config: dict[str, Any], maxiter: int, shots: int) -> dict[str, Any]:
    instance = config["instance"]
    request = instance["request"]
    result = run_configuration(
        config["experiment_id"],
        {
            "instance_id": instance["instance_id"],
            "candidate_count": instance["candidate_count"],
            "request": request,
            "candidates": instance["candidates"],
            "window_start": request["windowStart"],
            "window_end": request["windowEnd"],
        },
        alpha=DEFAULT_ALPHA,
        beta=config["beta"],
        p=config["p"],
        seed=config["seed"],
        maxiter=maxiter,
        shots=shots,
    )
    completion_time = None
    if result["completion_offset_minutes"] is not None:
        completion_time = (
            parse_time(request["windowStart"])
            + timedelta(minutes=result["completion_offset_minutes"])
        ).isoformat()
    return {
        **result,
        "instance_id": instance["instance_id"],
        "family": instance["family"],
        "family_name": instance["family_name"],
        "generator_seed": instance["generator_seed"],
        "task_count": instance["task_count"],
        "conflict_edge_count": instance["conflict_edge_count"],
        "conflict_graph_density": instance["conflict_graph_density"],
        "scheduling_density": instance["scheduling_density"],
        "priority_distribution": json.dumps(instance["priority_distribution"], sort_keys=True),
        "deadline_constraints": json.dumps(instance["deadline_constraints"], sort_keys=True),
        "feasible_assignment_count": instance["feasible_assignment_count"],
        "complete_assignment_count": instance["complete_assignment_count"],
        "equivalent_global_optima": instance["equivalent_global_optima"],
        "completion_time": completion_time,
        "finite_shot_optimal_hit": result["optimality_gap"] <= OPTIMALITY_TOLERANCE,
        "all_tasks_completed": result["scheduled_task_count"] == instance["task_count"],
    }


def aggregate_runs(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Summarize repeated measurements without merging distinct instances."""
    grouping = ["experiment_id", "family", "instance_id", "candidate_count", "beta", "p", "maxiter", "shots"]
    buckets: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        buckets[tuple(row[key] for key in grouping)].append(row)
    summaries = []
    for key, trials in sorted(buckets.items(), key=lambda pair: str(pair[0])):
        summary = dict(zip(grouping, key))
        for field in SUMMARY_FIELDS:
            values = [float(row[field]) for row in trials if row.get(field) is not None]
            if not values:
                continue
            summary[f"{field}_mean"] = float(np.mean(values))
            summary[f"{field}_std"] = float(np.std(values, ddof=1)) if len(values) > 1 else None
            summary[f"{field}_median"] = float(np.median(values))
            summary[f"{field}_min"] = float(np.min(values))
            summary[f"{field}_max"] = float(np.max(values))
        summary["trial_count"] = len(trials)
        summary["exact_optimum_hit_rate"] = float(np.mean([
            row["finite_shot_optimal_hit"] for row in trials
        ]))
        summary["seed_min"] = min(row["seed"] for row in trials)
        summary["seed_max"] = max(row["seed"] for row in trials)
        summaries.append(summary)
    return summaries


def _write_csv(path: Path, rows: list[dict[str, Any]], columns: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore", lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def _safe_corr(x: list[float], y: list[float]) -> float | None:
    if len(x) < 2 or np.std(x) == 0 or np.std(y) == 0:
        return None
    return float(np.corrcoef(x, y)[0, 1])


def _save_plots(rows: list[dict[str, Any]], output: Path) -> None:
    baseline = [row for row in rows if row["experiment_id"] == "cross_instance"]
    beta_rows = [row for row in rows if row["experiment_id"] == "beta_sensitivity"]
    depth_rows = [row for row in rows if row["experiment_id"] == "depth"]
    seed_rows = [row for row in rows if row["experiment_id"] == "seed_robustness"]

    families = sorted({row["family"] for row in baseline})
    colors = plt.get_cmap("tab10")
    fig, ax = plt.subplots(figsize=(8, 5))
    for index, family in enumerate(families):
        group = [row for row in baseline if row["family"] == family]
        ax.scatter([r["conflict_graph_density"] for r in group],
                   [r["feasible_probability"] for r in group],
                   label=f"{family}: {FAMILY_INFO[family]}", color=colors(index), s=45)
    ax.set_xlabel("Conflict graph density (edge fraction)")
    ax.set_ylabel("Ideal statevector feasible probability")
    ax.set_title("Conflict density and QAOA feasible probability")
    ax.set_ylim(0, 1)
    ax.grid(alpha=0.3)
    ax.legend(fontsize=7)
    fig.tight_layout()
    fig.savefig(output / "conflict_density_vs_feasible_probability.png", dpi=160)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(8, 5))
    for index, family in enumerate(families):
        group = [row for row in baseline if row["family"] == family]
        ax.scatter([r["scheduling_density"] for r in group],
                   [r["optimal_probability"] for r in group],
                   label=f"{family}: {FAMILY_INFO[family]}", color=colors(index), s=45)
    ax.set_xlabel("Scheduling density (task minutes / available minutes)")
    ax.set_ylabel("Ideal statevector optimal probability")
    ax.set_title("Scheduling density and QAOA optimal probability")
    ax.set_ylim(0, 1)
    ax.grid(alpha=0.3)
    ax.legend(fontsize=7)
    fig.tight_layout()
    fig.savefig(output / "scheduling_density_vs_optimal_probability.png", dpi=160)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(8, 5))
    means, stds = [], []
    for family in families:
        values = [row["optimality_gap"] for row in baseline if row["family"] == family]
        means.append(float(np.mean(values)))
        stds.append(float(np.std(values, ddof=1)) if len(values) > 1 else 0.0)
    ax.bar(families, means, yerr=stds, capsize=4, color=[colors(i) for i in range(len(families))])
    ax.set_xticks(range(len(families)), [f"{f}\n{FAMILY_INFO[f]}" for f in families], fontsize=8)
    ax.set_ylabel("Sampled optimality gap (QUBO objective)")
    ax.set_title("QAOA optimality gap by benchmark family")
    ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    fig.savefig(output / "family_optimality_gap.png", dpi=160)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(8, 5))
    hit_rates = [float(np.mean([row["finite_shot_optimal_hit"] for row in baseline if row["family"] == f])) for f in families]
    ax.bar(families, hit_rates, color=[colors(i) for i in range(len(families))])
    ax.set_xticks(range(len(families)), [f"{f}\n{FAMILY_INFO[f]}" for f in families], fontsize=8)
    ax.set_ylim(0, 1)
    ax.set_ylabel("Finite-shot exact-optimum hit rate")
    ax.set_title("Finite-shot exact-optimum hit rate by family")
    ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    fig.savefig(output / "family_exact_optimum_hit_rate.png", dpi=160)
    plt.close(fig)

    fig, ax = plt.subplots(figsize=(7, 4.5))
    beta_rows.sort(key=lambda row: row["beta"])
    if beta_rows:
        ax.plot([r["beta"] for r in beta_rows], [r["classical_internal_gap_minutes"] for r in beta_rows], marker="s", linestyle="--", label="Classical Exact")
        ax.plot([r["beta"] for r in beta_rows], [r["internal_gap_minutes"] for r in beta_rows], marker="o", label="QAOA sampled schedule")
        ax.set_xlabel("Compactness weight β")
        ax.set_ylabel("Actual internal gaps (minutes)")
        ax.set_title("Family F β sensitivity: actual schedule gaps")
        ax.grid(alpha=0.3)
        ax.legend()
    fig.tight_layout()
    fig.savefig(output / "family_f_beta_sensitivity.png", dpi=160)
    plt.close(fig)

    grouped: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for row in baseline:
        grouped[int(row["candidate_count"])].append(row)
    xs = sorted(grouped)
    fig, ax = plt.subplots(figsize=(7.5, 4.5))
    for field, label in (("classical_runtime_seconds", "Classical Exact"), ("qaoa_runtime_seconds", "QAOA statevector")):
        means = [float(np.mean([row[field] for row in grouped[n]])) for n in xs]
        stds = [float(np.std([row[field] for row in grouped[n]], ddof=1)) if len(grouped[n]) > 1 else 0.0 for n in xs]
        ax.errorbar(xs, means, yerr=stds, marker="o", capsize=4, label=label)
    ax.set_xlabel("Candidate binary variables (n)")
    ax.set_ylabel("Runtime (seconds)")
    ax.set_title("Runtime scaling across benchmark instances")
    ax.set_xticks(xs)
    ax.grid(alpha=0.3)
    ax.legend()
    fig.tight_layout()
    fig.savefig(output / "candidate_count_vs_runtime.png", dpi=160)
    plt.close(fig)

    if depth_rows:
        grouped_depth: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for row in depth_rows:
            grouped_depth[int(row["p"])].append(row)
        xs = sorted(grouped_depth)
        fig, ax = plt.subplots(figsize=(7, 4.5))
        ys = [float(np.mean([r["optimal_probability"] for r in grouped_depth[p]])) for p in xs]
        errors = [float(np.std([r["optimal_probability"] for r in grouped_depth[p]], ddof=1)) if len(grouped_depth[p]) > 1 else 0.0 for p in xs]
        ax.errorbar(xs, ys, yerr=errors, marker="o", capsize=4)
        ax.set_xlabel("QAOA layers (p)")
        ax.set_ylabel("Ideal statevector optimal probability")
        ax.set_title("Depth effects across representative instances")
        ax.set_xticks(xs)
        ax.set_ylim(0, 1)
        ax.grid(alpha=0.3)
        fig.tight_layout()
        fig.savefig(output / "depth_generalization.png", dpi=160)
        plt.close(fig)

    if seed_rows:
        grouped_seed: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for row in seed_rows:
            grouped_seed[int(row["seed"])].append(row)
        xs = sorted(grouped_seed)
        ys = [float(np.mean([row["optimality_gap"] for row in grouped_seed[seed]])) for seed in xs]
        errors = [float(np.std([row["optimality_gap"] for row in grouped_seed[seed]], ddof=1)) if len(grouped_seed[seed]) > 1 else 0.0 for seed in xs]
        fig, ax = plt.subplots(figsize=(8, 4.5))
        ax.errorbar(xs, ys, yerr=errors, marker="o", capsize=4)
        ax.set_xlabel("QAOA initialization seed")
        ax.set_ylabel("Sampled optimality gap")
        ax.set_title("Seed effects across instances")
        ax.grid(alpha=0.3)
        fig.tight_layout()
        fig.savefig(output / "seed_generalization.png", dpi=160)
        plt.close(fig)


def _report(rows: list[dict[str, Any]], excluded: list[dict[str, Any]], instances: list[dict[str, Any]], mode: str, settings: dict[str, Any]) -> str:
    baseline = [row for row in rows if row["experiment_id"] == "cross_instance"]
    family_stats = {}
    for family in sorted({row["family"] for row in baseline}):
        group = [row for row in baseline if row["family"] == family]
        family_stats[family] = {
            "gap": float(np.mean([row["optimality_gap"] for row in group])),
            "hit": float(np.mean([row["finite_shot_optimal_hit"] for row in group])),
            "optimal_prob": float(np.mean([row["optimal_probability"] for row in group])),
            "feasible_prob": float(np.mean([row["feasible_probability"] for row in group])),
        }
    conflict_corr = _safe_corr([r["conflict_graph_density"] for r in baseline], [r["feasible_probability"] for r in baseline])
    schedule_corr = _safe_corr([r["scheduling_density"] for r in baseline], [r["optimal_probability"] for r in baseline])
    lines = [
        "# Phase 2.2.1 — Multi-instance benchmark report", "",
        f"Mode: **{mode}** · Instances in dataset: **{len(instances)}** · Runs: **{len(rows)}** · Excluded/errors: **{len(excluded)}**", "",
        "## Dataset", "",
        "| Family | Structure | Instances | Candidate counts | Mean conflict density | Mean scheduling density |",
        "|---|---|---:|---|---:|---:|",
    ]
    for family in sorted(FAMILY_INFO):
        group = [item for item in instances if item["family"] == family]
        lines.append(
            f"| {family} | {FAMILY_INFO[family]} | {len(group)} | {', '.join(str(item['candidate_count']) for item in group)} | "
            f"{np.mean([item['conflict_graph_density'] for item in group]):.3f} | "
            f"{np.mean([item['scheduling_density'] for item in group]):.3f} |"
        )
    lines += ["", "Conflict density = conflict edges / all candidate pairs. Scheduling density = total requested task minutes / non-commitment minutes in the planning window. Feasible-assignment counts satisfy candidate conflict rules and may leave tasks unscheduled; complete-assignment counts select exactly one candidate for every requested task.", "",
              f"Baseline controls: α={DEFAULT_ALPHA}, β={DEFAULT_BETA}, p={BASELINE_P}, maxiter={settings['maxiter']}, shots={settings['shots']}, seed={BASELINE_SEED}. Python {settings['versions']['python']}, NumPy {settings['versions']['numpy']}, SciPy {settings['versions']['scipy']}, Qiskit {settings['versions']['qiskit']}. QAOA metrics use ideal noiseless statevector probabilities; finite-shot optimum-hit is reported separately.", "",
              "## RQ1 — Conflict density vs. feasible probability", "",
              f"Across {len(baseline)} baseline instances, Pearson correlation was {conflict_corr if conflict_corr is not None else 'n/a'} between conflict density and full-statevector feasible probability. This is an observed association in this generated dataset, not evidence that conflict density alone caused the change.", "",
              "## RQ2 — Scheduling density vs. optimal probability", "",
              f"Pearson correlation was {schedule_corr if schedule_corr is not None else 'n/a'} between scheduling density and full-statevector optimal probability across baseline instances. Instance structure and size vary together, so this is descriptive rather than causal.", "",
              "## RQ3 — Hardest families", "",
              "| Family | Gap mean ± SD | Gap median | Gap min–max | Optimal probability mean ± SD | Feasible probability mean ± SD | Exact-optimum hit rate | n |", "|---|---:|---:|---:|---:|---:|---:|---:|"]
    for family, stats in family_stats.items():
        group = [row for row in baseline if row["family"] == family]
        gaps = [row["optimality_gap"] for row in group]
        opt_probs = [row["optimal_probability"] for row in group]
        feasible_probs = [row["feasible_probability"] for row in group]
        def mean_sd(values: list[float]) -> str:
            sd = float(np.std(values, ddof=1)) if len(values) > 1 else None
            return f"{np.mean(values):.4g} ± {sd:.3g}" if sd is not None else f"{np.mean(values):.4g} ± n/a"
        lines.append(f"| {family} — {FAMILY_INFO[family]} | {mean_sd(gaps)} | {np.median(gaps):.4g} | {min(gaps):.4g}–{max(gaps):.4g} | {mean_sd(opt_probs)} | {mean_sd(feasible_probs)} | {stats['hit']:.1%} | {len(group)} |")
    hardest = max(family_stats, key=lambda family: family_stats[family]["gap"]) if family_stats else None
    lines += ["", f"By mean sampled gap, the hardest family in this run was **{hardest or 'n/a'}**. This ranking is based on three generated instances per family in full mode (one per family in quick mode).", "",
              "## RQ4 — Does β improve actual compactness?", ""]
    beta_rows = sorted([r for r in rows if r["experiment_id"] == "beta_sensitivity"], key=lambda row: row["beta"])
    if beta_rows:
        lines += ["| β | Exact internal gaps (min) | QAOA sampled internal gaps (min) | Exact compactness | QAOA compactness | Exact optimum |", "|---:|---:|---:|---:|---:|---:|"]
        for row in beta_rows:
            lines.append(f"| {row['beta']:.3f} | {row['classical_internal_gap_minutes']} | {row['internal_gap_minutes']} | {row['classical_compactness']} | {row['compactness']} | {row['classical_cost']:.6f} |")
        lines.append("")
        low, high = beta_rows[0], beta_rows[-1]
        lines.append(f"For Family F instance {low['instance_id']}, increasing β from {low['beta']} to {high['beta']} changed the exact optimum's internal gap from {low['classical_internal_gap_minutes']} to {high['classical_internal_gap_minutes']} minutes. This verifies a real compactness tradeoff for this constructed instance; it does not establish consistency across other families.")
    else:
        lines.append("No β sensitivity configurations completed.")
    lines += ["", "## RQ5 — Depth and seed generalization", ""]
    depth_rows = [row for row in rows if row["experiment_id"] == "depth"]
    if depth_rows:
        lines += ["| p | Optimal probability mean ± SD | Optimality gap mean ± SD | Runtime mean ± SD (s) | Trials |", "|---:|---:|---:|---:|---:|"]
        for p in sorted({row["p"] for row in depth_rows}):
            group = [row for row in depth_rows if row["p"] == p]
            def stat(field: str) -> str:
                values = [float(row[field]) for row in group]
                sd = float(np.std(values, ddof=1)) if len(values) > 1 else None
                return f"{np.mean(values):.4g} ± {sd:.3g}" if sd is not None else f"{np.mean(values):.4g} ± n/a"
            lines.append(f"| {p} | {stat('optimal_probability')} | {stat('optimality_gap')} | {stat('qaoa_runtime_seconds')} | {len(group)} |")
    seed_rows = [row for row in rows if row["experiment_id"] == "seed_robustness"]
    if seed_rows:
        gaps = np.asarray([row["optimality_gap"] for row in seed_rows], dtype=float)
        hits = sum(row["finite_shot_optimal_hit"] for row in seed_rows)
        lines += ["", f"Seed subset: {len(seed_rows)} runs across {len({row['instance_id'] for row in seed_rows})} instances and seeds {min(row['seed'] for row in seed_rows)}–{max(row['seed'] for row in seed_rows)}. Optimality gap mean ± SD={np.mean(gaps):.6g} ± {np.std(gaps, ddof=1) if len(gaps)>1 else 0.0:.6g}; median={np.median(gaps):.6g}, min={np.min(gaps):.6g}, max={np.max(gaps):.6g}; exact hit rate={hits}/{len(seed_rows)} ({hits/len(seed_rows):.1%}). Zero SD here would not establish robustness on unseen instances."]
    lines += ["", "## RQ6 — QAOA vs. Classical Exact", ""]
    if baseline:
        hit_count = sum(row["finite_shot_optimal_hit"] for row in baseline)
        gaps = [row["optimality_gap"] for row in baseline]
        lines.append(f"Baseline QAOA sampled an exact optimum in {hit_count}/{len(baseline)} runs ({hit_count/len(baseline):.1%}); mean gap={np.mean(gaps):.6g}, median={np.median(gaps):.6g}, range=[{min(gaps):.6g}, {max(gaps):.6g}]. Classical Exact is the benchmark optimum for the same candidate set and QUBO.")
    else:
        lines.append("No baseline comparisons completed.")
    lines += ["", "## Limitations", "", "Small QUBOs (at most 12 variables), ideal noiseless statevector simulation, finite shots, COBYLA initialization/iteration sensitivity, synthetic convenience instances, and discretized candidate starts limit generalization. Pairwise gap cost is a proxy and may not align with exact schedule fragmentation. Correlations are descriptive, not causal. No quantum advantage is claimed.", "", "## Excluded configurations and errors", ""]
    if excluded:
        lines += ["| Experiment | Instance | β | Reason |", "|---|---|---:|---|"]
        lines += [f"| {row['experiment_id']} | {row['instance_id']} | {row['beta']} | {row['reason']} |" for row in excluded]
    else:
        lines.append("None.")
    lines += ["", "## Reproducibility", "", f"Re-run with `python quantum-backend/multiinstance_benchmark.py --mode {mode} --output <directory>`. Full statevector probabilities and finite-shot outcomes are separate fields in `runs.csv`.", ""]
    return "\n".join(lines)


def run_benchmark(mode: str, output_dir: Path) -> dict[str, Any]:
    instances = build_benchmark_instances()
    configs, plan_settings = _plan(mode, instances)
    output_dir.mkdir(parents=True, exist_ok=True)
    instance_dump = []
    for instance in instances:
        instance_dump.append({key: value for key, value in instance.items() if key != "conflicts"})
    (output_dir / "instances.json").write_text(json.dumps(instance_dump, indent=2), encoding="utf-8")
    manifest = manifest_rows(instances)
    _write_csv(output_dir / "instance_manifest.csv", manifest, list(manifest[0]))

    settings = {
        "mode": mode,
        "alpha": DEFAULT_ALPHA,
        "beta": DEFAULT_BETA,
        "p": BASELINE_P,
        "maxiter": plan_settings["maxiter"],
        "shots": plan_settings["shots"],
        "seed": BASELINE_SEED,
        "seed_robustness": plan_settings["robustness_seeds"],
        "slot_minutes_by_instance": {item["instance_id"]: item["slot_minutes"] for item in instances},
        "weight_bound": "alpha*n + beta*n*(n-1)/2 < 1",
        "probability_method": "full ideal noiseless Qiskit Statevector distribution",
        "optimality_tolerance_absolute": OPTIMALITY_TOLERANCE,
        "versions": {
            "python": platform.python_version(),
            "numpy": np.__version__,
            "scipy": scipy.__version__,
            "qiskit": qiskit.__version__,
            "matplotlib": matplotlib.__version__,
        },
        **{key: value for key, value in plan_settings.items() if key not in ("maxiter", "shots")},
    }
    rows, excluded = [], []
    for index, config in enumerate(configs, start=1):
        instance = config["instance"]
        valid, reason = validate_weight_configuration(
            instance["candidate_count"], DEFAULT_ALPHA, config["beta"]
        )
        exclusion = {
            "experiment_id": config["experiment_id"],
            "instance_id": instance["instance_id"],
            "family": instance["family"],
            "candidate_count": instance["candidate_count"],
            "alpha": DEFAULT_ALPHA,
            "beta": config["beta"],
            "p": config["p"],
            "seed": config["seed"],
            "maxiter": plan_settings["maxiter"],
            "shots": plan_settings["shots"],
        }
        if not valid:
            excluded.append({**exclusion, "reason": reason})
            continue
        print(
            f"[{index}/{len(configs)}] {config['experiment_id']} "
            f"{instance['instance_id']} beta={config['beta']} p={config['p']} seed={config['seed']}",
            flush=True,
        )
        try:
            rows.append(_run_one(config, plan_settings["maxiter"], plan_settings["shots"]))
        except Exception as exc:  # Keep every failed experiment visible in the report.
            excluded.append({**exclusion, "reason": f"execution failure: {type(exc).__name__}: {exc}"})

    summary = aggregate_runs(rows)
    _write_csv(output_dir / "runs.csv", rows, RUN_COLUMNS)
    summary_columns = list(summary[0]) if summary else []
    _write_csv(output_dir / "summary.csv", summary, summary_columns)
    _write_csv(output_dir / "excluded_configurations.csv", excluded, EXCLUDED_COLUMNS)
    settings["instance_count"] = len(instances)
    settings["planned_runs"] = len(configs)
    settings["executed_runs"] = len(rows)
    settings["excluded_or_failed_runs"] = len(excluded)
    (output_dir / "config.json").write_text(json.dumps(settings, indent=2), encoding="utf-8")
    _save_plots(rows, output_dir)
    (output_dir / "report.md").write_text(_report(rows, excluded, instances, mode, settings), encoding="utf-8")
    return {"instances": instances, "runs": rows, "summary": summary, "excluded": excluded, "settings": settings}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("quick", "full"), default="quick")
    parser.add_argument("--output", type=Path, default=ROOT / "output" / "phase2_2_1_quick")
    args = parser.parse_args(argv)
    result = run_benchmark(args.mode, args.output)
    print(
        f"Instances={len(result['instances'])}, runs={len(result['runs'])}, "
        f"excluded/errors={len(result['excluded'])}; output={args.output.resolve()}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

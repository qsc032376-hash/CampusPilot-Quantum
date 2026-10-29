
"""Phase 1.8.3 — QAOA robustness benchmark."""

import csv
import json
import time
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from campus_adapter import prepare_optimization_input
from scheduling_qubo import build_scheduling_qubo
from qaoa_solver import solve_qaoa
from penalty_sensitivity import evaluate_distribution


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "output"

PENALTIES = [10, 20, 37, 50]
SEEDS = list(range(42, 52))
LAYERS = 3
MAXITER = 300
SHOTS = 2048

METRICS = [
    "feasible_probability",
    "optimal_probability",
    "expected_feasible_reward",
]


def summarize_runs(rows, metric):
    """Return mean, sample SD, and min/max for one metric."""
    values = np.asarray(
        [row[metric] for row in rows], dtype=float
    )

    if len(values) < 2:
        raise ValueError("At least two runs are required.")

    return {
        "mean": float(np.mean(values)),
        "std": float(np.std(values, ddof=1)),
        "min": float(np.min(values)),
        "max": float(np.max(values)),
    }


def run_robustness():
    OUTPUT.mkdir(parents=True, exist_ok=True)

    request = json.loads(
        (ROOT / "sample_request.json").read_text(
            encoding="utf-8"
        )
    )

    candidates = prepare_optimization_input(
        request
    )["candidates"]

    model = build_scheduling_qubo(candidates)
    conflicts = model["conflicts"]

    all_rows = []
    summary_rows = []

    print("===== QAOA ROBUSTNESS BENCHMARK =====")
    print("Candidates:", len(candidates))
    print("Layers:", LAYERS)
    print("Seeds:", SEEDS)

    for penalty in PENALTIES:
        print(f"\n===== Lambda = {penalty} =====")

        penalty_rows = []

        for seed in SEEDS:
            start = time.perf_counter()

            result = solve_qaoa(
                candidates,
                p=LAYERS,
                maxiter=MAXITER,
                shots=SHOTS,
                seed=seed,
                penalty=penalty,
            )

            elapsed = time.perf_counter() - start

            metrics = evaluate_distribution(
                result["probabilities"],
                candidates,
                conflicts,
            )

            record = {
                "penalty": penalty,
                "seed": seed,
                **metrics,
                "expected_penalized_cost": float(
                    result["expectedCost"]
                ),
                "best_sampled_cost": float(
                    result["best"]["cost"]
                ),
                "function_evaluations": int(
                    result["functionEvaluations"]
                ),
                "execution_seconds": float(elapsed),
                "optimizer_success": bool(
                    result["optimizationSuccess"]
                ),
            }

            all_rows.append(record)
            penalty_rows.append(record)

            print(
                f"seed={seed} | "
                f"P(feasible)="
                f"{metrics['feasible_probability']:.3f} | "
                f"P(optimal)="
                f"{metrics['optimal_probability']:.3f} | "
                f"Reward="
                f"{metrics['expected_feasible_reward']:.3f}"
            )

        summary = {"penalty": penalty}

        for metric in METRICS + [
            "function_evaluations",
            "execution_seconds",
        ]:
            stats = summarize_runs(penalty_rows, metric)

            summary[f"{metric}_mean"] = stats["mean"]
            summary[f"{metric}_std"] = stats["std"]
            summary[f"{metric}_min"] = stats["min"]
            summary[f"{metric}_max"] = stats["max"]

        # Best-of-10 is a separate selection procedure:
        # choose the lowest expected cost for THIS penalty.
        best = min(
            penalty_rows,
            key=lambda r: r["expected_penalized_cost"],
        )

        summary["best_seed"] = best["seed"]
        summary["best_expected_penalized_cost"] = (
            best["expected_penalized_cost"]
        )
        summary["best_feasible_probability"] = (
            best["feasible_probability"]
        )
        summary["best_optimal_probability"] = (
            best["optimal_probability"]
        )
        summary["best_expected_feasible_reward"] = (
            best["expected_feasible_reward"]
        )

        summary_rows.append(summary)

        print(
            f"Mean P(feasible): "
            f"{summary['feasible_probability_mean']:.3f}"
        )
        print(
            f"Mean P(optimal): "
            f"{summary['optimal_probability_mean']:.3f}"
        )

    # Save individual runs
    with (OUTPUT / "robustness_runs.csv").open(
        "w", newline="", encoding="utf-8"
    ) as f:
        writer = csv.DictWriter(
            f, fieldnames=list(all_rows[0])
        )
        writer.writeheader()
        writer.writerows(all_rows)

    # Save aggregated summary
    with (OUTPUT / "robustness_summary.csv").open(
        "w", newline="", encoding="utf-8"
    ) as f:
        writer = csv.DictWriter(
            f, fieldnames=list(summary_rows[0])
        )
        writer.writeheader()
        writer.writerows(summary_rows)

    with (OUTPUT / "robustness_results.json").open(
        "w", encoding="utf-8"
    ) as f:
        json.dump(
            {
                "settings": {
                    "penalties": PENALTIES,
                    "seeds": SEEDS,
                    "layers": LAYERS,
                    "maxiter": MAXITER,
                    "shots": SHOTS,
                    "simulator": "ideal-statevector",
                },
                "runs": all_rows,
                "summary": summary_rows,
            },
            f,
            indent=2,
        )

    # One figure per metric
    for metric in METRICS:
        means = np.array([
            row[f"{metric}_mean"]
            for row in summary_rows
        ])
        stds = np.array([
            row[f"{metric}_std"]
            for row in summary_rows
        ])

        multiplier = (
            100 if "probability" in metric else 1
        )

        fig, ax = plt.subplots(figsize=(8, 5))

        ax.errorbar(
            PENALTIES,
            means * multiplier,
            yerr=stds * multiplier,
            marker="o",
            capsize=5,
        )

        ax.set_xlabel("QUBO penalty lambda")
        ax.set_ylabel(
            metric.replace("_", " ").title()
        )
        ax.set_title(
            f"QAOA Robustness: {metric.replace('_', ' ').title()}"
        )
        ax.set_xticks(PENALTIES)
        ax.grid(alpha=0.3)

        if multiplier == 100:
            ax.set_ylim(0, 100)

        fig.tight_layout()
        fig.savefig(
            OUTPUT / f"robustness_{metric}.png",
            dpi=180,
        )
        plt.close(fig)

    print("\n===== ROBUSTNESS COMPLETE =====")
    print("Individual runs:", OUTPUT / "robustness_runs.csv")
    print("Summary:", OUTPUT / "robustness_summary.csv")

    return all_rows, summary_rows


if __name__ == "__main__":
    run_robustness()

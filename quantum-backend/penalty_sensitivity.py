
"""Phase 1.8.2: QAOA penalty sensitivity experiment."""

import csv
import json
import time
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from campus_adapter import prepare_optimization_input
from scheduling_qubo import build_scheduling_qubo, solve_exact
from qaoa_solver import solve_qaoa, index_to_assignment
from qubo_model import qubo_cost


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "output"

PENALTIES = [10, 20, 37, 50]
SEEDS = [42, 43, 44]
LAYERS = 3
MAXITER = 300
SHOTS = 2048


def evaluate_distribution(probabilities, candidates, conflicts):
    """Evaluate probabilities against common scheduling criteria."""
    n = len(candidates)
    weights = np.array([
        c["priorityWeight"] for c in candidates
    ], dtype=float)

    conflict_edges = [
        (pair["i"], pair["j"]) for pair in conflicts
    ]

    feasible_probability = 0.0
    optimal_probability = 0.0
    expected_feasible_reward = 0.0
    expected_violations = 0.0

    # Calculate the best feasible reward independently of penalty.
    feasible = []

    for index in range(2 ** n):
        bits = np.array(index_to_assignment(index, n))

        violations = sum(
            bool(bits[i] and bits[j])
            for i, j in conflict_edges
        )

        reward = float(weights @ bits)

        feasible.append((violations == 0, reward))

    best_reward = max(
        reward for is_valid, reward in feasible if is_valid
    )

    for index, probability in enumerate(probabilities):
        is_valid, reward = feasible[index]
        bits = index_to_assignment(index, n)

        violations = sum(
            bits[i] * bits[j]
            for i, j in conflict_edges
        )

        expected_violations += probability * violations

        if is_valid:
            feasible_probability += probability
            expected_feasible_reward += probability * reward

            if np.isclose(reward, best_reward):
                optimal_probability += probability

    return {
        "feasible_probability": float(feasible_probability),
        "optimal_probability": float(optimal_probability),
        "expected_feasible_reward": float(
            expected_feasible_reward
        ),
        "expected_violations": float(expected_violations),
        "best_feasible_reward": float(best_reward),
    }


def run_experiment():
    OUTPUT.mkdir(parents=True, exist_ok=True)

    request = json.loads(
        (ROOT / "sample_request.json").read_text(
            encoding="utf-8"
        )
    )

    candidates = prepare_optimization_input(request)[
        "candidates"
    ]

    # Conflict rules are independent of penalty.
    base = build_scheduling_qubo(candidates)
    conflicts = base["conflicts"]

    records = []

    for penalty in PENALTIES:
        print(f"\n===== Penalty λ={penalty} =====")

        trials = []

        for seed in SEEDS:
            started = time.perf_counter()

            result = solve_qaoa(
                candidates,
                p=LAYERS,
                maxiter=MAXITER,
                shots=SHOTS,
                seed=seed,
                penalty=penalty,
            )

            elapsed = time.perf_counter() - started

            metrics = evaluate_distribution(
                result["probabilities"],
                candidates,
                conflicts,
            )

            row = {
                "penalty": penalty,
                "seed": seed,
                "expected_penalized_cost": float(
                    result["expectedCost"]
                ),
                "best_sampled_cost": float(
                    result["best"]["cost"]
                ),
                "execution_seconds": elapsed,
                **metrics,
            }

            trials.append(row)
            records.append(row)

            print(
                f"seed={seed} | "
                f"P(feasible)={metrics['feasible_probability']:.3f} | "
                f"P(optimal)={metrics['optimal_probability']:.3f} | "
                f"E[valid reward]={metrics['expected_feasible_reward']:.3f}"
            )

        best = min(
            trials,
            key=lambda item: item["expected_penalized_cost"]
        )

        print(
            "Best by optimization objective:",
            f"seed={best['seed']}",
        )

    csv_path = OUTPUT / "penalty_sensitivity.csv"

    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f, fieldnames=list(records[0].keys())
        )
        writer.writeheader()
        writer.writerows(records)

    json_path = OUTPUT / "penalty_sensitivity.json"

    with json_path.open("w", encoding="utf-8") as f:
        json.dump(
            {
                "settings": {
                    "penalties": PENALTIES,
                    "seeds": SEEDS,
                    "layers": LAYERS,
                    "maxiter": MAXITER,
                    "shots": SHOTS,
                },
                "runs": records,
            },
            f,
            indent=2,
        )

    metrics_to_plot = [
        ("feasible_probability", "Feasible Probability", "%"),
        ("optimal_probability", "Optimal Probability", "%"),
        ("expected_feasible_reward", "Expected Feasible Reward", ""),
    ]

    # Separate figure for each metric.
    for metric, title, unit in metrics_to_plot:
        x_values = []
        means = []
        stds = []

        for penalty in PENALTIES:
            values = [
                r[metric] * (100 if unit == "%" else 1)
                for r in records
                if r["penalty"] == penalty
            ]

            x_values.append(penalty)
            means.append(np.mean(values))
            stds.append(np.std(values))

        fig, ax = plt.subplots(figsize=(8, 5))

        ax.errorbar(
            x_values,
            means,
            yerr=stds,
            marker="o",
            capsize=5,
        )

        ax.set_title(title)
        ax.set_xlabel("Penalty λ")
        ax.set_ylabel(title + (" (%)" if unit == "%" else ""))
        ax.set_xticks(PENALTIES)
        ax.grid(alpha=0.3)

        if unit == "%":
            ax.set_ylim(0, 100)

        fig.tight_layout()

        filename = f"penalty_{metric}.png"
        fig.savefig(OUTPUT / filename, dpi=180)
        plt.close(fig)

    print("\n===== PENALTY EXPERIMENT COMPLETE =====")
    print("CSV:", csv_path)
    print("JSON:", json_path)

    return records


if __name__ == "__main__":
    run_experiment()


"""Phase 1.8.1 — Multi-start QAOA experiment.

Uses the existing CampusPilot QAOA solver unchanged.
Compares 10 random starts for p = 1, 2, 3.
"""

import csv
import json
import time
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from campus_adapter import prepare_optimization_input
from scheduling_qubo import build_scheduling_qubo, solve_exact
from qaoa_solver import solve_qaoa
from benchmark_qaoa import (
    calculate_optimal_probability,
    calculate_feasible_probability,
)


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "output"

LAYERS = (1, 2, 3)
SEEDS = tuple(range(42, 52))
MAXITER = 300
SHOTS = 2048


def run_multistart():
    OUTPUT.mkdir(parents=True, exist_ok=True)

    request = json.loads(
        (ROOT / "sample_request.json").read_text(
            encoding="utf-8"
        )
    )

    candidates = prepare_optimization_input(request)[
        "candidates"
    ]

    model = build_scheduling_qubo(candidates)
    exact = solve_exact(candidates)
    exact_cost = float(exact["cost"])
    n = len(candidates)

    all_runs = []
    summary = []

    print("===== MULTI-START QAOA =====")
    print("Number of qubits:", n)
    print("Classical optimum:", exact_cost)
    print("Restarts per layer:", len(SEEDS))

    for p in LAYERS:
        print(f"\n===== QAOA p={p} =====")

        layer_runs = []
        start_total = time.perf_counter()

        for seed in SEEDS:
            start = time.perf_counter()

            result = solve_qaoa(
                candidates,
                p=p,
                maxiter=MAXITER,
                shots=SHOTS,
                seed=seed,
            )

            elapsed = time.perf_counter() - start

            probabilities = result["probabilities"]

            p_opt = calculate_optimal_probability(
                probabilities,
                model["Q"],
                exact_cost,
            )

            p_feasible = calculate_feasible_probability(
                probabilities,
                model["conflicts"],
                n,
            )

            record = {
                "p": p,
                "seed": seed,
                "expected_cost": float(
                    result["expectedCost"]
                ),
                "best_sampled_cost": float(
                    result["best"]["cost"]
                ),
                "optimal_probability": float(p_opt),
                "feasible_probability": float(p_feasible),
                "circuit_depth": int(
                    result["circuit"].depth()
                ),
                "execution_seconds": float(elapsed),
                "evaluations": int(
                    result["functionEvaluations"]
                ),
                "optimizer_success": bool(
                    result["optimizationSuccess"]
                ),
            }

            layer_runs.append(record)
            all_runs.append(record)

            print(
                f"seed={seed} | "
                f"E={record['expected_cost']:.4f} | "
                f"P(opt)={100*p_opt:.2f}% | "
                f"P(feasible)={100*p_feasible:.2f}%"
            )

        best = min(
            layer_runs,
            key=lambda r: r["expected_cost"],
        )

        baseline = next(
            r for r in layer_runs if r["seed"] == 42
        )

        total_seconds = time.perf_counter() - start_total

        row = {
            "p": p,
            "baseline_expected_cost": baseline["expected_cost"],
            "best_expected_cost": best["expected_cost"],
            "best_seed": best["seed"],
            "baseline_optimal_probability":
                baseline["optimal_probability"],
            "best_optimal_probability":
                best["optimal_probability"],
            "best_feasible_probability":
                best["feasible_probability"],
            "best_sampled_cost":
                best["best_sampled_cost"],
            "circuit_depth": best["circuit_depth"],
            "total_seconds": total_seconds,
        }

        summary.append(row)

        print(
            f"BEST p={p}: seed={best['seed']}, "
            f"E={best['expected_cost']:.4f}, "
            f"P(opt)={100*best['optimal_probability']:.2f}%"
        )

    # Export full individual-run results
    with (OUTPUT / "multistart_runs.csv").open(
        "w", newline="", encoding="utf-8"
    ) as f:
        writer = csv.DictWriter(
            f, fieldnames=list(all_runs[0].keys())
        )
        writer.writeheader()
        writer.writerows(all_runs)

    # Export summary for the presentation
    with (OUTPUT / "multistart_summary.csv").open(
        "w", newline="", encoding="utf-8"
    ) as f:
        writer = csv.DictWriter(
            f, fieldnames=list(summary[0].keys())
        )
        writer.writeheader()
        writer.writerows(summary)

    with (OUTPUT / "multistart_results.json").open(
        "w", encoding="utf-8"
    ) as f:
        json.dump(
            {
                "settings": {
                    "layers": list(LAYERS),
                    "seeds": list(SEEDS),
                    "maxiter": MAXITER,
                    "shots": SHOTS,
                    "exact_cost": exact_cost,
                },
                "summary": summary,
                "runs": all_runs,
            },
            f,
            indent=2,
        )

    # Visualization: separate figures
    p_values = [r["p"] for r in summary]

    plt.figure(figsize=(8, 5))
    plt.plot(
        p_values,
        [r["baseline_expected_cost"] for r in summary],
        marker="o",
        label="Seed 42 (300 iterations)",
    )
    plt.plot(
        p_values,
        [r["best_expected_cost"] for r in summary],
        marker="s",
        label="Best of 10 starts",
    )
    plt.axhline(
        exact_cost, linestyle="--",
        label="Classical optimum",
    )
    plt.xlabel("QAOA layers (p)")
    plt.ylabel("Expected cost")
    plt.title("QAOA Multi-Start Optimization")
    plt.xticks(p_values)
    plt.legend()
    plt.grid(alpha=0.3)
    plt.tight_layout()
    plt.savefig(
        OUTPUT / "multistart_cost.png", dpi=180
    )
    plt.close()

    plt.figure(figsize=(8, 5))
    plt.plot(
        p_values,
        [
            100 * r["baseline_optimal_probability"]
            for r in summary
        ],
        marker="o",
        label="Seed 42 (300 iterations)",
    )
    plt.plot(
        p_values,
        [
            100 * r["best_optimal_probability"]
            for r in summary
        ],
        marker="s",
        label="Best of 10 starts",
    )
    plt.xlabel("QAOA layers (p)")
    plt.ylabel("Optimal solution probability (%)")
    plt.title("QAOA Optimal Solution Probability")
    plt.xticks(p_values)
    plt.ylim(0, 100)
    plt.legend()
    plt.grid(alpha=0.3)
    plt.tight_layout()
    plt.savefig(
        OUTPUT / "multistart_probability.png",
        dpi=180,
    )
    plt.close()

    print("\n===== MULTI-START COMPLETE =====")
    print("Results saved to:", OUTPUT)

    return summary


if __name__ == "__main__":
    run_multistart()


"""CampusPilot Quantum — Phase 1.8 Benchmark.

Compare QAOA p=1,2,3 against an exact classical solver.
Produces CSV, JSON, and PNG results.
"""

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

LAYERS = [1, 2, 3]
SHOTS = 2048
MAXITER = 100
SEED = 42


def calculate_optimal_probability(
    probabilities,
    Q,
    exact_cost,
):
    """Probability of measuring any globally optimal bitstring."""
    n = Q.shape[0]

    probability = 0.0

    for index, p in enumerate(probabilities):
        bits = index_to_assignment(index, n)
        cost = qubo_cost(bits, Q)

        if np.isclose(cost, exact_cost, atol=1e-8):
            probability += float(p)

    return probability


def calculate_feasible_probability(
    probabilities,
    conflicts,
    n,
):
    """Total probability mass of feasible assignments."""
    forbidden_pairs = [
        (pair["i"], pair["j"])
        for pair in conflicts
    ]

    total = 0.0

    for index, probability in enumerate(probabilities):
        bits = index_to_assignment(index, n)

        feasible = all(
            not (bits[i] and bits[j])
            for i, j in forbidden_pairs
        )

        if feasible:
            total += float(probability)

    return total


def run_benchmark():
    OUTPUT.mkdir(parents=True, exist_ok=True)

    # Load existing CampusPilot sample data
    sample_file = ROOT / "sample_request.json"

    request = json.loads(
        sample_file.read_text(encoding="utf-8")
    )

    prepared = prepare_optimization_input(request)
    candidates = prepared["candidates"]

    model = build_scheduling_qubo(candidates)
    Q = model["Q"]

    n = len(candidates)

    print("=================================")
    print("CAMPUSPILOT QUANTUM BENCHMARK")
    print("=================================")
    print("Qubits:", n)
    print("QAOA layers:", LAYERS)

    # Classical exact benchmark
    start = time.perf_counter()
    classical = solve_exact(candidates)
    classical_time = time.perf_counter() - start

    exact_cost = classical["cost"]

    print("\nClassical optimum:", exact_cost)
    print("Exact solver time:", round(classical_time, 4), "s")

    results = []

    for p in LAYERS:
        print(f"\n===== QAOA p={p} =====")

        start = time.perf_counter()

        quantum = solve_qaoa(
            candidates,
            p=p,
            maxiter=MAXITER,
            shots=SHOTS,
            seed=SEED,
        )

        elapsed = time.perf_counter() - start

        probabilities = np.asarray(
            quantum["probabilities"], dtype=float
        )

        assert len(probabilities) == 2 ** n
        assert np.isclose(probabilities.sum(), 1.0)

        p_opt = calculate_optimal_probability(
            probabilities,
            Q,
            exact_cost,
        )

        p_feasible = calculate_feasible_probability(
            probabilities,
            model["conflicts"],
            n,
        )

        best_cost = float(quantum["best"]["cost"])
        gap = best_cost - exact_cost

        record = {
            "p": p,
            "qubits": n,
            "circuit_depth": quantum["circuit"].depth(),
            "best_cost": best_cost,
            "exact_cost": float(exact_cost),
            "optimality_gap": float(gap),
            "expected_cost": float(quantum["expectedCost"]),
            "optimal_probability": p_opt,
            "feasible_probability": p_feasible,
            "execution_seconds": elapsed,
            "classical_seconds": classical_time,
            "function_evaluations": quantum["functionEvaluations"],
            "optimizer_success": quantum["optimizationSuccess"],
            "shots": SHOTS,
            "seed": SEED,
        }

        results.append(record)

        print("Best cost:", best_cost)
        print("Optimality gap:", round(gap, 4))
        print("Expected cost:", round(record["expected_cost"], 4))
        print("P(optimal):", round(p_opt * 100, 2), "%")
        print("P(feasible):", round(p_feasible * 100, 2), "%")
        print("Circuit depth:", record["circuit_depth"])
        print("Execution time:", round(elapsed, 4), "s")

    # Save CSV
    csv_path = OUTPUT / "benchmark_results.csv"

    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=list(results[0].keys()),
        )
        writer.writeheader()
        writer.writerows(results)

    # Save JSON, including experiment settings
    json_path = OUTPUT / "benchmark_results.json"

    with json_path.open("w", encoding="utf-8") as f:
        json.dump(
            {
                "experiment": "CampusPilot QAOA benchmark",
                "settings": {
                    "layers": LAYERS,
                    "shots": SHOTS,
                    "maxiter": MAXITER,
                    "seed": SEED,
                },
                "results": results,
            },
            f,
            indent=2,
        )

    # Generate a 3-panel visualization
    fig, axes = plt.subplots(1, 3, figsize=(15, 4.5))

    layers = [r["p"] for r in results]

    axes[0].plot(
        layers,
        [100 * r["optimal_probability"] for r in results],
        marker="o",
    )
    axes[0].set_title("Optimal Solution Probability")
    axes[0].set_xlabel("QAOA layers (p)")
    axes[0].set_ylabel("Probability (%)")
    axes[0].set_ylim(0, 100)

    axes[1].plot(
        layers,
        [r["expected_cost"] for r in results],
        marker="o",
        label="QAOA expected cost",
    )
    axes[1].axhline(
        exact_cost,
        linestyle="--",
        label="Classical optimum",
    )
    axes[1].set_title("Optimization Cost")
    axes[1].set_xlabel("QAOA layers (p)")
    axes[1].set_ylabel("Cost")
    axes[1].legend()

    axes[2].plot(
        layers,
        [r["execution_seconds"] for r in results],
        marker="o",
        label="QAOA simulation",
    )
    axes[2].axhline(
        classical_time,
        linestyle="--",
        label="Exact classical",
    )
    axes[2].set_title("Wall-Clock Runtime")
    axes[2].set_xlabel("QAOA layers (p)")
    axes[2].set_ylabel("Seconds")
    axes[2].legend()

    for ax in axes:
        ax.set_xticks(layers)
        ax.grid(alpha=0.3)

    fig.suptitle("CampusPilot Quantum: QAOA Benchmark")
    fig.tight_layout()

    image_path = OUTPUT / "qaoa_benchmark.png"
    fig.savefig(image_path, dpi=180)
    plt.close(fig)

    print("\n===== BENCHMARK COMPLETE =====")
    print("CSV:", csv_path)
    print("JSON:", json_path)
    print("Figure:", image_path)

    return results


if __name__ == "__main__":
    run_benchmark()

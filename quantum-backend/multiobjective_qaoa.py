
"""Phase 2.0.2 — Multi-objective QAOA integration."""

import json
from pathlib import Path

from campus_adapter import prepare_optimization_input
from multiobjective_qubo import (
    build_multiobjective_qubo,
    solve_multiobjective_exact,
)
from general_qaoa import solve_qaoa_from_matrix


def solve_multiobjective_qaoa(
    candidates,
    window_start,
    window_end,
    alpha=0.05,
    p=2,
    maxiter=100,
    shots=2048,
    seed=42,
):
    """Optimize scheduling rewards and completion times."""
    model = build_multiobjective_qubo(
        candidates,
        window_start,
        window_end,
        alpha=alpha,
    )

    result = solve_qaoa_from_matrix(
        Q=model["Q"],
        candidates=candidates,
        conflicts=model["conflicts"],
        p=p,
        maxiter=maxiter,
        shots=shots,
        seed=seed,
    )

    result["alpha"] = alpha
    result["penalty"] = model["penalty"]
    result["objectiveType"] = "multiobjective"

    return result


def main():
    root = Path(__file__).resolve().parent

    request = json.loads(
        (root / "sample_request.json").read_text(
            encoding="utf-8"
        )
    )

    prepared = prepare_optimization_input(request)
    candidates = prepared["candidates"]

    print("===== CAMPUSPILOT MULTI-OBJECTIVE QAOA =====")
    print("Candidate variables:", len(candidates))

    # Exact benchmark for the NEW objective function.
    classical = solve_multiobjective_exact(
        candidates,
        request["windowStart"],
        request["windowEnd"],
        alpha=0.05,
    )

    quantum = solve_multiobjective_qaoa(
        candidates,
        request["windowStart"],
        request["windowEnd"],
        alpha=0.05,
        p=2,
        maxiter=100,
        shots=2048,
        seed=42,
    )

    classical_cost = float(classical["cost"])
    quantum_cost = float(quantum["best"]["cost"])

    print("\n===== CLASSICAL EXACT =====")
    print("Optimal cost:", classical_cost)

    for block in classical["schedule"]:
        print(
            block["title"],
            "|",
            block["start"],
            "->",
            block["end"],
        )

    print("\n===== MULTI-OBJECTIVE QAOA =====")
    print("Best sampled cost:", quantum_cost)
    print("Expected cost:", quantum["expectedCost"])
    print("Optimality gap:", quantum_cost - classical_cost)
    print("Circuit depth:", quantum["circuit"].depth())
    print("Fallback used:", quantum["fallbackUsed"])

    for block in quantum["best"]["schedule"]:
        print(
            block["title"],
            "|",
            block["start"],
            "->",
            block["end"],
        )

    print("\n===== MODEL SETTINGS =====")
    print("Alpha:", quantum["alpha"])
    print("Penalty:", quantum["penalty"])


if __name__ == "__main__":
    main()

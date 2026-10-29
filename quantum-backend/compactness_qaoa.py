
"""Phase 2.1.3 — Compactness-aware QAOA solver."""

import json
from pathlib import Path

import numpy as np

from campus_adapter import prepare_optimization_input
from compactness_qubo import (
    build_compactness_qubo,
    solve_compactness_exact,
)
from general_qaoa import solve_qaoa_from_matrix
from schedule_metrics import compare_solutions


def solve_compactness_qaoa(
    candidates,
    window_start,
    window_end,
    alpha=0.05,
    beta=0.005,
    p=2,
    maxiter=100,
    shots=2048,
    seed=42,
):
    """Optimize priority, early completion, and gap penalties.

    beta is the QUBO compactness weight, not the QAOA
    mixer angle.
    """

    model = build_compactness_qubo(
        candidates,
        window_start,
        window_end,
        alpha=alpha,
        beta=beta,
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

    return {
        **result,
        "alpha": alpha,
        "beta": beta,
        "penalty": model["penalty"],
        "objectiveType": "compactness",
    }


def compare_compactness_solvers(
    candidates,
    window_start,
    window_end,
    alpha=0.05,
    beta=0.005,
    p=2,
    maxiter=100,
    shots=2048,
    seed=42,
):
    """Compare exact and QAOA on the same compactness QUBO."""

    classical = solve_compactness_exact(
        candidates,
        window_start,
        window_end,
        alpha=alpha,
        beta=beta,
        max_variables=12,
    )

    quantum = solve_compactness_qaoa(
        candidates,
        window_start,
        window_end,
        alpha=alpha,
        beta=beta,
        p=p,
        maxiter=maxiter,
        shots=shots,
        seed=seed,
    )

    comparison = compare_solutions(
        classical,
        quantum,
        candidates,
        window_start,
        window_end,
    )

    return {
        "objectiveType": "compactness",
        "alpha": alpha,
        "beta": beta,
        "candidateCount": len(candidates),
        **comparison,
        "classicalSchedule": classical["schedule"],
        "quantumSchedule": quantum["best"]["schedule"],
    }


def main():
    root = Path(__file__).resolve().parent

    request = json.loads(
        (root / "sample_request.json").read_text(
            encoding="utf-8"
        )
    )

    prepared = prepare_optimization_input(
        request,
        slot_minutes=120,
    )

    candidates = prepared["candidates"]

    # A conservative beta for a 12-variable demonstration.
    alpha = 0.05
    beta = 0.005

    n = len(candidates)
    max_secondary = alpha * n + beta * n * (n - 1) / 2

    print("Candidate variables:", n)

    if n > 12:
        raise ValueError(
            "This QAOA demo supports at most 12 candidates."
        )

    if max_secondary >= 1:
        raise ValueError(
            "Secondary weights exceed the safe bound."
        )

    result = compare_compactness_solvers(
        candidates,
        request["windowStart"],
        request["windowEnd"],
        alpha=alpha,
        beta=beta,
        p=2,
        maxiter=100,
        shots=2048,
        seed=42,
    )

    print("\n===== COMPACTNESS QAOA =====")
    print("Alpha:", result["alpha"])
    print("Beta:", result["beta"])
    print("Optimality gap:", result["optimalityGap"])

    for name in ("classical", "quantum"):
        data = result[name]
        metrics = data["metrics"]

        print(f"\n{name.upper()}")
        print("QUBO Cost:", round(data["cost"], 6))
        print(
            "Priority Satisfaction:",
            metrics["prioritySatisfaction"],
        )
        print(
            "Completion Time:",
            metrics["completionTime"],
        )
        print(
            "Internal Gaps:",
            metrics["internalGapMinutes"],
        )
        print("Compactness:", metrics["compactness"])
        print("Feasible:", metrics["isFeasible"])

    print("\nClassical Schedule:")
    print(json.dumps(result["classicalSchedule"], indent=2))

    print("\nQuantum Schedule:")
    print(json.dumps(result["quantumSchedule"], indent=2))


if __name__ == "__main__":
    main()

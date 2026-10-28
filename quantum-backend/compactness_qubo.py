
"""Phase 2.1 — Pairwise schedule compactness QUBO."""

from itertools import product

import numpy as np

from campus_adapter import parse_time
from multiobjective_qubo import build_multiobjective_qubo
from qubo_model import qubo_cost
from scheduling_qubo import decode_schedule


def candidate_gap(a, b, window_minutes):
    """Normalized separation between two candidate intervals."""

    a_start = parse_time(a["start"])
    a_end = parse_time(a["end"])
    b_start = parse_time(b["start"])
    b_end = parse_time(b["end"])

    if a_end <= a_start or b_end <= b_start:
        raise ValueError("Candidate interval must be positive.")

    if a_end <= b_start:
        minutes = (b_start - a_end).total_seconds() / 60
    elif b_end <= a_start:
        minutes = (a_start - b_end).total_seconds() / 60
    else:
        minutes = 0.0

    return minutes / window_minutes


def build_compactness_qubo(
    candidates,
    window_start,
    window_end,
    alpha=0.05,
    beta=0.10,
):
    """Build priority + early completion + pairwise gap QUBO.

    alpha and beta must be small enough that secondary costs
    cannot reverse a full unit of integer priority reward.
    """

    n = len(candidates)

    if n == 0:
        raise ValueError("At least one candidate is required.")

    if not np.isfinite(alpha) or alpha < 0:
        raise ValueError("alpha must be nonnegative and finite.")

    if not np.isfinite(beta) or beta < 0:
        raise ValueError("beta must be nonnegative and finite.")

    max_pairs = n * (n - 1) // 2

    if alpha * n + beta * max_pairs >= 1:
        raise ValueError(
            "Secondary objective weights are too large. "
            "Require alpha*n + beta*n*(n-1)/2 < 1."
        )

    start = parse_time(window_start)
    end = parse_time(window_end)

    window_minutes = (end - start).total_seconds() / 60

    if window_minutes <= 0:
        raise ValueError("Invalid optimization window.")

    # Existing model handles:
    # - priority rewards
    # - feasibility/conflicts
    # - early completion
    model = build_multiobjective_qubo(
        candidates,
        window_start,
        window_end,
        alpha=alpha,
    )

    Q = np.asarray(model["Q"], dtype=float).copy()
    gap_matrix = np.zeros((n, n), dtype=float)

    # x^T Q x contains 2*Q[i,j]*x_i*x_j for i != j.
    # Therefore add half the desired pairwise coefficient
    # to each symmetric off-diagonal entry.
    for i in range(n):
        for j in range(i + 1, n):
            gap = candidate_gap(
                candidates[i],
                candidates[j],
                window_minutes,
            )

            gap_matrix[i, j] = gap
            gap_matrix[j, i] = gap

            extra = beta * gap / 2.0
            Q[i, j] += extra
            Q[j, i] += extra

    return {
        **model,
        "Q": Q,
        "alpha": alpha,
        "beta": beta,
        "gapMatrix": gap_matrix,
        "objectiveType": "compactness",
    }


def solve_compactness_exact(
    candidates,
    window_start,
    window_end,
    alpha=0.05,
    beta=0.10,
    max_variables=20,
):
    """Exhaustive classical benchmark for the compactness QUBO."""

    n = len(candidates)

    if n > max_variables:
        raise ValueError(
            f"Exact solver supports at most "
            f"{max_variables} variables."
        )

    model = build_compactness_qubo(
        candidates,
        window_start,
        window_end,
        alpha=alpha,
        beta=beta,
    )

    Q = model["Q"]
    conflicts = model["conflicts"]

    best_assignment = None
    best_cost = float("inf")

    for bits in product((0, 1), repeat=n):
        # Reject invalid assignments explicitly.
        valid = all(
            not (bits[pair["i"]] and bits[pair["j"]])
            for pair in conflicts
        )

        if not valid:
            continue

        cost = float(qubo_cost(bits, Q))

        if cost < best_cost - 1e-10:
            best_cost = cost
            best_assignment = bits

    if best_assignment is None:
        raise ValueError("No feasible assignment found.")

    return {
        "assignment": list(best_assignment),
        "cost": best_cost,
        "schedule": decode_schedule(
            best_assignment,
            candidates,
            conflicts,
        ),
        "model": model,
    }


"""CampusPilot Phase 2.0 — Multi-objective scheduling QUBO.

Primary: maximize completed task priority.
Secondary: prefer earlier task completion.
Hard constraints: forbid duplicate tasks and time overlaps.
"""

from itertools import product

import numpy as np

from campus_adapter import parse_time
from scheduling_qubo import (
    build_scheduling_qubo,
    decode_schedule,
)
from qubo_model import qubo_cost, qubo_to_ising


def build_multiobjective_qubo(
    candidates,
    window_start,
    window_end,
    alpha=0.05,
):
    """
    Build a symmetric QUBO matrix.

    Reward and hard constraints are inherited from Phase 1.6.
    An additional diagonal penalty rewards earlier completion.

    Assumes positive integer-valued priority weights.
    """
    start = parse_time(window_start)
    end = parse_time(window_end)

    total_seconds = (end - start).total_seconds()

    if total_seconds <= 0:
        raise ValueError("Invalid scheduling window.")

    if not np.isfinite(alpha) or alpha < 0:
        raise ValueError("alpha must be finite and nonnegative.")

    n = len(candidates)

    for candidate in candidates:
        weight = candidate["priorityWeight"]

        if (
            isinstance(weight, bool)
            or not isinstance(weight, (int, np.integer))
            or weight < 1
        ):
            raise ValueError(
                "Priority weights must be positive integers."
            )

    # If priority rewards differ by at least 1,
    # keep the total timing penalty strictly below 1.
    if n > 0 and alpha * n >= 1:
        raise ValueError(
            "alpha is too large to preserve priority dominance."
        )

    normalized_end_times = []

    for candidate in candidates:
        task_start = parse_time(candidate["start"])
        task_end = parse_time(candidate["end"])

        if (
            task_start < start
            or task_end > end
            or task_end <= task_start
        ):
            raise ValueError(
                "Candidate lies outside the scheduling window."
            )

        normalized = (
            (task_end - start).total_seconds()
            / total_seconds
        )

        normalized_end_times.append(normalized)

    # A conservative conflict penalty.
    total_reward = sum(
        candidate["priorityWeight"]
        for candidate in candidates
    )

    penalty = float(total_reward + alpha * n + 1.0)

    model = build_scheduling_qubo(
        candidates,
        penalty=penalty,
    )

    Q = model["Q"].copy()

    # Add early-completion costs to the QUBO diagonal.
    for i, normalized in enumerate(normalized_end_times):
        Q[i, i] += alpha * normalized

    return {
        "Q": Q,
        "variableCount": n,
        "conflicts": model["conflicts"],
        "penalty": penalty,
        "alpha": alpha,
        "normalizedEndTimes": normalized_end_times,
    }


def solve_multiobjective_exact(
    candidates,
    window_start,
    window_end,
    alpha=0.05,
    max_variables=20,
):
    """Exact reference solver for small demonstration instances."""
    model = build_multiobjective_qubo(
        candidates,
        window_start,
        window_end,
        alpha=alpha,
    )

    Q = model["Q"]
    n = len(candidates)

    if n > max_variables:
        raise ValueError("Too many variables for exact search.")

    best_cost = float("inf")
    best_assignment = None

    for assignment in product((0, 1), repeat=n):
        cost = float(qubo_cost(assignment, Q))

        if cost < best_cost:
            best_cost = cost
            best_assignment = assignment

    schedule = decode_schedule(
        best_assignment,
        candidates,
        model["conflicts"],
    )

    return {
        "assignment": best_assignment,
        "cost": best_cost,
        "schedule": schedule,
        "model": model,
    }


def build_multiobjective_ising(
    candidates,
    window_start,
    window_end,
    alpha=0.05,
):
    """Generate Ising coefficients for future QAOA integration."""
    model = build_multiobjective_qubo(
        candidates,
        window_start,
        window_end,
        alpha=alpha,
    )

    c, h, J = qubo_to_ising(model["Q"])

    return {
        "constant": c,
        "linear": h,
        "couplings": J,
        "variableCount": model["variableCount"],
    }


if __name__ == "__main__":
    import json
    from pathlib import Path

    from campus_adapter import prepare_optimization_input

    root = Path(__file__).resolve().parent

    request = json.loads(
        (root / "sample_request.json").read_text(
            encoding="utf-8"
        )
    )

    prepared = prepare_optimization_input(request)
    candidates = prepared["candidates"]

    result = solve_multiobjective_exact(
        candidates,
        request["windowStart"],
        request["windowEnd"],
    )

    print("===== MULTI-OBJECTIVE QUBO =====")
    print("Candidate variables:", len(candidates))
    print("Alpha:", result["model"]["alpha"])
    print("Penalty:", result["model"]["penalty"])
    print("Optimal cost:", result["cost"])

    print("\nOptimized schedule:")

    for block in result["schedule"]:
        print(
            block["title"],
            "|",
            block["start"],
            "->",
            block["end"],
        )

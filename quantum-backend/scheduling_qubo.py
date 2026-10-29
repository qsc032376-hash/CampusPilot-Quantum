
"""Build a multi-slot scheduling QUBO for CampusPilot."""

from itertools import product

import numpy as np

from campus_adapter import parse_time, overlaps
from qubo_model import qubo_cost, qubo_to_ising


def build_scheduling_qubo(candidates, penalty=None):
    """
    Build symmetric QUBO matrix Q.

    Objective:
        reward + task-conflict penalty
               + time-overlap penalty

    Each candidate corresponds to one binary variable.
    """
    n = len(candidates)
    weights = []

    for candidate in candidates:
        weight = float(candidate["priorityWeight"])

        if not np.isfinite(weight) or weight < 0:
            raise ValueError("Invalid priority weight.")

        start = parse_time(candidate["start"])
        end = parse_time(candidate["end"])

        if end <= start:
            raise ValueError("Invalid candidate interval.")

        weights.append(weight)

    if penalty is None:
        penalty = sum(weights) + 1.0

    penalty = float(penalty)

    if not np.isfinite(penalty) or penalty <= 0:
        raise ValueError("Penalty must be positive and finite.")

    Q = np.zeros((n, n), dtype=float)
    conflict_pairs = []

    # Reward for choosing each candidate
    for i in range(n):
        Q[i, i] = -weights[i]

    # Pairwise constraints
    for i in range(n):
        for j in range(i + 1, n):
            a = candidates[i]
            b = candidates[j]

            same_task = a["taskId"] == b["taskId"]

            time_conflict = overlaps(
                parse_time(a["start"]),
                parse_time(a["end"]),
                parse_time(b["start"]),
                parse_time(b["end"]),
            )

            # Candidates of the same task must be exclusive.
            # Different tasks must not overlap.
            if same_task or time_conflict:
                Q[i, j] = penalty / 2
                Q[j, i] = penalty / 2

                conflict_pairs.append({
                    "i": i,
                    "j": j,
                    "reason": (
                        "same-task"
                        if same_task
                        else "time-overlap"
                    ),
                })

    return {
        "Q": Q,
        "penalty": penalty,
        "conflicts": conflict_pairs,
        "variableCount": n,
    }


def is_feasible(assignment, conflicts):
    """Check that no forbidden candidate pair is selected."""
    for pair in conflicts:
        if assignment[pair["i"]] and assignment[pair["j"]]:
            return False
    return True


def decode_schedule(assignment, candidates, conflicts):
    """Decode a feasible binary assignment into study blocks."""
    if len(assignment) != len(candidates):
        raise ValueError("Assignment has incorrect length.")

    if any(bit not in (0, 1) for bit in assignment):
        raise ValueError("Assignment must be binary.")

    if not is_feasible(assignment, conflicts):
        raise ValueError("Assignment violates scheduling constraints.")

    blocks = []

    for i, bit in enumerate(assignment):
        if bit == 1:
            candidate = candidates[i]

            blocks.append({
                "taskId": candidate["taskId"],
                "title": candidate["title"],
                "start": candidate["start"],
                "end": candidate["end"],
            })

    return sorted(blocks, key=lambda block: block["start"])


def solve_exact(candidates, max_variables=20):
    """
    Exhaustive classical solver for small examples.

    Used to validate QUBO results, not as a scalable solver.
    """
    model = build_scheduling_qubo(candidates)

    Q = model["Q"]
    n = model["variableCount"]

    if n > max_variables:
        raise ValueError("Too many variables for exhaustive search.")

    best_bits = None
    best_cost = float("inf")

    for bits in product((0, 1), repeat=n):
        cost = qubo_cost(bits, Q)

        if cost < best_cost:
            best_cost = cost
            best_bits = bits

    schedule = decode_schedule(
        best_bits,
        candidates,
        model["conflicts"],
    )

    return {
        "assignment": best_bits,
        "cost": best_cost,
        "schedule": schedule,
        "model": model,
    }


def build_ising_model(candidates):
    """Prepare Hamiltonian coefficients for the QAOA engineer."""
    model = build_scheduling_qubo(candidates)

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

    path = Path(__file__).with_name("sample_request.json")
    request = json.loads(path.read_text(encoding="utf-8"))

    prepared = prepare_optimization_input(request)
    candidates = prepared["candidates"]

    result = solve_exact(candidates)

    print("Candidate variables:", len(candidates))
    print("Penalty:", result["model"]["penalty"])
    print("Optimal cost:", result["cost"])

    print("\nOptimal schedule:")

    for block in result["schedule"]:
        print(
            block["title"],
            "|",
            block["start"],
            "to",
            block["end"],
        )

    print("\nIsing Hamiltonian prepared successfully.")

    ising = build_ising_model(candidates)
    print("Constant:", ising["constant"])
    print("Linear coefficients:", ising["linear"])

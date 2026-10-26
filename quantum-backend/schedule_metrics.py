
"""CampusPilot Phase 2.0.3 — Schedule quality metrics.

Evaluate scheduling quality independently of the solver.
Compatible with classical exact and QAOA assignments.
"""

from datetime import datetime
from typing import Any

import numpy as np

from campus_adapter import parse_time, overlaps
from qubo_model import qubo_cost


def evaluate_schedule(
    assignment,
    candidates,
    conflicts,
    window_start,
    window_end,
) -> dict[str, Any]:
    """Evaluate one binary scheduling assignment."""

    start = parse_time(window_start)
    end = parse_time(window_end)

    if start >= end:
        raise ValueError("Invalid scheduling window.")

    n = len(candidates)

    if len(assignment) != n:
        raise ValueError("Assignment length mismatch.")

    if any(bit not in (0, 1) for bit in assignment):
        raise ValueError("Assignment must be binary.")

    # Validate candidates and collect unique task weights.
    task_weights = {}
    intervals = []

    for candidate in candidates:
        task_id = candidate["taskId"]
        weight = float(candidate["priorityWeight"])
        begin = parse_time(candidate["start"])
        finish = parse_time(candidate["end"])

        if not task_id:
            raise ValueError("Invalid task ID.")

        if not np.isfinite(weight) or weight <= 0:
            raise ValueError("Invalid priority weight.")

        if begin < start or finish > end or begin >= finish:
            raise ValueError("Invalid candidate time interval.")

        if task_id in task_weights:
            if not np.isclose(task_weights[task_id], weight):
                raise ValueError(
                    "Inconsistent weights for the same task."
                )
        else:
            task_weights[task_id] = weight

        intervals.append((begin, finish))

    # Validate and count selected conflict edges.
    violations = 0

    for pair in conflicts:
        i, j = pair["i"], pair["j"]

        if (
            type(i) is not int
            or type(j) is not int
            or not (0 <= i < n)
            or not (0 <= j < n)
            or i == j
        ):
            raise ValueError("Invalid conflict pair.")

        if assignment[i] and assignment[j]:
            violations += 1

    # Independently detect duplicates and time overlaps.
    selected_indices = [
        i for i, bit in enumerate(assignment) if bit == 1
    ]

    selected_tasks = set()
    duplicate_pairs = 0
    overlap_pairs = 0

    for position, i in enumerate(selected_indices):
        task_i = candidates[i]["taskId"]
        selected_tasks.add(task_i)

        for j in selected_indices[position + 1:]:
            if task_i == candidates[j]["taskId"]:
                duplicate_pairs += 1
            elif overlaps(
                intervals[i][0],
                intervals[i][1],
                intervals[j][0],
                intervals[j][1],
            ):
                overlap_pairs += 1

    # Union of detected violations, so incomplete conflict
    # metadata cannot incorrectly mark a schedule as feasible.
    is_feasible = (
        violations == 0
        and duplicate_pairs == 0
        and overlap_pairs == 0
    )

    total_priority = sum(task_weights.values())

    satisfied_priority = sum(
        task_weights[task_id]
        for task_id in selected_tasks
    )

    priority_ratio = (
        satisfied_priority / total_priority
        if total_priority > 0 else None
    )

    selected_intervals = sorted(
        [intervals[i] for i in selected_indices],
        key=lambda interval: interval[0],
    )

    total_minutes = sum(
        (finish - begin).total_seconds() / 60
        for begin, finish in selected_intervals
    )

    # Gap calculation applies to non-overlapping schedules.
    internal_gap_minutes = None
    compactness = None

    if not selected_intervals:
        completion_time = None
        completion_offset_minutes = None

    else:
        latest_end = max(
            finish for _, finish in selected_intervals
        )
        completion_time = latest_end.isoformat()
        completion_offset_minutes = (
            latest_end - start
        ).total_seconds() / 60

        if is_feasible:
            internal_gap_minutes = sum(
                max(
                    0.0,
                    (selected_intervals[i + 1][0]
                     - selected_intervals[i][1]
                    ).total_seconds() / 60,
                )
                for i in range(len(selected_intervals) - 1)
            )

            compactness = (
                total_minutes /
                (total_minutes + internal_gap_minutes)
            )

    return {
        "selectedCandidateCount": len(selected_indices),
        "selectedTaskCount": len(selected_tasks),
        "availableTaskCount": len(task_weights),
        "priorityReward": float(satisfied_priority),
        "totalPriority": float(total_priority),
        "prioritySatisfaction": priority_ratio,
        "completionTime": completion_time,
        "completionOffsetMinutes": completion_offset_minutes,
        "scheduledMinutes": float(total_minutes),
        "internalGapMinutes": internal_gap_minutes,
        "compactness": compactness,
        "conflictViolations": violations,
        "duplicateTaskPairs": duplicate_pairs,
        "overlapPairs": overlap_pairs,
        "isFeasible": is_feasible,
    }


def compare_solutions(
    classical,
    quantum,
    candidates,
    window_start,
    window_end,
):
    """Compare exact and QAOA results on one common QUBO."""

    exact_model = classical["model"]
    Q = np.asarray(exact_model["Q"], dtype=float)
    quantum_Q = np.asarray(quantum["Q"], dtype=float)

    if Q.shape != quantum_Q.shape or not np.allclose(
        Q, quantum_Q, rtol=1e-10, atol=1e-10
    ):
        raise ValueError(
            "Classical and quantum QUBO matrices differ."
        )

    conflicts = exact_model["conflicts"]

    exact_bits = classical["assignment"]
    quantum_bits = quantum["best"]["assignment"]

    exact_cost = float(qubo_cost(exact_bits, Q))
    quantum_cost = float(qubo_cost(quantum_bits, Q))

    classical_metrics = evaluate_schedule(
        exact_bits,
        candidates,
        conflicts,
        window_start,
        window_end,
    )

    quantum_metrics = evaluate_schedule(
        quantum_bits,
        candidates,
        conflicts,
        window_start,
        window_end,
    )

    if not classical_metrics["isFeasible"]:
        raise ValueError("Classical solution is infeasible.")

    if not quantum_metrics["isFeasible"]:
        raise ValueError("Quantum solution is infeasible.")

    gap = quantum_cost - exact_cost

    if gap < -1e-8:
        raise ValueError(
            "Quantum result is below the exact optimum."
        )

    return {
        "classical": {
            "cost": exact_cost,
            "metrics": classical_metrics,
        },
        "quantum": {
            "cost": quantum_cost,
            "metrics": quantum_metrics,
            "circuitDepth": quantum["circuit"].depth(),
            "expectedCost": float(quantum["expectedCost"]),
            "fallbackUsed": bool(
                quantum.get("fallbackUsed", False)
            ),
        },
        "optimalityGap": max(0.0, gap),
        "sameOptimalValue": abs(gap) <= 1e-8,
    }

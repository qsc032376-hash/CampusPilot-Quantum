
"""Compare schedule quality across classical and QAOA solvers."""

import json
from pathlib import Path

from campus_adapter import prepare_optimization_input
from multiobjective_qubo import solve_multiobjective_exact
from multiobjective_qaoa import solve_multiobjective_qaoa
from schedule_metrics import compare_solutions


ROOT = Path(__file__).resolve().parent


def main():
    request = json.loads(
        (ROOT / "sample_request.json").read_text(
            encoding="utf-8"
        )
    )

    candidates = prepare_optimization_input(request)[
        "candidates"
    ]

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

    comparison = compare_solutions(
        classical,
        quantum,
        candidates,
        request["windowStart"],
        request["windowEnd"],
    )

    print("\n===== SCHEDULE QUALITY COMPARISON =====")

    for name in ("classical", "quantum"):
        data = comparison[name]
        metrics = data["metrics"]

        print(f"\n{name.upper()}")
        print("QUBO Cost:", round(data["cost"], 4))
        print("Selected Tasks:", metrics["selectedTaskCount"])
        print("Priority Reward:", metrics["priorityReward"])
        print("Priority Satisfaction:",
              metrics["prioritySatisfaction"])
        print("Completion Time:", metrics["completionTime"])
        print("Internal Gap (minutes):",
              metrics["internalGapMinutes"])
        print("Compactness:", metrics["compactness"])
        print("Feasible:", metrics["isFeasible"])

    print("\nOptimality Gap:", comparison["optimalityGap"])
    print("Same Optimal Value:", comparison["sameOptimalValue"])


if __name__ == "__main__":
    main()

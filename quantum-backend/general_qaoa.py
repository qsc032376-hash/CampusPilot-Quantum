
"""Phase 2.0.2 — General-purpose QUBO QAOA solver.

Accepts an externally constructed symmetric QUBO matrix.
Uses Qiskit statevector simulation and SciPy COBYLA.
"""

import numpy as np
from scipy.optimize import minimize

from qaoa_solver import (
    create_qaoa_circuit,
    get_probabilities,
    index_to_assignment,
    expected_cost,
)
from qubo_model import qubo_cost, qubo_to_ising
from scheduling_qubo import decode_schedule


def validate_qubo(Q, candidates, conflicts):
    """Validate a QUBO and its candidate mapping."""
    Q = np.asarray(Q, dtype=float)

    if Q.ndim != 2 or Q.shape[0] != Q.shape[1]:
        raise ValueError("Q must be a square matrix.")

    n = Q.shape[0]

    if not 1 <= n <= 12:
        raise ValueError(
            "Statevector demo supports 1-12 variables."
        )

    if n != len(candidates):
        raise ValueError(
            "Q dimension does not match candidate count."
        )

    if not np.all(np.isfinite(Q)):
        raise ValueError("Q contains non-finite values.")

    if not np.allclose(Q, Q.T):
        raise ValueError("Q must be symmetric.")

    for pair in conflicts:
        i = pair["i"]
        j = pair["j"]

        if (
            type(i) is not int
            or type(j) is not int
            or i < 0
            or j < 0
            or i >= n
            or j >= n
            or i == j
        ):
            raise ValueError("Invalid conflict pair.")

    return Q


def solve_qaoa_from_matrix(
    Q,
    candidates,
    conflicts,
    p=1,
    maxiter=100,
    shots=2048,
    seed=42,
):
    """
    Solve an arbitrary symmetric QUBO with QAOA.

    Returns the lowest-cost feasible sampled assignment.

    This is an approximate solver, not a guarantee of
    global optimality.
    """
    Q = validate_qubo(Q, candidates, conflicts)

    if (
        type(p) is not int
        or type(maxiter) is not int
        or type(shots) is not int
        or p < 1
        or maxiter < 1
        or shots < 1
    ):
        raise ValueError(
            "p, maxiter and shots must be positive integers."
        )

    n = len(candidates)

    c, h, J = qubo_to_ising(Q)

    def objective(params):
        gammas = params[:p]
        betas = params[p:]

        circuit = create_qaoa_circuit(
            h, J, gammas, betas
        )

        probabilities = get_probabilities(circuit)

        return expected_cost(probabilities, Q)

    rng = np.random.default_rng(seed)

    initial_params = np.concatenate([
        rng.uniform(0, np.pi, size=p),
        rng.uniform(0, np.pi / 2, size=p),
    ])

    optimization = minimize(
        objective,
        initial_params,
        method="COBYLA",
        options={"maxiter": maxiter},
    )

    params = optimization.x

    circuit = create_qaoa_circuit(
        h,
        J,
        params[:p],
        params[p:],
    )

    probabilities = get_probabilities(circuit)

    # Simulate finite-shot measurements.
    sampled_indices = rng.choice(
        len(probabilities),
        size=shots,
        p=probabilities,
    )

    unique_indices, counts = np.unique(
        sampled_indices,
        return_counts=True,
    )

    solutions = []

    for index, count in zip(unique_indices, counts):
        bits = index_to_assignment(int(index), n)

        try:
            schedule = decode_schedule(
                bits,
                candidates,
                conflicts,
            )
        except ValueError:
            continue

        solutions.append({
            "assignment": bits,
            "cost": float(qubo_cost(bits, Q)),
            "schedule": schedule,
            "counts": int(count),
            "probability": float(probabilities[index]),
        })

    # The all-zero assignment is always feasible under
    # the scheduling conflict model. Use it only if
    # sampling found no feasible assignment.
    if not solutions:
        zero_bits = tuple(0 for _ in range(n))

        best = {
            "assignment": zero_bits,
            "cost": float(qubo_cost(zero_bits, Q)),
            "schedule": [],
            "counts": 0,
            "probability": float(probabilities[0]),
        }

        fallback_used = True
    else:
        best = min(
            solutions,
            key=lambda item: item["cost"],
        )
        fallback_used = False

    return {
        "best": best,
        "expectedCost": float(
            expected_cost(probabilities, Q)
        ),
        "parameters": params,
        "circuit": circuit,
        "probabilities": probabilities,
        "optimizationSuccess": bool(
            optimization.success
        ),
        "functionEvaluations": int(
            optimization.nfev
        ),
        "shots": shots,
        "Q": Q,
        "isingConstant": c,
        "fallbackUsed": fallback_used,
        "feasibleSampleCount": sum(
            item["counts"] for item in solutions
        ),
    }

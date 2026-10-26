
"""CampusPilot Quantum: QAOA scheduling solver.

Ideal statevector simulator; no quantum hardware required.
"""

import json
from pathlib import Path

import numpy as np
from scipy.optimize import minimize
from qiskit import QuantumCircuit
from qiskit.quantum_info import Statevector

from campus_adapter import prepare_optimization_input
from scheduling_qubo import (
    build_scheduling_qubo,
    decode_schedule,
    solve_exact,
)
from qubo_model import qubo_cost, qubo_to_ising


def create_qaoa_circuit(h, J, gammas, betas):
    """
    Create a standard QAOA circuit.

    Cost Hamiltonian:
      H = cI + sum(h_i Z_i) + sum(J_ij Z_i Z_j)

    The constant c contributes only a global phase.
    """
    n = len(h)
    if len(gammas) != len(betas) or len(gammas) == 0:
        raise ValueError("Invalid QAOA layer parameters.")

    if np.shape(J) != (n, n):
        raise ValueError("Invalid coupling matrix.")

    qc = QuantumCircuit(n)

    # Uniform superposition
    qc.h(range(n))

    for gamma, beta in zip(gammas, betas):

        # Cost evolution: exp(-i gamma H_C)
        for i in range(n):
            if abs(h[i]) > 1e-12:
                qc.rz(2 * gamma * h[i], i)

        for i in range(n):
            for j in range(i + 1, n):
                if abs(J[i, j]) > 1e-12:
                    qc.rzz(2 * gamma * J[i, j], i, j)

        # Mixer evolution: exp(-i beta H_M)
        for i in range(n):
            qc.rx(2 * beta, i)

    return qc


def get_probabilities(circuit):
    """Return probabilities indexed by Qiskit's basis integer."""
    state = Statevector.from_instruction(circuit)
    return np.asarray(state.probabilities(), dtype=float)


def index_to_assignment(index, n):
    """
    Convert basis index to candidate-order bits.

    Qiskit uses little-endian qubit indexing.
    Qubit 0 corresponds to candidate 0.
    """
    return tuple((index >> i) & 1 for i in range(n))


def expected_cost(probabilities, Q):
    """Compute expected QUBO objective from a statevector."""
    n = Q.shape[0]
    total = 0.0

    for index, probability in enumerate(probabilities):
        bits = index_to_assignment(index, n)
        total += probability * qubo_cost(bits, Q)

    return float(total)


def solve_qaoa(
    candidates,
    p=1,
    maxiter=100,
    shots=2048,
    seed=42,
):
    """Optimize a QAOA circuit and sample candidate schedules."""
    if p < 1 or maxiter < 1 or shots < 1:
        raise ValueError("p, maxiter and shots must be positive.")

    model = build_scheduling_qubo(candidates)
    Q = model["Q"]
    n = len(candidates)

    if n < 1 or n > 12:
        raise ValueError(
            "This educational statevector demo supports 1-12 bits."
        )

    c, h, J = qubo_to_ising(Q)

    def objective(params):
        gammas = params[:p]
        betas = params[p:]

        circuit = create_qaoa_circuit(h, J, gammas, betas)
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
        h, J, params[:p], params[p:]
    )

    probabilities = get_probabilities(circuit)

    # Simulate finite measurement shots.
    sampled_indices = rng.choice(
        len(probabilities),
        size=shots,
        p=probabilities,
    )

    # Postprocess only observed, feasible assignments.
    solutions = []

    for index in sorted(set(sampled_indices)):
        bits = index_to_assignment(int(index), n)

        try:
            schedule = decode_schedule(
                bits,
                candidates,
                model["conflicts"],
            )
        except ValueError:
            continue

        solutions.append({
            "assignment": bits,
            "cost": qubo_cost(bits, Q),
            "schedule": schedule,
            "counts": int(np.sum(sampled_indices == index)),
            "probability": float(probabilities[index]),
        })

    if not solutions:
        raise RuntimeError(
            "No feasible assignment found in sampled shots."
        )

    best = min(solutions, key=lambda item: item["cost"])

    return {
        "best": best,
        "expectedCost": expected_cost(probabilities, Q),
        "parameters": params,
        "circuit": circuit,
        "probabilities": probabilities,
        "optimizationSuccess": bool(optimization.success),
        "functionEvaluations": int(optimization.nfev),
        "shots": shots,
        "Q": Q,
        "isingConstant": c,
    }


def main():
    sample_path = Path(__file__).with_name("sample_request.json")

    request = json.loads(
        sample_path.read_text(encoding="utf-8")
    )

    prepared = prepare_optimization_input(request)
    candidates = prepared["candidates"]

    print("===== CAMPUSPILOT QUANTUM =====")
    print("Candidate variables:", len(candidates))

    # Classical benchmark
    classical = solve_exact(candidates)

    print("\nClassical optimum:", classical["cost"])

    # Quantum approximate optimization
    quantum = solve_qaoa(
        candidates,
        p=1,
        maxiter=100,
        shots=2048,
        seed=42,
    )

    print("\n===== QAOA RESULTS =====")
    print("Best sampled cost:", quantum["best"]["cost"])
    print("Expected cost:", round(quantum["expectedCost"], 4))
    print("Optimization success:", quantum["optimizationSuccess"])
    print("Function evaluations:", quantum["functionEvaluations"])

    print("\n===== QUANTUM SCHEDULE =====")

    for block in quantum["best"]["schedule"]:
        print(
            block["title"],
            block["start"],
            "->",
            block["end"],
        )

    print("\n===== QAOA CIRCUIT =====")
    print(quantum["circuit"].draw(output="text"))


if __name__ == "__main__":
    main()

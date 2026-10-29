"""Research strategies for initializing compactness-aware QAOA.

The standard and multi-start paths delegate each optimization to the existing
``general_qaoa.solve_qaoa_from_matrix`` implementation. Warm start uses a
bounded continuous relaxation and the product-state-preserving mixer
H_i = 2*sqrt(c_i*(1-c_i))*X_i + (1-2*c_i)*Z_i. This mixer has the prepared
single-qubit state as its +1 eigenstate and reduces to the standard X mixer at
c_i=1/2. It does not preserve scheduling feasibility; feasibility remains a
measured property of the resulting distribution.
"""

from __future__ import annotations

import time
from typing import Any

import numpy as np
from scipy.optimize import minimize
from qiskit import QuantumCircuit

from general_qaoa import solve_qaoa_from_matrix, validate_qubo
from qaoa_solver import expected_cost, get_probabilities, index_to_assignment
from qubo_model import qubo_cost, qubo_to_ising


BOUNDARY_EPSILON = 0.02


def initial_parameters(p: int, seed: int) -> np.ndarray:
    """Match the existing solver's seeded uniform gamma/beta initialization."""
    if type(p) is not int or p < 1:
        raise ValueError("p must be a positive integer")
    rng = np.random.default_rng(seed)
    return np.concatenate((rng.uniform(0, np.pi, p), rng.uniform(0, np.pi / 2, p)))


def relaxation_solution(Q: np.ndarray, *, boundary_epsilon: float = BOUNDARY_EPSILON) -> dict[str, Any]:
    """Minimize the continuous quadratic relaxation over [0,1]^n.

    L-BFGS-B starts at the neutral point 0.5. Boundary values are clipped to
    epsilon so a bit does not become frozen under the warm-start mixer. Failed
    or non-finite relaxations explicitly fall back to the uniform product
    state and are marked for the benchmark report.
    """
    matrix = np.asarray(Q, dtype=float)
    if matrix.ndim != 2 or matrix.shape[0] != matrix.shape[1] or not np.all(np.isfinite(matrix)):
        raise ValueError("Q must be a finite square matrix")
    if not np.allclose(matrix, matrix.T, rtol=0, atol=1e-10):
        raise ValueError("Q must be symmetric")
    if not 0 <= boundary_epsilon < 0.5:
        raise ValueError("boundary_epsilon must be in [0, 0.5)")
    start = time.perf_counter()
    n = len(matrix)
    if n == 0:
        raise ValueError("Q must contain at least one variable")
    result = minimize(
        lambda x: float(x @ matrix @ x),
        np.full(n, 0.5),
        jac=lambda x: 2.0 * matrix @ x,
        method="L-BFGS-B",
        bounds=[(0.0, 1.0)] * n,
        options={"maxiter": 500, "ftol": 1e-12},
    )
    elapsed = time.perf_counter() - start
    success = bool(result.success and np.all(np.isfinite(result.x)) and np.isfinite(result.fun))
    raw = np.asarray(result.x, dtype=float) if success else np.full(n, 0.5)
    clipped = np.clip(raw, boundary_epsilon, 1.0 - boundary_epsilon)
    return {
        "probabilities": clipped,
        "raw_probabilities": raw,
        "objective": float(result.fun) if success else None,
        "success": success,
        "fallback_used": not success,
        "boundary_clipped_count": int(np.count_nonzero(np.abs(raw - clipped) > 1e-12)),
        "function_evaluations": int(getattr(result, "nfev", 0)),
        "preprocessing_seconds": float(elapsed),
        "message": str(result.message),
    }


def product_state_amplitudes(probabilities: np.ndarray) -> np.ndarray:
    """Return amplitudes indexed using Qiskit's little-endian basis order."""
    c = np.asarray(probabilities, dtype=float)
    if c.ndim != 1 or len(c) == 0 or not np.all(np.isfinite(c)) or np.any(c < 0) or np.any(c > 1):
        raise ValueError("probabilities must be a nonempty vector in [0,1]")
    amps = np.empty(2 ** len(c), dtype=float)
    for index in range(len(amps)):
        amp = 1.0
        for qubit, probability in enumerate(c):
            amp *= np.sqrt(probability if (index >> qubit) & 1 else 1.0 - probability)
        amps[index] = amp
    return amps


def _cost_layer(qc: QuantumCircuit, h: np.ndarray, J: np.ndarray, gamma: float) -> None:
    for i, value in enumerate(h):
        if abs(value) > 1e-12:
            qc.rz(2 * gamma * value, i)
    for i in range(len(h)):
        for j in range(i + 1, len(h)):
            if abs(J[i, j]) > 1e-12:
                qc.rzz(2 * gamma * J[i, j], i, j)


def create_warm_start_circuit(
    h: np.ndarray, J: np.ndarray, gammas: np.ndarray, betas: np.ndarray,
    probabilities: np.ndarray,
) -> QuantumCircuit:
    """Build QAOA with relaxed product state and its compatible mixer.

    For c_i=sin(theta_i/2)^2, the mixer is n_i·sigma with
    n_i=(sin(theta_i),0,cos(theta_i)); the initial state is its +1 eigenstate.
    At c_i=1/2 this circuit is equivalent to the standard H/X mixer up to a
    global phase. The mixer is X/Z biased for other c_i and can move between
    bit strings, but is not a feasibility-preserving constraint mixer.
    """
    h = np.asarray(h, dtype=float)
    J = np.asarray(J, dtype=float)
    c = np.asarray(probabilities, dtype=float)
    gammas = np.asarray(gammas, dtype=float)
    betas = np.asarray(betas, dtype=float)
    n = len(h)
    if J.shape != (n, n) or c.shape != (n,) or len(gammas) == 0 or gammas.shape != betas.shape:
        raise ValueError("Inconsistent warm-start circuit dimensions")
    if not np.all(np.isfinite(c)) or np.any(c < 0) or np.any(c > 1):
        raise ValueError("Warm-start probabilities must lie in [0,1]")
    qc = QuantumCircuit(n)
    theta = 2.0 * np.arcsin(np.sqrt(c))
    for i, angle in enumerate(theta):
        qc.ry(float(angle), i)
    for gamma, beta in zip(gammas, betas):
        _cost_layer(qc, h, J, float(gamma))
        for i, angle in enumerate(theta):
            # RY(theta) RZ(2 beta) RY(-theta) = exp(-i beta n·sigma).
            qc.ry(float(-angle), i)
            qc.rz(float(2.0 * beta), i)
            qc.ry(float(angle), i)
    return qc


def _sample_best(probabilities: np.ndarray, Q: np.ndarray, candidates: list[dict[str, Any]],
                 conflicts: list[dict[str, Any]], shots: int, seed: int) -> dict[str, Any]:
    rng = np.random.default_rng(seed)
    sampled = rng.choice(len(probabilities), size=shots, p=probabilities)
    solutions = []
    for index in np.unique(sampled):
        bits = index_to_assignment(int(index), Q.shape[0])
        if any(bits[edge["i"]] and bits[edge["j"]] for edge in conflicts):
            continue
        solutions.append({
            "assignment": bits,
            "cost": float(qubo_cost(bits, Q)),
            "counts": int(np.count_nonzero(sampled == index)),
        })
    if solutions:
        return min(solutions, key=lambda row: row["cost"])
    zero = tuple(0 for _ in range(Q.shape[0]))
    return {"assignment": zero, "cost": float(qubo_cost(zero, Q)), "counts": 0, "fallback_used": True}


def _warm_single(Q: np.ndarray, candidates: list[dict[str, Any]], conflicts: list[dict[str, Any]],
                 *, p: int, maxiter: int, shots: int, seed: int,
                 warm_probabilities: np.ndarray) -> dict[str, Any]:
    Q = validate_qubo(Q, candidates, conflicts)
    _, h, J = qubo_to_ising(Q)
    initial = initial_parameters(p, seed)
    evaluations = 0

    def objective(params: np.ndarray) -> float:
        nonlocal evaluations
        evaluations += 1
        circuit = create_warm_start_circuit(h, J, params[:p], params[p:], warm_probabilities)
        return expected_cost(get_probabilities(circuit), Q)

    started = time.perf_counter()
    optimized = minimize(objective, initial, method="COBYLA", options={"maxiter": maxiter})
    optimization_seconds = time.perf_counter() - started
    params = np.asarray(optimized.x, dtype=float)
    circuit = create_warm_start_circuit(h, J, params[:p], params[p:], warm_probabilities)
    state_probabilities = get_probabilities(circuit)
    best = _sample_best(state_probabilities, Q, candidates, conflicts, shots, seed + 7919)
    return {
        "initial_parameters": initial,
        "parameters": params,
        "expected_cost": float(expected_cost(state_probabilities, Q)),
        "best": best,
        "probabilities": state_probabilities,
        "circuit": circuit,
        "optimization_success": bool(optimized.success),
        "function_evaluations": int(getattr(optimized, "nfev", evaluations)),
        "optimization_runtime_seconds": float(optimization_seconds),
        "fallback_used": bool(best.get("fallback_used", False)),
    }


def run_strategy(
    strategy: str, Q: np.ndarray, candidates: list[dict[str, Any]], conflicts: list[dict[str, Any]],
    *, p: int = 2, maxiter: int = 25, shots: int = 2048, seed: int = 42,
    restart_count: int = 1, warm_probabilities: np.ndarray | None = None,
) -> dict[str, Any]:
    """Run standard, expected-cost multi-start, or continuous warm-start QAOA.

    Multi-start selects the restart with minimum optimized expected QUBO cost;
    exact optimum metrics never enter initialization or selection.
    """
    if strategy not in {"standard", "multi_start", "warm_start"}:
        raise ValueError("unknown strategy")
    if type(maxiter) is not int or maxiter < 1 or type(shots) is not int or shots < 1:
        raise ValueError("maxiter and shots must be positive integers")
    if type(restart_count) is not int or restart_count < 1:
        raise ValueError("restart_count must be a positive integer")
    Q = validate_qubo(Q, candidates, conflicts)
    if strategy == "standard" and restart_count != 1:
        raise ValueError("standard strategy uses exactly one restart")
    if strategy == "warm_start" and warm_probabilities is None:
        raise ValueError("warm_start requires relaxation probabilities")
    if strategy != "multi_start" and restart_count != 1:
        raise ValueError("restart_count applies only to multi_start")

    restart_rows = []
    total_runtime = 0.0
    for restart in range(restart_count):
        restart_seed = seed if restart == 0 else seed + restart * 1009
        started = time.perf_counter()
        if strategy in {"standard", "multi_start"}:
            result = solve_qaoa_from_matrix(
                Q, candidates, conflicts, p=p, maxiter=maxiter, shots=shots, seed=restart_seed,
            )
            expected = float(result["expectedCost"])
            best = result["best"]
            probs = np.asarray(result["probabilities"], dtype=float)
            circuit = result["circuit"]
            final = np.asarray(result["parameters"], dtype=float)
            initial = initial_parameters(p, restart_seed)
            success = bool(result["optimizationSuccess"])
            nfev = int(result["functionEvaluations"])
            fallback = bool(result["fallbackUsed"])
            opt_runtime = time.perf_counter() - started
        else:
            result = _warm_single(
                Q, candidates, conflicts, p=p, maxiter=maxiter, shots=shots,
                seed=restart_seed, warm_probabilities=np.asarray(warm_probabilities, dtype=float),
            )
            expected, best, probs, circuit = result["expected_cost"], result["best"], result["probabilities"], result["circuit"]
            final, initial = result["parameters"], result["initial_parameters"]
            success, nfev, fallback = result["optimization_success"], result["function_evaluations"], result["fallback_used"]
            opt_runtime = time.perf_counter() - started
        total_runtime += opt_runtime
        restart_rows.append({
            "restart_index": restart,
            "seed": restart_seed,
            "initial_parameters": [float(v) for v in initial],
            "final_parameters": [float(v) for v in final],
            "optimized_expected_cost": float(expected),
            "best_feasible_sampled_cost": float(best["cost"]),
            "feasible_probability": None,
            "optimal_probability": None,
            "function_evaluations": nfev,
            "optimization_runtime_seconds": float(opt_runtime),
            "optimization_success": success,
            "fallback_used": fallback,
            "_probabilities": probs,
            "_best": best,
            "_circuit": circuit,
        })
    # This selector depends only on the optimized statevector expectation.
    selected = min(restart_rows, key=lambda row: row["optimized_expected_cost"])
    selected_probabilities = selected["_probabilities"]
    selected_best = selected["_best"]
    selected_circuit = selected["_circuit"]
    return {
        "selected_restart_index": int(selected["restart_index"]),
        "expected_cost": float(selected["optimized_expected_cost"]),
        "best": selected_best,
        "probabilities": selected_probabilities,
        "circuit": selected_circuit,
        "parameters": selected["final_parameters"],
        "initial_parameters": selected["initial_parameters"],
        "function_evaluations": int(sum(row["function_evaluations"] for row in restart_rows)),
        "optimization_runtime_seconds": float(total_runtime),
        "optimization_success": all(row["optimization_success"] for row in restart_rows),
        "fallback_used": any(row["fallback_used"] for row in restart_rows),
        "restart_details": restart_rows,
        "restart_probabilities": [row["_probabilities"] for row in restart_rows],
        "restart_count": restart_count,
    }

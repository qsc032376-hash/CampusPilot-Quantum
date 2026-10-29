"""Budget-aware comparison of classical optimizers for standard QAOA.

Every objective call, including SLSQP's numerical finite-difference calls, is
made through :class:`BudgetCounter`. The returned distribution belongs to the
best point actually evaluated, never an unevaluated ``result.x``.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy.optimize import minimize

from general_qaoa import validate_qubo
from qaoa_initialization import initial_parameters
from qaoa_solver import create_qaoa_circuit, expected_cost, get_probabilities
from qubo_model import qubo_to_ising


OPTIMIZERS = ("COBYLA", "Powell", "Nelder-Mead", "SLSQP")


class EvaluationBudgetExceeded(RuntimeError):
    """Raised before an objective evaluation would exceed its hard cap."""


@dataclass
class BudgetCounter:
    Q: np.ndarray
    h: np.ndarray
    J: np.ndarray
    p: int
    budget: int
    evaluations: int = 0
    best_cost: float = float("inf")
    best_params: np.ndarray | None = None
    best_probabilities: np.ndarray | None = None
    best_circuit: Any = None
    initial_cost: float | None = None

    def evaluate(self, params: np.ndarray) -> float:
        if self.evaluations >= self.budget:
            raise EvaluationBudgetExceeded(
                f"objective evaluation budget exhausted ({self.budget})"
            )
        vector = np.asarray(params, dtype=float)
        if vector.shape != (2 * self.p,) or not np.all(np.isfinite(vector)):
            raise ValueError("Optimizer supplied invalid QAOA parameters")
        self.evaluations += 1
        circuit = create_qaoa_circuit(
            self.h, self.J, vector[:self.p], vector[self.p:]
        )
        probabilities = get_probabilities(circuit)
        cost = float(expected_cost(probabilities, self.Q))
        if not np.isfinite(cost):
            raise ValueError("QAOA expected cost is non-finite")
        if self.initial_cost is None:
            self.initial_cost = cost
        if cost < self.best_cost:
            self.best_cost = cost
            self.best_params = vector.copy()
            self.best_probabilities = probabilities.copy()
            self.best_circuit = circuit
        return cost


def run_optimizer(
    optimizer: str,
    Q: np.ndarray,
    candidates: list[dict[str, Any]],
    conflicts: list[dict[str, Any]],
    *,
    p: int = 2,
    budget: int = 100,
    seed: int = 42,
) -> dict[str, Any]:
    """Run one optimizer under a strict number of expected-cost calls."""
    if optimizer not in OPTIMIZERS:
        raise ValueError(f"Unsupported optimizer: {optimizer}")
    if type(p) is not int or p < 1 or type(budget) is not int or budget < 1:
        raise ValueError("p and budget must be positive integers")
    matrix = validate_qubo(Q, candidates, conflicts)
    _, h, J = qubo_to_ising(matrix)
    x0 = initial_parameters(p, seed)
    counter = BudgetCounter(matrix, h, J, p, budget)
    started = time.perf_counter()
    termination = "optimizer completed"
    optimizer_success = False
    optimizer_message = ""
    result_nit: int | None = None
    try:
        # Count the common starting point explicitly. It also guarantees a
        # retained incumbent if the optimizer fails on its first subsequent call.
        counter.evaluate(x0)
        result = minimize(
            counter.evaluate,
            x0.copy(),
            method=optimizer,
            # A high iteration cap lets the shared objective-call budget, rather
            # than optimizer-specific iteration semantics, stop the run.
            options={"maxiter": max(10, budget * 10)},
        )
        optimizer_success = bool(result.success)
        optimizer_message = str(result.message)
        result_nit = int(getattr(result, "nit", 0))
    except EvaluationBudgetExceeded as exc:
        termination = str(exc)
        optimizer_message = termination
    except Exception as exc:  # retain the best evaluated point on optimizer failure
        termination = f"optimizer exception: {type(exc).__name__}: {exc}"
        optimizer_message = termination
    elapsed = time.perf_counter() - started
    if counter.best_params is None or counter.best_probabilities is None:
        raise RuntimeError("No valid QAOA objective evaluation was completed")
    return {
        "optimizer": optimizer,
        "p": p,
        "budget": budget,
        "seed": seed,
        "initial_params": x0,
        "best_params": counter.best_params,
        "initial_expected_cost": float(counter.initial_cost),
        "best_expected_cost": float(counter.best_cost),
        "probabilities": counter.best_probabilities,
        "circuit": counter.best_circuit,
        "actual_objective_evaluations": counter.evaluations,
        "optimizer_runtime_seconds": float(elapsed),
        "optimizer_success": optimizer_success,
        "optimizer_message": optimizer_message,
        "termination_reason": termination,
        "optimizer_iterations": result_nit,
        "finite_difference_mode": "SciPy numerical gradient; calls counted by shared budget" if optimizer == "SLSQP" else "not applicable",
    }

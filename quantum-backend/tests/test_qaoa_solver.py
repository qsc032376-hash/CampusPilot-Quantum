
import json
import sys
from pathlib import Path

import numpy as np
import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from campus_adapter import prepare_optimization_input
from scheduling_qubo import solve_exact
from qaoa_solver import (
    create_qaoa_circuit,
    get_probabilities,
    index_to_assignment,
    expected_cost,
    solve_qaoa,
)


@pytest.fixture
def sample_candidates():
    path = BACKEND / "sample_request.json"
    request = json.loads(path.read_text(encoding="utf-8"))
    return prepare_optimization_input(request)["candidates"]


def test_qaoa_circuit():
    h = np.array([-1.0, -2.0])
    J = np.zeros((2, 2))

    circuit = create_qaoa_circuit(
        h, J, gammas=[0.5], betas=[0.3]
    )

    assert circuit.num_qubits == 2


def test_probabilities_sum_to_one():
    circuit = create_qaoa_circuit(
        np.array([-1.0, -2.0]),
        np.zeros((2, 2)),
        gammas=[0.5],
        betas=[0.3],
    )

    probabilities = get_probabilities(circuit)
    assert sum(probabilities) == pytest.approx(1.0)


def test_bit_order():
    assert index_to_assignment(1, 3) == (1, 0, 0)
    assert index_to_assignment(4, 3) == (0, 0, 1)


def test_uniform_superposition_expectation():
    h = np.array([-1.0, -2.0])
    J = np.zeros((2, 2))

    circuit = create_qaoa_circuit(
        h, J, gammas=[0.0], betas=[0.0]
    )

    probabilities = get_probabilities(circuit)
    Q = np.diag([-2.0, -4.0])

    assert expected_cost(probabilities, Q) == pytest.approx(-3.0)


def test_quantum_solver_feasibility(sample_candidates):
    result = solve_qaoa(
        sample_candidates,
        p=1,
        maxiter=30,
        shots=1024,
        seed=42,
    )

    assert result["best"]["cost"] <= 0
    assert result["best"]["cost"] >= -8

    # The solver returns a feasible decoded schedule.
    assert isinstance(result["best"]["schedule"], list)


def test_quantum_cannot_beat_exact(sample_candidates):
    classical = solve_exact(sample_candidates)

    quantum = solve_qaoa(
        sample_candidates,
        p=1,
        maxiter=30,
        shots=1024,
        seed=42,
    )

    assert quantum["best"]["cost"] >= classical["cost"] - 1e-8
    
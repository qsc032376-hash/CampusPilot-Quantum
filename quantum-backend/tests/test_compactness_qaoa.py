
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from compactness_qaoa import (
    solve_compactness_qaoa,
    compare_compactness_solvers,
)
from compactness_qubo import build_compactness_qubo
from qubo_model import qubo_cost


START = "2026-11-02T09:00:00-05:00"
END = "2026-11-02T17:00:00-05:00"


@pytest.fixture
def candidates():
    return [
        {
            "taskId": "A",
            "title": "Math",
            "priorityWeight": 5,
            "start": "2026-11-02T09:00:00-05:00",
            "end": "2026-11-02T10:00:00-05:00",
        },
        {
            "taskId": "B",
            "title": "Python",
            "priorityWeight": 3,
            "start": "2026-11-02T10:00:00-05:00",
            "end": "2026-11-02T11:00:00-05:00",
        },
        {
            "taskId": "B",
            "title": "Python",
            "priorityWeight": 3,
            "start": "2026-11-02T13:00:00-05:00",
            "end": "2026-11-02T14:00:00-05:00",
        },
    ]


@pytest.fixture(scope="module")
def quantum_result():
    candidate_data = [
        {
            "taskId": "A",
            "title": "Math",
            "priorityWeight": 5,
            "start": "2026-11-02T09:00:00-05:00",
            "end": "2026-11-02T10:00:00-05:00",
        },
        {
            "taskId": "B",
            "title": "Python",
            "priorityWeight": 3,
            "start": "2026-11-02T10:00:00-05:00",
            "end": "2026-11-02T11:00:00-05:00",
        },
        {
            "taskId": "B",
            "title": "Python",
            "priorityWeight": 3,
            "start": "2026-11-02T13:00:00-05:00",
            "end": "2026-11-02T14:00:00-05:00",
        },
    ]

    return solve_compactness_qaoa(
        candidate_data,
        START,
        END,
        alpha=0.05,
        beta=0.005,
        p=1,
        maxiter=30,
        shots=256,
        seed=42,
    )


def test_objective_type(quantum_result):
    assert quantum_result["objectiveType"] == "compactness"


def test_weights_preserved(quantum_result):
    assert quantum_result["alpha"] == pytest.approx(0.05)
    assert quantum_result["beta"] == pytest.approx(0.005)


def test_q_matrix_matches_model(candidates, quantum_result):
    model = build_compactness_qubo(
        candidates,
        START,
        END,
        alpha=0.05,
        beta=0.005,
    )

    assert np.allclose(quantum_result["Q"], model["Q"])


def test_quantum_assignment_binary(quantum_result):
    bits = quantum_result["best"]["assignment"]

    assert len(bits) == 3
    assert all(bit in (0, 1) for bit in bits)


def test_quantum_cost_is_consistent(quantum_result):
    bits = quantum_result["best"]["assignment"]
    actual = qubo_cost(bits, quantum_result["Q"])

    assert quantum_result["best"]["cost"] == pytest.approx(
        actual
    )


def test_quantum_cost_not_below_exact(candidates, quantum_result):
    from compactness_qubo import solve_compactness_exact

    exact = solve_compactness_exact(
        candidates,
        START,
        END,
        alpha=0.05,
        beta=0.005,
    )

    assert (
        quantum_result["best"]["cost"]
        >= exact["cost"] - 1e-8
    )


def test_invalid_secondary_weight(candidates):
    with pytest.raises(ValueError):
        solve_compactness_qaoa(
            candidates,
            START,
            END,
            alpha=0.3,
            beta=0.1,
        )


def test_invalid_qaoa_layers(candidates):
    with pytest.raises(ValueError):
        solve_compactness_qaoa(
            candidates,
            START,
            END,
            p=0,
        )


def test_classical_quantum_comparison(candidates):
    result = compare_compactness_solvers(
        candidates,
        START,
        END,
        alpha=0.05,
        beta=0.005,
        p=1,
        maxiter=20,
        shots=128,
        seed=42,
    )

    assert result["objectiveType"] == "compactness"
    assert result["optimalityGap"] >= -1e-8
    assert result["classical"]["metrics"]["isFeasible"]
    assert result["quantum"]["metrics"]["isFeasible"]


import sys
from pathlib import Path

import numpy as np
import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from multiobjective_qubo import (
    build_multiobjective_qubo,
    solve_multiobjective_exact,
)
from multiobjective_qaoa import solve_multiobjective_qaoa
from general_qaoa import (
    validate_qubo,
    solve_qaoa_from_matrix,
)
from qubo_model import qubo_cost


WINDOW_START = "2026-11-02T10:00:00-05:00"
WINDOW_END = "2026-11-02T17:00:00-05:00"


@pytest.fixture
def candidates():
    return [
        {
            "taskId": "A",
            "title": "Math Study",
            "priorityWeight": 5,
            "start": "2026-11-02T11:00:00-05:00",
            "end": "2026-11-02T12:00:00-05:00",
        },
        {
            "taskId": "A",
            "title": "Math Study",
            "priorityWeight": 5,
            "start": "2026-11-02T15:00:00-05:00",
            "end": "2026-11-02T16:00:00-05:00",
        },
    ]


def test_general_qubo_accepts_matrix(candidates):
    model = build_multiobjective_qubo(
        candidates, WINDOW_START, WINDOW_END
    )

    Q = validate_qubo(
        model["Q"],
        candidates,
        model["conflicts"],
    )

    assert Q.shape == (2, 2)


def test_reject_non_symmetric_matrix(candidates):
    Q = np.array([
        [-5.0, 3.0],
        [0.0, -5.0],
    ])

    with pytest.raises(ValueError):
        validate_qubo(Q, candidates, [])


def test_reject_candidate_count_mismatch(candidates):
    Q = np.eye(3)

    with pytest.raises(ValueError):
        validate_qubo(Q, candidates, [])


def test_multiobjective_changes_cost(candidates):
    model = build_multiobjective_qubo(
        candidates, WINDOW_START, WINDOW_END
    )

    Q = model["Q"]

    early = qubo_cost((1, 0), Q)
    late = qubo_cost((0, 1), Q)

    assert early < late


def test_qaoa_probabilities(candidates):
    result = solve_multiobjective_qaoa(
        candidates,
        WINDOW_START,
        WINDOW_END,
        p=1,
        maxiter=30,
        shots=128,
        seed=42,
    )

    assert result["circuit"].num_qubits == 2
    assert len(result["probabilities"]) == 4

    assert np.sum(
        result["probabilities"]
    ) == pytest.approx(1.0)


def test_qaoa_returns_feasible_schedule(candidates):
    result = solve_multiobjective_qaoa(
        candidates,
        WINDOW_START,
        WINDOW_END,
        p=1,
        maxiter=30,
        shots=128,
        seed=42,
    )

    # Both candidates belong to the same task.
    # No feasible schedule can include both.
    assert len(result["best"]["schedule"]) <= 1


def test_quantum_not_better_than_exact(candidates):
    classical = solve_multiobjective_exact(
        candidates,
        WINDOW_START,
        WINDOW_END,
    )

    quantum = solve_multiobjective_qaoa(
        candidates,
        WINDOW_START,
        WINDOW_END,
        p=1,
        maxiter=30,
        shots=128,
        seed=42,
    )

    assert (
        quantum["best"]["cost"]
        >= classical["cost"] - 1e-8
    )


def test_same_objective_matrix(candidates):
    model = build_multiobjective_qubo(
        candidates,
        WINDOW_START,
        WINDOW_END,
    )

    quantum = solve_multiobjective_qaoa(
        candidates,
        WINDOW_START,
        WINDOW_END,
        p=1,
        maxiter=30,
        shots=128,
        seed=42,
    )

    np.testing.assert_allclose(
        model["Q"],
        quantum["Q"],
    )


def test_invalid_conflict_pair(candidates):
    Q = np.eye(2)

    with pytest.raises(ValueError):
        validate_qubo(
            Q,
            candidates,
            [{"i": 0, "j": 4}],
        )


def test_invalid_qaoa_layer(candidates):
    model = build_multiobjective_qubo(
        candidates,
        WINDOW_START,
        WINDOW_END,
    )

    with pytest.raises(ValueError):
        solve_qaoa_from_matrix(
            model["Q"],
            candidates,
            model["conflicts"],
            p=0,
        )

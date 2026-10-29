
import sys
from pathlib import Path

import numpy as np
import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from multiobjective_qubo import (
    build_multiobjective_qubo,
    solve_multiobjective_exact,
    build_multiobjective_ising,
)
from qubo_model import qubo_cost, ising_energy


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


def test_matrix_shape(candidates):
    model = build_multiobjective_qubo(
        candidates, WINDOW_START, WINDOW_END
    )

    assert model["Q"].shape == (2, 2)


def test_matrix_symmetric(candidates):
    model = build_multiobjective_qubo(
        candidates, WINDOW_START, WINDOW_END
    )

    np.testing.assert_allclose(
        model["Q"], model["Q"].T
    )


def test_early_completion_preferred(candidates):
    model = build_multiobjective_qubo(
        candidates, WINDOW_START, WINDOW_END
    )

    Q = model["Q"]

    early_cost = qubo_cost((1, 0), Q)
    late_cost = qubo_cost((0, 1), Q)

    assert early_cost < late_cost


def test_exact_solver_selects_early(candidates):
    result = solve_multiobjective_exact(
        candidates, WINDOW_START, WINDOW_END
    )

    assert result["assignment"] == (1, 0)
    assert len(result["schedule"]) == 1

    assert result["schedule"][0]["start"] == (
        "2026-11-02T11:00:00-05:00"
    )


def test_same_task_conflict(candidates):
    model = build_multiobjective_qubo(
        candidates, WINDOW_START, WINDOW_END
    )

    Q = model["Q"]

    assert qubo_cost((1, 1), Q) > qubo_cost((1, 0), Q)


def test_invalid_alpha(candidates):
    with pytest.raises(ValueError):
        build_multiobjective_qubo(
            candidates,
            WINDOW_START,
            WINDOW_END,
            alpha=-1,
        )


def test_priority_dominance_guard(candidates):
    with pytest.raises(ValueError):
        build_multiobjective_qubo(
            candidates,
            WINDOW_START,
            WINDOW_END,
            alpha=0.5,
        )


def test_ising_equivalence(candidates):
    model = build_multiobjective_qubo(
        candidates, WINDOW_START, WINDOW_END
    )

    ising = build_multiobjective_ising(
        candidates, WINDOW_START, WINDOW_END
    )

    Q = model["Q"]

    for assignment in [
        (0, 0),
        (1, 0),
        (0, 1),
        (1, 1),
    ]:
        qubo_value = qubo_cost(assignment, Q)

        ising_value = ising_energy(
            assignment,
            ising["constant"],
            ising["linear"],
            ising["couplings"],
        )

        assert qubo_value == pytest.approx(ising_value)

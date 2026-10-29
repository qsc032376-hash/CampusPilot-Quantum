
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from compactness_qubo import (
    candidate_gap,
    build_compactness_qubo,
    solve_compactness_exact,
)
from qubo_model import qubo_cost
from schedule_metrics import evaluate_schedule


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


def test_adjacent_gap_zero(candidates):
    assert candidate_gap(candidates[0], candidates[1], 480) == 0


def test_three_hour_gap(candidates):
    value = candidate_gap(candidates[0], candidates[2], 480)
    assert value == pytest.approx(3 / 8)


def test_qubo_is_symmetric(candidates):
    model = build_compactness_qubo(
        candidates, START, END, alpha=0.05, beta=0.1
    )
    assert np.allclose(model["Q"], model["Q"].T)


def test_pairwise_coefficient(candidates):
    basic = build_compactness_qubo(
        candidates, START, END, alpha=0, beta=0
    )
    compact = build_compactness_qubo(
        candidates, START, END, alpha=0, beta=0.1
    )

    expected = 0.1 * (3 / 8)

    assert (
        compact["Q"][0, 2] - basic["Q"][0, 2]
    ) == pytest.approx(expected / 2)


def test_compactness_penalty_increases_cost(candidates):
    model = build_compactness_qubo(
        candidates, START, END, alpha=0, beta=0.1
    )
    baseline = build_compactness_qubo(
        candidates, START, END, alpha=0, beta=0
    )

    # Select Math 9-10 and Python 13-14.
    bits = [1, 0, 1]

    difference = (
        qubo_cost(bits, model["Q"])
        - qubo_cost(bits, baseline["Q"])
    )

    assert difference == pytest.approx(0.1 * 3 / 8)


def test_exact_prefers_compact_schedule(candidates):
    solution = solve_compactness_exact(
        candidates,
        START,
        END,
        alpha=0,
        beta=0.1,
    )

    # Both tasks scheduled, choosing adjacent slots.
    assert solution["assignment"] == [1, 1, 0]

    metrics = evaluate_schedule(
        solution["assignment"],
        candidates,
        solution["model"]["conflicts"],
        START,
        END,
    )

    assert metrics["isFeasible"]
    assert metrics["prioritySatisfaction"] == pytest.approx(1)
    assert metrics["internalGapMinutes"] == 0
    assert metrics["compactness"] == pytest.approx(1)


def test_zero_beta_matches_original_model(candidates):
    from multiobjective_qubo import build_multiobjective_qubo

    original = build_multiobjective_qubo(
        candidates, START, END, alpha=0.05
    )
    compact = build_compactness_qubo(
        candidates, START, END, alpha=0.05, beta=0
    )

    assert np.allclose(original["Q"], compact["Q"])


def test_excessive_weights_rejected(candidates):
    with pytest.raises(ValueError):
        build_compactness_qubo(
            candidates, START, END, alpha=0.2, beta=0.2
        )


def test_negative_beta_rejected(candidates):
    with pytest.raises(ValueError):
        build_compactness_qubo(
            candidates, START, END, beta=-0.1
        )


def test_exact_cost_matches_qubo(candidates):
    solution = solve_compactness_exact(
        candidates, START, END, alpha=0.05, beta=0.1
    )

    actual = qubo_cost(
        solution["assignment"],
        solution["model"]["Q"],
    )

    assert solution["cost"] == pytest.approx(actual)


import sys
from pathlib import Path

import numpy as np
import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from penalty_sensitivity import evaluate_distribution
from scheduling_qubo import build_scheduling_qubo
from qubo_model import qubo_cost


@pytest.fixture
def candidates():
    return [
        {
            "taskId": "A",
            "title": "Task A",
            "priorityWeight": 5,
            "start": "2026-11-02T13:00:00-05:00",
            "end": "2026-11-02T14:00:00-05:00",
        },
        {
            "taskId": "B",
            "title": "Task B",
            "priorityWeight": 3,
            "start": "2026-11-02T13:30:00-05:00",
            "end": "2026-11-02T14:30:00-05:00",
        },
    ]


def test_penalty_changes_qubo(candidates):
    q10 = build_scheduling_qubo(candidates, penalty=10)["Q"]
    q20 = build_scheduling_qubo(candidates, penalty=20)["Q"]

    assert qubo_cost([1, 1], q10) == pytest.approx(2)
    assert qubo_cost([1, 1], q20) == pytest.approx(12)


def test_feasible_probability(candidates):
    conflicts = build_scheduling_qubo(candidates)["conflicts"]

    probabilities = np.array([0.1, 0.2, 0.3, 0.4])
    result = evaluate_distribution(
        probabilities, candidates, conflicts
    )

    assert result["feasible_probability"] == pytest.approx(0.6)


def test_optimal_probability(candidates):
    conflicts = build_scheduling_qubo(candidates)["conflicts"]

    probabilities = np.array([0.1, 0.2, 0.3, 0.4])
    result = evaluate_distribution(
        probabilities, candidates, conflicts
    )

    # State 01 in candidate order means only task A selected.
    assert result["optimal_probability"] == pytest.approx(0.2)


def test_expected_feasible_reward(candidates):
    conflicts = build_scheduling_qubo(candidates)["conflicts"]

    probabilities = np.array([0.1, 0.2, 0.3, 0.4])
    result = evaluate_distribution(
        probabilities, candidates, conflicts
    )

    # 0.2 * 5 + 0.3 * 3
    assert result["expected_feasible_reward"] == pytest.approx(1.9)


def test_expected_violations(candidates):
    conflicts = build_scheduling_qubo(candidates)["conflicts"]

    probabilities = np.array([0.1, 0.2, 0.3, 0.4])
    result = evaluate_distribution(
        probabilities, candidates, conflicts
    )

    assert result["expected_violations"] == pytest.approx(0.4)

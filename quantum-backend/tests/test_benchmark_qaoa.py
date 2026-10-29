
import sys
from pathlib import Path

import numpy as np
import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from benchmark_qaoa import (
    calculate_optimal_probability,
    calculate_feasible_probability,
)


def test_optimal_probability():
    # Two binary variables, 4 possible basis states.
    Q = np.diag([-2.0, -1.0])

    # Index 1 corresponds to assignment (1, 0).
    probabilities = np.array([0.1, 0.6, 0.2, 0.1])

    result = calculate_optimal_probability(
        probabilities,
        Q,
        exact_cost=-2.0,
    )

    assert result == pytest.approx(0.6)


def test_multiple_optimal_solutions():
    Q = np.zeros((2, 2))
    probabilities = np.array([0.1, 0.2, 0.3, 0.4])

    result = calculate_optimal_probability(
        probabilities,
        Q,
        exact_cost=0.0,
    )

    assert result == pytest.approx(1.0)


def test_feasible_probability():
    probabilities = np.array([0.1, 0.2, 0.3, 0.4])

    conflicts = [
        {"i": 0, "j": 1, "reason": "time-overlap"}
    ]

    result = calculate_feasible_probability(
        probabilities,
        conflicts,
        n=2,
    )

    # Only state 11 is infeasible.
    assert result == pytest.approx(0.6)


def test_no_conflicts():
    probabilities = np.array([0.1, 0.2, 0.3, 0.4])

    result = calculate_feasible_probability(
        probabilities,
        conflicts=[],
        n=2,
    )

    assert result == pytest.approx(1.0)
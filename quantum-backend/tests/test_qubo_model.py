
import sys
from pathlib import Path
from itertools import product

import numpy as np
import pytest

sys.path.insert(
    0,
    str(Path(__file__).resolve().parents[1])
)

from qubo_model import (
    build_qubo,
    qubo_cost,
    qubo_to_ising,
    ising_energy,
    find_optimum,
)


def test_qubo_matrix():
    Q = build_qubo([8, 6, 4], 20)

    expected = np.array([
        [-8, 10, 10],
        [10, -6, 10],
        [10, 10, -4],
    ])

    np.testing.assert_allclose(Q, expected)


def test_ising_coefficients():
    Q = build_qubo([8, 6, 4], 20)
    c, h, J = qubo_to_ising(Q)

    assert c == pytest.approx(6)

    np.testing.assert_allclose(h, [-6, -7, -8])

    np.testing.assert_allclose(J, [
        [0, 5, 5],
        [5, 0, 5],
        [5, 5, 0],
    ])


def test_all_basis_states():
    Q = build_qubo([8, 6, 4], 20)
    c, h, J = qubo_to_ising(Q)

    for x in product([0, 1], repeat=3):
        assert qubo_cost(x, Q) == pytest.approx(
            ising_energy(x, c, h, J)
        )


def test_optimal_assignment():
    Q = build_qubo([8, 6, 4], 20)

    cost, assignment = find_optimum(Q)

    assert assignment == (1, 0, 0)
    assert cost == pytest.approx(-8)


@pytest.mark.parametrize(
    "priorities,expected_index",
    [
        ([8, 6, 4], 0),
        ([5, 12, 7], 1),
        ([3, 4, 10], 2),
    ],
)
def test_different_priorities(priorities, expected_index):
    Q = build_qubo(priorities, 30)
    _, assignment = find_optimum(Q)

    assert assignment[expected_index] == 1
    assert sum(assignment) == 1


def test_general_qubo_ising_equivalence():
    rng = np.random.default_rng(42)

    for n in range(1, 6):
        Q = rng.normal(size=(n, n))
        c, h, J = qubo_to_ising(Q)

        for x in product([0, 1], repeat=n):
            assert qubo_cost(x, Q) == pytest.approx(
                ising_energy(x, c, h, J)
            )


def test_invalid_inputs():
    with pytest.raises(ValueError):
        build_qubo([], 20)

    with pytest.raises(ValueError):
        build_qubo([-1, 5], 20)

    with pytest.raises(ValueError):
        build_qubo([3, 4], -10)

    with pytest.raises(ValueError):
        qubo_cost([1, 2], np.eye(2))

    with pytest.raises(ValueError):
        qubo_to_ising(np.ones((2, 3)))

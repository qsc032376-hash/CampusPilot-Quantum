
import json
import sys
from itertools import product
from pathlib import Path

import numpy as np
import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from campus_adapter import (
    generate_candidates,
    parse_time,
    overlaps,
)

from scheduling_qubo import (
    build_scheduling_qubo,
    build_ising_model,
    decode_schedule,
    is_feasible,
    solve_exact,
)

from qubo_model import qubo_cost, ising_energy


@pytest.fixture
def sample_candidates():
    path = BACKEND / "sample_request.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    return generate_candidates(data, 30)


def test_variable_count(sample_candidates):
    model = build_scheduling_qubo(sample_candidates)

    assert model["variableCount"] == 9
    assert model["Q"].shape == (9, 9)


def test_qubo_symmetry(sample_candidates):
    Q = build_scheduling_qubo(sample_candidates)["Q"]

    np.testing.assert_allclose(Q, Q.T)


def test_priority_rewards(sample_candidates):
    Q = build_scheduling_qubo(sample_candidates)["Q"]

    expected = [
        -candidate["priorityWeight"]
        for candidate in sample_candidates
    ]

    np.testing.assert_allclose(np.diag(Q), expected)


def test_conflict_penalties(sample_candidates):
    model = build_scheduling_qubo(sample_candidates)

    for pair in model["conflicts"]:
        i, j = pair["i"], pair["j"]

        assert model["Q"][i, j] > 0
        assert model["Q"][j, i] > 0


def test_same_task_exclusivity(sample_candidates):
    model = build_scheduling_qubo(sample_candidates)
    conflicts = model["conflicts"]

    for i, a in enumerate(sample_candidates):
        for j in range(i + 1, len(sample_candidates)):
            b = sample_candidates[j]

            if a["taskId"] == b["taskId"]:
                bits = [0] * len(sample_candidates)
                bits[i] = 1
                bits[j] = 1

                assert not is_feasible(bits, conflicts)


def test_exact_optimum(sample_candidates):
    result = solve_exact(sample_candidates)

    assert result["cost"] == pytest.approx(-8.0)
    assert len(result["schedule"]) == 2

    task_ids = {
        block["taskId"]
        for block in result["schedule"]
    }

    assert task_ids == {"task-1", "task-2"}


def test_optimal_schedule_has_no_overlap(sample_candidates):
    schedule = solve_exact(sample_candidates)["schedule"]

    for i, a in enumerate(schedule):
        for b in schedule[i + 1:]:
            assert not overlaps(
                parse_time(a["start"]),
                parse_time(a["end"]),
                parse_time(b["start"]),
                parse_time(b["end"]),
            )


def test_ising_equivalence(sample_candidates):
    model = build_scheduling_qubo(sample_candidates)
    ising = build_ising_model(sample_candidates)

    Q = model["Q"]

    for bits in product([0, 1], repeat=len(sample_candidates)):
        classical = qubo_cost(bits, Q)

        quantum_energy = ising_energy(
            bits,
            ising["constant"],
            ising["linear"],
            ising["couplings"],
        )

        assert classical == pytest.approx(quantum_energy)


def test_infeasible_schedule_rejected(sample_candidates):
    model = build_scheduling_qubo(sample_candidates)

    pair = model["conflicts"][0]
    bits = [0] * len(sample_candidates)

    bits[pair["i"]] = 1
    bits[pair["j"]] = 1

    with pytest.raises(ValueError):
        decode_schedule(
            bits,
            sample_candidates,
            model["conflicts"],
        )


def test_invalid_penalty(sample_candidates):
    with pytest.raises(ValueError):
        build_scheduling_qubo(sample_candidates, penalty=-1)

import numpy as np
import pytest
from itertools import product

import qaoa_optimizer_comparison as comparison
from benchmark_instances import build_benchmark_instances
from qaoa_initialization import initial_parameters
from qubo_model import ising_energy, qubo_cost, qubo_to_ising


@pytest.fixture(scope="module")
def small_problem():
    instance = next(x for x in build_benchmark_instances() if x["instance_id"] == "A1-n3")
    from compactness_qubo import build_compactness_qubo
    request = instance["request"]
    model = build_compactness_qubo(
        instance["candidates"], request["windowStart"], request["windowEnd"],
        alpha=0.05, beta=0.005,
    )
    return instance, model


@pytest.mark.parametrize("optimizer", comparison.OPTIMIZERS)
def test_all_optimizers_respect_hard_objective_budget_and_shared_initialization(small_problem, optimizer):
    instance, model = small_problem
    result = comparison.run_optimizer(
        optimizer, model["Q"], instance["candidates"], model["conflicts"],
        p=1, budget=2, seed=17,
    )
    np.testing.assert_allclose(result["initial_params"], initial_parameters(1, 17))
    assert 1 <= result["actual_objective_evaluations"] <= 2
    assert result["best_params"].shape == (2,)
    assert result["probabilities"].shape == (2 ** len(instance["candidates"]),)
    assert np.isclose(result["probabilities"].sum(), 1.0)


def test_slsqp_finite_difference_calls_are_counted_and_capped(small_problem, monkeypatch):
    instance, model = small_problem
    seen = []

    def fake_minimize(fun, x0, **kwargs):
        seen.append(np.asarray(x0).copy())
        for _ in range(20):
            try:
                fun(x0 + 0.01)
            except comparison.EvaluationBudgetExceeded:
                break
        raise RuntimeError("injected optimizer failure")

    monkeypatch.setattr(comparison, "minimize", fake_minimize)
    result = comparison.run_optimizer(
        "SLSQP", model["Q"], instance["candidates"], model["conflicts"],
        p=1, budget=4, seed=3,
    )
    assert result["actual_objective_evaluations"] == 4
    assert result["termination_reason"].startswith("optimizer exception")
    assert result["best_params"].shape == (2,)
    assert len(seen) == 1


def test_budget_one_returns_the_initial_evaluated_incumbent(small_problem):
    instance, model = small_problem
    result = comparison.run_optimizer(
        "COBYLA", model["Q"], instance["candidates"], model["conflicts"],
        p=1, budget=1, seed=19,
    )
    np.testing.assert_array_equal(result["best_params"], result["initial_params"])
    assert result["actual_objective_evaluations"] == 1
    assert result["initial_expected_cost"] == result["best_expected_cost"]


def test_symmetric_qubo_energy_is_preserved_by_ising_conversion():
    Q = np.array([[1.2, -0.7, 0.2], [-0.7, 0.4, 0.9], [0.2, 0.9, -0.3]])
    c, h, J = qubo_to_ising(Q)
    for bits in product((0, 1), repeat=3):
        assert ising_energy(bits, c, h, J) == pytest.approx(qubo_cost(bits, Q), abs=1e-12)

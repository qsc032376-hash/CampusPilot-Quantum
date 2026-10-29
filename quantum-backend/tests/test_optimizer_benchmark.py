import numpy as np
import pytest

from benchmark_instances import build_benchmark_instances
from optimizer_benchmark import (
    configuration_matrix,
    sample_independent_batches,
    theoretical_hit_probability,
)


def test_theoretical_batch_hit_probability_edges_and_stability():
    assert theoretical_hit_probability(0.0, 2048) == 0.0
    assert theoretical_hit_probability(1.0, 2048) == 1.0
    assert theoretical_hit_probability(0.5, 1) == pytest.approx(0.5)
    assert theoretical_hit_probability(1e-14, 2048) == pytest.approx(2.04799999998e-11)
    with pytest.raises(ValueError):
        theoretical_hit_probability(-0.1, 2048)


def test_quick_and_full_matrices_are_bounded_and_reproducible():
    quick = configuration_matrix("quick")
    full = configuration_matrix("full")
    assert len(quick) == 36
    assert len(full) == 168
    assert {row["optimizer"] for row in full} == {"COBYLA", "Powell", "Nelder-Mead", "SLSQP"}
    assert {row["instance_id"] for row in full} == {
        item["instance_id"] for item in build_benchmark_instances()
    }
    paired = [row for row in full if row["instance_id"] == "B2-n9" and row["p"] == 2 and row["budget"] == 100 and row["seed"] == 42]
    assert len(paired) == 4
    assert len({(row["p"], row["budget"], row["seed"]) for row in paired}) == 1


def test_independent_sampling_batches_are_seeded_and_report_a_rate():
    instance = next(x for x in build_benchmark_instances() if x["instance_id"] == "A1-n3")
    n = len(instance["candidates"])
    request = instance["request"]
    probabilities = np.full(2**n, 1 / (2**n))
    Q = np.zeros((n, n))
    conflicts = instance["conflicts"]
    kwargs = dict(
        exact_cost=0.0, shots_per_batch=32, batches=7, seed=55,
        window_start=request["windowStart"], window_end=request["windowEnd"],
    )
    first = sample_independent_batches(probabilities, Q, instance["candidates"], conflicts, **kwargs)
    second = sample_independent_batches(probabilities, Q, instance["candidates"], conflicts, **kwargs)
    assert first["empirical_hit_trials"] == 7
    assert 0 <= first["empirical_hit_rate"] <= 1
    assert first["empirical_hit_rate"] == second["empirical_hit_rate"]
    assert first["empirical_hit_batches"] == second["empirical_hit_batches"]
    assert len(first["best_assignment"]) == n

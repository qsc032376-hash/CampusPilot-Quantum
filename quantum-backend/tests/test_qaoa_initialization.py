import inspect
import sys
from pathlib import Path

import numpy as np
import pytest
from qiskit.quantum_info import Statevector

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

import qaoa_initialization as init
from qaoa_solver import get_probabilities
from qubo_model import qubo_cost, qubo_to_ising, ising_energy


def test_seeded_initial_parameters_are_deterministic_and_distinct():
    a = init.initial_parameters(2, 42)
    b = init.initial_parameters(2, 42)
    c = init.initial_parameters(2, 43)
    assert np.array_equal(a, b)
    assert not np.array_equal(a, c)


def test_product_state_amplitudes_match_warm_start_statevector():
    c = np.array([0.2, 0.65, 0.8])
    amplitudes = init.product_state_amplitudes(c)
    qc = __import__("qiskit").QuantumCircuit(3)
    for i, probability in enumerate(c):
        qc.ry(2 * np.arcsin(np.sqrt(probability)), i)
    state = Statevector.from_instruction(qc).data
    assert np.allclose(amplitudes, state, atol=1e-12)
    assert np.isclose(np.linalg.norm(amplitudes), 1.0)


def test_warm_mixer_preserves_prepared_state_when_cost_is_zero():
    c = np.array([0.12, 0.41, 0.88])
    circuit = init.create_warm_start_circuit(
        np.zeros(3), np.zeros((3, 3)), np.array([0.0]), np.array([0.73]), c,
    )
    actual_state = Statevector.from_instruction(circuit).data
    initial_state = init.product_state_amplitudes(c)
    assert abs(np.vdot(initial_state, actual_state)) == pytest.approx(1.0, abs=1e-12)
    probabilities = get_probabilities(circuit)
    expected = init.product_state_amplitudes(c) ** 2
    assert np.allclose(probabilities, expected, atol=1e-12)
    assert np.isclose(probabilities.sum(), 1.0)


def test_uniform_warm_start_reduces_to_standard_qaoa_distribution():
    from qaoa_solver import create_qaoa_circuit
    Q = np.array([[0.5, 0.1], [0.1, -0.2]])
    _, h, J = qubo_to_ising(Q)
    gamma, beta = np.array([0.22]), np.array([0.37])
    warm = init.create_warm_start_circuit(h, J, gamma, beta, np.array([0.5, 0.5]))
    standard = create_qaoa_circuit(h, J, gamma, beta)
    assert np.allclose(get_probabilities(warm), get_probabilities(standard), atol=1e-12)


def test_qubo_to_ising_preserves_binary_energies():
    Q = np.array([[0.7, -0.3], [-0.3, 0.2]])
    constant, h, J = qubo_to_ising(Q)
    for bits in ((0, 0), (0, 1), (1, 0), (1, 1)):
        assert ising_energy(bits, constant, h, J) == pytest.approx(qubo_cost(bits, Q))


def test_multistart_restarts_have_distinct_deterministic_initializations(monkeypatch):
    calls = []

    def fake_solver(Q, candidates, conflicts, *, p, maxiter, shots, seed):
        calls.append(seed)
        params = init.initial_parameters(p, seed)
        probs = np.array([1.0, 0.0])
        return {
            "expectedCost": float(seed), "best": {"assignment": (0,), "cost": 0.0},
            "probabilities": probs, "circuit": __import__("qiskit").QuantumCircuit(1),
            "parameters": params, "optimizationSuccess": True, "functionEvaluations": 7,
            "fallbackUsed": False,
        }

    monkeypatch.setattr(init, "solve_qaoa_from_matrix", fake_solver)
    result = init.run_strategy("multi_start", np.zeros((1, 1)), [{}], [], restart_count=3)
    assert calls == [42, 1051, 2060]
    initial = [detail["initial_parameters"] for detail in result["restart_details"]]
    assert len({tuple(values) for values in initial}) == 3
    assert result["function_evaluations"] == 21
    assert result["selected_restart_index"] == 0
    assert result["restart_count"] == 3


def test_restart_selection_uses_expected_cost_and_has_no_exact_optimum_input(monkeypatch):
    costs = iter([4.0, -2.0, 1.0])

    def fake_solver(Q, candidates, conflicts, **kwargs):
        value = next(costs)
        seed = kwargs["seed"]
        return {
            "expectedCost": value, "best": {"assignment": (0,), "cost": float(seed % 3)},
            "probabilities": np.array([1.0, 0.0]), "circuit": __import__("qiskit").QuantumCircuit(1),
            "parameters": init.initial_parameters(2, seed), "optimizationSuccess": True,
            "functionEvaluations": 1, "fallbackUsed": False,
        }

    monkeypatch.setattr(init, "solve_qaoa_from_matrix", fake_solver)
    result = init.run_strategy("multi_start", np.zeros((1, 1)), [{}], [], restart_count=3)
    assert result["selected_restart_index"] == 1
    assert result["expected_cost"] == -2.0
    assert "exact" not in inspect.signature(init.run_strategy).parameters


def test_relaxation_is_bounded_and_failure_falls_back(monkeypatch):
    result = init.relaxation_solution(np.array([[1.0, 2.0], [2.0, 1.0]]))
    assert np.all(result["probabilities"] >= 0.02)
    assert np.all(result["probabilities"] <= 0.98)

    class Failed:
        success = False
        x = np.array([np.nan, 1.0])
        fun = np.nan
        nfev = 3
        message = "synthetic failure"

    monkeypatch.setattr(init, "minimize", lambda *args, **kwargs: Failed())
    failed = init.relaxation_solution(np.eye(2))
    assert failed["fallback_used"] is True
    assert failed["success"] is False
    assert np.array_equal(failed["probabilities"], np.array([0.5, 0.5]))


def test_invalid_warm_start_probabilities_are_rejected():
    with pytest.raises(ValueError, match="probabilities"):
        init.product_state_amplitudes(np.array([-0.1]))

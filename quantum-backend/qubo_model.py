
from itertools import product
import numpy as np


def build_qubo(priorities, penalty):
    """Build a symmetric QUBO matrix for one shared resource."""
    priorities = np.asarray(priorities, dtype=float)

    if priorities.ndim != 1 or len(priorities) == 0:
        raise ValueError("Priorities must be a nonempty vector.")

    if not np.all(np.isfinite(priorities)):
        raise ValueError("Priorities must be finite.")

    if np.any(priorities < 0):
        raise ValueError("Priorities cannot be negative.")

    if not np.isfinite(penalty) or penalty < 0:
        raise ValueError("Penalty must be finite and nonnegative.")

    n = len(priorities)
    Q = np.zeros((n, n), dtype=float)

    for i in range(n):
        Q[i, i] = -priorities[i]

        for j in range(i + 1, n):
            Q[i, j] = penalty / 2
            Q[j, i] = penalty / 2

    return Q


def qubo_cost(x, Q):
    """Calculate x.T @ Q @ x for a binary vector."""
    x = np.asarray(x, dtype=float)
    Q = np.asarray(Q, dtype=float)

    if Q.ndim != 2 or Q.shape[0] != Q.shape[1]:
        raise ValueError("Q must be square.")

    if x.shape != (Q.shape[0],):
        raise ValueError("Incorrect binary vector length.")

    if not np.all((x == 0) | (x == 1)):
        raise ValueError("Decision variables must be binary.")

    return float(x @ Q @ x)


def qubo_to_ising(Q):
    """Convert symmetric or asymmetric QUBO to Ising."""
    Q = np.asarray(Q, dtype=float)

    if Q.ndim != 2 or Q.shape[0] != Q.shape[1]:
        raise ValueError("Q must be square.")

    if not np.all(np.isfinite(Q)):
        raise ValueError("Q must contain finite coefficients.")

    n = Q.shape[0]
    c = 0.0
    h = np.zeros(n)
    J = np.zeros((n, n))

    for i in range(n):
        c += Q[i, i] / 2
        h[i] -= Q[i, i] / 2

    for i in range(n):
        for j in range(i + 1, n):
            weight = Q[i, j] + Q[j, i]

            c += weight / 4
            h[i] -= weight / 4
            h[j] -= weight / 4

            J[i, j] = weight / 4
            J[j, i] = weight / 4

    return float(c), h, J


def ising_energy(x, c, h, J):
    """Evaluate an Ising Hamiltonian on a basis state."""
    x = np.asarray(x, dtype=int)
    h = np.asarray(h, dtype=float)
    J = np.asarray(J, dtype=float)

    if x.shape != h.shape or J.shape != (len(h), len(h)):
        raise ValueError("Inconsistent Hamiltonian dimensions.")

    if not np.all((x == 0) | (x == 1)):
        raise ValueError("x must be binary.")

    z = 1 - 2 * x
    return float(c + h @ z + 0.5 * z @ J @ z)


def find_optimum(Q):
    """Exhaustively solve a small QUBO for verification."""
    n = Q.shape[0]

    if n > 20:
        raise ValueError("Exhaustive search limited to 20 bits.")

    return min(
        (
            (qubo_cost(bits, Q), bits)
            for bits in product([0, 1], repeat=n)
        ),
        key=lambda item: item[0]
    )


def main():
    Q = build_qubo([8, 6, 4], penalty=20)
    c, h, J = qubo_to_ising(Q)

    print("QUBO Matrix:\n", Q)
    print("Constant:", c)
    print("Linear coefficients:", h)
    print("Couplings:\n", J)

    for x in product([0, 1], repeat=3):
        classical = qubo_cost(x, Q)
        ising = ising_energy(x, c, h, J)

        assert np.isclose(classical, ising)

    best_cost, best_bits = find_optimum(Q)
    print("Optimal assignment:", best_bits)
    print("Minimum cost:", best_cost)
    print("All energy checks passed!")


if __name__ == "__main__":
    main()

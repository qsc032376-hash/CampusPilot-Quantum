# Phase 2.1.5 — Compactness QAOA benchmark report

Mode: **quick** · Executed runs: **9** · Excluded configurations: **1**

## Experimental method

Settings: α=0.05, β baseline=0.005, p baseline=2, maxiter=25, shots=256, slot_minutes=120. Data are deterministic adapter-generated instances with 60-minute tasks, high/medium/low priorities, deadlines, same-task alternatives and overlapping time conflicts.

The exact solver and QAOA use identical candidate arrays and symmetric QUBO matrices. Runtimes use `time.perf_counter()`. Probability metrics come from the full noiseless statevector; `shots` only controls finite-shot sampling used for `qaoa_best_cost`. Feasible assignments are validated with the production schedule decoder. Costs are considered tied at absolute tolerance 1e-8 (relative tolerance 0). `optimal_probability` sums probability across every feasible assignment tied at the global exact minimum. `expected_feasible_reward` is unconditional E[R·1_feasible], so infeasible outcomes contribute zero; it is not the reward conditional on feasibility.

## RQ1 — Compactness sensitivity

| β | Classical compactness | QAOA compactness | Classical gaps (min) | QAOA gaps (min) | Priority satisfaction | Completion offset (min) |
|---:|---:|---:|---:|---:|---:|---:|
| 0.000 | 0.667 | 0.667 | 60.0 | 60.0 | 0.889 | 180.0 |
| 0.005 | 0.667 | 0.667 | 60.0 | 60.0 | 0.889 | 180.0 |
| 0.020 | 0.667 | 0.667 | 60.0 | 60.0 | 0.889 | 180.0 |

β-dependent QUBO costs are not compared across rows because each β defines a different objective. The table compares actual schedule metrics.

## RQ2 — QAOA depth

| p | Mean optimal probability | Mean sampled gap | Mean feasible probability | Mean runtime (s) | Mean circuit depth | Mean evaluations |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0.0052 ± n/a | 0 ± n/a | 0.6319 ± n/a | 0.0276 ± n/a | 10.0 | 25.0 |
| 2 | 0.0164 ± n/a | 0 ± n/a | 0.7063 ± n/a | 0.0331 ± n/a | 17.0 | 25.0 |


## RQ3 — Initialization and seed robustness

Across 2 seeds, optimality gap mean ± sample SD = 0 ± 0; median=0, min=0, max=0; exact-optimum hit rate=2/2 (100.0%).
A zero standard deviation only describes these runs on this instance; it does not establish robustness on unseen instances.

## RQ4 — Candidate-count scaling

| Candidates | Classical Exact runtime (s) | QAOA runtime (s) | Sampled gap | Feasible probability |
|---:|---:|---:|---:|---:|
| 3 | 0.000063 | 0.039314 | 0 | 0.8969 |
| 5 | 0.000149 | 0.042203 | 0 | 0.7063 |

These measurements describe only small ideal statevector runs and do not predict hardware scaling.

## RQ5 — Classical Exact vs. QAOA

QAOA's finite-shot best feasible sample reached the exact optimum in 9/9 runs; observed sampled gap range was 0 to 0. The full-statevector optimal probability is reported separately and includes all equivalent global optima.

## Limitations

Instances are small; QAOA is an ideal noiseless statevector simulation; COBYLA can be sensitive to initialization and finite iteration limits; candidate generation discretizes start times; pairwise gap cost is a proxy for fragmentation rather than exact internal idle time. This convenience sample supports no broad statistical-significance claim and no quantum-advantage claim.

## Excluded configurations

| Experiment | Instance | β | Reason |
|---|---|---:|---|
| weight_bound_guard | synthetic-n12 | 0.02 | secondary objective bound is not < 1: alpha*n + beta*n*(n-1)/2 = 1.92 |

## Reproducibility

All individual rows, aggregate statistics, settings, software versions, exclusions and plots are saved alongside this report. Re-run with `python quantum-backend/compactness_benchmark.py --mode quick --output <directory>`.


import { useState } from "react";

import type { ScheduleRequest } from "../../types";
import {
  optimizeSchedule,
} from "../../features/quantum-optimization/api";

import type {
  QuantumResult,
  QuantumSolver,
} from "../../features/quantum-optimization/api";

interface QuantumOptimizerProps {
  request: ScheduleRequest;
  windowStart: string | null | undefined;
  windowEnd: string | null | undefined;
}

export function QuantumOptimizer({
  request,
  windowStart,
  windowEnd,
}: QuantumOptimizerProps) {
  const [solver, setSolver] =
    useState<QuantumSolver>("quantum");

  const [layers, setLayers] = useState(1);
  const [loading, setLoading] = useState(false);

  const [result, setResult] =
    useState<QuantumResult | null>(null);

  const [error, setError] =
    useState<string | null>(null);

  async function runOptimization() {
    if (!windowStart || !windowEnd) {
      setError("Select a valid scheduling day first.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await optimizeSchedule(
        request,
        windowStart,
        windowEnd,
        {
          solver,
          p: layers,
          shots: 512,
          maxiter: 50,
          seed: 42,
        }
      );

      setResult(response);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Quantum optimization failed."
      );
    } finally {
      setLoading(false);
    }
  }

  function formatTime(iso: string): string {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  }

  return (
    <section
      className="cp-panel"
      aria-labelledby="quantum-heading"
    >
      <div className="cp-panel__head">
        <h2 id="quantum-heading">
          Quantum Optimization
        </h2>

        <p className="cp-panel__meta">
          Qiskit QAOA · Experimental
        </p>
      </div>

      <div className="cp-field">
        <label
          htmlFor="quantum-solver"
          className="cp-field__label"
        >
          Optimization method
        </label>

        <select
          id="quantum-solver"
          className="cp-input"
          value={solver}
          disabled={loading}
          onChange={(event) => {
            setSolver(event.target.value as QuantumSolver);
            setResult(null);
          }}
        >
          <option value="classical">
            Classical Exact
          </option>
          <option value="quantum">
            Quantum QAOA
          </option>
        </select>
      </div>

      {solver === "quantum" && (
        <div className="cp-field">
          <label
            htmlFor="quantum-layers"
            className="cp-field__label"
          >
            QAOA layers
          </label>

          <select
            id="quantum-layers"
            className="cp-input"
            value={layers}
            disabled={loading}
            onChange={(event) => {
              setLayers(Number(event.target.value));
              setResult(null);
            }}
          >
            <option value={1}>p = 1</option>
            <option value={2}>p = 2</option>
            <option value={3}>p = 3</option>
          </select>
        </div>
      )}

      <button
        type="button"
        className="cp-button cp-button--full"
        onClick={runOptimization}
        disabled={
          loading ||
          !windowStart ||
          !windowEnd ||
          request.tasks.length === 0
        }
      >
        {loading
          ? "Optimizing..."
          : solver === "quantum"
            ? "Optimize with QAOA →"
            : "Run Classical Optimizer →"}
      </button>

      {error && (
        <p className="cp-error" role="alert">
          {error}
        </p>
      )}

      {result && (
        <div className="cp-results" aria-live="polite">
          <h3>Optimization Results</h3>

          <dl className="cp-results__totals">
            <div>
              <dt>Selected tasks</dt>
              <dd>{result.schedule.length}</dd>
            </div>

            <div>
              <dt>Cost</dt>
              <dd>{result.cost.toFixed(2)}</dd>
            </div>

            <div>
              <dt>Time</dt>
              <dd>
                {result.executionSeconds.toFixed(3)}s
              </dd>
            </div>
          </dl>

          {result.solver === "quantum" && (
            <div>
              <p>
                Circuit depth:{" "}
                {result.circuitDepth ?? "N/A"}
              </p>

              <p>
                Expected cost:{" "}
                {result.expectedCost?.toFixed(3) ?? "N/A"}
              </p>

              <p>
                Function evaluations:{" "}
                {result.functionEvaluations ?? "N/A"}
              </p>
            </div>
          )}

          <h3>Optimized Schedule</h3>

          {result.schedule.length === 0 ? (
            <p className="cp-hint">
              No tasks selected in this solution.
            </p>
          ) : (
            <ul>
              {result.schedule.map((block, index) => (
                <li
                  key={`${block.taskId}-${block.start}-${index}`}
                >
                  <strong>{block.title}</strong>
                  {" — "}
                  {formatTime(block.start)}
                  {" to "}
                  {formatTime(block.end)}
                </li>
              ))}
            </ul>
          )}

          <p className="cp-hint">
            Experimental scheduling result.
            This does not create a room reservation
            or update your existing study plan.
          </p>
        </div>
      )}
    </section>
  );
}

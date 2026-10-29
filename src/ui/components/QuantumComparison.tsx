
import { useState } from "react";

import type { ScheduleRequest } from "../../types";
import {
  optimizeSchedule,
  type QuantumResult,
} from "../../features/quantum-optimization/api";

interface QuantumComparisonProps {
  request: ScheduleRequest;
  windowStart: string | null | undefined;
  windowEnd: string | null | undefined;
}

interface Comparison {
  classical: QuantumResult;
  quantum: QuantumResult;
  gap: number;
}

export function QuantumComparison({
  request,
  windowStart,
  windowEnd,
}: QuantumComparisonProps) {
  const [loading, setLoading] = useState(false);
  const [comparison, setComparison] =
    useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [layers, setLayers] = useState(2);

  async function runComparison() {
    if (!windowStart || !windowEnd) {
      setError("Select a valid scheduling day.");
      return;
    }

    setLoading(true);
    setError(null);
    setComparison(null);

    try {
      // Freeze the request for this benchmark run.
      // Both solvers must receive the same input data.
      const snapshot = structuredClone(request);

      const classicalOptions = {
        solver: "classical" as const,
      };

      const quantumOptions = {
        solver: "quantum" as const,
        p: layers,
        shots: 2048,
        maxiter: 100,
        seed: 42,
      };

      // Sequential calls keep the local server from
      // competing with itself for CPU-intensive work.
      const classical = await optimizeSchedule(
        snapshot,
        windowStart,
        windowEnd,
        classicalOptions
      );

      const quantum = await optimizeSchedule(
        snapshot,
        windowStart,
        windowEnd,
        quantumOptions
      );

      if (classical.candidateCount !== quantum.candidateCount) {
        throw new Error(
          "Solver inputs differ: candidate counts do not match."
        );
      }

      const gap = quantum.cost - classical.cost;

      if (gap < -1e-7) {
        throw new Error(
          "QAOA returned a cost below the exact optimum. " +
          "Check QUBO penalties and solver settings."
        );
      }

      setComparison({
        classical,
        quantum,
        gap: Math.max(0, gap),
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Comparison failed."
      );
    } finally {
      setLoading(false);
    }
  }

  const timeFormatter = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: "America/New_York",
      hour: "numeric",
      minute: "2-digit",
    }
  );

  function showTime(iso: string) {
    return timeFormatter.format(new Date(iso));
  }

  function renderSchedule(
    title: string,
    result: QuantumResult
  ) {
    return (
      <div>
        <h4>{title}</h4>

        {result.schedule.length === 0 ? (
          <p className="cp-hint">No selected tasks.</p>
        ) : (
          <ul>
            {result.schedule.map((block, index) => (
              <li
                key={`${block.taskId}-${block.start}-${index}`}
              >
                <strong>{block.title}</strong>
                {" — "}
                {showTime(block.start)}
                {" to "}
                {showTime(block.end)}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <section
      className="cp-panel"
      aria-labelledby="quantum-comparison-heading"
    >
      <div className="cp-panel__head">
        <h2 id="quantum-comparison-heading">
          Quantum vs. Classical
        </h2>
        <p className="cp-panel__meta">
          Same tasks · Exact benchmark
        </p>
      </div>

      <div className="cp-field">
        <label
          className="cp-field__label"
          htmlFor="comparison-layers"
        >
          QAOA Layers
        </label>

        <select
          id="comparison-layers"
          className="cp-input"
          value={layers}
          disabled={loading}
          onChange={(event) => {
            setLayers(Number(event.target.value));
            setComparison(null);
          }}
        >
          <option value={1}>p = 1</option>
          <option value={2}>p = 2</option>
          <option value={3}>p = 3</option>
        </select>
      </div>

      <button
        className="cp-button cp-button--full"
        type="button"
        disabled={
          loading ||
          !windowStart ||
          !windowEnd ||
          request.tasks.length === 0
        }
        onClick={runComparison}
      >
        {loading
          ? "Comparing solvers..."
          : "Compare Classical vs. QAOA →"}
      </button>

      {error && (
        <p className="cp-error" role="alert">
          {error}
        </p>
      )}

      {comparison && (
        <div className="cp-results" aria-live="polite">
          <h3>Optimization Comparison</h3>

          <dl className="cp-results__totals">
            <div>
              <dt>Classical</dt>
              <dd>
                {comparison.classical.cost.toFixed(2)}
              </dd>
            </div>

            <div>
              <dt>QAOA</dt>
              <dd>
                {comparison.quantum.cost.toFixed(2)}
              </dd>
            </div>

            <div>
              <dt>Gap</dt>
              <dd>
                {comparison.gap.toFixed(2)}
              </dd>
            </div>
          </dl>

          <p className="cp-hint">
            {comparison.gap <= 1e-7
              ? "QAOA sampled a globally optimal schedule."
              : "QAOA sampled a feasible but suboptimal schedule."}
          </p>

          <p>
            Classical runtime:{" "}
            {comparison.classical.executionSeconds.toFixed(3)}s
          </p>

          <p>
            QAOA runtime:{" "}
            {comparison.quantum.executionSeconds.toFixed(3)}s
          </p>

          <p>
            Circuit depth:{" "}
            {comparison.quantum.circuitDepth ?? "N/A"}
          </p>

          <p>
            Expected quantum cost:{" "}
            {comparison.quantum.expectedCost?.toFixed(3) ??
              "N/A"}
          </p>

          <p>
            Candidate variables:{" "}
            {comparison.quantum.candidateCount}
          </p>

          {renderSchedule(
            "Classical Schedule",
            comparison.classical
          )}

          {renderSchedule(
            "Quantum Schedule",
            comparison.quantum
          )}

          <p className="cp-hint">
            Both results use the same request, time
            resolution, and default QUBO penalty.
            QAOA runs on an ideal simulator.
            Neither result modifies your saved plan.
          </p>
        </div>
      )}
    </section>
  );
}

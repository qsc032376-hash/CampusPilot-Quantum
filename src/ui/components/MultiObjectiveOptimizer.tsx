
import { useState } from "react";
import type { ScheduleRequest } from "../../types.ts";
import {
  compareMultiObjective,
  type MultiObjectiveComparison,
} from "../../features/quantum-optimization/api.ts";

interface Props {
  request: ScheduleRequest;
  windowStart: string | null;
  windowEnd: string | null;
}

function formatTime(iso: string | null): string {
  if (!iso) return "N/A";

  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatPercent(value: number | null): string {
  return value === null
    ? "N/A"
    : `${(value * 100).toFixed(1)}%`;
}

function formatMinutes(value: number | null): string {
  return value === null ? "N/A" : `${value.toFixed(0)} min`;
}

export function MultiObjectiveOptimizer({
  request,
  windowStart,
  windowEnd,
}: Props) {
  const [alpha, setAlpha] = useState(0.05);
  const [p, setP] = useState(2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] =
    useState<MultiObjectiveComparison | null>(null);

  async function handleCompare() {
    if (!windowStart || !windowEnd) {
      setError("Please select a valid scheduling window.");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = await compareMultiObjective(
        request,
        windowStart,
        windowEnd,
        alpha,
        p
      );

      setResult(data);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Multi-objective optimization failed."
      );
    } finally {
      setLoading(false);
    }
  }

  const classical = result?.classical;
  const quantum = result?.quantum;

  return (
    <section className="cp-panel">
      <div className="cp-panel__head">
        <h2>Multi-Objective Optimization</h2>
        <p className="cp-panel__meta">
          Priority + Early Completion · Experimental
        </p>
      </div>

      <div className="cp-form">
        <label className="cp-field">
          <span className="cp-field__label">
            Early Completion Weight α: {alpha.toFixed(2)}
          </span>

          <input
            type="range"
            min={0}
            max={0.1}
            step={0.01}
            value={alpha}
            onChange={(event) => {
              setAlpha(Number(event.target.value));
              setResult(null);
            }}
          />
        </label>

        <p className="cp-hint">
          α = 0 uses priority and conflict costs only.
          Higher α prefers earlier completion.
        </p>

        <label className="cp-field">
          <span className="cp-field__label">
            QAOA Layers
          </span>

          <select
            className="cp-input"
            value={p}
            onChange={(event) => {
              setP(Number(event.target.value));
              setResult(null);
            }}
          >
            <option value={1}>p = 1</option>
            <option value={2}>p = 2</option>
            <option value={3}>p = 3</option>
          </select>
        </label>

        <button
          type="button"
          className="cp-button"
          disabled={loading || !windowStart || !windowEnd}
          onClick={handleCompare}
        >
          {loading
            ? "Optimizing..."
            : "Compare Multi-Objective Schedules"}
        </button>

        {error && (
          <p role="alert" style={{ color: "#aa1b32" }}>
            {error}
          </p>
        )}
      </div>

      {result && classical && quantum && (
        <div style={{ marginTop: 24 }}>
          <h3>Schedule Quality Comparison</h3>

          <p className="cp-hint">
            Candidate variables: {result.candidateCount}
            {" · "}
            α = {result.alpha.toFixed(2)}
          </p>

          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                textAlign: "left",
              }}
            >
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Classical</th>
                  <th>QAOA</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Tasks</td>
                  <td>{classical.metrics.selectedTaskCount}</td>
                  <td>{quantum.metrics.selectedTaskCount}</td>
                </tr>
                <tr>
                  <td>Priority Satisfaction</td>
                  <td>
                    {formatPercent(
                      classical.metrics.prioritySatisfaction
                    )}
                  </td>
                  <td>
                    {formatPercent(
                      quantum.metrics.prioritySatisfaction
                    )}
                  </td>
                </tr>
                <tr>
                  <td>Completion Time</td>
                  <td>
                    {formatTime(
                      classical.metrics.completionTime
                    )}
                  </td>
                  <td>
                    {formatTime(
                      quantum.metrics.completionTime
                    )}
                  </td>
                </tr>
                <tr>
                  <td>Internal Gaps</td>
                  <td>
                    {formatMinutes(
                      classical.metrics.internalGapMinutes
                    )}
                  </td>
                  <td>
                    {formatMinutes(
                      quantum.metrics.internalGapMinutes
                    )}
                  </td>
                </tr>
                <tr>
                  <td>Compactness</td>
                  <td>
                    {formatPercent(
                      classical.metrics.compactness
                    )}
                  </td>
                  <td>
                    {formatPercent(
                      quantum.metrics.compactness
                    )}
                  </td>
                </tr>
                <tr>
                  <td>QUBO Cost</td>
                  <td>{classical.cost.toFixed(4)}</td>
                  <td>{quantum.cost.toFixed(4)}</td>
                </tr>
                <tr>
                  <td>Runtime</td>
                  <td>
                    {classical.executionSeconds.toFixed(3)}s
                  </td>
                  <td>
                    {quantum.executionSeconds.toFixed(3)}s
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <h3>Optimality Gap</h3>
          <p style={{ fontSize: 24, fontWeight: 700 }}>
            {result.optimalityGap.toFixed(4)}
          </p>

          <p className="cp-hint">
            {result.sameOptimalValue
              ? "QAOA sampled a globally optimal QUBO solution."
              : "QAOA did not reach the exact optimum."}
          </p>

          <h3>Quantum Schedule</h3>
          <ul>
            {quantum.schedule.map((block, index) => (
              <li key={`${block.taskId}-${index}`}>
                <strong>{block.title}</strong>
                {" — "}
                {formatTime(block.start)}
                {" to "}
                {formatTime(block.end)}
              </li>
            ))}
          </ul>

          <p className="cp-hint">
            Experimental QAOA simulation. This comparison
            does not change your saved study plan.
          </p>
        </div>
      )}
    </section>
  );
}

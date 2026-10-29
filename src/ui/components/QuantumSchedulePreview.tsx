
import type { QuantumResult } from "../../features/quantum-optimization/api";

interface QuantumSchedulePreviewProps {
  result: QuantumResult | null;
  windowStart: string | null | undefined;
  windowEnd: string | null | undefined;
}

const CAMPUS_ZONE = "America/New_York";

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CAMPUS_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function QuantumSchedulePreview({
  result,
  windowStart,
  windowEnd,
}: QuantumSchedulePreviewProps) {
  if (!result || !windowStart || !windowEnd) {
    return null;
  }

  const start = Date.parse(windowStart);
  const end = Date.parse(windowEnd);
  const duration = end - start;

  if (!Number.isFinite(duration) || duration <= 0) {
    return null;
  }

  const blocks = result.schedule
    .map((block) => ({
      ...block,
      startMs: Date.parse(block.start),
      endMs: Date.parse(block.end),
    }))
    .filter(
      (block) =>
        Number.isFinite(block.startMs) &&
        Number.isFinite(block.endMs) &&
        block.startMs >= start &&
        block.endMs <= end &&
        block.endMs > block.startMs
    )
    .sort((a, b) => a.startMs - b.startMs);

  const hours = Math.ceil(duration / 3_600_000);
  const height = Math.max(240, hours * 64);

  const hourMarks = Array.from(
    { length: hours + 1 },
    (_, index) => {
      const time = start + index * 3_600_000;

      return {
        time,
        top: ((time - start) / duration) * 100,
      };
    }
  ).filter((mark) => mark.time <= end);

  return (
    <section
      className="cp-panel"
      aria-labelledby="quantum-preview-heading"
    >
      <div className="cp-panel__head">
        <h2 id="quantum-preview-heading">
          Quantum Schedule Preview
        </h2>
        <p className="cp-panel__meta">
          Experimental · Read-only
        </p>
      </div>

      <p className="cp-hint">
        {result.solver === "quantum"
          ? "QAOA sampled schedule"
          : "Classical exact schedule"}
        {" · "}
        {blocks.length} tasks
        {" · Cost: "}
        {result.cost.toFixed(2)}
      </p>

      <div
        style={{
          position: "relative",
          height,
          marginTop: 20,
          marginLeft: 72,
          marginRight: 10,
          borderLeft: "1px solid #a8adb3",
        }}
      >
        {hourMarks.map((mark) => (
          <div
            key={mark.time}
            style={{
              position: "absolute",
              top: `${mark.top}%`,
              left: 0,
              right: 0,
              borderTop: "1px solid #ddd",
            }}
          >
            <span
              style={{
                position: "absolute",
                left: -70,
                top: -9,
                fontSize: 11,
                color: "#777",
              }}
            >
              {formatTime(new Date(mark.time).toISOString())}
            </span>
          </div>
        ))}

        {blocks.map((block, index) => {
          const top =
            ((block.startMs - start) / duration) * 100;

          const itemHeight =
            ((block.endMs - block.startMs) / duration) * 100;

          return (
            <div
              key={`${block.taskId}-${block.start}-${index}`}
              title={`${block.title}: ${formatTime(block.start)} to ${formatTime(block.end)}`}
              style={{
                position: "absolute",
                left: 8,
                right: 8,
                top: `${top}%`,
                height: `${itemHeight}%`,
                boxSizing: "border-box",
                background: "rgba(69, 110, 219, 0.14)",
                borderLeft: "4px solid #4475d8",
                borderRadius: 6,
                padding: "5px 9px",
                overflow: "hidden",
                fontSize: 12,
              }}
            >
              <strong>{block.title}</strong>
              <div>
                {formatTime(block.start)} –{" "}
                {formatTime(block.end)}
              </div>
            </div>
          );
        })}
      </div>

      <p className="cp-hint">
        Preview only. Existing CampusPilot plans and
        reservations are unchanged.
      </p>
    </section>
  );
}

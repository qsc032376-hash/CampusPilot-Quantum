
import type { ScheduleRequest } from "../../types";

export type QuantumSolver = "classical" | "quantum";

export interface QuantumBlock {
  taskId: string;
  title: string;
  start: string;
  end: string;
}

export interface QuantumResult {
  solver: QuantumSolver;
  status: string;
  candidateCount: number;
  cost: number;
  schedule: QuantumBlock[];
  executionSeconds: number;
  isExact: boolean;
  expectedCost?: number;
  circuitDepth?: number;
  functionEvaluations?: number;
  optimizerSuccess?: boolean;
}

export interface QuantumOptions {
  solver: QuantumSolver;
  p?: number;
  shots?: number;
  maxiter?: number;
  seed?: number;
  penalty?: number;
}

const API_BASE =
  import.meta.env.VITE_QUANTUM_API_URL ??
  "http://127.0.0.1:8000";

export async function optimizeSchedule(
  request: ScheduleRequest,
  windowStart: string,
  windowEnd: string,
  options: QuantumOptions
): Promise<QuantumResult> {
  // Project CampusPilot data into the Python adapter contract.
  const payload = {
    request: {
      windowStart,
      windowEnd,
      tasks: request.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        durationMinutes: task.durationMinutes,
        dueAt: task.dueAt,
        notBefore: task.notBefore ?? null,
        priority: task.priority ?? "medium",
      })),
      classes: request.classes.map((event) => ({
        id: event.id,
        title: event.title,
        start: event.start,
        end: event.end,
      })),
      unavailablePeriods: request.unavailablePeriods.map(
        (event) => ({
          id: event.id,
          title: event.title,
          start: event.start,
          end: event.end,
        })
      ),
      locations: [],
    },
    solver: options.solver,
    slot_minutes: 60,
    p: options.p ?? 1,
    maxiter: options.maxiter ?? 50,
    shots: options.shots ?? 512,
    seed: options.seed ?? 42,
    penalty: options.penalty ?? null,
  };

  const response = await fetch(`${API_BASE}/api/optimize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);

    throw new Error(
      typeof body?.detail === "string"
        ? body.detail
        : `Optimization failed: HTTP ${response.status}`
    );
  }

  return (await response.json()) as QuantumResult;
}

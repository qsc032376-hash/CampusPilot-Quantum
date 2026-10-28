
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

const API_BASE = "http://127.0.0.1:8000";

export function buildQuantumRequest(
  request: ScheduleRequest,
  windowStart: string,
  windowEnd: string
) {
  return {
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
  };
}

export interface ScheduleQualityMetrics {
  selectedTaskCount: number;
  availableTaskCount: number;
  priorityReward: number;
  prioritySatisfaction: number | null;
  completionTime: string | null;
  internalGapMinutes: number | null;
  compactness: number | null;
  conflictViolations: number;
  isFeasible: boolean;
}

export interface MultiObjectiveSolution {
  cost: number;
  executionSeconds: number;
  schedule: QuantumBlock[];
  metrics: ScheduleQualityMetrics;
  expectedCost?: number;
  circuitDepth?: number;
  fallbackUsed?: boolean;
}

export interface MultiObjectiveComparison {
  status: string;
  objective: string;
  alpha: number;
  candidateCount: number;
  classical: MultiObjectiveSolution;
  quantum: MultiObjectiveSolution;
  optimalityGap: number;
  sameOptimalValue: boolean;
}

export async function compareMultiObjective(
  request: ScheduleRequest,
  windowStart: string,
  windowEnd: string,
  alpha = 0.05,
  p = 2
): Promise<MultiObjectiveComparison> {
  const response = await fetch(
    `${API_BASE}/api/multiobjective/compare`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        request: buildQuantumRequest(
          request,
          windowStart,
          windowEnd
        ),
        slot_minutes: 120,
        alpha,
        p,
        maxiter: 100,
        shots: 2048,
        seed: 42,
      }),
    }
  );

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      typeof body?.detail === "string"
        ? body.detail
        : `Multi-objective API error: ${response.status}`
    );
  }

  return (await response.json()) as MultiObjectiveComparison;
}


export async function optimizeSchedule(
  request: ScheduleRequest,
  windowStart: string,
  windowEnd: string,
  options: QuantumOptions
): Promise<QuantumResult> {
  // Project CampusPilot data into the Python adapter contract.
  const payload = {
    request: buildQuantumRequest(request, windowStart, windowEnd),
    solver: options.solver,
    slot_minutes: 120,
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

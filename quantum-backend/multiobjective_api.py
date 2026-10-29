
"""Phase 2.0.4: Multi-objective optimization API."""

from time import perf_counter

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from campus_adapter import (
    parse_time,
    prepare_optimization_input,
)
from multiobjective_qubo import solve_multiobjective_exact
from multiobjective_qaoa import solve_multiobjective_qaoa
from schedule_metrics import compare_solutions


router = APIRouter(
    prefix="/api/multiobjective",
    tags=["Multi-Objective Scheduling"],
)


class MultiObjectiveRequest(BaseModel):
    request: dict
    slot_minutes: int = Field(default=120, ge=15, le=240)
    alpha: float = Field(default=0.05, ge=0, lt=1)
    p: int = Field(default=2, ge=1, le=3)
    maxiter: int = Field(default=100, ge=1, le=500)
    shots: int = Field(default=2048, ge=1, le=100000)
    seed: int = 42


def validate_schedule_durations(schedule, tasks):
    """Reject scheduling outputs that shorten task duration."""
    duration_by_id = {
        str(task["id"]): int(task["durationMinutes"])
        for task in tasks
    }

    for item in schedule:
        task_id = str(item["taskId"])

        if task_id not in duration_by_id:
            raise ValueError(
                f"Unknown scheduled task: {task_id}"
            )

        start = parse_time(item["start"])
        end = parse_time(item["end"])

        actual_minutes = (
            end - start
        ).total_seconds() / 60

        if abs(actual_minutes - duration_by_id[task_id]) > 1e-6:
            raise ValueError(
                f"Duration mismatch for {task_id}: "
                f"expected {duration_by_id[task_id]} min, "
                f"got {actual_minutes:g} min"
            )


@router.post("/compare")
def compare_multiobjective(body: MultiObjectiveRequest):
    try:
        raw = body.request
        prepared = prepare_optimization_input(
            raw,
            slot_minutes=body.slot_minutes,
        )
        candidates = prepared["candidates"]

        n = len(candidates)

        if n == 0:
            raise ValueError(
                "No valid candidate time slots were generated."
            )

        if n > 12:
            raise ValueError(
                f"Problem has {n} candidate variables; "
                "this quantum demo supports at most 12. "
                "Reduce the date range or use coarser slots."
            )

        window_start = raw["windowStart"]
        window_end = raw["windowEnd"]

        # Solve the same multi-objective QUBO both ways.
        start = perf_counter()

        classical = solve_multiobjective_exact(
            candidates,
            window_start,
            window_end,
            alpha=body.alpha,
        )

        classical_seconds = perf_counter() - start

        start = perf_counter()

        quantum = solve_multiobjective_qaoa(
            candidates,
            window_start,
            window_end,
            alpha=body.alpha,
            p=body.p,
            maxiter=body.maxiter,
            shots=body.shots,
            seed=body.seed,
        )

        quantum_seconds = perf_counter() - start

        # Verify the original task duration is preserved.
        validate_schedule_durations(
            classical["schedule"],
            raw["tasks"],
        )

        validate_schedule_durations(
            quantum["best"]["schedule"],
            raw["tasks"],
        )

        quality = compare_solutions(
            classical,
            quantum,
            candidates,
            window_start,
            window_end,
        )

        return {
            "status": "ok",
            "objective": "multiobjective",
            "alpha": body.alpha,
            "candidateCount": n,
            "classical": {
                "cost": quality["classical"]["cost"],
                "schedule": classical["schedule"],
                "metrics": quality["classical"]["metrics"],
                "executionSeconds": classical_seconds,
            },
            "quantum": {
                "cost": quality["quantum"]["cost"],
                "schedule": quantum["best"]["schedule"],
                "metrics": quality["quantum"]["metrics"],
                "executionSeconds": quantum_seconds,
                "expectedCost": quality["quantum"][
                    "expectedCost"
                ],
                "circuitDepth": quality["quantum"][
                    "circuitDepth"
                ],
                "fallbackUsed": quality["quantum"][
                    "fallbackUsed"
                ],
                "feasibleSampleCount": quality["quantum"][
                    "feasibleSampleCount"
                ],
                "shots": quality["quantum"]["shots"],
            },
            "optimalityGap": quality["optimalityGap"],
            "sameOptimalValue": quality["sameOptimalValue"],
            "settings": {
                "p": body.p,
                "maxiter": body.maxiter,
                "shots": body.shots,
                "seed": body.seed,
            },
        }

    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(
            status_code=400,
            detail=str(exc),
        ) from exc

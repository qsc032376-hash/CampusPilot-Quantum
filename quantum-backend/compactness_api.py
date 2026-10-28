
"""Phase 2.1.4 — Compactness optimization API."""

from time import perf_counter

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from campus_adapter import prepare_optimization_input
from compactness_qubo import solve_compactness_exact
from compactness_qaoa import solve_compactness_qaoa
from schedule_metrics import compare_solutions
from multiobjective_api import validate_schedule_durations


router = APIRouter(
    prefix="/api/compactness",
    tags=["Compactness Optimization"],
)


class CompactnessRequest(BaseModel):
    request: dict
    slot_minutes: int = Field(default=120, ge=15, le=240)
    alpha: float = Field(default=0.05, ge=0, lt=1)
    beta: float = Field(default=0.005, ge=0, lt=1)
    p: int = Field(default=2, ge=1, le=3)
    maxiter: int = Field(default=100, ge=1, le=500)
    shots: int = Field(default=2048, ge=1, le=100000)
    seed: int = 42


@router.post("/compare")
def compare_compactness(body: CompactnessRequest):
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
                "No valid candidate time slots generated."
            )

        if n > 12:
            raise ValueError(
                f"Problem has {n} candidate variables; "
                "this demo supports at most 12."
            )

        # Preserve priority as the primary objective.
        secondary_bound = (
            body.alpha * n
            + body.beta * n * (n - 1) / 2
        )

        if secondary_bound >= 1:
            raise ValueError(
                "Secondary objective weights are too large. "
                f"Current bound = {secondary_bound:.4f}. "
                "Lower alpha or beta."
            )

        window_start = raw["windowStart"]
        window_end = raw["windowEnd"]

        start = perf_counter()
        classical = solve_compactness_exact(
            candidates,
            window_start,
            window_end,
            alpha=body.alpha,
            beta=body.beta,
            max_variables=12,
        )
        classical_seconds = perf_counter() - start

        start = perf_counter()
        quantum = solve_compactness_qaoa(
            candidates,
            window_start,
            window_end,
            alpha=body.alpha,
            beta=body.beta,
            p=body.p,
            maxiter=body.maxiter,
            shots=body.shots,
            seed=body.seed,
        )
        quantum_seconds = perf_counter() - start

        # Detect accidental shortening of original tasks.
        validate_schedule_durations(
            classical["schedule"], raw["tasks"]
        )
        validate_schedule_durations(
            quantum["best"]["schedule"], raw["tasks"]
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
            "objective": "compactness",
            "alpha": body.alpha,
            "beta": body.beta,
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
            },
            "optimalityGap": quality["optimalityGap"],
            "sameOptimalValue": quality["sameOptimalValue"],
            "settings": {
                "slot_minutes": body.slot_minutes,
                "alpha": body.alpha,
                "beta": body.beta,
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

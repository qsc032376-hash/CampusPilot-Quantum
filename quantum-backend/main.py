
"""CampusPilot Quantum Optimization API — Phase 1.9."""
from multiobjective_api import router as multiobjective_router
from typing import Any
from time import perf_counter

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from campus_adapter import prepare_optimization_input
from scheduling_qubo import solve_exact
from qaoa_solver import solve_qaoa
from compactness_api import router as compactness_router


app = FastAPI(
    title="CampusPilot Quantum API",
    version="0.1.0",
    description="Classical and QAOA campus scheduling."
)
app.include_router(multiobjective_router)
app.include_router(compactness_router)

# Local development only.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class OptimizationRequest(BaseModel):
    request: dict[str, Any]
    solver: str = "quantum"
    slot_minutes: int = Field(default=30, ge=1, le=120)
    p: int = Field(default=1, ge=1, le=3)
    maxiter: int = Field(default=100, ge=1, le=500)
    shots: int = Field(default=2048, ge=1, le=8192)
    seed: int = Field(default=42, ge=0)
    penalty: float | None = Field(default=None, gt=0)


def serialize_schedule(schedule):
    """Return frontend-compatible, JSON-safe study blocks."""
    return [
        {
            "taskId": block["taskId"],
            "title": block["title"],
            "start": block["start"],
            "end": block["end"],
        }
        for block in schedule
    ]


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "service": "CampusPilot Quantum",
        "version": "0.1.0",
    }


@app.post("/api/optimize")
def optimize(payload: OptimizationRequest):
    if payload.solver not in {"quantum", "classical"}:
        raise HTTPException(
            status_code=422,
            detail="solver must be quantum or classical",
        )

    try:
        prepared = prepare_optimization_input(
            payload.request,
            slot_minutes=payload.slot_minutes,
        )
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid schedule request: {exc}",
        ) from exc

    candidates = prepared["candidates"]
    n = len(candidates)

    if n == 0:
        raise HTTPException(
            status_code=422,
            detail="No valid scheduling candidates.",
        )

    # Both solvers use small, bounded demonstration problems.
    if n > 12:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Problem has {n} candidate variables; "
                "this demo supports at most 12."
            ),
        )

    if payload.solver == "classical":
        start = perf_counter()

        classical = solve_exact(candidates)

        elapsed = perf_counter() - start

        return {
            "solver": "classical",
            "status": "completed",
            "candidateCount": n,
            "cost": float(classical["cost"]),
            "schedule": serialize_schedule(
                classical["schedule"]
            ),
            "executionSeconds": elapsed,
            "isExact": True,
        }

    # Quantum path
    try:
        start = perf_counter()

        result = solve_qaoa(
            candidates,
            p=payload.p,
            maxiter=payload.maxiter,
            shots=payload.shots,
            seed=payload.seed,
            penalty=payload.penalty,
        )

        elapsed = perf_counter() - start

    except (ValueError, RuntimeError) as exc:
        raise HTTPException(
            status_code=422,
            detail=str(exc),
        ) from exc

    return {
        "solver": "quantum",
        "status": "completed",
        "candidateCount": n,
        "cost": float(result["best"]["cost"]),
        "expectedCost": float(result["expectedCost"]),
        "schedule": serialize_schedule(
            result["best"]["schedule"]
        ),
        "executionSeconds": elapsed,
        "circuitDepth": int(
            result["circuit"].depth()
        ),
        "functionEvaluations": int(
            result["functionEvaluations"]
        ),
        "optimizerSuccess": bool(
            result["optimizationSuccess"]
        ),
        "isExact": False,
        "settings": {
            "p": payload.p,
            "shots": payload.shots,
            "maxiter": payload.maxiter,
            "seed": payload.seed,
            "penalty": payload.penalty,
        },
    }

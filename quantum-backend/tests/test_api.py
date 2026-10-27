
import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from main import app


client = TestClient(app)


def sample_payload():
    data = json.loads(
        (BACKEND / "sample_request.json").read_text(
            encoding="utf-8"
        )
    )

    return {
        "request": data,
        "solver": "classical",
        "slot_minutes": 30,
    }


def test_health():
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_classical_optimization():
    response = client.post(
        "/api/optimize",
        json=sample_payload(),
    )

    assert response.status_code == 200

    result = response.json()

    assert result["solver"] == "classical"
    assert result["candidateCount"] == 9
    assert result["cost"] == -8.0
    assert len(result["schedule"]) == 2
    assert result["isExact"] is True


def test_invalid_solver():
    payload = sample_payload()
    payload["solver"] = "unknown"

    response = client.post(
        "/api/optimize",
        json=payload,
    )

    assert response.status_code == 422


def test_invalid_schedule():
    payload = sample_payload()
    payload["request"]["windowStart"] = "bad-date"

    response = client.post(
        "/api/optimize",
        json=payload,
    )

    assert response.status_code == 422


def test_quantum_optimization():
    payload = sample_payload()
    payload.update({
        "solver": "quantum",
        "p": 1,
        "maxiter": 30,
        "shots": 512,
        "seed": 42,
    })

    response = client.post(
        "/api/optimize",
        json=payload,
    )

    assert response.status_code == 200

    result = response.json()

    assert result["solver"] == "quantum"
    assert result["candidateCount"] == 9
    assert result["cost"] >= -8.0
    assert result["circuitDepth"] > 0
    assert isinstance(result["schedule"], list)
    assert result["isExact"] is False

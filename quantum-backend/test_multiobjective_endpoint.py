
"""Manual integration test for the multi-objective endpoint."""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from main import app


root = Path(__file__).resolve().parent
request = json.loads(
    (root / "sample_request.json").read_text(
        encoding="utf-8"
    )
)

client = TestClient(app)

response = client.post(
    "/api/multiobjective/compare",
    json={
        "request": request,
        "alpha": 0.05,
        "p": 2,
        "maxiter": 100,
        "shots": 2048,
        "seed": 42,
    },
)

print("HTTP Status:", response.status_code)

if response.status_code != 200:
    print(json.dumps(response.json(), indent=2))
    raise SystemExit(1)

data = response.json()

print("\nClassical Cost:", data["classical"]["cost"])
print("Quantum Cost:", data["quantum"]["cost"])
print("Optimality Gap:", data["optimalityGap"])

print("\nClassical Quality:")
print(json.dumps(
    data["classical"]["metrics"],
    indent=2,
))

print("\nQuantum Quality:")
print(json.dumps(
    data["quantum"]["metrics"],
    indent=2,
))

print("\nClassical Schedule:")
print(json.dumps(data["classical"]["schedule"], indent=2))

print("\nQuantum Schedule:")
print(json.dumps(data["quantum"]["schedule"], indent=2))

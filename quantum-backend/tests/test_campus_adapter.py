
import json
import sys
from pathlib import Path

import pytest

# Locate the quantum-backend directory
BACKEND = Path(__file__).resolve().parents[1]

# Allow imports from campus_adapter.py
sys.path.insert(0, str(BACKEND))

from campus_adapter import (
    parse_time,
    overlaps,
    generate_candidates,
    prepare_optimization_input,
)


# ---------------------------------------------------
# Fixture: Load sample CampusPilot scheduling data
# ---------------------------------------------------

@pytest.fixture
def sample_request():
    path = BACKEND / "sample_request.json"

    return json.loads(
        path.read_text(encoding="utf-8")
    )


# ---------------------------------------------------
# Test 1: Timezone conversion
# ---------------------------------------------------

def test_timezone_conversion():
    actual = parse_time("2026-11-02T13:00:00-05:00")
    expected = parse_time("2026-11-02T18:00:00Z")

    assert actual == expected


# ---------------------------------------------------
# Test 2: Interval overlap
# ---------------------------------------------------

def test_interval_overlap():
    a = parse_time("2026-11-02T13:00:00-05:00")
    b = parse_time("2026-11-02T14:00:00-05:00")
    c = parse_time("2026-11-02T15:00:00-05:00")

    # Adjacent intervals do not overlap
    assert not overlaps(a, b, b, c)

    # Partially overlapping intervals
    assert overlaps(a, c, b, c)


# ---------------------------------------------------
# Test 3: Candidates respect class commitments
# ---------------------------------------------------

def test_candidates_respect_class(sample_request):
    candidates = generate_candidates(sample_request, 30)

    class_start = parse_time(
        sample_request["classes"][0]["start"]
    )

    class_end = parse_time(
        sample_request["classes"][0]["end"]
    )

    for candidate in candidates:
        start = parse_time(candidate["start"])
        end = parse_time(candidate["end"])

        assert not overlaps(
            start,
            end,
            class_start,
            class_end
        )


# ---------------------------------------------------
# Test 4: Candidate counts
# ---------------------------------------------------

def test_candidate_counts(sample_request):
    candidates = generate_candidates(sample_request, 30)

    math_candidates = [
        c for c in candidates
        if c["taskId"] == "task-1"
    ]

    python_candidates = [
        c for c in candidates
        if c["taskId"] == "task-2"
    ]

    assert len(math_candidates) == 4
    assert len(python_candidates) == 5
    assert len(candidates) == 9


# ---------------------------------------------------
# Test 5: Priority weights
# ---------------------------------------------------

def test_priority_weights(sample_request):
    candidates = generate_candidates(sample_request, 30)

    weights = {
        c["taskId"]: c["priorityWeight"]
        for c in candidates
    }

    assert weights["task-1"] == 5
    assert weights["task-2"] == 3


# ---------------------------------------------------
# Test 6: Task durations
# ---------------------------------------------------

def test_candidate_duration(sample_request):
    candidates = generate_candidates(sample_request, 30)

    for candidate in candidates:
        start = parse_time(candidate["start"])
        end = parse_time(candidate["end"])

        actual_minutes = (
            end - start
        ).total_seconds() / 60

        assert actual_minutes == candidate["durationMinutes"]


# ---------------------------------------------------
# Test 7: Optimization input structure
# ---------------------------------------------------

def test_prepared_input(sample_request):
    result = prepare_optimization_input(
        sample_request,
        slot_minutes=30
    )

    assert result["taskCount"] == 2
    assert result["variableCount"] == 9
    assert len(result["candidates"]) == 9

    assert result["status"] == "candidates-generated"


# ---------------------------------------------------
# Test 8: Invalid deadline
# ---------------------------------------------------

def test_invalid_deadline(sample_request):
    sample_request["tasks"][0]["dueAt"] = "invalid-date"

    with pytest.raises(ValueError):
        generate_candidates(sample_request)


# ---------------------------------------------------
# Test 9: Duplicate task IDs
# ---------------------------------------------------

def test_duplicate_task_id(sample_request):
    sample_request["tasks"][1]["id"] = "task-1"

    with pytest.raises(ValueError):
        generate_candidates(sample_request)


# ---------------------------------------------------
# Test 10: Invalid time-slot size
# ---------------------------------------------------

def test_invalid_slot_size(sample_request):
    with pytest.raises(ValueError):
        generate_candidates(sample_request, 0)

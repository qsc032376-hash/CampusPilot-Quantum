
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from schedule_metrics import evaluate_schedule


START = "2026-11-02T10:00:00-05:00"
END = "2026-11-02T18:00:00-05:00"


@pytest.fixture
def candidates():
    return [
        {
            "taskId": "A",
            "title": "Math",
            "priorityWeight": 5,
            "start": "2026-11-02T11:00:00-05:00",
            "end": "2026-11-02T12:00:00-05:00",
        },
        {
            "taskId": "A",
            "title": "Math",
            "priorityWeight": 5,
            "start": "2026-11-02T15:00:00-05:00",
            "end": "2026-11-02T16:00:00-05:00",
        },
        {
            "taskId": "B",
            "title": "Python",
            "priorityWeight": 3,
            "start": "2026-11-02T12:00:00-05:00",
            "end": "2026-11-02T13:00:00-05:00",
        },
        {
            "taskId": "C",
            "title": "Physics",
            "priorityWeight": 1,
            "start": "2026-11-02T16:00:00-05:00",
            "end": "2026-11-02T17:00:00-05:00",
        },
    ]


@pytest.fixture
def conflicts():
    return [
        {"i": 0, "j": 1, "reason": "same-task"},
    ]


def evaluate(bits, candidates, conflicts):
    return evaluate_schedule(
        bits, candidates, conflicts, START, END
    )


def test_priority_satisfaction(candidates, conflicts):
    result = evaluate((1, 0, 1, 0), candidates, conflicts)
    assert result["priorityReward"] == 8
    assert result["totalPriority"] == 9
    assert result["prioritySatisfaction"] == pytest.approx(8 / 9)


def test_no_duplicate_priority(candidates, conflicts):
    result = evaluate((1, 1, 0, 0), candidates, conflicts)
    assert result["priorityReward"] == 5
    assert result["selectedTaskCount"] == 1


def test_compact_schedule(candidates, conflicts):
    result = evaluate((1, 0, 1, 0), candidates, conflicts)
    assert result["internalGapMinutes"] == 0
    assert result["compactness"] == pytest.approx(1.0)


def test_fragmented_schedule(candidates, conflicts):
    result = evaluate((1, 0, 0, 1), candidates, conflicts)
    # 11-12 and 16-17: 240 minutes of internal idle time.
    assert result["internalGapMinutes"] == 240
    assert result["compactness"] == pytest.approx(1 / 3)


def test_completion_time(candidates, conflicts):
    result = evaluate((1, 0, 1, 0), candidates, conflicts)
    assert result["completionTime"] == (
        "2026-11-02T18:00:00+00:00"
    )
    assert result["completionOffsetMinutes"] == 180


def test_same_task_conflict(candidates, conflicts):
    result = evaluate((1, 1, 0, 0), candidates, conflicts)
    assert not result["isFeasible"]
    assert result["conflictViolations"] == 1
    assert result["duplicateTaskPairs"] == 1
    assert result["compactness"] is None


def test_empty_schedule(candidates, conflicts):
    result = evaluate((0, 0, 0, 0), candidates, conflicts)
    assert result["priorityReward"] == 0
    assert result["completionTime"] is None
    assert result["compactness"] is None
    assert result["isFeasible"]


def test_adjacent_tasks_do_not_overlap(candidates, conflicts):
    result = evaluate((1, 0, 1, 0), candidates, conflicts)
    assert result["overlapPairs"] == 0
    assert result["isFeasible"]


def test_invalid_assignment_length(candidates, conflicts):
    with pytest.raises(ValueError):
        evaluate((1, 0), candidates, conflicts)


def test_invalid_binary_assignment(candidates, conflicts):
    with pytest.raises(ValueError):
        evaluate((1, 0, 2, 0), candidates, conflicts)


def test_inconsistent_task_weights(candidates, conflicts):
    candidates[1]["priorityWeight"] = 10

    with pytest.raises(ValueError):
        evaluate((1, 0, 0, 0), candidates, conflicts)


def test_detect_overlap_without_conflict_metadata(candidates):
    candidates[2]["start"] = "2026-11-02T11:30:00-05:00"
    candidates[2]["end"] = "2026-11-02T12:30:00-05:00"

    result = evaluate((1, 0, 1, 0), candidates, [])

    assert result["overlapPairs"] == 1
    assert not result["isFeasible"]


def test_invalid_window(candidates, conflicts):
    with pytest.raises(ValueError):
        evaluate_schedule(
            (1, 0, 0, 0),
            candidates,
            conflicts,
            END,
            START,
        )


"""Convert CampusPilot ScheduleRequest data into candidate starts."""

from datetime import datetime, timedelta, timezone
from typing import Any


PRIORITY_WEIGHTS = {
    "low": 1,
    "medium": 3,
    "high": 5,
}


def parse_time(value: str) -> datetime:
    """Read an ISO 8601 timestamp with an explicit UTC offset."""
    if not isinstance(value, str):
        raise ValueError("Timestamp must be a string.")

    if value.endswith("Z"):
        value = value[:-1] + "+00:00"

    try:
        result = datetime.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("Invalid ISO timestamp.") from exc

    if result.tzinfo is None or result.utcoffset() is None:
        raise ValueError("Timestamp must include a timezone offset.")

    return result.astimezone(timezone.utc)


def overlaps(start_a, end_a, start_b, end_b):
    """Check whether two half-open intervals overlap."""
    return start_a < end_b and start_b < end_a


def validate_request(request: dict[str, Any]) -> None:
    """Validate the fields needed for candidate generation."""
    start = parse_time(request["windowStart"])
    end = parse_time(request["windowEnd"])

    if start >= end:
        raise ValueError("Invalid scheduling window.")

    ids = set()

    for task in request["tasks"]:
        task_id = task["id"]

        if not isinstance(task_id, str) or not task_id:
            raise ValueError("Invalid task ID.")

        if task_id in ids:
            raise ValueError("Duplicate task ID.")

        ids.add(task_id)

        duration = task["durationMinutes"]

        if (
            type(duration) is not int
            or duration <= 0
        ):
            raise ValueError("Task duration must be positive integer.")

        due = parse_time(task["dueAt"])

        if "notBefore" in task and task["notBefore"] is not None:
            earliest = parse_time(task["notBefore"])

            if earliest >= due:
                raise ValueError("notBefore must precede deadline.")

        priority = task.get("priority", "medium")

        if priority is not None and priority not in PRIORITY_WEIGHTS:
            raise ValueError("Unknown task priority.")

    for event in (
        request["classes"] + request["unavailablePeriods"]
    ):
        event_start = parse_time(event["start"])
        event_end = parse_time(event["end"])

        if event_start >= event_end:
            raise ValueError("Invalid occupied interval.")


def generate_candidates(
    request: dict[str, Any],
    slot_minutes: int = 30,
) -> list[dict[str, Any]]:
    """
    Generate candidate starts for each task.

    One candidate represents a complete, uninterrupted task.
    Does not resolve conflicts between candidate tasks.
    """
    if type(slot_minutes) is not int or slot_minutes <= 0:
        raise ValueError("slot_minutes must be positive integer.")

    validate_request(request)

    window_start = parse_time(request["windowStart"])
    window_end = parse_time(request["windowEnd"])

    occupied = [
        (
            parse_time(event["start"]),
            parse_time(event["end"]),
        )
        for event in (
            request["classes"] + request["unavailablePeriods"]
        )
    ]

    step = timedelta(minutes=slot_minutes)
    candidates = []

    for task in request["tasks"]:
        duration = timedelta(minutes=task["durationMinutes"])
        deadline = parse_time(task["dueAt"])

        earliest = window_start

        if task.get("notBefore") is not None:
            earliest = max(
                earliest,
                parse_time(task["notBefore"]),
            )

        latest_end = min(window_end, deadline)

        priority = task.get("priority") or "medium"
        weight = PRIORITY_WEIGHTS[priority]

        # Candidate grid is anchored to windowStart.
        current = window_start

        while current + duration <= latest_end:
            if current >= earliest:
                finish = current + duration

                blocked = any(
                    overlaps(current, finish, busy_start, busy_end)
                    for busy_start, busy_end in occupied
                )

                if not blocked:
                    candidates.append({
                        "variable": len(candidates),
                        "taskId": task["id"],
                        "title": task["title"],
                        "start": current.isoformat(),
                        "end": finish.isoformat(),
                        "durationMinutes": task["durationMinutes"],
                        "priorityWeight": weight,
                    })

            current += step

    return candidates


def prepare_optimization_input(
    request: dict[str, Any],
    slot_minutes: int = 30,
) -> dict[str, Any]:
    """Prepare a JSON-compatible handoff to the QUBO engineer."""
    candidates = generate_candidates(request, slot_minutes)

    return {
        "slotMinutes": slot_minutes,
        "taskCount": len(request["tasks"]),
        "variableCount": len(candidates),
        "candidates": candidates,
        "taskIds": [task["id"] for task in request["tasks"]],
        "status": "candidates-generated",
    }

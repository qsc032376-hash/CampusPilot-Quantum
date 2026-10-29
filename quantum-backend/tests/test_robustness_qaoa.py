
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from robustness_qaoa import summarize_runs


def test_summary_mean():
    rows = [{"score": 1}, {"score": 3}, {"score": 5}]
    result = summarize_runs(rows, "score")

    assert result["mean"] == pytest.approx(3.0)


def test_sample_standard_deviation():
    rows = [{"score": 1}, {"score": 3}, {"score": 5}]
    result = summarize_runs(rows, "score")

    assert result["std"] == pytest.approx(2.0)


def test_min_max():
    rows = [{"score": 1}, {"score": 3}, {"score": 5}]
    result = summarize_runs(rows, "score")

    assert result["min"] == 1
    assert result["max"] == 5


def test_single_run_rejected():
    with pytest.raises(ValueError):
        summarize_runs([{"score": 1}], "score")

"""Clinical result wording for the PDF, read from the same file as the screen.

`shared/clinical_copy.json` is imported by frontend-new/src/lib/clinical-copy.ts
and loaded here. One file, two consumers, on purpose: the printed report and the
result screen must not be able to describe the same finding differently. A
patient whose screen says "not confidently normal" while their PDF says "normal"
is a worse outcome than either wording being slightly off.

    python -c "from pdf_copy import result_copy; print(result_copy('COPD','HIGH'))"

Standard library only -- no dependency on ReportLab or FastAPI, so this can be
imported from a script, a test, or the PDF generator without pulling anything in.
"""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Tuple

_COPY_PATH = Path(__file__).resolve().parent.parent / "shared" / "clinical_copy.json"


@lru_cache(maxsize=1)
def _copy() -> Dict[str, Any]:
    with open(_COPY_PATH, encoding="utf-8") as handle:
        return json.load(handle)


def copy_key(status: str, level: str) -> str:
    return f"{status}_{level}"


def result_copy(status: str, level: str) -> Tuple[str, str, str]:
    """Return (headline, message, recommendation) for a result.

    Falls back to the status-only key on an unexpected confidence level, so a
    value the copy file does not cover degrades to something readable rather
    than printing `None` into a clinical document.
    """
    data = _copy()
    key = copy_key(status, level)
    fallback = copy_key(status, "HIGH")
    default = data["disclosure"]["scope"]

    def pick(section: str) -> str:
        return data[section].get(key) or data[section].get(fallback) or default

    return pick("headline"), pick("message"), pick("recommendation")


def status_label(status: str) -> str:
    return _copy()["status"].get(status, {}).get("label", status)


def confidence_label(level: str) -> str:
    return _copy()["confidence"].get(level, level)


def disclosure(key: str) -> str:
    return _copy()["disclosure"].get(key, "")

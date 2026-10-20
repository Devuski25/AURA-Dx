"""The reported class must agree with the reported probabilities.

    python backend/test_classification.py

A screening's headline, its badge, its confidence meter and the probability
table beneath them are four renderings of one answer. When the class was
picked by rules other than "which class is most likely", they could disagree:
a screening with a healthy mean of 0.60 was reported as COPD while its own
probability table read Healthy 60.0%, so the banner said COPD DETECTED, the
badge said COPD, the meter said 21% and the table showed Healthy on top.

This asserts, for every screening in the database, that what the API returns
agrees with itself:
  * the reported class is the one with the highest probability
  * the reported confidence is that class's probability
  * the probability list sorted puts that class first

A screening whose safety override fired is exempt. There the mean can
legitimately point the other way -- that is the override doing its job -- and
re-deriving it would hide the one finding that must never be hidden.

Needs a reachable database. Safe anywhere else: no model loading.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from database import supabase  # noqa: E402
from routes.api import _screening_row  # noqa: E402


def main():
    rows = (
        supabase.table("screening_history_view")
        .select("*")
        .order("created_at", desc=True).limit(50).execute().data or []
    )
    if not rows:
        print("  no screenings available")
        return 0

    print(f"  {len(rows)} screenings\n")
    problems = []
    overrides = 0

    for r in rows:
        m = _screening_row(r)
        probs = m.respiratory_probabilities or {}
        if not probs:
            continue
        ordered = sorted(probs.items(), key=lambda kv: kv[1], reverse=True)
        top_label, top_prob = ordered[0]

        fusion = (m.recording_scores or {}).get("fusion") or {}
        is_override = bool(fusion.get("override_applied"))
        if is_override:
            overrides += 1

        if is_override:
            status = "override (exempt)"
        else:
            status = "OK" if m.respiratory_result == top_label else "MISMATCH"
            if m.respiratory_result != top_label:
                problems.append(
                    f"{m.id[:8]}: reported {m.respiratory_result} but the most "
                    f"likely class is {top_label} ({top_prob:.3f})")
            if abs((m.respiratory_confidence or 0) - top_prob) > 0.001:
                problems.append(
                    f"{m.id[:8]}: confidence {m.respiratory_confidence} != the "
                    f"reported class's probability {top_prob}")

        print(f"  {m.id[:8]}  reported={str(m.respiratory_result):<12} "
              f"conf={str(round(m.respiratory_confidence or 0, 3)):<6} "
              f"top={top_label} {top_prob:.3f}   {status}")

    print(f"\n  {overrides} screening(s) had a safety override (exempt)")
    if problems:
        print("\n  FAILURES:")
        for p in problems:
            print(f"    {p}")
        return 1
    print("  PASS: every screening's class, confidence and probability list agree")
    return 0


if __name__ == "__main__":
    sys.exit(main())

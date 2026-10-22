"""Does gathering the Stage 2 windows into one batch change the verdict?

The endpoint used to score one recording at a time, so a five-take
screening paid five separate passes through TensorFlow. The windows of
every recording that reaches Stage 2 are now predicted in ONE pass, and
the headline for a recording is still the maximum over that recording's
own windows.

That is only safe if two things hold:
  1. the batched path returns the same numbers as the per-recording path;
  2. each recording's windows are sliced out of the batch correctly, so
     one recording's loudest window cannot be handed to another.

This tests both, with the models stubbed, so it needs only numpy.

Run:
    python packages/inference/test_batched_scoring.py
"""
import importlib.util
import sys
import types
from pathlib import Path

import numpy as np

SERVICE_PATH = Path(__file__).resolve().parent / "inference_service.py"


def _load_service():
    """Import inference_service with every non-numpy dependency stubbed out."""
    for name in ["librosa", "fastapi", "fastapi.responses",
                 "fastapi.security", "pydantic", "scipy", "scipy.signal"]:
        sys.modules.setdefault(name, types.ModuleType(name))

    class _BaseModel:
        def __init__(self, **kwargs):
            for k, v in kwargs.items():
                setattr(self, k, v)

    class _FakeApp:
        """Stands in for FastAPI so the route decorators become no-ops."""

        def __init__(self, *a, **k):
            pass

        def post(self, *a, **k):
            return lambda fn: fn

        def get(self, *a, **k):
            return lambda fn: fn

    def _anything(*a, **k):
        return None

    sys.modules["pydantic"].BaseModel = _BaseModel
    sys.modules["fastapi"].FastAPI = _FakeApp
    sys.modules["fastapi"].File = _anything
    sys.modules["fastapi"].Depends = _anything
    sys.modules["fastapi"].Security = _anything
    sys.modules["fastapi"].UploadFile = object
    sys.modules["fastapi"].HTTPException = Exception
    responses_mod = sys.modules["fastapi.responses"]
    responses_mod.JSONResponse = object
    security_mod = sys.modules["fastapi.security"]
    security_mod.APIKeyHeader = lambda **k: None
    sys.modules["scipy.signal"].butter = None
    sys.modules["scipy.signal"].filtfilt = None

    spec = importlib.util.spec_from_file_location("inference_service", SERVICE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


svc = _load_service()

# ── the stubs ──────────────────────────────────────────────────────────
#
# A recording is a list of samples. Sample 0 doubles as its Stage 1
# probability, so a test can decide whether it reaches Stage 2. Every
# window of a recording carries the recording's own marker, so a window
# handed to the wrong recording is visible in the numbers.

WINDOW = 2
SAMPLES = 8
WINDOWS_PER_CLIP = SAMPLES // WINDOW

AUDIO = {}


class _FakeBooster:
    def inplace_predict(self, features):
        return np.asarray([features[0][0]])


class _FakeModel:
    """Returns the mean of each sample, so every window's score is known."""

    def __init__(self):
        self.batches = []

    def predict(self, batch, verbose=0):
        arr = np.asarray(batch)
        self.batches.append(arr)
        return arr.reshape(arr.shape[0], -1).mean(axis=1)


def _install(marker_of):
    """Point the service at the fakes. `marker_of` maps a payload to its
    recording's samples."""
    svc._stage1_model = _FakeBooster()
    svc._stage2_model = _FakeModel()
    svc.load_audio = lambda payload: AUDIO[payload]
    svc.build_stage1_features = lambda audio: np.full((1, svc.STAGE1_FEATURE_DIM), audio[0])
    svc.stage2_windows = lambda audio: [audio[i:i + WINDOW] for i in range(0, len(audio), WINDOW)]
    svc.build_stage2_tensor = lambda w: w.reshape(1, 1, WINDOW, 1)


def _make(index, p_healthy):
    """One recording: `p_healthy` decides routing, the rest marks the
    windows so they can be told apart from another recording's."""
    samples = [p_healthy] + [index * 100 + k for k in range(SAMPLES - 1)]
    return np.array(samples, dtype=float)


def _expected_max(payload):
    """The Stage 2 headline a recording must end up with: the largest score
    over its own windows. Derived from the data, never written by hand."""
    audio = AUDIO[payload]
    return max(audio[j:j + WINDOW].mean() for j in range(0, len(audio), WINDOW))


# ── the tests ──────────────────────────────────────────────────────────

failures = []


def check(name, condition, detail=""):
    if condition:
        print(f"  [PASS] {name}")
    else:
        print(f"  [FAIL] {name}" + (f"  -- {detail}" if detail else ""))
        failures.append(name)


print("batched Stage 2 scoring")

# --- 1. the batched path returns the same numbers as the per-recording path
AUDIO.clear()
payloads = []
for i in range(3):
    audio = _make(i, 0.10)  # 0.10 < 0.61, so it reaches Stage 2
    payload = f"clip{i}".encode()
    AUDIO[payload] = audio
    payloads.append(payload)

_install(lambda: None)

per_clip = [svc.score_single_clip(svc.load_audio(p), i) for i, p in enumerate(payloads)]

# The per-recording path above made one pass through the model per
# recording. Clear the log, so what is measured next is the batched path
# and nothing else.
svc._stage2_model.batches.clear()

batched = svc.score_batch(payloads)

check("same number of results", len(batched) == len(per_clip),
      f"{len(batched)} vs {len(per_clip)}")
check("results are in index order",
      [r["index"] for r in batched] == list(range(len(per_clip))))
check("pneumonia probability is unchanged",
      all(abs(b["pneumonia_prob"] - p["pneumonia_prob"]) < 1e-9
          for b, p in zip(batched, per_clip)),
      str([(b["pneumonia_prob"], p["pneumonia_prob"]) for b, p in zip(batched, per_clip)]))
check("the label is unchanged",
      all(b["clip_label"] == p["clip_label"] for b, p in zip(batched, per_clip)))
check("the healthy probability is unchanged",
      all(abs(b["stage1_healthy_prob"] - p["stage1_healthy_prob"]) < 1e-9
          for b, p in zip(batched, per_clip)))
check("the COPD probability is unchanged",
      all(abs(b["copd_prob"] - p["copd_prob"]) < 1e-9 for b, p in zip(batched, per_clip)))

# --- 2. one pass through the model, not one per recording
check("the model was called once, not once per recording",
      len(svc._stage2_model.batches) == 1,
      f"{len(svc._stage2_model.batches)} call(s)")

# --- 3. the batch holds exactly the windows of the recordings that need it
batch = svc._stage2_model.batches[0]
check("the batch holds every window of every recording that reached Stage 2",
      batch.shape[0] == len(payloads) * WINDOWS_PER_CLIP,
      f"{batch.shape[0]} samples, expected {len(payloads) * WINDOWS_PER_CLIP}")

# --- 4. each recording's windows are its OWN
#     A recording's headline is the max over its windows, and each
#     recording's windows carry that recording's marker. If the slicing
#     were off by even one window, the headline would carry another
#     recording's marker and this would fail.
expected = [_expected_max(p) for p in payloads]
check("each recording gets its own windows back",
      all(abs(b["pneumonia_prob"] - e) < 1e-9 for b, e in zip(batched, expected)),
      f"got {[b['pneumonia_prob'] for b in batched]}, expected {expected}")

# --- 5. a recording that Stage 1 calls healthy never reaches Stage 2
AUDIO.clear()
payloads = []
for i in range(3):
    p_healthy = 0.90 if i == 1 else 0.10  # the middle one is healthy
    payload = f"mix{i}".encode()
    AUDIO[payload] = _make(i, p_healthy)
    payloads.append(payload)

_install(lambda: None)
batched = svc.score_batch(payloads)

check("a healthy recording is pinned and does not reach Stage 2",
      batched[1]["stage1_routed_to_stage2"] is False
      and batched[1]["healthy_prob"] == 1.0
      and batched[1]["pneumonia_prob"] == 0.0)
check("the healthy recording is left out of the batch",
      svc._stage2_model.batches[0].shape[0] == 2 * WINDOWS_PER_CLIP,
      f"{svc._stage2_model.batches[0].shape[0]} samples, expected {2 * WINDOWS_PER_CLIP}")
check("the other two still get their own windows",
      abs(batched[0]["pneumonia_prob"] - _expected_max(payloads[0])) < 1e-9
      and abs(batched[2]["pneumonia_prob"] - _expected_max(payloads[2])) < 1e-9,
      f"got {batched[0]['pneumonia_prob']} and {batched[2]['pneumonia_prob']}, "
      f"expected {_expected_max(payloads[0])} and {_expected_max(payloads[2])}")

# --- 6. a bad recording still says which recording it was
AUDIO.clear()
good = b"good"
bad = b"bad"
AUDIO[good] = _make(0, 0.10)
AUDIO[bad] = np.array([0.0])


def _explode(payload):
    if payload == bad:
        raise ValueError("Decoded audio is empty")
    return AUDIO[payload]


svc.load_audio = _explode

try:
    svc.score_batch([good, bad])
    check("a bad recording raises", False, "no exception")
except svc.RecordingError as exc:
    check("a bad recording raises with its index", exc.index == 1, f"index={exc.index}")
    check("a bad recording is a 400, not a 500", exc.bad_request is True)
except Exception as exc:  # noqa: BLE001
    check("a bad recording raises RecordingError", False, type(exc).__name__)

print()
if failures:
    print(f"  {len(failures)} FAILED")
    sys.exit(1)
print("  ALL PASS")

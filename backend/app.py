from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
import sqlite3
import secrets
import time
import os
import uuid
from functools import wraps
from database import get_db
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
import io

import torch
import torch.nn as nn
import torchvision.models as tv_models
from audio_utils import extract_dual_tier_tensors

app = Flask(__name__)
CORS(app)

# ════════════════════════════════════════════════════════════════
# AI Model Loading — happens ONCE at server startup, not per-request
# ════════════════════════════════════════════════════════════════
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TB_WEIGHTS_PATH = os.path.join(BASE_DIR, "tb_gatekeeper_resnet18.pth")
RESP_WEIGHTS_PATH = os.path.join(BASE_DIR, "respiratory_classifier_resnet18.pth")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads_audio")
os.makedirs(UPLOAD_DIR, exist_ok=True)

RESP_CLASSES = ["COPD", "Healthy", "Pneumonia"]
ALLOWED_AUDIO_EXTENSIONS = {".wav", ".mp3", ".webm", ".ogg", ".m4a", ".flac"}

CLINICAL_RECOMMENDATIONS = {
    "Tuberculosis": {
        "urgency": "Urgent",
        "text": (
            "TB Gatekeeper flagged TB-positive acoustic markers. Refer the patient for "
            "confirmatory testing (sputum smear microscopy or GeneXpert) immediately. "
            "Where possible, isolate the patient from others in the waiting area pending "
            "confirmatory results, per standard TB infection control protocol."
        ),
    },
    "COPD": {
        "urgency": "Moderate",
        "text": (
            "Acoustic pattern is consistent with COPD. Recommend spirometry testing to "
            "confirm diagnosis and assess severity. Advise on smoking cessation if "
            "applicable, and monitor for exacerbation symptoms such as increased "
            "breathlessness or changes in sputum."
        ),
    },
    "Pneumonia": {
        "urgency": "Moderate",
        "text": (
            "Acoustic pattern is consistent with pneumonia. Recommend a chest exam and "
            "vital signs check (temperature, respiratory rate, oxygen saturation), "
            "correlated with symptoms such as fever or chest pain. Consider a chest "
            "X-ray if clinically indicated."
        ),
    },
    "Healthy": {
        "urgency": "Low",
        "text": (
            "No respiratory abnormality detected in this screening. No immediate "
            "clinical action required. Advise the patient to seek in-person evaluation "
            "if symptoms persist or worsen — this is a screening tool, not a "
            "diagnostic substitute."
        ),
    },
}

def get_clinical_recommendation(prediction):
    return CLINICAL_RECOMMENDATIONS.get(prediction, {
        "urgency": "Unknown",
        "text": "No specific recommendation available for this result. Refer to a licensed physician for evaluation.",
    })

def build_resnet18(num_classes):
    model = tv_models.resnet18(weights=None)
    model.fc = nn.Linear(model.fc.in_features, num_classes)
    return model

print("Loading TB Gatekeeper model (Tier 1, 2 classes)...")
tb_model = build_resnet18(num_classes=2)
tb_model.load_state_dict(torch.load(TB_WEIGHTS_PATH, map_location="cpu"))
tb_model.eval()

print("Loading Respiratory Classifier model (Tier 2, 3 classes)...")
resp_model = build_resnet18(num_classes=3)
resp_model.load_state_dict(torch.load(RESP_WEIGHTS_PATH, map_location="cpu"))
resp_model.eval()

print("Both AI models loaded on CPU and locked into eval() mode.")

@app.before_request
def start_timer():
    request.start_time = time.time()

@app.after_request
def log_metrics(response):
    try:
        duration_ms = (time.time() - request.start_time) * 1000
        db = get_db()
        db.execute(
            "INSERT INTO request_metrics (endpoint, method, status_code, response_time_ms) VALUES (?, ?, ?, ?)",
            (request.path, request.method, response.status_code, duration_ms)
        )
        db.commit()
        db.close()
    except Exception:
        pass
    return response

def require_auth(roles=None):
    def decorator(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            auth_header = request.headers.get("Authorization", "")
            if not auth_header.startswith("Bearer "):
                return jsonify({"error": "You must be signed in to do that."}), 401

            token = auth_header.split(" ", 1)[1]
            db = get_db()
            user = db.execute(
                "SELECT users.* FROM sessions JOIN users ON sessions.user_id = users.id WHERE sessions.token = ?",
                (token,)
            ).fetchone()
            db.close()

            if user is None:
                return jsonify({"error": "Session expired or invalid. Please sign in again."}), 401
            if roles and user["role"] not in roles:
                return jsonify({"error": "You don't have permission to do that."}), 403

            request.current_user = user
            return f(*args, **kwargs)
        return wrapped
    return decorator

@app.route("/")
def home():
    return {"message": "CoughPH backend is running"}

@app.route("/api/register", methods=["POST"])
def register():
    data = request.get_json()
    username = data.get("username", "").strip()
    password = data.get("password", "")
    role = data.get("role", "nurse")

    if not username or not password:
        return jsonify({"error": "Username and password are required."}), 400

    password_hash = generate_password_hash(password)

    db = get_db()
    try:
        db.execute(
            "INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, ?, 'pending')",
            (username, password_hash, role)
        )
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({"error": "That username is already taken."}), 409
    finally:
        db.close()

    return jsonify({"message": "Account created. Awaiting Super Admin approval."}), 201

@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json()
    username = data.get("username", "").strip()
    password = data.get("password", "")

    db = get_db()
    user = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    db.close()

    if user is None or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid username or password."}), 401

    if user["status"] != "approved":
        return jsonify({"error": "Account is pending approval."}), 403

    db2 = get_db()
    db2.execute("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?", (user["id"],))
    db2.commit()
    db2.close()

    token = secrets.token_hex(32)
    db3 = get_db()
    db3.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user["id"]))
    db3.commit()
    db3.close()

    return jsonify({
        "message": "Login successful.",
        "username": user["username"],
        "role": user["role"],
        "token": token
    }), 200

@app.route("/api/logout", methods=["POST"])
@require_auth()
def logout():
    auth_header = request.headers.get("Authorization", "")
    token = auth_header.split(" ", 1)[1]
    db = get_db()
    db.execute("DELETE FROM sessions WHERE token = ?", (token,))
    db.commit()
    db.close()
    return jsonify({"message": "Logged out."}), 200

@app.route("/api/screenings", methods=["POST"])
def create_screening():
    data = request.get_json()
    patient_label = data.get("patient_label", "").strip()
    phenotype = data.get("phenotype")
    prediction = data.get("prediction")
    confidence = data.get("confidence")

    if not patient_label:
        return jsonify({"error": "patient_label is required."}), 400

    db = get_db()
    cursor = db.execute(
        "INSERT INTO screenings (patient_label, phenotype, prediction, confidence) VALUES (?, ?, ?, ?)",
        (patient_label, phenotype, prediction, confidence)
    )
    db.commit()
    new_id = cursor.lastrowid
    db.close()

    return jsonify({"message": "Screening saved.", "id": new_id}), 201

# ════════════════════════════════════════════════════════════════
# REAL AI prediction endpoint — this replaces the simulated result
# ════════════════════════════════════════════════════════════════
@app.route("/api/screenings/predict", methods=["POST"])
def predict_screening():
    if "file" not in request.files:
        return jsonify({"error": "No audio file provided under form key 'file'."}), 400

    audio_file = request.files["file"]
    patient_label = request.form.get("patient_label", "Web Portal Screening").strip()

    if audio_file.filename == "":
        return jsonify({"error": "Empty filename."}), 400

    ext = os.path.splitext(audio_file.filename)[1].lower()
    if ext not in ALLOWED_AUDIO_EXTENSIONS:
        ext = ".wav"
    stored_filename = f"{uuid.uuid4().hex}{ext}"
    stored_path = os.path.join(UPLOAD_DIR, stored_filename)
    audio_file.save(stored_path)

    try:
        tier1_tensor, tier2_tensor = extract_dual_tier_tensors(stored_path)

        # ── Tier 1: TB Gatekeeper ──────────────────────────────────
        with torch.no_grad():
            tb_logits = tb_model(tier1_tensor)
            tb_probs = torch.softmax(tb_logits, dim=1).squeeze(0)
            tb_pred_idx = int(torch.argmax(tb_probs).item())
            tb_confidence = round(float(tb_probs[tb_pred_idx].item()) * 100, 2)

        if tb_pred_idx == 1:
            # TB Positive — halt the pipeline, do not run Tier 2
            tb_status = "TB Positive"
            final_prediction = "Tuberculosis"
            final_confidence = tb_confidence
            distribution = None
        else:
            # ── Tier 2: Respiratory Classifier (only if TB Negative) ──
            tb_status = "TB Negative"
            with torch.no_grad():
                resp_logits = resp_model(tier2_tensor)
                resp_probs = torch.softmax(resp_logits, dim=1).squeeze(0)
                resp_pred_idx = int(torch.argmax(resp_probs).item())
                final_prediction = RESP_CLASSES[resp_pred_idx]
                final_confidence = round(float(resp_probs[resp_pred_idx].item()) * 100, 2)
                distribution = {
                    RESP_CLASSES[i]: round(float(resp_probs[i].item()) * 100, 2)
                    for i in range(len(RESP_CLASSES))
                }

        db = get_db()
        cursor = db.execute(
            "INSERT INTO screenings (patient_label, phenotype, prediction, confidence) VALUES (?, ?, ?, ?)",
            (patient_label, tb_status, final_prediction, final_confidence)
        )
        db.commit()
        new_id = cursor.lastrowid
        db.close()

        recommendation = get_clinical_recommendation(final_prediction)

        return jsonify({
            "id": new_id,
            "tb_status": tb_status,
            "tb_confidence": tb_confidence,
            "prediction": final_prediction,
            "confidence": final_confidence,
            "distribution": distribution,
            "recommendation": recommendation["text"],
            "urgency": recommendation["urgency"]
        }), 201

    except Exception as e:
        return jsonify({"error": f"Inference failed: {str(e)}"}), 500
    finally:
        # Delete the temp audio file after inference — matches your
        # Legal & Privacy page's data-minimization commitments; we don't
        # need to keep raw audio around once a result has been extracted.
        try:
            os.remove(stored_path)
        except OSError:
            pass

@app.route("/api/screenings", methods=["GET"])
@require_auth()
def list_screenings():
    db = get_db()
    rows = db.execute("""
        SELECT screenings.*, users.username AS reviewed_by_username
        FROM screenings
        LEFT JOIN users ON screenings.reviewed_by = users.id
        ORDER BY screenings.created_at DESC
    """).fetchall()
    db.close()
    return jsonify([dict(row) for row in rows]), 200

@app.route("/api/screenings", methods=["DELETE"])
@require_auth(roles=["super_admin"])
def clear_screenings():
    db = get_db()
    db.execute("DELETE FROM screenings")
    db.commit()
    db.close()
    return jsonify({"message": "History cleared."}), 200

@app.route("/api/users", methods=["GET"])
@require_auth(roles=["super_admin"])
def list_users():
    db = get_db()
    rows = db.execute(
        "SELECT id, username, role, status, created_at, last_login_at FROM users ORDER BY created_at DESC"
    ).fetchall()
    db.close()
    return jsonify([dict(row) for row in rows]), 200

@app.route("/api/users/<int:user_id>/status", methods=["PATCH"])
@require_auth(roles=["super_admin"])
def update_user_status(user_id):
    data = request.get_json()
    new_status = data.get("status")
    if new_status not in ("approved", "rejected", "pending"):
        return jsonify({"error": "Status must be approved, rejected, or pending."}), 400

    db = get_db()
    db.execute("UPDATE users SET status = ? WHERE id = ?", (new_status, user_id))
    db.commit()
    db.close()
    return jsonify({"message": "Status updated."}), 200

@app.route("/api/screenings/<int:screening_id>/pdf", methods=["GET"])
@require_auth()
def screening_pdf(screening_id):
    db = get_db()
    row = db.execute("""
        SELECT screenings.*, users.username AS reviewed_by_username
        FROM screenings
        LEFT JOIN users ON screenings.reviewed_by = users.id
        WHERE screenings.id = ?
    """, (screening_id,)).fetchone()
    db.close()
    if row is None:
        return jsonify({"error": "Screening not found."}), 404

    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=letter)
    width, height = letter

    c.setFont("Helvetica-Bold", 16)
    c.drawString(50, height - 60, "CoughPH Screening Summary")
    c.setFont("Helvetica", 10)
    c.drawString(50, height - 80, "For research and clinical-support use only. Not a substitute for professional diagnosis.")

    fields = [
        ("Screening ID", row["id"]),
        ("Patient Label", row["patient_label"]),
        ("Date", row["created_at"]),
        ("Tier 1 Result (TB Gatekeeper)", row["phenotype"] or "-"),
        ("Tier 2 Result (Diagnosis)", row["prediction"] or "-"),
        ("Confidence", f"{row['confidence']}%" if row["confidence"] is not None else "-"),
        ("Reviewed By", row["reviewed_by_username"] or "Not yet reviewed"),
    ]

    c.setFont("Helvetica", 11)
    y = height - 120
    for label, value in fields:
        c.drawString(50, y, f"{label}: {value}")
        y -= 22

    recommendation = get_clinical_recommendation(row["prediction"])
    y -= 10
    c.setFont("Helvetica-Bold", 11)
    c.drawString(50, y, f"Clinical Recommendation ({recommendation['urgency']} Priority)")
    y -= 18
    c.setFont("Helvetica", 10)

    import textwrap
    wrapped_lines = textwrap.wrap(recommendation["text"], width=90)
    for line in wrapped_lines:
        c.drawString(50, y, line)
        y -= 15

    y -= 10
    c.setFont("Helvetica-Oblique", 9)
    c.drawString(50, 60, "Generated by CoughPH — Web-Based AI System for Early Detection of Respiratory Diseases")

    c.showPage()
    c.save()
    buffer.seek(0)

    return send_file(
        buffer,
        mimetype="application/pdf",
        as_attachment=True,
        download_name=f"coughph-screening-{screening_id}.pdf"
    )

@app.route("/api/screenings/<int:screening_id>/review", methods=["PATCH"])
@require_auth(roles=["nurse", "doctor"])
def review_screening(screening_id):
    db = get_db()
    row = db.execute("SELECT id FROM screenings WHERE id = ?", (screening_id,)).fetchone()
    if row is None:
        db.close()
        return jsonify({"error": "Screening not found."}), 404

    db.execute(
        "UPDATE screenings SET reviewed_by = ? WHERE id = ?",
        (request.current_user["id"], screening_id)
    )
    db.commit()
    db.close()
    return jsonify({"message": "Marked as reviewed."}), 200

@app.route("/api/metrics/summary", methods=["GET"])
@require_auth(roles=["super_admin"])
def metrics_summary():
    db = get_db()
    by_endpoint = db.execute("""
        SELECT endpoint, method,
               COUNT(*) AS request_count,
               ROUND(AVG(response_time_ms), 2) AS avg_ms,
               ROUND(MIN(response_time_ms), 2) AS min_ms,
               ROUND(MAX(response_time_ms), 2) AS max_ms,
               SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS error_count
        FROM request_metrics
        GROUP BY endpoint, method
        ORDER BY request_count DESC
    """).fetchall()
    overall = db.execute("""
        SELECT COUNT(*) AS total_requests,
               ROUND(AVG(response_time_ms), 2) AS avg_ms,
               SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS total_errors
        FROM request_metrics
    """).fetchone()
    db.close()
    return jsonify({
        "by_endpoint": [dict(r) for r in by_endpoint],
        "overall": dict(overall)
    }), 200

if __name__ == "__main__":
    app.run(debug=True, port=5000)
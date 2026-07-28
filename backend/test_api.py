import requests

BASE = "http://127.0.0.1:5000"

# Test registration
r = requests.post(f"{BASE}/api/register", json={
    "username": "demo_nurse",
    "password": "CoughPH123!",
    "role": "nurse"
})
print("Register:", r.status_code, r.json())

# Login and capture the token
r = requests.post(f"{BASE}/api/login", json={
    "username": "demo_nurse",
    "password": "CoughPH123!"
})
print("Login:", r.status_code, r.json())
token = r.json().get("token")

# Try listing users WITHOUT a token — should fail with 401
r = requests.get(f"{BASE}/api/users")
print("List users (no token):", r.status_code, r.json())

# Try listing users WITH a nurse token — should fail with 403 (wrong role)
r = requests.get(f"{BASE}/api/users", headers={"Authorization": f"Bearer {token}"})
print("List users (nurse token):", r.status_code, r.json())

# Test PDF export (using the token from the login test above)
r = requests.get(f"{BASE}/api/screenings/1/pdf", headers={"Authorization": f"Bearer {token}"})
print("PDF export status:", r.status_code, "| content-type:", r.headers.get("Content-Type"))
with open("test-screening.pdf", "wb") as f:
    f.write(r.content)
print("Saved test-screening.pdf")

# Test metrics summary
r = requests.get(f"{BASE}/api/metrics/summary", headers={"Authorization": f"Bearer {token}"})
print("Metrics summary:", r.status_code, r.json())
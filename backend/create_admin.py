from werkzeug.security import generate_password_hash
from database import get_db
import sqlite3

username = "super_admin"
password = "ChangeThisPassword123!"

db = get_db()
try:
    db.execute(
        "INSERT INTO users (username, password_hash, role, status) VALUES (?, ?, 'super_admin', 'approved')",
        (username, generate_password_hash(password))
    )
    db.commit()
    print(f"Super Admin created: {username} / {password}")
except sqlite3.IntegrityError:
    print("That username already exists.")
db.close()
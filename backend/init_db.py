import sqlite3

DB_FILE = "coughph.db"
SCHEMA_FILE = "schema.sql"

def init_db():
    connection = sqlite3.connect(DB_FILE)
    with open(SCHEMA_FILE, "r") as f:
        connection.executescript(f.read())
    connection.commit()
    connection.close()
    print(f"Database initialized: {DB_FILE}")

if __name__ == "__main__":
    init_db()
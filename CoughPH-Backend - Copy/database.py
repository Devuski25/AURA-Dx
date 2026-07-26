import sqlite3

DB_FILE = "coughph.db"

def get_db():
    connection = sqlite3.connect(DB_FILE)
    connection.row_factory = sqlite3.Row  # lets us access columns by name, like a dictionary
    return connection
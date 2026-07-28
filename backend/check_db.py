import sqlite3

connection = sqlite3.connect("coughph.db")
tables = connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
print(tables)
connection.close()
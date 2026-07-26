import sqlite3

connection = sqlite3.connect("coughph.db")
connection.execute("UPDATE users SET status = 'approved' WHERE username = ?", ("demo_nurse",))
connection.commit()
connection.close()
print("demo_nurse approved.")
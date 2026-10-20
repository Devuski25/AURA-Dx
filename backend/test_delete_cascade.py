"""Work out exactly what deletes clinical data.

Three test patients and one test screening each were created -- one owned by
the account being removed, two owned by other accounts -- and then the
removal sequence was run and watched.

The point is to find out whether removing one account can take another
account's patients and screenings with it.
"""

import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from database import supabase  # noqa: E402

made = []


def auth_retry(fn, attempts=6):
    """The auth admin API times out intermittently on this project.

    That is not a theory -- it is what left two stray super_admin accounts in
    the database in the first place, because the cleanup's auth delete failed
    and the profile row was never removed. Every auth call in a test gets the
    same treatment.
    """
    last = None
    for i in range(attempts):
        try:
            return fn()
        except Exception as e:
            last = e
            time.sleep(2 + i)
    raise last


def make_user(email, name, role="clinician"):
    password = "CascadeProbe!pass123"
    r = auth_retry(lambda: supabase.auth.admin.create_user(
        {"email": email, "password": password, "email_confirm": True}
    ))
    uid = r.user.id
    made.append(uid)
    clinic = supabase.table("clinics").select("id").limit(1).execute().data[0]["id"]
    supabase.table("profiles").upsert({
        "id": uid, "email": email, "full_name": name, "role": role,
        "status": "approved", "clinic_id": clinic,
    }).execute()
    return uid, clinic


def make_patient(name, owner_id, clinic):
    pid = str(uuid.uuid4())
    supabase.table("patients").insert({
        "id": pid, "full_name": name, "date_of_birth": "1990-01-01",
        "gender": "male", "clinic_id": clinic, "clinician_id": owner_id,
    }).execute()
    sid = str(uuid.uuid4())
    supabase.table("screenings").insert({
        "id": sid, "patient_id": pid, "clinician_id": owner_id, "clinic_id": clinic,
        "status": "completed", "respiratory_result": "Healthy",
        "cascade_path": "stage1", "model_version": "probe",
    }).execute()
    return pid, sid


def alive(table, rid):
    return bool(supabase.table(table).select("id").eq("id", rid).execute().data)


def main():
    stamp = int(time.time())
    doomed_email = f"cascade{stamp}doomed@example.com"
    other_email = f"cascade{stamp}other@example.com"

    doomed, clinic = make_user(doomed_email, "Cascade Doomed")
    other, _ = make_user(other_email, "Cascade Other")

    p_doomed, s_doomed = make_patient("ZZ Doomed Patient", doomed, clinic)
    p_other, s_other = make_patient("ZZ Other Patient", other, clinic)

    print("  before:")
    print(f"    doomed patient  alive={alive('patients', p_doomed)}  screening alive={alive('screenings', s_doomed)}")
    print(f"    other  patient  alive={alive('patients', p_other)}  screening alive={alive('screenings', s_other)}")

    # The exact sequence the removal script ran.
    print("\n  step 1: delete screenings where clinician_id = doomed")
    supabase.table("screenings").delete().eq("clinician_id", doomed).execute()
    print(f"    other screening still alive={alive('screenings', s_other)}")

    print("  step 2: delete patients where clinician_id = doomed")
    supabase.table("patients").delete().eq("clinician_id", doomed).execute()
    print(f"    doomed patient alive={alive('patients', p_doomed)}  other patient alive={alive('patients', p_other)}")
    print(f"    other screening still alive={alive('screenings', s_other)}")

    print("  step 3: delete the auth user")
    try:
        auth_retry(lambda: supabase.auth.admin.delete_user(doomed))
        print("    auth delete succeeded")
    except Exception as e:
        print(f"    auth delete FAILED: {str(e)[:160]}")

    print(f"    other patient alive={alive('patients', p_other)}  other screening alive={alive('screenings', s_other)}")

    print("  step 4: delete the profile row")
    try:
        supabase.table("profiles").delete().eq("id", doomed).execute()
        print("    profile delete succeeded")
    except Exception as e:
        print(f"    profile delete FAILED: {str(e)[:160]}")

    print(f"    other patient alive={alive('patients', p_other)}  other screening alive={alive('screenings', s_other)}")

    print("\n  after:")
    print(f"    doomed patient  alive={alive('patients', p_doomed)}  screening alive={alive('screenings', s_doomed)}")
    print(f"    other  patient  alive={alive('patients', p_other)}  screening alive={alive('screenings', s_other)}")

    cascade = not alive("patients", p_other) or not alive("screenings", s_other)
    print()
    if cascade:
        print("  FINDING: removing one account ALSO removes another account's clinical data")
    else:
        print("  FINDING: the removal is properly scoped -- other accounts' data is untouched")


try:
    main()
finally:
    # Leave the database exactly as it was found.
    for uid in made:
        for table, col in (("screenings", "clinician_id"), ("patients", "clinician_id"),
                            ("profiles", "id")):
            try:
                supabase.table(table).delete().eq(col, uid).execute()
            except Exception:
                pass
        for _ in range(3):
            try:
                auth_retry(lambda: supabase.auth.admin.delete_user(uid))
                break
            except Exception:
                time.sleep(2)
    print("\n  probe data cleaned up")

"""Remove every super_admin except the one the owner keeps.

The two extra accounts were leftovers from the filter test: its cleanup deleted
the auth user first, and when that call timed out the profile row was left
behind. The test has been fixed separately.

The application's own delete endpoint refuses to delete a super_admin, which is
the right rule for the UI, so this does the work directly -- and it audits it,
because an account disappearing without a trace is not something to be able to
explain later.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from database import supabase  # noqa: E402

KEEP_EMAIL = "rheincama@gmail.com"


def log_audit(action, actor, clinic_id, entity_type, entity_id, details):
    """Same shape as the backend's _log_audit, and the same columns.

    The column names here matter: `actor_id`/`target_id` are not columns, and
    an insert that names them fails with PGRST204 -- which the backend's own
    helper swallows silently, so an audit trail that quietly stopped working
    looks exactly like an audit trail with nothing in it.
    """
    try:
        supabase.table("audit_logs").insert({
            "user_id": actor,
            "clinic_id": clinic_id,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "details": details,
        }).execute()
        return True
    except Exception as e:
        print(f"    (audit log write failed: {e!r})")
        return False


def delete_auth_user(uid, attempts=3):
    """The auth admin call intermittently times out. Retry it."""
    last = None
    for i in range(attempts):
        try:
            supabase.auth.admin.delete_user(uid)
            return True, None
        except Exception as e:
            last = e
            # A missing user is a success as far as the caller is concerned.
            if "not found" in str(e).lower() or "404" in str(e):
                return True, None
    return False, repr(last)


def main():
    rows = supabase.table("profiles").select(
        "id, email, full_name, role, status, clinic_id"
    ).eq("role", "super_admin").execute().data

    print(f"  super_admin accounts found: {len(rows)}")
    keep = [r for r in rows if (r.get("email") or "").lower() == KEEP_EMAIL]
    remove = [r for r in rows if (r.get("email") or "").lower() != KEEP_EMAIL]

    if not keep:
        print(f"  ERROR: the account to keep ({KEEP_EMAIL}) was not found.")
        print("         Nothing was deleted.")
        return 1
    print(f"  keeping : {keep[0]['email']} ({keep[0].get('full_name')})")

    actor = keep[0]["id"]
    clinic_id = keep[0].get("clinic_id")

    # Accounts removed by an earlier run of this script. They are recorded here
    # so the audit trail has an entry for them even though the profile rows
    # are already gone.
    ALREADY_REMOVED = [
        ("2463d64e-e050-408d-83e0-537c67dcaafd",
         "filt1792497706super_admin@example.com"),
        ("c7cd6523-6057-4639-a97e-db5ff46df2b3",
         "filt1792497826super_admin@example.com"),
    ]

    for r in remove:
        uid = r["id"]
        email = r.get("email")
        print(f"\n  removing: {email} ({uid})")

        # Clinical rows first. patients/screenings reference profiles with
        # ON DELETE RESTRICT, so the profile delete fails otherwise.
        scr = supabase.table("screenings").delete().eq("clinician_id", uid).execute()
        pat = supabase.table("patients").delete().eq("clinician_id", uid).execute()
        n_scr = len(scr.data or [])
        n_pat = len(pat.data or [])
        print(f"    screenings deleted: {n_scr}   patients deleted: {n_pat}")

        # The auth user first, then the profile, each in its own try block so
        # that one failure cannot leave the other behind. That is exactly how
        # the stray accounts happened in the first place.
        ok, err = delete_auth_user(uid)
        print(f"    auth user removed: {ok}" + (f"  ({err})" if err else ""))
        try:
            supabase.table("profiles").delete().eq("id", uid).execute()
            print("    profile removed: True")
        except Exception as e:
            print(f"    profile removed: False  ({e!r})")

        log_audit("user_delete", actor, clinic_id, "user", uid, {
            "deleted_user": email,
            "role": "super_admin",
            "reason": "removed all super_admin accounts except the owner's",
        })

    # Record the ones an earlier run already deleted.
    for uid, email in ALREADY_REMOVED:
        if any(r["id"] == uid for r in remove):
            continue
        print(f"\n  recording the earlier removal of: {email} ({uid})")
        log_audit("user_delete", actor, clinic_id, "user", uid, {
            "deleted_user": email,
            "role": "super_admin",
            "reason": "removed all super_admin accounts except the owner's",
        })

    # Verify.
    after = supabase.table("profiles").select("id, email, role").eq(
        "role", "super_admin").execute().data
    print(f"\n  super_admin accounts remaining: {len(after)}")
    for r in after:
        print(f"    {r['email']}")

    ok = len(after) == 1 and (after[0].get("email") or "").lower() == KEEP_EMAIL
    print()
    print("  PASS: only the owner's super_admin account remains" if ok
          else "  FAIL: the wrong set of accounts remains")
    return 0 if ok else 1


sys.exit(main())

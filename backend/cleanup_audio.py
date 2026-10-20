"""Remove the recordings on the Mini PC's disk.

The recordings are files, not rows, so a SQL script cannot clear them. The
instruction that used to do it --

    Remove-Item C:\\VSPWET\\AURA-Dx\\backend\\uploads_audio\\* -Force

-- is a trap. It deletes every recording, including the ones belonging to
screenings that still exist, and the rows are left pointing at files that
are not there. Nothing breaks visibly, because the result of a screening is
in the database and the audio is only used for playback during the recording
itself. The recordings are simply gone, and the disk looks like it was never
used.

So there are two modes:

    cleanup_audio.py            remove the orphans, and only the orphans
    cleanup_audio.py --all      remove every recording, live screenings included

The default is the safe one. A file is an orphan when no screening row
refers to it, which is the normal state after a reset: the rows are gone and
the files were left behind.

Run it with no arguments from anywhere; it finds the upload directory
itself, so it cannot be pointed at the wrong folder.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from database import supabase  # noqa: E402

UPLOADS = Path(__file__).resolve().parent / "uploads_audio"


def referenced_names():
    """Every recording filename that a live screening row points at."""
    names = set()
    rows = (
        supabase.table("screenings")
        .select("recording_paths,audio_file_path")
        .execute()
        .data or []
    )
    for r in rows:
        for p in (r.get("recording_paths") or []):
            if p:
                names.add(Path(str(p)).name)
        if r.get("audio_file_path"):
            names.add(Path(str(r["audio_file_path"])).name)
    return names


def main():
    wipe_all = "--all" in sys.argv

    if not UPLOADS.is_dir():
        print(f"  no upload directory at {UPLOADS}")
        return 0

    files = [f for f in UPLOADS.iterdir() if f.is_file()]
    if not files:
        print(f"  nothing to remove -- {UPLOADS} is already empty")
        return 0

    live = referenced_names()
    orphans = [f for f in files if f.name not in live]
    live_files = [f for f in files if f.name in live]

    print(f"  upload directory : {UPLOADS}")
    print(f"  files on disk    : {len(files)}")
    print(f"  referenced by a screening : {len(live_files)}")
    print(f"  orphans                 : {len(orphans)}")

    if live_files and not wipe_all:
        print("\n  These belong to screenings that still exist, so they are kept:")
        for f in live_files:
            print(f"    {f.name}")
        print("  Use --all to remove them as well.")

    targets = files if wipe_all else orphans
    if not targets:
        print("\n  nothing to remove")
        return 0

    removed = 0
    freed = 0
    for f in targets:
        try:
            size = f.stat().st_size
            f.unlink()
            removed += 1
            freed += size
        except OSError as e:
            print(f"    could not remove {f.name}: {e!r}")

    print(f"\n  removed {removed} file(s), {freed / 1024 / 1024:.1f} MB")
    if wipe_all and live_files:
        print(f"  WARNING: {len(live_files)} recording(s) that live screenings still")
        print("           refer to were deleted. Playback of those takes will")
        print("           not work. The results themselves are in the database")
        print("           and are unaffected.")
    return 0


sys.exit(main())

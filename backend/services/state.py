import json
import os
import threading
from datetime import datetime
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
STATE_FILE = DATA_DIR / "state.json"

_lock = threading.Lock()

# "ready" normally, "building" while the search index is rebuilt after startup.
index_status = {"state": "ready"}


def persist():
    """Saves the scan, extracted text, review decisions and move history to disk."""
    # Imported here (not at the top of the file) to avoid circular imports.
    from routers import organize, review, scan

    snapshot = {
        "version": 1,
        "scan": scan._last_scan,
        "texts": scan._texts,
        "decisions": review._decisions,
        "history": organize._history,
    }
    with _lock:
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            temp = STATE_FILE.with_suffix(".tmp")
            with open(temp, "w", encoding="utf-8") as f:
                json.dump(snapshot, f)
            os.replace(temp, STATE_FILE)  # swap in only after the whole file is written
        except Exception as e:
            print(f"[File Genie] Could not save data: {e}")


def load() -> int:
    """Restores saved data into the running app. Returns how many files came back."""
    from routers import organize, review, scan

    if not STATE_FILE.exists():
        return 0
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)

        saved = data.get("scan") or {}
        scan._last_scan.update({
            "scan_id": saved.get("scan_id"),
            "folder": saved.get("folder"),
            "scanned_at": saved.get("scanned_at"),
            "files": saved.get("files", []),
        })
        scan._texts.clear()
        scan._texts.update({int(k): v for k, v in (data.get("texts") or {}).items()})

        decisions = data.get("decisions") or {}
        review._decisions["scan_id"] = decisions.get("scan_id")
        review._decisions["items"] = {
            int(k): v for k, v in (decisions.get("items") or {}).items()
        }

        organize._history.clear()
        organize._history.extend(data.get("history") or [])
    except Exception as e:
        print(f"[File Genie] Saved data could not be read, starting empty: {e}")
        return 0

    return len(scan._last_scan["files"])


def saved_info() -> dict:
    if not STATE_FILE.exists():
        return {"exists": False}
    info = STATE_FILE.stat()
    return {
        "exists": True,
        "size_bytes": info.st_size,
        "saved_at": datetime.fromtimestamp(info.st_mtime).isoformat(),
    }


def clear_all():
    """Forgets everything File Genie has stored. Never touches the user's own files."""
    from routers import organize, review, scan
    from services.embeddings import index

    scan._last_scan.update(
        {"scan_id": None, "folder": None, "scanned_at": None, "files": []}
    )
    scan._texts.clear()
    review._decisions.update({"scan_id": None, "items": {}})
    organize._history.clear()
    organize._plans.clear()
    index.clear()
    with _lock:
        STATE_FILE.unlink(missing_ok=True)
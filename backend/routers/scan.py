import os
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()

# File types File Genie will handle. Text extraction comes in a later phase.
SUPPORTED_TYPES = {
    ".pdf": "PDF",
    ".docx": "Word",
    ".pptx": "PowerPoint",
    ".txt": "Text",
    ".md": "Markdown",
    ".csv": "CSV",
    ".ipynb": "Notebook",
    ".py": "Code",
    ".js": "Code",
    ".java": "Code",
    ".c": "Code",
    ".cpp": "Code",
    ".html": "Code",
    ".css": "Code",
}

# Folders that are never useful to scan.
SKIP_FOLDERS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv",
    "$RECYCLE.BIN", "System Volume Information",
}

# Holds the result of the most recent scan (memory only, resets on restart).
_last_scan = {"scan_id": None, "folder": None, "scanned_at": None, "files": []}


class ScanRequest(BaseModel):
    folder: str


@router.post("/scan")
def scan_folder(request: ScanRequest):
    folder = Path(request.folder)

    if not folder.exists():
        raise HTTPException(status_code=404, detail="That folder does not exist.")
    if not folder.is_dir():
        raise HTTPException(status_code=400, detail="That path is not a folder.")

    files = []
    unsupported = 0
    unreadable = 0

    # os.walk goes through the folder and all its subfolders.
    for current, dirs, names in os.walk(folder, onerror=lambda e: None):
        dirs[:] = [d for d in dirs if d not in SKIP_FOLDERS]

        for name in names:
            path = Path(current) / name
            ext = path.suffix.lower()

            if ext not in SUPPORTED_TYPES:
                unsupported += 1
                continue

            try:
                info = path.stat()
            except OSError:
                unreadable += 1
                continue

            files.append({
                "id": len(files) + 1,
                "name": name,
                "extension": ext,
                "type": SUPPORTED_TYPES[ext],
                "size_bytes": info.st_size,
                "path": str(path),
                "folder": str(path.parent),
                "modified": datetime.fromtimestamp(info.st_mtime).isoformat(),
                "category": None,  # filled in by categorization (later phase)
            })

    scan_id = str(uuid.uuid4())
    _last_scan.update({
        "scan_id": scan_id,
        "folder": str(folder),
        "scanned_at": datetime.now().isoformat(),
        "files": files,
    })

    return {
        "scan_id": scan_id,
        "folder": str(folder),
        "file_count": len(files),
        "skipped_unsupported": unsupported,
        "skipped_unreadable": unreadable,
    }


@router.get("/files")
def list_files():
    # Empty until the user scans a folder. No fake data.
    return {
        "scan_id": _last_scan["scan_id"],
        "folder": _last_scan["folder"],
        "scanned_at": _last_scan["scanned_at"],
        "count": len(_last_scan["files"]),
        "files": _last_scan["files"],
    }
import os
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.extractor import extract_text

router = APIRouter()

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

SKIP_FOLDERS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv",
    "$RECYCLE.BIN", "System Volume Information",
}

# Memory only: resets when the server restarts.
_last_scan = {"scan_id": None, "folder": None, "scanned_at": None, "files": []}
_texts = {}  # file id -> extracted text (kept out of the file list to keep it light)


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
    texts = {}
    unsupported = 0
    unreadable = 0

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

            file_id = len(files) + 1
            result = extract_text(path, ext)
            texts[file_id] = result["text"]

            files.append({
                "id": file_id,
                "name": name,
                "extension": ext,
                "type": SUPPORTED_TYPES[ext],
                "size_bytes": info.st_size,
                "path": str(path),
                "folder": str(path.parent),
                "modified": datetime.fromtimestamp(info.st_mtime).isoformat(),
                "category": None,  # filled in by categorization (next step)
                "extraction_status": result["status"],  # ok / empty / error
                "extraction_error": result["error"],
                "char_count": len(result["text"]),
            })

    scan_id = str(uuid.uuid4())
    _last_scan.update({
        "scan_id": scan_id,
        "folder": str(folder),
        "scanned_at": datetime.now().isoformat(),
        "files": files,
    })
    _texts.clear()
    _texts.update(texts)

    return {
        "scan_id": scan_id,
        "folder": str(folder),
        "file_count": len(files),
        "text_extracted": sum(1 for f in files if f["extraction_status"] == "ok"),
        "no_text_found": sum(1 for f in files if f["extraction_status"] == "empty"),
        "extraction_errors": sum(1 for f in files if f["extraction_status"] == "error"),
        "skipped_unsupported": unsupported,
        "skipped_unreadable": unreadable,
    }


@router.get("/files")
def list_files():
    return {
        "scan_id": _last_scan["scan_id"],
        "folder": _last_scan["folder"],
        "scanned_at": _last_scan["scanned_at"],
        "count": len(_last_scan["files"]),
        "files": _last_scan["files"],
    }


@router.get("/files/{file_id}/text")
def file_text_preview(file_id: int):
    match = next((f for f in _last_scan["files"] if f["id"] == file_id), None)
    if match is None:
        raise HTTPException(status_code=404, detail="No scanned file with that id.")

    text = _texts.get(file_id, "")
    return {
        "id": file_id,
        "name": match["name"],
        "extraction_status": match["extraction_status"],
        "extraction_error": match["extraction_error"],
        "char_count": len(text),
        "preview": text[:2000],
    }
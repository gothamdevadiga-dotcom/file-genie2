import os
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.categorizer import categorize
from services.extractor import extract_text
from services.embeddings import index as search_index

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


class CategoryUpdate(BaseModel):
    category: str


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

            if result["status"] == "ok":
                cat = categorize(result["text"])
            else:
                cat = {
                    "category": None,
                    "confidence": 0,
                    "level": "None",
                    "reason": "No readable text, so this file could not be categorized.",
                    "candidates": [],
                }

            files.append({
                "id": file_id,
                "name": name,
                "extension": ext,
                "type": SUPPORTED_TYPES[ext],
                "size_bytes": info.st_size,
                "path": str(path),
                "folder": str(path.parent),
                "modified": datetime.fromtimestamp(info.st_mtime).isoformat(),
                "extraction_status": result["status"],  # ok / empty / error
                "extraction_error": result["error"],
                "char_count": len(result["text"]),
                "category": cat["category"],
                "category_confidence": cat["confidence"],
                "category_level": cat["level"],
                "category_reason": cat["reason"],
                "category_candidates": cat["candidates"],
                "category_source": "auto",  # becomes "user" if the user corrects it
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
    search_index.build(files, texts)

    return {
        "scan_id": scan_id,
        "folder": str(folder),
        "file_count": len(files),
        "text_extracted": sum(1 for f in files if f["extraction_status"] == "ok"),
        "no_text_found": sum(1 for f in files if f["extraction_status"] == "empty"),
        "extraction_errors": sum(1 for f in files if f["extraction_status"] == "error"),
        "categorized": sum(
            1 for f in files if f["category"] not in (None, "Uncategorized")
        ),
        "uncategorized": sum(
            1 for f in files if f["category"] in (None, "Uncategorized")
        ),
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


@router.get("/categories")
def list_categories():
    # Counts of files per category in the current scan (empty before any scan).
    counts = {}
    for f in _last_scan["files"]:
        name = f["category"] or "Uncategorized"
        counts[name] = counts.get(name, 0) + 1

    return {
        "categories": [
            {"category": name, "count": count}
            for name, count in sorted(counts.items(), key=lambda item: -item[1])
        ]
    }


@router.put("/files/{file_id}/category")
def correct_category(file_id: int, update: CategoryUpdate):
    # Lets the user fix a wrong category. Only changes File Genie's label,
    # never the file itself.
    match = next((f for f in _last_scan["files"] if f["id"] == file_id), None)
    if match is None:
        raise HTTPException(status_code=404, detail="No scanned file with that id.")

    new_category = update.category.strip()
    if not new_category or len(new_category) > 50:
        raise HTTPException(
            status_code=400, detail="Category must be 1 to 50 characters."
        )

    match["category"] = new_category
    match["category_source"] = "user"
    match["category_level"] = "Set by you"
    match["category_reason"] = "Category chosen by you."
    return {"id": file_id, "name": match["name"], "category": new_category}
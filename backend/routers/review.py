import re
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from routers.scan import _last_scan

router = APIRouter()

# Your decisions, kept in memory for the current scan only (a new scan starts fresh).
_decisions = {"scan_id": None, "items": {}}

_ILLEGAL = re.compile(r'[<>:"/\\|?*]')  # characters Windows folder names can't contain


class Decision(BaseModel):
    action: str                 # approve / reject / modify / undo
    category: str | None = None  # needed for "modify"


def _current_decisions() -> dict:
    if _decisions["scan_id"] != _last_scan["scan_id"]:
        _decisions["scan_id"] = _last_scan["scan_id"]
        _decisions["items"] = {}
    return _decisions["items"]


def _find_file(file_id: int):
    return next((f for f in _last_scan["files"] if f["id"] == file_id), None)


def _flags(f: dict, include_medium: bool) -> list:
    """Reasons File Genie wants the user to look at this file."""
    flags = []
    if f["extraction_status"] != "ok":
        flags.append("No readable text")
    elif f["category"] in (None, "Uncategorized"):
        flags.append("Could not choose a category")
    else:
        if f["category_level"] == "Low":
            flags.append("Low confidence")
        if include_medium and f["category_level"] == "Medium":
            flags.append("Medium confidence")
        if "Close call" in (f["category_reason"] or ""):
            flags.append("Close call between categories")
    return flags


def _suggested_category(f: dict):
    if f["category"] not in (None, "Uncategorized"):
        return f["category"]
    candidates = f.get("category_candidates") or []
    return candidates[0]["category"] if candidates else None


def _proposed_move(f: dict, category, destination_root):
    """Describes the move that WOULD happen. Nothing is moved or created here."""
    if not destination_root or not category:
        return None
    folder_name = _ILLEGAL.sub("", category).strip() or "Uncategorized"
    target = Path(destination_root) / folder_name / f["name"]
    current = Path(f["path"])
    try:
        exists = target.exists()
    except OSError:
        exists = False
    return {
        "from": f["path"],
        "to": str(target),
        "already_there": target == current,
        "would_overwrite": exists and target != current,
    }


@router.get("/review")
def review(
    scope: str = Query("needs_review", pattern="^(needs_review|all)$"),
    include_medium: bool = False,
    destination_root: str | None = None,
):
    files = _last_scan["files"]
    if not files:
        return {
            "items": [],
            "message": "No files have been scanned yet. Scan a folder first.",
        }

    decisions = _current_decisions()
    items = []
    needs_review = 0

    for f in files:
        decision = decisions.get(f["id"])
        flags = _flags(f, include_medium)
        pending = bool(flags) and decision is None
        needs_review += 1 if pending else 0

        if scope == "needs_review" and not pending:
            continue

        suggested = _suggested_category(f)
        rejected = decision is not None and decision["action"] == "reject"
        items.append({
            "id": f["id"],
            "name": f["name"],
            "path": f["path"],
            "current_category": f["category"],
            "category_level": f["category_level"],
            "confidence": f["category_confidence"],
            "reason": f["category_reason"],
            "flags": flags,
            "candidates": f["category_candidates"],
            "suggested_category": suggested,
            "proposed_move": None if rejected else _proposed_move(f, suggested, destination_root),
            "decision": decision,
        })

    values = list(decisions.values())
    return {
        "scope": scope,
        "total_files": len(files),
        "needs_review": needs_review,
        "approved": sum(1 for d in values if d["action"] == "approve"),
        "modified": sum(1 for d in values if d["action"] == "modify"),
        "rejected": sum(1 for d in values if d["action"] == "reject"),
        "items": items,
        "message": None if items else "Nothing needs your review right now.",
        "note": "These are suggestions only. Nothing has been moved or changed on disk.",
    }


@router.post("/review/{file_id}/decision")
def decide(file_id: int, body: Decision):
    f = _find_file(file_id)
    if f is None:
        raise HTTPException(status_code=404, detail="No scanned file with that id.")

    decisions = _current_decisions()
    action = body.action.strip().lower()

    if action == "undo":
        decisions.pop(file_id, None)  # clears the decision only; a changed category stays
        return {"id": file_id, "name": f["name"], "decision": None}

    if action in ("approve", "reject"):
        if action == "approve" and f["category"] in (None, "Uncategorized"):
            raise HTTPException(
                status_code=400,
                detail="This file has no category yet. Use 'modify' to choose one.",
            )
        category = f["category"]
    elif action == "modify":
        category = (body.category or "").strip()
        if not category or len(category) > 50:
            raise HTTPException(
                status_code=400, detail="Category must be 1 to 50 characters."
            )
        f["category"] = category
        f["category_source"] = "user"
        f["category_level"] = "Set by you"
        f["category_reason"] = "Category chosen by you."
    else:
        raise HTTPException(
            status_code=400,
            detail="Action must be approve, reject, modify, or undo.",
        )

    decisions[file_id] = {
        "action": action,
        "category": category,
        "decided_at": datetime.now().isoformat(),
    }
    return {"id": file_id, "name": f["name"], "decision": decisions[file_id]}
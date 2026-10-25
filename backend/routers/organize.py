import os
import re
import shutil
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from routers.review import _current_decisions
from routers.scan import _last_scan

router = APIRouter()

_ILLEGAL = re.compile(r'[<>:"/\\|?*]')  # characters Windows folder names can't contain

# Memory only: these reset when the server restarts.
_plans = {}     # the latest plan, waiting for confirmation
_history = []   # completed move batches, newest last


class PlanRequest(BaseModel):
    destination_root: str
    file_ids: list[int] | None = None   # optional: only plan these files
    include_undecided: bool = False     # also include categorized files you haven't reviewed


class ExecuteRequest(BaseModel):
    plan_id: str
    confirm: bool = False
    move_count: int = 0   # must equal the number of moves in the plan


class UndoRequest(BaseModel):
    batch_id: str
    confirm: bool = False
    move_count: int = 0   # must equal the number of moves still to undo


def _folder_name(category: str) -> str:
    return _ILLEGAL.sub("", category).strip(" .") or "Uncategorized"


def _norm(path) -> str:
    return os.path.normcase(os.path.abspath(str(path)))


def _protected_reason(root: Path):
    try:
        resolved = root.resolve()
    except OSError:
        return "That destination path can't be used."
    if resolved.parent == resolved:
        return "Choose a folder, not a whole drive."
    for var in ("SystemRoot", "ProgramFiles", "ProgramFiles(x86)", "ProgramData"):
        value = os.environ.get(var)
        if not value:
            continue
        blocked = Path(value).resolve()
        if resolved == blocked or blocked in resolved.parents:
            return "Choose a folder outside Windows and Program Files."
    return None


def _move_one(source: Path, target: Path):
    """Moves one file. Never overwrites. Raises an error if anything looks wrong."""
    if not source.exists():
        raise FileNotFoundError("The file is no longer at its original location.")
    if target.exists():
        raise FileExistsError("A file with this name already exists at the destination.")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source), str(target))
    if not target.exists() or source.exists():
        raise OSError("The move could not be verified.")


def _update_record(file_id: int, new_path: Path):
    for f in _last_scan["files"]:
        if f["id"] == file_id:
            f["path"] = str(new_path)
            f["folder"] = str(new_path.parent)
            return


@router.post("/organize/plan")
def make_plan(request: PlanRequest):
    files = _last_scan["files"]
    if not files:
        raise HTTPException(
            status_code=400, detail="No files have been scanned yet. Scan a folder first."
        )

    raw_root = request.destination_root.strip()
    root = Path(raw_root)
    if not raw_root or not root.is_absolute():
        raise HTTPException(
            status_code=400,
            detail="Give the full path of the destination folder, like C:/Users/you/Desktop/Organized.",
        )
    problem = _protected_reason(root)
    if problem:
        raise HTTPException(status_code=400, detail=problem)

    decisions = _current_decisions()
    wanted = set(request.file_ids) if request.file_ids is not None else None

    operations, skipped = [], []
    taken = set()
    not_included = {"rejected": 0, "not_reviewed": 0, "no_category": 0}

    for f in files:
        if wanted is not None and f["id"] not in wanted:
            continue

        decision = decisions.get(f["id"])
        action = decision["action"] if decision else None
        category = f["category"]

        if action == "reject":
            not_included["rejected"] += 1
            continue
        if category in (None, "Uncategorized"):
            not_included["no_category"] += 1
            continue
        if action is None and not request.include_undecided:
            not_included["not_reviewed"] += 1
            continue

        source = Path(f["path"])
        target = root / _folder_name(category) / f["name"]
        item = {
            "file_id": f["id"],
            "name": f["name"],
            "category": category,
            "from": str(source),
            "to": str(target),
        }

        if not source.exists():
            reason = "The file is no longer at its original location."
        elif _norm(source) == _norm(target):
            reason = "Already in the right folder."
        elif target.exists():
            reason = "A file with this name already exists there. Nothing will be overwritten."
        elif _norm(target) in taken:
            reason = "Another file in this plan has the same name and destination."
        else:
            reason = None

        if reason:
            skipped.append({**item, "reason": reason})
        else:
            taken.add(_norm(target))
            operations.append(item)

    plan_id = str(uuid.uuid4())
    _plans.clear()  # only the latest plan can be run
    _plans[plan_id] = {
        "plan_id": plan_id,
        "scan_id": _last_scan["scan_id"],
        "created_at": datetime.now().isoformat(),
        "destination_root": str(root),
        "operations": operations,
    }

    count = len(operations)
    return {
        "plan_id": plan_id,
        "destination_root": str(root),
        "move_count": count,
        "moves": operations,
        "skipped_count": len(skipped),
        "skipped": skipped,
        "not_included": not_included,
        "next_step": (
            f"To carry this out, call /organize/execute with this plan_id, "
            f'"confirm": true and "move_count": {count}.'
            if count else "There is nothing to move."
        ),
        "note": "This is only a plan. Nothing has been moved or created yet.",
    }


@router.post("/organize/execute")
def execute_plan(request: ExecuteRequest):
    plan = _plans.get(request.plan_id)
    if plan is None:
        raise HTTPException(
            status_code=404,
            detail="No such plan. Create one with /organize/plan (only the latest plan can be run).",
        )
    if plan["scan_id"] != _last_scan["scan_id"]:
        _plans.clear()
        raise HTTPException(
            status_code=409,
            detail="The scan changed since this plan was made. Create a new plan.",
        )

    operations = plan["operations"]
    if not operations:
        raise HTTPException(status_code=400, detail="This plan has nothing to move.")
    if not request.confirm:
        raise HTTPException(
            status_code=400,
            detail="Not confirmed, so nothing was moved. Send confirm: true to carry out the plan.",
        )
    if request.move_count != len(operations):
        raise HTTPException(
            status_code=400,
            detail=f"The confirmation doesn't match. This plan has {len(operations)} moves. Nothing was moved.",
        )

    _plans.pop(request.plan_id, None)  # a plan can only be run once

    results, moved_log = [], []
    for op in operations:
        try:
            _move_one(Path(op["from"]), Path(op["to"]))
        except Exception as e:
            results.append({**op, "status": "failed", "message": str(e)[:150]})
            continue
        _update_record(op["file_id"], Path(op["to"]))
        results.append({**op, "status": "moved", "message": None})
        moved_log.append({
            "file_id": op["file_id"],
            "name": op["name"],
            "from": op["from"],
            "to": op["to"],
            "undone": False,
        })

    batch_id = str(uuid.uuid4())
    if moved_log:
        _history.append({
            "batch_id": batch_id,
            "executed_at": datetime.now().isoformat(),
            "destination_root": plan["destination_root"],
            "moves": moved_log,
        })

    return {
        "batch_id": batch_id if moved_log else None,
        "moved": len(moved_log),
        "failed": len(results) - len(moved_log),
        "results": results,
        "note": (
            "Undo with /organize/undo using this batch_id. Undo only works until the "
            "server restarts, so don't edit backend files before you finish checking. "
            "The old and new paths above are your record."
        ),
    }


@router.get("/organize/history")
def history():
    batches = []
    for b in reversed(_history):
        batches.append({
            "batch_id": b["batch_id"],
            "executed_at": b["executed_at"],
            "destination_root": b["destination_root"],
            "moves_total": len(b["moves"]),
            "moves_undone": sum(1 for m in b["moves"] if m["undone"]),
            "moves": b["moves"],
        })
    return {
        "batches": batches,
        "message": None if batches else "No files have been moved yet.",
    }


@router.post("/organize/undo")
def undo_batch(request: UndoRequest):
    batch = next((b for b in _history if b["batch_id"] == request.batch_id), None)
    if batch is None:
        raise HTTPException(status_code=404, detail="No batch with that id.")

    pending = [m for m in batch["moves"] if not m["undone"]]
    if not pending:
        raise HTTPException(status_code=400, detail="Everything in this batch is already undone.")
    if not request.confirm:
        raise HTTPException(
            status_code=400,
            detail="Not confirmed, so nothing was moved. Send confirm: true to undo.",
        )
    if request.move_count != len(pending):
        raise HTTPException(
            status_code=400,
            detail=f"The confirmation doesn't match. {len(pending)} files would be moved back. Nothing was moved.",
        )

    results = []
    for m in pending:
        try:
            _move_one(Path(m["to"]), Path(m["from"]))
        except Exception as e:
            results.append({"name": m["name"], "status": "failed", "message": str(e)[:150]})
            continue
        m["undone"] = True
        _update_record(m["file_id"], Path(m["from"]))
        results.append({"name": m["name"], "status": "moved back", "message": None})

    return {
        "batch_id": batch["batch_id"],
        "moved_back": sum(1 for r in results if r["status"] == "moved back"),
        "failed": sum(1 for r in results if r["status"] == "failed"),
        "results": results,
        "note": "Folders that were created for the move are left in place, even if empty.",
    }
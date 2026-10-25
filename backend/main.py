import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from routers import duplicates, organize, review, scan, search
from services import state
from services.embeddings import index

# Requests that change saved data. After one succeeds, everything is saved to disk.
SAVE_AFTER = ("/scan", "/files", "/review", "/organize/execute", "/organize/undo")
# Requests that need the search index, so they wait while it is rebuilt after startup.
NEEDS_INDEX = ("/scan", "/search", "/ask")


def _rebuild_index():
    try:
        index.build(scan._last_scan["files"], scan._texts)
    except Exception as e:
        print(f"[File Genie] Could not rebuild the search index: {e}")
    finally:
        state.index_status["state"] = "ready"


@asynccontextmanager
async def lifespan(app: FastAPI):
    restored = state.load()
    if restored:
        state.index_status["state"] = "building"
        threading.Thread(target=_rebuild_index, daemon=True).start()
        print(f"[File Genie] Restored {restored} files from the last session.")
    yield


app = FastAPI(title="File Genie API", lifespan=lifespan)


@app.middleware("http")
async def save_and_guard(request, call_next):
    path = request.url.path
    if (
        state.index_status["state"] == "building"
        and request.method == "POST"
        and path in NEEDS_INDEX
    ):
        return JSONResponse(
            status_code=503,
            content={
                "detail": "File Genie is rebuilding its search index after startup. "
                          "Try again in a few seconds."
            },
        )

    response = await call_next(request)

    if (
        request.method in ("POST", "PUT")
        and path.startswith(SAVE_AFTER)
        and response.status_code < 400
    ):
        await run_in_threadpool(state.persist)
    return response


# The Electron window loads local files, so the browser sends requests
# with a "null" origin. The backend only listens on 127.0.0.1 (your own
# computer), so this stays local. We'll tighten this in Phase 6.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(scan.router)
app.include_router(search.router)
app.include_router(duplicates.router)
app.include_router(review.router)
app.include_router(organize.router)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/status")
def status():
    return {
        "files": len(scan._last_scan["files"]),
        "folder": scan._last_scan["folder"],
        "scanned_at": scan._last_scan["scanned_at"],
        "search_index": state.index_status["state"],
        "search_method": index.method,
        "saved_data": state.saved_info(),
    }


@app.delete("/data")
def clear_saved_data(confirm: bool = False):
    if not confirm:
        raise HTTPException(
            status_code=400,
            detail="Not confirmed, so nothing was deleted. "
                   "Send confirm=true to clear File Genie's saved data.",
        )
    state.clear_all()
    return {
        "cleared": True,
        "note": "File Genie's saved scan data and history were deleted. "
                "Your own files were not touched.",
    }
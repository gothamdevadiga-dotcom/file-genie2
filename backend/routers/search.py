import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from routers.scan import _last_scan
from services.embeddings import index, tokenize

router = APIRouter()


class SearchRequest(BaseModel):
    query: str
    mode: str = "meaning"          # "meaning" or "filename"
    category: str | None = None    # optional: only search inside one category
    limit: int = Field(default=10, ge=1, le=50)


def _snippet(chunk: str, query: str, length: int = 350) -> str:
    # Show the part of the chunk around the first word that matches the query.
    terms = [t for t in re.findall(r"[a-z0-9]+", query.lower()) if len(t) > 2]
    lowered = chunk.lower()
    positions = [lowered.find(t) for t in terms if lowered.find(t) != -1]
    start = max(0, min(positions) - 120) if positions else 0
    piece = chunk[start:start + length].strip()
    return ("..." if start > 0 else "") + piece + ("..." if start + length < len(chunk) else "")


def _relevance(score: float) -> str:
    return index.relevance(score)


def _file_summary(f: dict) -> dict:
    return {
        "id": f["id"],
        "name": f["name"],
        "type": f["type"],
        "path": f["path"],
        "size_bytes": f["size_bytes"],
        "category": f["category"],
    }


@router.post("/search")
def search(request: SearchRequest):
    query = request.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Type something to search for.")
    if request.mode not in ("meaning", "filename"):
        raise HTTPException(status_code=400, detail='Mode must be "meaning" or "filename".')

    files = _last_scan["files"]
    if not files:
        return {
            "query": query,
            "mode": request.mode,
            "count": 0,
            "results": [],
            "message": "No files have been scanned yet. Scan a folder first.",
        }

    allowed = None
    if request.category:
        allowed = {f["id"] for f in files if f["category"] == request.category}

    # Plain filename search: every word typed must appear in the file name.
    if request.mode == "filename":
        words = query.lower().split()
        matches = [
            f for f in files
            if all(w in f["name"].lower() for w in words)
            and (allowed is None or f["id"] in allowed)
        ]
        matches.sort(key=lambda f: f["name"].lower())
        results = [{**_file_summary(f), "snippet": None, "score": None, "relevance": None}
                   for f in matches[:request.limit]]
        return {
            "query": query,
            "mode": "filename",
            "method": "File name match",
            "count": len(results),
            "results": results,
            "message": None if results else "No file names match that search.",
        }

    # Content search.
    by_id = {f["id"]: f for f in files}
    hits = index.search(query, request.limit, allowed)
    results = []
    for hit in hits:
        f = by_id[hit["file_id"]]
        results.append({
            **_file_summary(f),
            "snippet": _snippet(hit["chunk_text"], query),
            "score": hit["score"],
            "relevance": _relevance(hit["score"]),
        })

    return {
        "query": query,
        "mode": "meaning",
        "method": index.method,
        "count": len(results),
        "results": results,
        "message": None if results else "No close matches found in your files.",
    }
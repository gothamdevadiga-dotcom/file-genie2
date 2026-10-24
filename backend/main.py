from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import scan, search

app = FastAPI(title="File Genie API")

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


@app.get("/health")
def health():
    return {"status": "ok"}
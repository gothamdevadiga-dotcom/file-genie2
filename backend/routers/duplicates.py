import hashlib
from collections import defaultdict

from fastapi import APIRouter, Query
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from routers.scan import _last_scan, _texts

router = APIRouter()

HASH_BLOCK = 1024 * 1024  # read files in 1 MB pieces so big files don't fill memory


def _hash_file(path: str):
    # A fingerprint of the file's exact bytes. Identical files give identical hashes.
    digest = hashlib.sha256()
    try:
        with open(path, "rb") as f:
            while True:
                block = f.read(HASH_BLOCK)
                if not block:
                    break
                digest.update(block)
    except OSError:
        return None  # file moved, deleted, or locked since the scan
    return digest.hexdigest()


def _file_info(f: dict) -> dict:
    return {
        "id": f["id"],
        "name": f["name"],
        "path": f["path"],
        "folder": f["folder"],
        "size_bytes": f["size_bytes"],
        "modified": f["modified"],
        "category": f["category"],
    }


def _exact_groups(files: list) -> list:
    # Only files with the same size can be identical, so hash only those.
    by_size = defaultdict(list)
    for f in files:
        if f["size_bytes"] > 0:
            by_size[f["size_bytes"]].append(f)

    groups = []
    for same_size in by_size.values():
        if len(same_size) < 2:
            continue
        by_hash = defaultdict(list)
        for f in same_size:
            digest = _hash_file(f["path"])
            if digest:
                by_hash[digest].append(f)
        for members in by_hash.values():
            if len(members) > 1:
                groups.append(members)
    return groups


def _similar_groups(files: list, exact_groups: list, threshold: float) -> list:
    # Exact copies are already reported, so compare only one copy from each.
    skip = {f["id"] for group in exact_groups for f in group[1:]}
    candidates = [f for f in files if _texts.get(f["id"]) and f["id"] not in skip]
    if len(candidates) < 2:
        return []

    try:
        vectorizer = TfidfVectorizer(
            stop_words="english", sublinear_tf=True, max_features=50000
        )
        matrix = vectorizer.fit_transform([_texts[f["id"]] for f in candidates])
    except ValueError:
        return []  # no usable words

    sims = cosine_similarity(matrix)
    n = len(candidates)

    # Join files that are similar enough into groups.
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(n):
        for j in range(i + 1, n):
            if sims[i][j] >= threshold:
                parent[find(i)] = find(j)

    clusters = defaultdict(list)
    for i in range(n):
        clusters[find(i)].append(i)

    groups = []
    for members in clusters.values():
        if len(members) < 2:
            continue
        scores = [
            float(sims[a][b])
            for idx, a in enumerate(members)
            for b in members[idx + 1:]
        ]
        groups.append({
            "files": [candidates[i] for i in members],
            "lowest": min(scores),
            "highest": max(scores),
        })
    return groups


@router.get("/duplicates")
def find_duplicates(
    similarity_threshold: float = Query(0.65, ge=0.5, le=1.0),
):
    files = _last_scan["files"]
    if not files:
        return {
            "exact_groups": [],
            "similar_groups": [],
            "message": "No files have been scanned yet. Scan a folder first.",
        }

    exact = _exact_groups(files)
    similar = _similar_groups(files, exact, similarity_threshold)

    exact_out = []
    for number, members in enumerate(exact, 1):
        members = sorted(members, key=lambda f: f["path"].lower())
        exact_out.append({
            "group": number,
            "label": "Exact duplicate",
            "file_count": len(members),
            "extra_space_bytes": members[0]["size_bytes"] * (len(members) - 1),
            "files": [_file_info(f) for f in members],
        })

    similar_out = []
    for number, group in enumerate(similar, 1):
        members = sorted(group["files"], key=lambda f: f["path"].lower())
        similar_out.append({
            "group": number,
            "label": "Similar content",
            "file_count": len(members),
            "similarity_lowest": round(group["lowest"], 3),
            "similarity_highest": round(group["highest"], 3),
            "files": [_file_info(f) for f in members],
        })

    return {
        "scanned_files": len(files),
        "similarity_threshold": similarity_threshold,
        "method": "Exact: SHA-256 file hash. Similar: TF-IDF text comparison.",
        "exact_count": len(exact_out),
        "similar_count": len(similar_out),
        "exact_groups": exact_out,
        "similar_groups": similar_out,
        "message": None if (exact_out or similar_out) else "No duplicates found.",
        "note": "This only reports matches. Nothing is deleted or moved.",
    }
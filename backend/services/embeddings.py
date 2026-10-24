import re

from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, TfidfVectorizer
from sklearn.metrics.pairwise import linear_kernel

CHUNK_SIZE = 900        # characters per chunk
CHUNK_OVERLAP = 150     # overlap so sentences aren't cut off between chunks
MAX_CHUNKS_PER_FILE = 400
MIN_SCORE = 0.05        # below this, a chunk is not considered a match

_WORD = re.compile(r"[a-z0-9]+")


def _stem(word: str) -> str:
    # Very light word-ending trimming so "loops" matches "loop".
    if len(word) > 5 and word.endswith("ing"):
        return word[:-3]
    if len(word) > 4 and word.endswith("ed"):
        return word[:-2]
    if len(word) > 4 and word.endswith("es"):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def tokenize(text: str) -> list:
    words = _WORD.findall(text.lower())
    kept = [w for w in words
            if (len(w) > 1 or w in ("c", "r")) and w not in ENGLISH_STOP_WORDS]
    return [_stem(w) for w in kept]


def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list:
    text = re.sub(r"\s+", " ", text).strip()
    chunks, start = [], 0
    while start < len(text):
        end = min(start + size, len(text))
        if end < len(text):
            # Prefer to cut at a space instead of in the middle of a word.
            space = text.rfind(" ", start + size // 2, end)
            if space != -1:
                end = space
        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return chunks


class SearchIndex:
    """In-memory search index over the chunks of the scanned files.
    Method: TF-IDF keyword weighting (not true meaning-based yet)."""

    method = "TF-IDF keyword ranking"

    def __init__(self):
        self.clear()

    def clear(self):
        self._vectorizer = None
        self._matrix = None
        self._chunks = []

    def build(self, files: list, texts: dict):
        self.clear()
        chunks = []
        for f in files:
            text = texts.get(f["id"], "")
            if not text:
                continue
            for number, piece in enumerate(chunk_text(text)[:MAX_CHUNKS_PER_FILE], 1):
                chunks.append({"file_id": f["id"], "chunk_no": number, "text": piece})

        if not chunks:
            return

        vectorizer = TfidfVectorizer(
            tokenizer=tokenize,
            lowercase=False,
            token_pattern=None,
            ngram_range=(1, 2),
            sublinear_tf=True,
        )
        try:
            matrix = vectorizer.fit_transform([c["text"] for c in chunks])
        except ValueError:
            return  # no usable words in any file

        self._chunks = chunks
        self._vectorizer = vectorizer
        self._matrix = matrix

    @property
    def chunk_count(self) -> int:
        return len(self._chunks)

    def search(self, query: str, limit: int = 10, allowed_ids=None) -> list:
        if self._vectorizer is None or not query.strip():
            return []

        query_vector = self._vectorizer.transform([query])
        if query_vector.nnz == 0:
            return []  # none of the query's words appear in any file

        scores = linear_kernel(query_vector, self._matrix).ravel()

        # Keep only the best-matching chunk per file.
        best = {}
        for i, score in enumerate(scores):
            if score < MIN_SCORE:
                continue
            file_id = self._chunks[i]["file_id"]
            if allowed_ids is not None and file_id not in allowed_ids:
                continue
            if file_id not in best or score > best[file_id][0]:
                best[file_id] = (float(score), i)

        ranked = sorted(best.items(), key=lambda item: item[1][0], reverse=True)[:limit]
        return [
            {
                "file_id": file_id,
                "score": round(score, 3),
                "chunk_no": self._chunks[i]["chunk_no"],
                "chunk_text": self._chunks[i]["text"],
            }
            for file_id, (score, i) in ranked
        ]


# One shared index for the whole app.
index = SearchIndex()
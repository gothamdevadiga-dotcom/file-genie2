import re

from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, TfidfVectorizer
from sklearn.metrics.pairwise import linear_kernel

CHUNK_SIZE = 900        # characters per chunk
CHUNK_OVERLAP = 150     # overlap so sentences aren't cut off between chunks
MAX_CHUNKS_PER_FILE = 400

# The AI model that turns text into "meaning numbers".
# About 90 MB, downloaded once on first use, then runs fully offline.
MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"

SEMANTIC_MIN_SCORE = 0.25   # cutoff when the AI model is used
KEYWORD_MIN_SCORE = 0.05    # cutoff for the backup keyword method

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


# The AI model is loaded once, the first time it is needed.
_model = None
_model_error = None


def _get_model():
    global _model, _model_error
    if _model is not None:
        return _model
    if _model_error is not None:
        return None
    try:
        from sentence_transformers import SentenceTransformer

        _model = SentenceTransformer(MODEL_NAME)
    except Exception as e:
        _model_error = str(e)[:200]
        print(f"[File Genie] AI model unavailable, using keyword search: {_model_error}")
        return None
    return _model


class SearchIndex:
    """In-memory search index over the chunks of the scanned files.
    Uses the AI embedding model when available, and falls back to keyword
    ranking (TF-IDF) if the model cannot be loaded."""

    def __init__(self):
        self.clear()

    def clear(self):
        self._chunks = []
        self._embeddings = None
        self._vectorizer = None
        self._matrix = None
        self._mode = None  # "semantic" or "keyword"

    @property
    def method(self) -> str:
        if self._mode == "semantic":
            return "Semantic search (AI embeddings, runs locally)"
        if self._mode == "keyword":
            return "TF-IDF keyword ranking (AI model not available)"
        return "No index built yet"

    @property
    def min_score(self) -> float:
        return SEMANTIC_MIN_SCORE if self._mode == "semantic" else KEYWORD_MIN_SCORE

    def relevance(self, score: float) -> str:
        # Rough labels only. They are an estimate, not a probability.
        high, medium = (0.50, 0.35) if self._mode == "semantic" else (0.20, 0.10)
        if score >= high:
            return "High"
        if score >= medium:
            return "Medium"
        return "Low"

    @property
    def chunk_count(self) -> int:
        return len(self._chunks)

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

        self._chunks = chunks
        pieces = [c["text"] for c in chunks]

        model = _get_model()
        if model is not None:
            try:
                self._embeddings = model.encode(
                    pieces,
                    batch_size=32,
                    normalize_embeddings=True,
                    show_progress_bar=False,
                )
                self._mode = "semantic"
                return
            except Exception as e:
                print(f"[File Genie] Embedding failed, using keyword search: {e}")
                self._embeddings = None

        self._build_keyword(pieces)

    def _build_keyword(self, pieces: list):
        vectorizer = TfidfVectorizer(
            tokenizer=tokenize,
            lowercase=False,
            token_pattern=None,
            ngram_range=(1, 2),
            sublinear_tf=True,
        )
        try:
            self._matrix = vectorizer.fit_transform(pieces)
        except ValueError:
            self.clear()  # no usable words in any file
            return
        self._vectorizer = vectorizer
        self._mode = "keyword"

    def _scores(self, query: str):
        if self._mode == "semantic":
            model = _get_model()
            query_vector = model.encode(
                [query], normalize_embeddings=True, show_progress_bar=False
            )
            return self._embeddings @ query_vector[0]

        query_vector = self._vectorizer.transform([query])
        if query_vector.nnz == 0:
            return None  # none of the query's words appear in any file
        return linear_kernel(query_vector, self._matrix).ravel()

    def search(self, query: str, limit: int = 10, allowed_ids=None) -> list:
        if self._mode is None or not query.strip():
            return []

        scores = self._scores(query)
        if scores is None:
            return []

        # Keep only the best-matching chunk per file.
        best = {}
        for i, score in enumerate(scores):
            if score < self.min_score:
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
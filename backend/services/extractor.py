import json
from pathlib import Path

# Stop reading after this many characters per file, so huge files
# don't slow down or freeze the app.
MAX_CHARS = 200_000


def _read_plain(path: Path) -> str:
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read(MAX_CHARS)


def _read_pdf(path: Path) -> str:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    if reader.is_encrypted:
        # Try an empty password; many "locked" PDFs only restrict editing.
        if reader.decrypt("") == 0:
            raise ValueError("PDF is password protected")

    parts, total = [], 0
    for page in reader.pages:
        text = page.extract_text() or ""
        parts.append(text)
        total += len(text)
        if total >= MAX_CHARS:
            break
    return "\n".join(parts)[:MAX_CHARS]


def _read_docx(path: Path) -> str:
    from docx import Document

    doc = Document(str(path))
    parts = [p.text for p in doc.paragraphs]
    for table in doc.tables:
        for row in table.rows:
            parts.append(" | ".join(cell.text for cell in row.cells))
    return "\n".join(parts)[:MAX_CHARS]


def _read_pptx(path: Path) -> str:
    from pptx import Presentation

    prs = Presentation(str(path))
    parts = []
    for slide in prs.slides:
        for shape in slide.shapes:
            if shape.has_text_frame:
                parts.append(shape.text_frame.text)
    return "\n".join(parts)[:MAX_CHARS]


def _read_notebook(path: Path) -> str:
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        nb = json.load(f)
    parts = []
    for cell in nb.get("cells", []):
        source = cell.get("source", [])
        parts.append("".join(source) if isinstance(source, list) else str(source))
    return "\n".join(parts)[:MAX_CHARS]


_READERS = {
    ".pdf": _read_pdf,
    ".docx": _read_docx,
    ".pptx": _read_pptx,
    ".ipynb": _read_notebook,
}


def extract_text(path: Path, ext: str) -> dict:
    """Read a file's text. Never crashes: failures come back as a status."""
    reader = _READERS.get(ext, _read_plain)
    try:
        text = reader(path).strip()
    except Exception as e:
        return {"text": "", "status": "error", "error": str(e)[:200]}

    if not text:
        # e.g. a scanned PDF with only images (needs OCR, which we don't do yet)
        return {"text": "", "status": "empty", "error": None}
    return {"text": text, "status": "ok", "error": None}
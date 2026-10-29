# File Genie

An AI-assisted Windows file organizer for students. Point it at a folder of notes, slides, PDFs and code, and it reads them, sorts them into categories, finds duplicates, lets you search and ask questions about them, and moves files into tidy folders only after you approve a plan.

Your files stay on your PC. File Genie never deletes or overwrites anything, and every move can be undone.

## Features

- **Scan a folder** with a native Windows folder picker. Reads PDF, Word, PowerPoint, text, Markdown, CSV, notebooks and common code files.
- **My Files**: sortable, filterable table with a details panel, text preview, **Open file** and **Show in folder**.
- **Smart Categories**: files grouped by simple keyword rules (not AI). You can correct any category.
- **Duplicates**: exact copies (SHA-256) and files with very similar text. Report only, nothing is deleted.
- **AI Search**: search by file name, by meaning, or both at once. Meaning search runs locally.
- **Ask Files**: finds the best-matching passages and can ask Claude to write a cited answer. Off by default. When on, only the matching passages are sent, and the app shows which files they came from.
- **Review Suggestions**: approve, reject or change the category of each file that needs a decision.
- **Move and undo**: preview a full plan, confirm it, then undo from **Activity**. Files are never overwritten or deleted.
- **Settings**: turn Claude answers on or off by default and clear File Genie's saved data.

## Privacy

- Scanning, categorizing, searching and duplicate detection happen on your computer.
- Ask Files only contacts Anthropic if you turn on "Let Claude write an answer". Only the retrieved passages are sent, never whole files, and the screen lists the files they came from.
- Your API key lives only in `.env`, which is git-ignored.
- "Clear saved data" deletes File Genie's own saved scan data. It never touches your files.

## Tech stack

- **Frontend:** Electron, plain HTML, CSS and JavaScript (no framework, works offline)
- **Backend:** Python, FastAPI
- **Search:** sentence-transformers (all-MiniLM-L6-v2) running locally, with a TF-IDF fallback
- **AI answers (optional):** Anthropic API

## Setup (Windows)

You need Python 3.10 or newer, Node.js, and Git.

```
git clone https://github.com/gothamdevadiga-dotcom/file-genie2.git
cd file-genie2
```

**1. Backend**

```
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

**2. Optional: AI answers**

Copy `.env.example` to `.env` in the project root and add your key:

```
ANTHROPIC_API_KEY=your-key-here
```

Without a key, everything works except Claude-written answers. Never commit `.env`.

**3. Run the app** (from the project root)

```
npm install
npm start
```

File Genie starts its own backend, so there is nothing else to launch. It looks for Python in `backend\venv`, then `venv` or `.venv` in the project folder. If your Python is somewhere else, add this line to your `.env` file:

```
FG_PYTHON=C:\path\to\python.exe
```

You can also double-click `start-file-genie.bat`. The first start can take a little while because the search model loads. If a backend is already running on port 8000, File Genie uses it and leaves it running when you close the app.

**Developing the backend on its own** (optional): run `uvicorn main:app --reload` from the `backend` folder. The API docs are at http://localhost:8000/docs.

## Project structure

```
backend/
  main.py              app setup, saved-state restore, /status, DELETE /data
  routers/             scan, search (+ ask), duplicates, review, organize
  services/            extractor, categorizer, embeddings, rag, state
electron/
  main.js              window, starts the backend, folder picker, open file / show in folder
  preload.js           the small, safe bridge between the page and Electron
frontend/
  index.html
  css/styles.css
  js/app.js            all screens
docs/
```

## Known limitations

- Categories come from keyword rules, so they can be wrong. Use Review Suggestions to correct them.
- Scanned PDFs (pictures of pages) have no readable text yet. OCR is not added.
- If a Claude request fails partway, the backend cannot confirm whether passages reached the service, and the screen says so.
- File Genie needs Python and the backend packages installed on the PC. There is no one-file installer yet, because bundling the search model and Python together is large.
- The backend allows requests from any local origin (CORS). It is meant to run on your own machine only.
- Tested on Windows only. Packaging into an installer is not done.
- "Open file" only opens documents. Code files can be shown in their folder but are not opened, because Windows may run scripts instead of opening them.
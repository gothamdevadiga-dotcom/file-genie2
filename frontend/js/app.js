"use strict";

// File Genie - app shell: sidebar, page switching, backend status.
// Pages other than the Dashboard are honest placeholders until we build them.

const API = "http://127.0.0.1:8000";

// ---------- Icons (inline SVG, so the app works offline) ----------

const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  files: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  categories: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  ask: '<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  duplicates: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  review: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
  activity: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.2 8 8 9 4.8-1 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
};

function svg(name) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
         'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + "</svg>";
}

// ---------- Pages ----------

const PAGES = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard", render: renderDashboard, after: loadLastScan },
  { id: "files", label: "My Files", icon: "files", render: renderFiles, after: openFiles },
  { id: "categories", label: "Smart Categories", icon: "categories",
    empty: "No categories yet", text: "Categories appear after your first scan. You can correct any category you disagree with." },
  { id: "search", label: "AI Search", icon: "search",
    empty: "Nothing to search yet", text: "Once a folder is scanned, you can find files by name or by what they are about." },
  { id: "ask", label: "Ask Files", icon: "ask",
    empty: "Nothing to ask yet", text: "After a scan, ask a question and get an answer that names the files it came from." },
  { id: "duplicates", label: "Duplicates", icon: "duplicates",
    empty: "No duplicates found", text: "Run a scan to look for exact copies and very similar files. Nothing is ever deleted for you." },
  { id: "review", label: "Review Suggestions", icon: "review",
    empty: "No suggestions to review", text: "After a scan, you approve or reject each suggested move before any file changes." },
  { id: "activity", label: "Activity", icon: "activity",
    empty: "No activity yet", text: "Moves you approve will be listed here, and you can undo them." },
  { id: "settings", label: "Settings", icon: "settings",
    empty: "Settings", text: "Options for AI answers and clearing File Genie's saved data will go here." },
  { id: "scan", label: "Scan a folder", icon: "files", hidden: true,
    render: renderScan, after: bindScan },
];

function renderDashboard() {
  return `
    <div class="page">
      <section class="card welcome">
        <h2>Welcome to File Genie</h2>
        <p>Scan a folder and File Genie reads your files, sorts them into categories, and helps you find things. Nothing moves until you approve it.</p>
        <button class="btn btn-primary" type="button" data-go="scan">Scan a folder</button>
      </section>

      <div id="lastScan" hidden></div>

      <section class="steps" aria-label="How it works">
        <div class="step"><span class="step-num">1</span><h3>Choose a folder</h3><p>Pick Downloads, Desktop or a course folder.</p></div>
        <div class="step"><span class="step-num">2</span><h3>Let it read</h3><p>Text is pulled out of your PDFs, documents and notes.</p></div>
        <div class="step"><span class="step-num">3</span><h3>Review and approve</h3><p>Check each suggested move. You can undo any of them.</p></div>
      </section>

      <div class="note">
        ${svg("shield")}
        <span>Your files stay on this PC, and File Genie never deletes or overwrites them. If you turn on AI answers in Ask Files, only the matching passages are sent to Claude, and you can see which files were included.</span>
      </div>
    </div>`;
}

function renderPlaceholder(page) {
  return `
    <div class="page">
      <section class="card empty">
        <div class="empty-icon">${svg(page.icon)}</div>
        <h2>${page.empty}</h2>
        <p>${page.text}</p>
        ${page.id === "scan" ? "" : '<button class="btn btn-primary" type="button" data-go="scan">Scan a folder</button>'}
      </section>
    </div>`;
}

// ---------- Scan page ----------

// Kept in memory so the result is still there if you switch pages and come back.
const scan = { folder: null, phase: "idle", result: null, error: null };
// phase: "idle" | "scanning" | "done" | "error"

function esc(text) {
  return String(text)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function stat(value, label) {
  return `<div class="stat"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`;
}

function renderScan() {
  const busy = scan.phase === "scanning";
  const path = scan.folder
    ? `<span class="path">${esc(scan.folder)}</span>`
    : '<span class="path path-empty">No folder chosen</span>';

  let status = "";
  if (busy) {
    status = `
      <section class="card progress">
        <span class="spinner" aria-hidden="true"></span>
        <div>
          <h2 class="card-title">Reading files…</h2>
          <p class="card-text">This can take a minute for large folders. Your files are only read, never changed.</p>
        </div>
      </section>`;
  } else if (scan.phase === "error") {
    status = `<div class="note note-error"><span>${esc(scan.error)}</span></div>`;
  } else if (scan.phase === "done") {
    status = renderScanResult(scan.result);
  }

  return `
    <div class="page">
      <section class="card">
        <h2 class="card-title">Choose a folder to scan</h2>
        <p class="card-text">File Genie reads PDFs, Word and PowerPoint files, notes and code in the folder and its subfolders. It never changes or deletes them.</p>
        <div class="picker">
          <div class="picker-path">${path}</div>
          <button class="btn" type="button" id="pickBtn" ${busy ? "disabled" : ""}>Choose folder</button>
        </div>
        <button class="btn btn-primary" type="button" id="scanBtn" ${!scan.folder || busy ? "disabled" : ""}>Scan this folder</button>
      </section>
      ${status}
    </div>`;
}

function renderScanResult(r) {
  const unread = r.no_text_found + r.extraction_errors;
  const skipped = r.skipped_unsupported + r.skipped_unreadable;

  if (r.file_count === 0) {
    return '<div class="note"><span>No supported files were found in that folder. Try a folder with PDFs, Word files, notes or code.</span></div>';
  }

  return `
    <section class="card">
      <h2 class="card-title">Scan complete</h2>
      <p class="card-text">${esc(r.folder)}</p>
      <div class="stats">
        ${stat(r.file_count, "Files found")}
        ${stat(r.categorized, "Categorized")}
        ${stat(r.uncategorized, "Uncategorized")}
        ${stat(unread, "No readable text")}
      </div>
      ${unread ? '<p class="fine">Files with no readable text can\'t be categorized. This often happens with scanned PDFs, because text recognition (OCR) isn\'t added yet.</p>' : ""}
      ${skipped ? `<p class="fine">${r.skipped_unsupported} files were skipped because their type isn't supported${r.skipped_unreadable ? `, and ${r.skipped_unreadable} couldn't be opened` : ""}.</p>` : ""}
      <button class="btn btn-primary" type="button" data-go="files">Open My Files</button>
    </section>`;
}

function bindScan() {
  const pickBtn = document.getElementById("pickBtn");
  const scanBtn = document.getElementById("scanBtn");
  if (pickBtn) pickBtn.addEventListener("click", chooseFolder);
  if (scanBtn) scanBtn.addEventListener("click", runScan);
}

async function chooseFolder() {
  if (!window.fileGenie) {
    scan.phase = "error";
    scan.error = "The folder picker only works inside the File Genie app window.";
    go("scan");
    return;
  }
  const folder = await window.fileGenie.pickFolder();
  if (folder) {
    scan.folder = folder;
    scan.phase = "idle";
    scan.result = null;
    scan.error = null;
    go("scan");
  }
}

async function runScan() {
  if (!scan.folder) return;
  scan.phase = "scanning";
  scan.result = null;
  scan.error = null;
  go("scan");

  try {
    const res = await fetch(API + "/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder: scan.folder }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof data.detail === "string"
        ? data.detail
        : "The backend returned an error (" + res.status + ").");
    }
    scan.result = data;
    scan.phase = "done";
  } catch (err) {
    scan.phase = "error";
    scan.error = err instanceof TypeError
      ? "Couldn't reach the backend. Check that it is running, then try again."
      : err.message;
  }

  if (currentPage === "scan") go("scan");
}

// ---------- Dashboard: last scan ----------

async function loadLastScan() {
  const box = document.getElementById("lastScan");
  if (!box) return;
  try {
    const res = await fetch(API + "/status");
    if (!res.ok) return;
    const s = await res.json();
    if (!s.files) return;
    const when = s.scanned_at ? new Date(s.scanned_at).toLocaleString() : "";
    const building = s.search_index === "building"
      ? '<p class="fine">Search is still getting ready. It finishes in the background.</p>' : "";
    box.innerHTML = `
      <section class="card last-scan">
        <div>
          <h2 class="card-title">Last scan</h2>
          <p class="card-text">${s.files} files in ${esc(s.folder)}</p>
          <p class="fine">${esc(when)}</p>
          ${building}
        </div>
        <button class="btn" type="button" data-go="files">Open My Files</button>
      </section>`;
    box.hidden = false;
    box.querySelector("[data-go]").addEventListener("click", () => go("files"));
  } catch (err) {
    // The status pill already shows when the backend is offline.
  }
}

// ---------- My Files ----------

const library = {
  data: null, error: null,
  selectedId: null, preview: null, previewError: null,
  type: "all", category: "all", query: "",
  sortKey: "modified", sortDir: "desc",
};

function formatSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
}

function categoryOf(file) { return file.category || "Uncategorized"; }

function optionList(values, current, allLabel) {
  return ['<option value="all">' + allLabel + "</option>"].concat(
    values.map(v => `<option value="${esc(v)}"${v === current ? " selected" : ""}>${esc(v)}</option>`)
  ).join("");
}

function renderFiles() {
  if (library.error) {
    return `<div class="page"><div class="note note-error"><span>${esc(library.error)}</span></div></div>`;
  }
  if (!library.data) {
    return '<div class="page"><section class="card progress"><span class="spinner" aria-hidden="true"></span><p class="card-text">Loading files…</p></section></div>';
  }
  const files = library.data.files;
  if (files.length === 0) {
    return `
      <div class="page">
        <section class="card empty">
          <div class="empty-icon">${svg("files")}</div>
          <h2>No files yet</h2>
          <p>Scan a folder and your files will show up here in a table you can sort and filter.</p>
          <button class="btn btn-primary" type="button" data-go="scan">Scan a folder</button>
        </section>
      </div>`;
  }

  const types = [...new Set(files.map(f => f.type))].sort();
  const cats = [...new Set(files.map(categoryOf))].sort();
  if (library.type !== "all" && !types.includes(library.type)) library.type = "all";
  if (library.category !== "all" && !cats.includes(library.category)) library.category = "all";

  return `
    <div class="page page-wide">
      <div class="toolbar">
        <input class="input" id="fileQuery" type="search" placeholder="Filter by file name" aria-label="Filter by file name" value="${esc(library.query)}">
        <select class="input" id="fileType" aria-label="File type">${optionList(types, library.type, "All types")}</select>
        <select class="input" id="fileCategory" aria-label="Category">${optionList(cats, library.category, "All categories")}</select>
        <span class="toolbar-count" id="fileCount"></span>
      </div>
      <div class="files-layout">
        <div id="fileTable"></div>
        <aside class="detail" id="fileDetail" hidden></aside>
      </div>
    </div>`;
}

function visibleFiles() {
  const q = library.query.trim().toLowerCase();
  const rows = library.data.files.filter(f =>
    (library.type === "all" || f.type === library.type) &&
    (library.category === "all" || categoryOf(f) === library.category) &&
    (!q || f.name.toLowerCase().includes(q)));
  const dir = library.sortDir === "asc" ? 1 : -1;
  const key = library.sortKey;
  const value = f => key === "category" ? categoryOf(f).toLowerCase()
                   : key === "name" ? f.name.toLowerCase() : f[key];
  return rows.sort((a, b) => (value(a) < value(b) ? -1 : value(a) > value(b) ? 1 : 0) * dir);
}

function paintTable() {
  const table = document.getElementById("fileTable");
  if (!table || !library.data) return;
  const rows = visibleFiles();
  document.getElementById("fileCount").textContent =
    rows.length + " of " + library.data.files.length + " files";

  if (rows.length === 0) {
    table.innerHTML = '<div class="note"><span>No files match these filters.</span></div>';
    return;
  }

  const head = (key, label) => {
    const arrow = library.sortKey === key ? (library.sortDir === "asc" ? " ▲" : " ▼") : "";
    return `<th><button class="th-btn" type="button" data-sort="${key}">${label}${arrow}</button></th>`;
  };
  table.innerHTML = `
    <table class="table">
      <thead><tr>${head("name", "Name")}${head("category", "Category")}${head("size_bytes", "Size")}${head("modified", "Modified")}</tr></thead>
      <tbody>${rows.map(f => `
        <tr tabindex="0" data-id="${f.id}" class="${f.id === library.selectedId ? "selected" : ""}">
          <td><div class="file-name">${esc(f.name)}</div><div class="file-sub">${esc(f.type)}</div></td>
          <td>${esc(categoryOf(f))}</td>
          <td>${formatSize(f.size_bytes)}</td>
          <td>${formatDate(f.modified)}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;

  table.querySelectorAll("[data-sort]").forEach(btn => btn.addEventListener("click", () => {
    const key = btn.dataset.sort;
    if (library.sortKey === key) {
      library.sortDir = library.sortDir === "asc" ? "desc" : "asc";
    } else {
      library.sortKey = key;
      library.sortDir = key === "name" || key === "category" ? "asc" : "desc";
    }
    paintTable();
  }));
  table.querySelectorAll("tbody tr").forEach(row => {
    const pick = () => selectFile(Number(row.dataset.id));
    row.addEventListener("click", pick);
    row.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
  });
}

function paintDetail() {
  const box = document.getElementById("fileDetail");
  if (!box || !library.data) return;
  const f = library.data.files.find(x => x.id === library.selectedId);
  if (!f) { box.hidden = true; return; }

  let previewHtml;
  if (f.extraction_status !== "ok") {
    previewHtml = `<p class="fine">${esc(f.extraction_error || "No readable text was found in this file.")}</p>`;
  } else if (library.previewError) {
    previewHtml = `<p class="fine">${esc(library.previewError)}</p>`;
  } else if (!library.preview) {
    previewHtml = '<p class="fine">Loading preview…</p>';
  } else {
    const more = library.preview.char_count > 2000 ? '<p class="fine">Showing the first 2,000 characters.</p>' : "";
    previewHtml = `<pre class="preview">${esc(library.preview.preview)}</pre>${more}`;
  }

  const known = [...new Set(library.data.files.map(categoryOf))].filter(c => c !== "Uncategorized");
  const level = f.category && f.category_level ? ` <span class="badge">${esc(f.category_level)}</span>` : "";
  box.innerHTML = `
    <h2 class="detail-title">${esc(f.name)}</h2>
    <dl class="meta">
      <dt>Type</dt><dd>${esc(f.type)}, ${formatSize(f.size_bytes)}</dd>
      <dt>Category</dt><dd>${esc(categoryOf(f))}${level}</dd>
      <dt>Why</dt><dd>${esc(f.category_reason || "")}</dd>
      <dt>Modified</dt><dd>${formatDate(f.modified)}</dd>
      <dt>Location</dt><dd class="mono">${esc(f.path)}</dd>
    </dl>
    <div class="cat-edit">
      <label for="catInput">Change category</label>
      <div class="cat-row">
        <input class="input" id="catInput" list="catList" maxlength="50" placeholder="Type or pick a category">
        <datalist id="catList">${known.map(c => `<option value="${esc(c)}">`).join("")}</datalist>
        <button class="btn" type="button" id="catSave">Save</button>
      </div>
      <p class="fine" id="catMsg">This only changes File Genie's label, never the file.</p>
    </div>
    <h3>Text preview</h3>
    ${previewHtml}
    <button class="btn" type="button" id="detailClose">Close</button>`;
  box.hidden = false;
  document.getElementById("catSave").addEventListener("click", () => saveCategory(f.id));
  document.getElementById("detailClose").addEventListener("click", () => {
    library.selectedId = null;
    paintTable();
    paintDetail();
  });
}

async function selectFile(id) {
  library.selectedId = id;
  library.preview = null;
  library.previewError = null;
  paintTable();
  paintDetail();
  try {
    const res = await fetch(`${API}/files/${id}/text`);
    if (!res.ok) throw new Error("preview failed");
    const data = await res.json();
    if (library.selectedId === id) { library.preview = data; paintDetail(); }
  } catch (err) {
    if (library.selectedId === id) { library.previewError = "Couldn't load the text preview."; paintDetail(); }
  }
}

async function saveCategory(fileId) {
  const msg = document.getElementById("catMsg");
  const value = document.getElementById("catInput").value.trim();
  if (!value) { msg.textContent = "Type a category name first."; return; }
  try {
    const res = await fetch(`${API}/files/${fileId}/category`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof data.detail === "string"
        ? data.detail : "Couldn't save the category (" + res.status + "). If the backend just restarted, wait a few seconds and try again.");
    }
    const f = library.data.files.find(x => x.id === fileId);
    Object.assign(f, {
      category: data.category, category_source: "user",
      category_level: "Set by you", category_reason: "Category chosen by you.",
    });
    go("files");
  } catch (err) {
    msg.textContent = err instanceof TypeError ? "Couldn't reach the backend." : err.message;
  }
}

function bindFilesToolbar() {
  const query = document.getElementById("fileQuery");
  if (!query) return;
  query.addEventListener("input", () => { library.query = query.value; paintTable(); });
  document.getElementById("fileType").addEventListener("change", e => { library.type = e.target.value; paintTable(); });
  document.getElementById("fileCategory").addEventListener("change", e => { library.category = e.target.value; paintTable(); });
  paintTable();
  paintDetail();
}

async function openFiles() {
  bindFilesToolbar(); // shows what we already have while fresh data loads
  try {
    const res = await fetch(API + "/files");
    if (!res.ok) throw new Error("The backend returned an error (" + res.status + ").");
    library.data = await res.json();
    library.error = null;
  } catch (err) {
    library.error = err instanceof TypeError
      ? "Couldn't reach the backend. Check that it is running, then reopen My Files."
      : err.message;
  }
  if (currentPage === "files") {
    content.innerHTML = renderFiles();
    content.querySelectorAll("[data-go]").forEach(btn => btn.addEventListener("click", () => go(btn.dataset.go)));
    bindFilesToolbar();
  }
}

// ---------- Navigation ----------

let currentPage = "dashboard";

const nav = document.getElementById("nav");
const content = document.getElementById("content");
const pageTitle = document.getElementById("pageTitle");

function buildNav() {
  document.getElementById("brandMark").innerHTML = svg("files");
  nav.innerHTML = PAGES.filter(p => !p.hidden).map(p =>
    `<button class="nav-item" type="button" data-page="${p.id}">${svg(p.icon)}<span>${p.label}</span></button>`
  ).join("");
  nav.querySelectorAll(".nav-item").forEach(btn =>
    btn.addEventListener("click", () => go(btn.dataset.page)));
  document.getElementById("sidebarScan").addEventListener("click", () => go("scan"));
}

function go(id) {
  const page = PAGES.find(p => p.id === id) || PAGES[0];
  currentPage = page.id;
  pageTitle.textContent = page.label;
  nav.querySelectorAll(".nav-item").forEach(btn =>
    btn.classList.toggle("active", btn.dataset.page === page.id));
  content.innerHTML = page.render ? page.render() : renderPlaceholder(page);
  content.querySelectorAll("[data-go]").forEach(btn =>
    btn.addEventListener("click", () => go(btn.dataset.go)));
  if (page.after) page.after();
  content.scrollTop = 0;
}

// ---------- Backend status ----------

const statusEl = document.getElementById("status");
const statusText = document.getElementById("statusText");

const STATUS_TEXT = {
  online: "Backend connected",
  offline: "Backend offline",
  error: "Backend error",
};

function setStatus(state) {
  statusEl.dataset.state = state;
  statusText.textContent = STATUS_TEXT[state];
  statusEl.title = state === "offline"
    ? "Start the backend: C:\\fgvenv\\Scripts\\python.exe -m uvicorn main:app --reload (from the backend folder)"
    : "";
}

async function checkBackend() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(API + "/status", { signal: controller.signal });
    setStatus(res.ok ? "online" : "error");
  } catch (err) {
    setStatus("offline");
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Start ----------

buildNav();
go("dashboard");
checkBackend();
setInterval(checkBackend, 5000);
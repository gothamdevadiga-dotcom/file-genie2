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
  { id: "categories", label: "Smart Categories", icon: "categories", render: renderCategories, after: openCategories },
  { id: "search", label: "AI Search", icon: "search", render: renderSearch, after: bindSearch },
  { id: "ask", label: "Ask Files", icon: "ask", render: renderAsk, after: bindAsk },
  { id: "duplicates", label: "Duplicates", icon: "duplicates", render: renderDuplicates, after: openDuplicates },
  { id: "review", label: "Review Suggestions", icon: "review", render: renderReview, after: openReview },
  { id: "activity", label: "Activity", icon: "activity", render: renderActivity, after: openActivity },
  { id: "settings", label: "Settings", icon: "settings", render: renderSettings, after: openSettings },
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
        <button class="btn btn-primary" type="button" data-go="files">Open My Files</button>
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

  if (scan.phase === "done" && scan.result.file_count > 0) {
    // Forget the previous scan's view so My Files and Categories load the new results.
    library.data = null;
    library.selectedId = null;
    library.preview = null;
    library.type = "all";
    library.category = "all";
    library.query = "";
    cats.data = null;
    dupes.data = null;
    searchState.data = null;
    searchState.phase = "idle";
    ask.data = null;
    ask.phase = "idle";
    review.data = null;
    org.plan = null;
    org.result = null;
    org.phase = "idle";
    org.error = null;
    activity.data = null;
  }
  if (currentPage === "scan") {
    go(scan.phase === "done" && scan.result.file_count > 0 ? "files" : "scan");
  }
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
    <div class="detail-actions">
      <button class="btn btn-primary" type="button" id="openFile">Open file</button>
      <button class="btn" type="button" id="revealFile">Show in folder</button>
    </div>
    <p class="fine" id="openMsg"></p>
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
  document.getElementById("openFile").addEventListener("click", () => fileAction("openFile", f.path));
  document.getElementById("revealFile").addEventListener("click", () => fileAction("revealFile", f.path));
  document.getElementById("detailClose").addEventListener("click", () => {
    library.selectedId = null;
    paintTable();
    paintDetail();
  });
}

async function fileAction(kind, filePath) {
  const msg = document.getElementById("openMsg");
  if (!window.fileGenie || !window.fileGenie[kind]) {
    msg.textContent = "This only works inside the File Genie app. Close it and start it again with npm start.";
    return;
  }
  const result = await window.fileGenie[kind](filePath);
  msg.textContent = result.ok ? "" : result.message;
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

// ---------- Smart Categories ----------

const cats = { data: null, error: null };

function renderCategories() {
  if (cats.error) {
    return `<div class="page"><div class="note note-error"><span>${esc(cats.error)}</span></div></div>`;
  }
  if (!cats.data) {
    return '<div class="page"><section class="card progress"><span class="spinner" aria-hidden="true"></span><p class="card-text">Loading categories…</p></section></div>';
  }
  const files = cats.data.files;
  if (files.length === 0) {
    return `
      <div class="page">
        <section class="card empty">
          <div class="empty-icon">${svg("categories")}</div>
          <h2>No categories yet</h2>
          <p>Scan a folder first. Categories are made from the files in your latest scan.</p>
          <button class="btn btn-primary" type="button" data-go="scan">Scan a folder</button>
        </section>
      </div>`;
  }

  const groups = {};
  files.forEach(f => { (groups[categoryOf(f)] = groups[categoryOf(f)] || []).push(f); });
  const names = Object.keys(groups).sort((a, b) => {
    if (a === "Uncategorized") return 1;
    if (b === "Uncategorized") return -1;
    return groups[b].length - groups[a].length;
  });

  const cards = names.map(name => {
    const list = groups[name];
    const examples = list.slice(0, 3).map(f => `<li>${esc(f.name)}</li>`).join("");
    const more = list.length > 3 ? `<li class="more">and ${list.length - 3} more</li>` : "";
    return `
      <section class="card cat-card">
        <div class="cat-head">
          <h2 class="card-title">${esc(name)}</h2>
          <span class="badge">${list.length} ${list.length === 1 ? "file" : "files"}</span>
        </div>
        <ul class="cat-list">${examples}${more}</ul>
        <button class="btn" type="button" data-cat="${esc(name)}">View files</button>
      </section>`;
  }).join("");

  return `
    <div class="page page-wide">
      <p class="card-text">Categories are picked by simple keyword rules, not AI. If one is wrong, open the file in My Files and change it.</p>
      <div class="cat-grid">${cards}</div>
    </div>`;
}

function bindCategories() {
  content.querySelectorAll("[data-cat]").forEach(btn => btn.addEventListener("click", () => {
    library.category = btn.dataset.cat;
    library.type = "all";
    library.query = "";
    library.selectedId = null;
    go("files");
  }));
}

async function openCategories() {
  bindCategories();
  try {
    const res = await fetch(API + "/files");
    if (!res.ok) throw new Error("The backend returned an error (" + res.status + ").");
    cats.data = await res.json();
    cats.error = null;
  } catch (err) {
    cats.error = err instanceof TypeError
      ? "Couldn't reach the backend. Check that it is running, then reopen Smart Categories."
      : err.message;
  }
  if (currentPage === "categories") {
    content.innerHTML = renderCategories();
    content.querySelectorAll("[data-go]").forEach(btn => btn.addEventListener("click", () => go(btn.dataset.go)));
    bindCategories();
  }
}

// ---------- Shared helpers for the data screens ----------

async function api(path, options) {
  try {
    const res = await fetch(API + path, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(typeof data.detail === "string"
        ? data.detail
        : "The backend returned an error (" + res.status + "). If it just restarted, wait a few seconds and try again.");
    }
    return data;
  } catch (err) {
    if (err instanceof TypeError) throw new Error("Couldn't reach the backend. Check that it is running.");
    throw err;
  }
}

function postJson(path, body) {
  return api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Redraws a page after its data changed, without re-running its load hook.
function paintPage(id, render, bind) {
  if (currentPage !== id) return;
  content.innerHTML = render();
  content.querySelectorAll("[data-go]").forEach(btn => btn.addEventListener("click", () => go(btn.dataset.go)));
  bind();
}

function loadingCard(text) {
  return `<section class="card progress"><span class="spinner" aria-hidden="true"></span><p class="card-text">${text}</p></section>`;
}

function errorNote(text) {
  return `<div class="note note-error"><span>${esc(text)}</span></div>`;
}

function emptyCard(icon, title, text) {
  return `<section class="card empty"><div class="empty-icon">${svg(icon)}</div><h2>${title}</h2><p>${text}</p><button class="btn btn-primary" type="button" data-go="scan">Scan a folder</button></section>`;
}

function showInFiles(name) {
  library.query = name;
  library.type = "all";
  library.category = "all";
  library.selectedId = null;
  go("files");
}

// ---------- Duplicates ----------

const dupes = { data: null, error: null, loading: false, threshold: "0.65" };

function dupGroup(g, exact) {
  let badge = '<span class="badge">Exact copy</span>';
  if (!exact) {
    const lo = Math.round(g.similarity_lowest * 100);
    const hi = Math.round(g.similarity_highest * 100);
    badge = `<span class="badge">${lo === hi ? lo : lo + " to " + hi}% similar text</span>`;
  }
  const extra = exact ? `<p class="fine">${formatSize(g.extra_space_bytes)} of extra space used by the copies.</p>` : "";
  const items = g.files.map(f => `
    <li>
      <div class="file-name">${esc(f.name)}</div>
      <div class="file-sub mono">${esc(f.folder)}</div>
      <div class="file-sub">${formatSize(f.size_bytes)}, modified ${formatDate(f.modified)}</div>
    </li>`).join("");
  return `
    <section class="card">
      <div class="group-head"><h3 class="card-title">${g.file_count} ${exact ? "identical" : "similar"} files</h3>${badge}</div>
      ${extra}
      <ul class="group-list">${items}</ul>
    </section>`;
}

function renderDuplicates() {
  const levels = [["0.5", "Loose"], ["0.65", "Balanced"], ["0.8", "Strict"]];
  const options = levels.map(([v, label]) =>
    `<option value="${v}"${v === dupes.threshold ? " selected" : ""}>${label}</option>`).join("");
  const d = dupes.data;

  let body;
  if (dupes.loading) {
    body = loadingCard("Comparing your files…");
  } else if (dupes.error) {
    body = errorNote(dupes.error);
  } else if (!d || !d.scanned_files) {
    body = emptyCard("duplicates", "Nothing to compare yet", "Scan a folder first, then come back to look for duplicate files.");
  } else {
    const total = d.exact_count + d.similar_count;
    body = `<div class="note"><span>Checked ${d.scanned_files} files. ${esc(d.note)}</span></div>`;
    if (total === 0) body += '<div class="note"><span>No duplicates found.</span></div>';
    if (d.exact_count) {
      body += `<h2 class="section-title">Exact copies (${d.exact_count})</h2>` + d.exact_groups.map(g => dupGroup(g, true)).join("");
    }
    if (d.similar_count) {
      body += `<h2 class="section-title">Similar files (${d.similar_count})</h2>
        <p class="fine">Similar means the text is alike, not that it is the same file. Check them before deciding anything.</p>`
        + d.similar_groups.map(g => dupGroup(g, false)).join("");
    }
  }

  return `
    <div class="page">
      <div class="toolbar">
        <label class="fine" for="dupLevel">Similarity level</label>
        <select class="input" id="dupLevel">${options}</select>
      </div>
      ${body}
    </div>`;
}

function bindDuplicates() {
  const select = document.getElementById("dupLevel");
  if (select) select.addEventListener("change", () => {
    dupes.threshold = select.value;
    loadDuplicates();
  });
}

async function loadDuplicates() {
  dupes.loading = true;
  dupes.error = null;
  paintPage("duplicates", renderDuplicates, bindDuplicates);
  try {
    dupes.data = await api("/duplicates?similarity_threshold=" + dupes.threshold);
  } catch (err) {
    dupes.error = err.message;
  }
  dupes.loading = false;
  paintPage("duplicates", renderDuplicates, bindDuplicates);
}

function openDuplicates() {
  bindDuplicates();
  loadDuplicates();
}

// ---------- AI Search ----------

const searchState = { query: "", mode: "both", phase: "idle", data: null, error: null };

function matchBadges(r) {
  const tags = [];
  if (r.matchedBy === "name" || r.matchedBy === "both") tags.push("Name match");
  if (r.matchedBy === "content" || r.matchedBy === "both") tags.push("Content match");
  const list = tags.map(t => `<span class="badge">${t}</span>`);
  if (r.relevance) list.push(`<span class="badge">${esc(r.relevance)} relevance</span>`);
  return list.join(" ");
}

// Runs the file-name search and the meaning search together and merges them,
// so a file shows up if its name OR its content matches.
async function searchBoth(query) {
  const [byName, byMeaning] = await Promise.allSettled([
    postJson("/search", { query, mode: "filename", limit: 20 }),
    postJson("/search", { query, mode: "meaning", limit: 10 }),
  ]);
  if (byName.status === "rejected" && byMeaning.status === "rejected") throw byName.reason;

  const merged = new Map();
  if (byName.status === "fulfilled") {
    byName.value.results.forEach(r => merged.set(r.id, { ...r, matchedBy: "name" }));
  }
  if (byMeaning.status === "fulfilled") {
    byMeaning.value.results.forEach(r => {
      const existing = merged.get(r.id);
      if (existing) {
        merged.set(r.id, { ...existing, snippet: r.snippet, relevance: r.relevance, matchedBy: "both" });
      } else {
        merged.set(r.id, { ...r, matchedBy: "content" });
      }
    });
  }
  const results = [...merged.values()];
  return {
    count: results.length,
    results,
    method: "names and content, runs locally",
    message: "No matches in file names or content.",
  };
}

function renderSearchResults(d) {
  if (!d.count) return `<div class="note"><span>${esc(d.message || "No results.")}</span></div>`;
  const rows = d.results.map(r => `
    <li class="result">
      <div class="result-head">
        <span class="file-name">${esc(r.name)}</span>
        ${matchBadges(r)}
      </div>
      <div class="file-sub">${esc(r.type)}, ${esc(r.category || "Uncategorized")}</div>
      ${r.snippet ? `<p class="snippet">${esc(r.snippet)}</p>` : ""}
      <div class="file-sub mono">${esc(r.path)}</div>
      <button class="btn btn-small" type="button" data-show="${esc(r.name)}">Show in My Files</button>
    </li>`).join("");
  return `
    <section class="card">
      <p class="fine">${d.count} ${d.count === 1 ? "result" : "results"}${d.method ? ", " + esc(d.method) : ""}</p>
      <ul class="results">${rows}</ul>
    </section>`;
}

function renderSearch() {
  const busy = searchState.phase === "searching";
  let body = "";
  if (busy) body = loadingCard("Searching…");
  else if (searchState.error) body = errorNote(searchState.error);
  else if (searchState.data) body = renderSearchResults(searchState.data);

  const mode = m => (searchState.mode === m ? " selected" : "");
  return `
    <div class="page">
      <section class="card">
        <h2 class="card-title">Search your files</h2>
        <p class="card-text">Names and content checks both at once. By meaning finds files about a topic, even when the words differ. By file name matches words in the name. Searching happens on your computer.</p>
        <div class="ask-row">
          <input class="input grow" id="searchQuery" type="search" placeholder="What are you looking for?" aria-label="Search" value="${esc(searchState.query)}" ${busy ? "disabled" : ""}>
          <select class="input" id="searchMode" aria-label="Search type" ${busy ? "disabled" : ""}>
            <option value="both"${mode("both")}>Names and content</option>
            <option value="meaning"${mode("meaning")}>By meaning</option>
            <option value="filename"${mode("filename")}>By file name</option>
          </select>
          <button class="btn btn-primary" type="button" id="searchBtn" ${busy ? "disabled" : ""}>Search</button>
        </div>
      </section>
      ${body}
    </div>`;
}

async function runSearch() {
  searchState.query = document.getElementById("searchQuery").value.trim();
  searchState.mode = document.getElementById("searchMode").value;
  searchState.data = null;
  if (!searchState.query) {
    searchState.phase = "error";
    searchState.error = "Type something to search for.";
    paintPage("search", renderSearch, bindSearch);
    return;
  }
  searchState.phase = "searching";
  searchState.error = null;
  paintPage("search", renderSearch, bindSearch);
  try {
    searchState.data = searchState.mode === "both"
      ? await searchBoth(searchState.query)
      : await postJson("/search", { query: searchState.query, mode: searchState.mode, limit: 10 });
    searchState.phase = "done";
  } catch (err) {
    searchState.phase = "error";
    searchState.error = err.message;
  }
  paintPage("search", renderSearch, bindSearch);
}

function bindSearch() {
  const input = document.getElementById("searchQuery");
  const btn = document.getElementById("searchBtn");
  if (btn) btn.addEventListener("click", runSearch);
  if (input) input.addEventListener("keydown", e => { if (e.key === "Enter") runSearch(); });
  content.querySelectorAll("[data-show]").forEach(b => b.addEventListener("click", () => showInFiles(b.dataset.show)));
}

// ---------- Ask Files ----------

const ask = { question: "", useAi: false, phase: "idle", data: null, error: null };

// Escapes the text first, then turns **bold** into real bold, so nothing can inject HTML.
function formatAnswer(text) {
  return esc(text).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function renderAnswer(d) {
  const main = d.status === "answered"
    ? `<section class="card"><h2 class="card-title">Answer</h2><p class="answer">${formatAnswer(d.answer)}</p></section>`
    : `<div class="note ${d.status === "error" ? "note-error" : ""}"><span>${esc(d.message || "")}</span></div>`;

  let disclosure = "Nothing left your computer.";
  if (d.status === "error") {
    disclosure = "The AI request failed, so File Genie can't confirm whether any passages reached the service.";
  } else if (d.sent_to_external_service) {
    disclosure = `Sent to ${esc(d.provider)}: passages from ${d.sent_files.map(esc).join(", ")}.`;
  }

  const sources = (d.sources || []).map(s => `
    <li class="result">
      <div class="result-head">
        <span class="file-name">[${s.number}] ${esc(s.name)}</span>
        ${s.relevance ? `<span class="badge">${esc(s.relevance)}</span>` : ""}
      </div>
      <details class="passage"><summary>Show passage</summary><p class="snippet">${esc(s.passage)}</p></details>
      <div class="file-sub mono">${esc(s.path)}</div>
    </li>`).join("");
  const list = sources
    ? `<section class="card"><h2 class="card-title">Passages used</h2><ul class="results">${sources}</ul></section>` : "";

  return main + `<div class="note">${svg("shield")}<span>${disclosure}</span></div>` + list;
}

function renderAsk() {
  const busy = ask.phase === "asking";
  let body = "";
  if (busy) body = loadingCard(ask.useAi ? "Finding passages and asking Claude…" : "Finding the most relevant passages…");
  else if (ask.error) body = errorNote(ask.error);
  else if (ask.data) body = renderAnswer(ask.data);

  return `
    <div class="page">
      <section class="card">
        <h2 class="card-title">Ask about your files</h2>
        <p class="card-text">File Genie finds the passages in your scanned files that best match your question.</p>
        <div class="ask-row">
          <textarea class="input grow" id="askQuestion" rows="3" placeholder="For example: What does Unit 1 cover?" aria-label="Your question" ${busy ? "disabled" : ""}>${esc(ask.question)}</textarea>
        </div>
        <label class="check">
          <input type="checkbox" id="askAi" ${ask.useAi ? "checked" : ""} ${busy ? "disabled" : ""}>
          <span>Let Claude write an answer from those passages. Only the matching passages are sent to Anthropic, never whole files, and you will see which files they came from.</span>
        </label>
        <div class="ask-row"><button class="btn btn-primary" type="button" id="askBtn" ${busy ? "disabled" : ""}>Ask</button></div>
      </section>
      ${body}
    </div>`;
}

async function runAsk() {
  ask.question = document.getElementById("askQuestion").value.trim();
  ask.useAi = document.getElementById("askAi").checked;
  ask.data = null;
  if (!ask.question) {
    ask.phase = "error";
    ask.error = "Type a question first.";
    paintPage("ask", renderAsk, bindAsk);
    return;
  }
  ask.phase = "asking";
  ask.error = null;
  paintPage("ask", renderAsk, bindAsk);
  try {
    ask.data = await postJson("/ask", { question: ask.question, allow_external_ai: ask.useAi, limit: 5 });
    ask.phase = "done";
  } catch (err) {
    ask.phase = "error";
    ask.error = err.message;
  }
  paintPage("ask", renderAsk, bindAsk);
}

function bindAsk() {
  const btn = document.getElementById("askBtn");
  if (btn) btn.addEventListener("click", runAsk);
}

// ---------- Review Suggestions and moving files ----------

const review = { data: null, error: null, loading: false, scope: "needs_review", includeMedium: false };
const org = { dest: null, includeUndecided: false, phase: "idle", plan: null, result: null, error: null };

const DECISION_LABEL = { approve: "Approved", reject: "Rejected", modify: "Changed" };

function reviewCard(it) {
  const flags = it.flags.map(f => `<span class="badge badge-warn">${esc(f)}</span>`).join(" ");
  const decided = it.decision
    ? `<span class="badge">${DECISION_LABEL[it.decision.action] || ""}${it.decision.category ? ": " + esc(it.decision.category) : ""}</span>` : "";
  const level = it.current_category && it.category_level ? ` (${esc(it.category_level)})` : "";
  const chips = (it.candidates || []).slice(0, 3).map(c =>
    `<button class="chip" type="button" data-pick="${it.id}" data-cat="${esc(c.category)}">${esc(c.category)}</button>`).join("");
  const noCat = !it.current_category || it.current_category === "Uncategorized";
  return `
    <section class="card review-card">
      <div class="group-head">
        <div>
          <h3 class="card-title">${esc(it.name)}</h3>
          <p class="file-sub">Category: ${esc(it.current_category || "none")}${level}</p>
        </div>
        ${decided}
      </div>
      ${flags ? `<div class="chips">${flags}</div>` : ""}
      ${it.reason ? `<p class="fine">${esc(it.reason)}</p>` : ""}
      ${chips ? `<div class="chips"><span class="fine">Other options:</span>${chips}</div>` : ""}
      <div class="review-actions">
        <button class="btn btn-primary btn-small" type="button" data-act="approve" data-id="${it.id}" ${noCat ? "disabled" : ""}>Approve</button>
        <button class="btn btn-small" type="button" data-act="reject" data-id="${it.id}">Reject</button>
        ${it.decision ? `<button class="btn btn-small" type="button" data-act="undo" data-id="${it.id}">Undo decision</button>` : ""}
        <input class="input" data-input="${it.id}" maxlength="50" placeholder="Other category" aria-label="Other category">
        <button class="btn btn-small" type="button" data-set="${it.id}">Set category</button>
      </div>
      <p class="fine" data-msg="${it.id}"></p>
    </section>`;
}

function renderPlan(p) {
  const skipped = p.skipped_count
    ? `<details class="passage"><summary>${p.skipped_count} skipped</summary><ul class="plan-list">${
        p.skipped.map(x => `<li>${esc(x.name)}: ${esc(x.reason)}</li>`).join("")}</ul></details>` : "";
  const n = p.not_included || {};
  const left = [];
  if (n.rejected) left.push(n.rejected + " rejected");
  if (n.not_reviewed) left.push(n.not_reviewed + " not reviewed yet");
  if (n.no_category) left.push(n.no_category + " without a category");
  const leftText = left.length ? `<p class="fine">Not included: ${left.join(", ")}.</p>` : "";

  if (p.move_count === 0) {
    return `<div class="plan"><div class="note"><span>Nothing to move. Approve some files first, or tick the box to include files you haven't reviewed.</span></div>${leftText}${skipped}</div>`;
  }
  const rows = p.moves.map(m => `<li><strong>${esc(m.name)}</strong> goes to <span class="mono">${esc(m.category)}</span></li>`).join("");
  return `
    <div class="plan">
      <p><strong>${p.move_count} ${p.move_count === 1 ? "file" : "files"}</strong> will be moved into folders inside <span class="mono">${esc(p.destination_root)}</span>. Nothing has moved yet.</p>
      <ul class="plan-list">${rows}</ul>
      ${leftText}${skipped}
      <div class="ask-row">
        <button class="btn btn-primary" type="button" id="orgConfirm">Confirm and move ${p.move_count} ${p.move_count === 1 ? "file" : "files"}</button>
        <button class="btn" type="button" id="orgCancel">Cancel</button>
      </div>
    </div>`;
}

function renderMoveResult(r) {
  const failed = r.results.filter(x => x.status === "failed")
    .map(x => `<li>${esc(x.name)}: ${esc(x.message || "failed")}</li>`).join("");
  return `
    <div class="note">${svg("shield")}<span>Moved ${r.moved} ${r.moved === 1 ? "file" : "files"}${r.failed ? ", " + r.failed + " failed" : ""}. You can undo this from Activity.</span></div>
    ${failed ? `<ul class="plan-list">${failed}</ul>` : ""}
    <div class="ask-row"><button class="btn" type="button" data-go="activity">Open Activity</button></div>`;
}

function renderOrganizeCard() {
  const busy = org.phase === "planning" || org.phase === "moving";
  let body = "";
  if (org.error) body += errorNote(org.error);
  if (org.phase === "planning") body += loadingCard("Building the plan…");
  if (org.phase === "moving") body += loadingCard("Moving files…");
  if (org.phase === "planned" && org.plan) body += renderPlan(org.plan);
  if (org.phase === "done" && org.result) body += renderMoveResult(org.result);
  const dest = org.dest
    ? `<span class="path">${esc(org.dest)}</span>` : '<span class="path path-empty">No destination chosen</span>';
  return `
    <section class="card">
      <h2 class="card-title">Move files into category folders</h2>
      <p class="card-text">Approved or changed files are moved into one folder per category inside the destination you choose. Nothing is overwritten or deleted, and you see the full plan before anything moves.</p>
      <div class="picker">
        <div class="picker-path">${dest}</div>
        <button class="btn" type="button" id="orgPick" ${busy ? "disabled" : ""}>Choose destination</button>
      </div>
      <label class="check"><input type="checkbox" id="orgUndecided" ${org.includeUndecided ? "checked" : ""} ${busy ? "disabled" : ""}><span>Also include categorized files I haven't reviewed</span></label>
      <div class="ask-row"><button class="btn btn-primary" type="button" id="orgPlan" ${!org.dest || busy ? "disabled" : ""}>Preview moves</button></div>
      ${body ? `<div class="plan-wrap">${body}</div>` : ""}
    </section>`;
}

function renderReview() {
  const d = review.data;
  if (review.error && !d) return `<div class="page">${errorNote(review.error)}</div>`;
  if (!d) return `<div class="page">${loadingCard("Loading suggestions…")}</div>`;
  if (!d.total_files) {
    return `<div class="page">${emptyCard("review", "Nothing to review yet", "Scan a folder first. Files that need a decision will show up here.")}</div>`;
  }
  const sel = v => (review.scope === v ? " selected" : "");
  const head = `
    <div class="toolbar">
      <select class="input" id="revScope" aria-label="Which files">
        <option value="needs_review"${sel("needs_review")}>Needs review (${d.needs_review})</option>
        <option value="all"${sel("all")}>All files (${d.total_files})</option>
      </select>
      <label class="check inline"><input type="checkbox" id="revMedium" ${review.includeMedium ? "checked" : ""}><span>Include medium confidence</span></label>
      <span class="toolbar-count">${d.approved} approved, ${d.modified} changed, ${d.rejected} rejected</span>
    </div>`;
  const list = d.items.length
    ? d.items.map(reviewCard).join("")
    : `<div class="note"><span>${esc(d.message || "Nothing needs your review right now.")}</span></div>`;
  return `<div class="page">${review.error ? errorNote(review.error) : ""}${renderOrganizeCard()}${head}${list}</div>`;
}

async function loadReview() {
  review.loading = true;
  review.error = null;
  paintPage("review", renderReview, bindReview);
  try {
    review.data = await api("/review?scope=" + review.scope + "&include_medium=" + review.includeMedium);
  } catch (err) {
    review.error = err.message;
  }
  review.loading = false;
  paintPage("review", renderReview, bindReview);
}

async function decide(id, action, category) {
  const msg = content.querySelector('[data-msg="' + id + '"]');
  try {
    await postJson("/review/" + id + "/decision", { action, category: category || null });
    library.data = null;
    cats.data = null;
    await loadReview();
  } catch (err) {
    if (msg) msg.textContent = err.message;
  }
}

function dropViewsAfterMove() {
  library.data = null;
  cats.data = null;
  dupes.data = null;
  activity.data = null;
}

async function makePlan() {
  org.phase = "planning";
  org.error = null;
  org.result = null;
  paintPage("review", renderReview, bindReview);
  try {
    org.plan = await postJson("/organize/plan", { destination_root: org.dest, include_undecided: org.includeUndecided });
    org.phase = "planned";
  } catch (err) {
    org.phase = "idle";
    org.error = err.message;
  }
  paintPage("review", renderReview, bindReview);
}

async function confirmMove() {
  const plan = org.plan;
  if (!plan || !window.confirm("Move " + plan.move_count + " files now? You can undo it from Activity.")) return;
  org.phase = "moving";
  org.error = null;
  paintPage("review", renderReview, bindReview);
  try {
    org.result = await postJson("/organize/execute", { plan_id: plan.plan_id, confirm: true, move_count: plan.move_count });
    org.phase = "done";
    org.plan = null;
    dropViewsAfterMove();
  } catch (err) {
    org.phase = "idle";
    org.error = err.message;
  }
  await loadReview();
}

function bindReview() {
  const $ = id => document.getElementById(id);
  if ($("revScope")) $("revScope").addEventListener("change", e => { review.scope = e.target.value; loadReview(); });
  if ($("revMedium")) $("revMedium").addEventListener("change", e => { review.includeMedium = e.target.checked; loadReview(); });
  if ($("orgUndecided")) $("orgUndecided").addEventListener("change", e => { org.includeUndecided = e.target.checked; org.plan = null; org.phase = "idle"; });
  if ($("orgPick")) $("orgPick").addEventListener("click", async () => {
    if (!window.fileGenie) { org.error = "The folder picker only works inside the File Genie app window."; paintPage("review", renderReview, bindReview); return; }
    const folder = await window.fileGenie.pickFolder();
    if (folder) { org.dest = folder; org.plan = null; org.phase = "idle"; org.error = null; org.result = null; paintPage("review", renderReview, bindReview); }
  });
  if ($("orgPlan")) $("orgPlan").addEventListener("click", makePlan);
  if ($("orgConfirm")) $("orgConfirm").addEventListener("click", confirmMove);
  if ($("orgCancel")) $("orgCancel").addEventListener("click", () => { org.plan = null; org.phase = "idle"; paintPage("review", renderReview, bindReview); });

  content.querySelectorAll("[data-act]").forEach(b => b.addEventListener("click", () => decide(Number(b.dataset.id), b.dataset.act)));
  content.querySelectorAll("[data-pick]").forEach(b => b.addEventListener("click", () => decide(Number(b.dataset.pick), "modify", b.dataset.cat)));
  content.querySelectorAll("[data-set]").forEach(b => b.addEventListener("click", () => {
    const id = b.dataset.set;
    const value = content.querySelector('[data-input="' + id + '"]').value.trim();
    if (!value) { content.querySelector('[data-msg="' + id + '"]').textContent = "Type a category name first."; return; }
    decide(Number(id), "modify", value);
  }));
}

function openReview() {
  bindReview();
  loadReview();
}

// ---------- Activity ----------

const activity = { data: null, error: null, msg: null };

function renderActivity() {
  if (activity.error) return `<div class="page">${errorNote(activity.error)}</div>`;
  const d = activity.data;
  if (!d) return `<div class="page">${loadingCard("Loading activity…")}</div>`;
  const msg = activity.msg ? `<div class="note"><span>${esc(activity.msg)}</span></div>` : "";
  if (!d.batches.length) {
    return `<div class="page">${msg}<section class="card empty"><div class="empty-icon">${svg("activity")}</div><h2>No moves yet</h2><p>When you move files, each batch is listed here and can be undone.</p><button class="btn btn-primary" type="button" data-go="review">Go to Review Suggestions</button></section></div>`;
  }
  const cards = d.batches.map(b => {
    const pending = b.moves_total - b.moves_undone;
    const rows = b.moves.map(m => `
      <li>
        <div class="file-name">${esc(m.name)} ${m.undone ? '<span class="badge">Moved back</span>' : ""}</div>
        <div class="file-sub mono">From: ${esc(m.from)}</div>
        <div class="file-sub mono">To: ${esc(m.to)}</div>
      </li>`).join("");
    return `
      <section class="card">
        <div class="group-head">
          <h3 class="card-title">${b.moves_total} ${b.moves_total === 1 ? "file" : "files"} moved</h3>
          <span class="fine">${esc(new Date(b.executed_at).toLocaleString())}</span>
        </div>
        <p class="card-text">Into ${esc(b.destination_root)}${b.moves_undone ? ", " + b.moves_undone + " moved back" : ""}</p>
        <details class="passage"><summary>Show files</summary><ul class="group-list">${rows}</ul></details>
        ${pending ? `<button class="btn" type="button" data-undo="${esc(b.batch_id)}" data-count="${pending}">Undo (${pending} ${pending === 1 ? "file" : "files"})</button>` : '<p class="fine">Everything in this batch has been moved back.</p>'}
      </section>`;
  }).join("");
  return `<div class="page">${msg}${cards}</div>`;
}

async function loadActivity() {
  activity.error = null;
  try {
    activity.data = await api("/organize/history");
  } catch (err) {
    activity.error = err.message;
  }
  paintPage("activity", renderActivity, bindActivity);
}

function bindActivity() {
  content.querySelectorAll("[data-undo]").forEach(b => b.addEventListener("click", async () => {
    const count = Number(b.dataset.count);
    if (!window.confirm("Move " + count + " files back to where they were?")) return;
    try {
      const r = await postJson("/organize/undo", { batch_id: b.dataset.undo, confirm: true, move_count: count });
      activity.msg = "Moved back " + r.moved_back + (r.moved_back === 1 ? " file" : " files") + (r.failed ? ", " + r.failed + " failed" : "") + ".";
      dropViewsAfterMove();
      review.data = null;
    } catch (err) {
      activity.msg = err.message;
    }
    loadActivity();
  }));
}

function openActivity() {
  activity.msg = null;
  bindActivity();
  loadActivity();
}

// ---------- Settings ----------

const settings = { status: null, msg: null };

function aiAllowed() {
  try { return localStorage.getItem("fg_ai") === "1"; } catch (err) { return false; }
}

function renderSettings() {
  const st = settings.status;
  let saved = "Loading…";
  if (st && st.saved_data) {
    saved = st.saved_data.exists
      ? formatSize(st.saved_data.size_bytes) + (st.saved_data.saved_at ? ", saved " + new Date(st.saved_data.saved_at).toLocaleString() : "")
      : "Nothing saved yet";
  }
  return `
    <div class="page">
      <section class="card">
        <h2 class="card-title">AI answers</h2>
        <p class="card-text">Ask Files can send the matching passages from your files to Anthropic's Claude to write an answer. It is off unless you turn it on, and you can change it for each question.</p>
        <label class="check"><input type="checkbox" id="setAi" ${aiAllowed() ? "checked" : ""}><span>Turn on Claude answers by default in Ask Files</span></label>
      </section>
      <section class="card">
        <h2 class="card-title">Saved data</h2>
        <p class="card-text">File Genie remembers your last scan, your review decisions and your move history so they are still here after a restart. Currently saved: ${esc(saved)}.</p>
        <button class="btn" type="button" id="setClear">Clear saved data</button>
        <p class="fine" id="setMsg">${esc(settings.msg || "This deletes File Genie's own saved data only. Your files are never touched.")}</p>
      </section>
    </div>`;
}

async function loadSettings() {
  try { settings.status = await api("/status"); } catch (err) { settings.status = null; }
  paintPage("settings", renderSettings, bindSettings);
}

function resetViews() {
  library.data = null; library.selectedId = null; library.preview = null;
  library.type = "all"; library.category = "all"; library.query = "";
  cats.data = null; dupes.data = null;
  searchState.data = null; searchState.phase = "idle";
  ask.data = null; ask.phase = "idle";
  review.data = null; org.plan = null; org.result = null; org.phase = "idle"; org.error = null;
  activity.data = null;
  scan.folder = null; scan.phase = "idle"; scan.result = null; scan.error = null;
}

function bindSettings() {
  const ai = document.getElementById("setAi");
  if (ai) ai.addEventListener("change", () => {
    try { localStorage.setItem("fg_ai", ai.checked ? "1" : "0"); } catch (err) { /* storage unavailable */ }
    ask.useAi = ai.checked;
  });
  const clear = document.getElementById("setClear");
  if (clear) clear.addEventListener("click", async () => {
    if (!window.confirm("Clear File Genie's saved scan, decisions and move history? Your own files will not be touched.")) return;
    try {
      await api("/data?confirm=true", { method: "DELETE" });
      resetViews();
      settings.msg = "Saved data cleared. Your own files were not touched. Restart the backend to also clear what it holds in memory.";
    } catch (err) {
      settings.msg = err.message;
    }
    loadSettings();
  });
}

function openSettings() {
  settings.msg = null;
  bindSettings();
  loadSettings();
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

ask.useAi = aiAllowed();
buildNav();
go("dashboard");
checkBackend();
setInterval(checkBackend, 5000);
'use strict';

// SS2026 exam modules — sorted by exam date
const MODULES = [
  { id: 'iatprak', name: 'IAT Praktikum', examDate: '2026-06-25' },
  { id: 'iat',    name: 'IAT',            examDate: '2026-07-08' },
  { id: 'hm2',    name: 'HM II',          examDate: '2026-07-25' },
  { id: 'eet',    name: 'EET',            examDate: '2026-07-29' },
  { id: 'hm3',    name: 'HM III',         examDate: '2026-08-08' },
  { id: 'esws',   name: 'ES Workshop',    examDate: '2026-08-26' },
  { id: 'es',     name: 'ES',             examDate: '2026-09-08' },
];

// KIT SS2026 semester start (mid-April)
const SEM_START = new Date('2026-04-14');

// ── State ─────────────────────────────────────────────────────────────────────
let currentModule    = null;
let pendingImageUrl  = null;   // data URL of image awaiting send
let isStreaming      = false;
let streamEl         = null;   // the .msg.assistant element being streamed into
let streamBuf        = '';     // accumulated text
let rafPending       = false;  // rAF throttle flag for DOM updates

// ── Helpers ───────────────────────────────────────────────────────────────────
function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysUntil(dateStr) {
  const t = new Date(dateStr);
  t.setHours(0, 0, 0, 0);
  return Math.round((t - today()) / 86400000);
}

function fmtDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Render math first (placeholder approach), then markdown.
// This avoids fragile regex-on-HTML and double-encoding issues.
function renderContent(text) {
  const blocks = [];

  // 1. Extract $$ block math
  text = text.replace(/\$\$([^$]+)\$\$/g, (_, tex) => {
    const id = blocks.length;
    try {
      blocks.push(katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false }));
    } catch {
      blocks.push(`<code>$$${esc(tex)}$$</code>`);
    }
    return `\x00MATH${id}\x00`;
  });

  // 2. Extract $ inline math (avoid false positives: no newlines, non-empty)
  text = text.replace(/\$([^$\n\r]{1,400}?)\$/g, (_, tex) => {
    const id = blocks.length;
    try {
      blocks.push(katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false }));
    } catch {
      blocks.push(`<code>${esc(tex)}</code>`);
    }
    return `\x00MATH${id}\x00`;
  });

  // 3. Markdown → HTML
  let html;
  try {
    html = marked.parse(text, { breaks: true, gfm: true });
  } catch {
    html = `<p>${esc(text)}</p>`;
  }

  // 4. Restore math
  blocks.forEach((rendered, i) => {
    html = html.replace(`\x00MATH${i}\x00`, rendered);
  });

  return html;
}

// ── DOM refs ──────────────────────────────────────────────────────────────────
const screenHome   = document.getElementById('screen-home');
const screenModule = document.getElementById('screen-module');
const tilesEl      = document.getElementById('tiles');
const homeHint     = document.getElementById('home-hint');
const crumbsEl     = document.getElementById('crumbs');
const brandEl      = document.getElementById('brand');

const materialsList = document.getElementById('materials-list');
const addPdfBtn     = document.getElementById('add-pdf');
const dropZone      = document.getElementById('drop-zone');
const quizBtn       = document.getElementById('quiz-btn');
const clearHistBtn  = document.getElementById('clear-history');
const usageBox      = document.getElementById('usage-info');

const chatLog        = document.getElementById('chat-log');
const chatEmpty      = document.getElementById('chat-empty');
const imgPreviewBar  = document.getElementById('image-preview-bar');
const previewImg     = document.getElementById('preview-img');
const previewRemove  = document.getElementById('preview-remove');
const inputEl        = document.getElementById('input');
const attachBtn      = document.getElementById('attach-image');
const sendBtn        = document.getElementById('send');

const settingsBtn    = document.getElementById('settings-btn');
const settingsModal  = document.getElementById('settings-modal');
const apiKeyInput    = document.getElementById('api-key-input');
const settingsCancel = document.getElementById('settings-cancel');
const settingsSave   = document.getElementById('settings-save');

// ── Navigation ────────────────────────────────────────────────────────────────
function showHome() {
  screenHome.classList.remove('hidden');
  screenModule.classList.add('hidden');
  crumbsEl.textContent = '';
  currentModule = null;
}

function showModule(mod) {
  currentModule = mod;
  screenHome.classList.add('hidden');
  screenModule.classList.remove('hidden');
  crumbsEl.textContent = '/ ' + mod.name;
  loadModuleState();
}

brandEl.addEventListener('click', showHome);

// ── Tiles ─────────────────────────────────────────────────────────────────────
function renderTiles() {
  tilesEl.innerHTML = '';
  const now = today();

  MODULES.forEach(mod => {
    const days      = daysUntil(mod.examDate);
    const examDate  = new Date(mod.examDate);
    examDate.setHours(0, 0, 0, 0);

    // State
    let state, badgeText;
    if (days < 0)       { state = 'done';     badgeText = 'Vorbei'; }
    else if (days === 0){ state = 'today';    badgeText = 'Heute!'; }
    else if (days <= 7) { state = 'urgent';   badgeText = `${days}d`; }
    else                { state = 'upcoming'; badgeText = `${days}d`; }

    // Countdown display
    let countdownText;
    if (days < 0)       countdownText = 'Fertig';
    else if (days === 0)countdownText = 'Heute!';
    else                countdownText = `${days}d`;

    // Progress bar: (today - semStart) / (examDate - semStart), capped 0–100
    const spanTotal = examDate - SEM_START;
    const spanDone  = now - SEM_START;
    const pct       = Math.max(0, Math.min(100, (spanDone / spanTotal) * 100));
    const barClass  = days < 0 ? 'done' : (days <= 7 ? 'urgent' : '');

    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.innerHTML = `
      <div class="tile-header">
        <div class="name">${esc(mod.name)}</div>
        <span class="badge ${state}">${badgeText}</span>
      </div>
      <div class="countdown ${state}">${countdownText}</div>
      <div class="exam-date">Pruefung ${fmtDate(mod.examDate)}</div>
      <div class="bar-wrap">
        <div class="bar"><div class="bar-fill ${barClass}" style="width:${pct.toFixed(1)}%"></div></div>
      </div>
    `;
    tile.addEventListener('click', () => showModule(mod));
    tilesEl.appendChild(tile);
  });

  // Next upcoming exam hint
  const next = MODULES.find(m => daysUntil(m.examDate) >= 0);
  if (next) {
    const d = daysUntil(next.examDate);
    homeHint.textContent = d === 0
      ? `${next.name} ist heute!`
      : `Naechste Pruefung: ${next.name} in ${d} Tagen (${fmtDate(next.examDate)})`;
  } else {
    homeHint.textContent = 'Alle Pruefungen abgeschlossen.';
  }
}

// ── Module state ──────────────────────────────────────────────────────────────
async function loadModuleState() {
  chatLog.innerHTML = '';
  chatLog.appendChild(chatEmpty);
  chatEmpty.style.display = '';
  materialsList.innerHTML = '';
  usageBox.style.display = 'none';
  pendingImageUrl = null;
  imgPreviewBar.classList.add('hidden');

  const state = await window.api.moduleState(currentModule.id);
  renderMaterials(state.materials);
  renderHistory(state.history);
}

// ── Materials ─────────────────────────────────────────────────────────────────
function renderMaterials(materials) {
  materialsList.innerHTML = '';
  if (!materials.length) {
    materialsList.innerHTML = '<div class="empty-materials">Noch keine PDFs</div>';
    return;
  }
  materials.forEach(m => {
    const kb   = (m.chars / 1024).toFixed(0);
    const item = document.createElement('div');
    item.className = 'material-item';
    item.innerHTML = `
      <div class="material-icon">PDF</div>
      <span class="fname" title="${esc(m.filename)}">${esc(m.filename)}</span>
      <span class="meta">${m.pages}S ${kb}k</span>
      <button class="remove-btn" data-id="${esc(m.id)}" title="Entfernen">&times;</button>
    `;
    item.querySelector('.remove-btn').addEventListener('click', async () => {
      await window.api.removeMaterial(currentModule.id, m.id);
      const s = await window.api.moduleState(currentModule.id);
      renderMaterials(s.materials);
    });
    materialsList.appendChild(item);
  });
}

async function addPdfFiles(filePaths) {
  for (const p of filePaths) {
    const filename = p.split(/[/\\]/).pop();
    const loadingEl = makePdfLoading(filename);
    materialsList.appendChild(loadingEl);

    const res = await window.api.addPdf(currentModule.id, p, filename);
    loadingEl.remove();
    if (!res.ok) {
      showError(`PDF-Fehler: ${res.error}`);
    }
  }
  const s = await window.api.moduleState(currentModule.id);
  renderMaterials(s.materials);
}

function makePdfLoading(filename) {
  const el = document.createElement('div');
  el.className = 'pdf-loading';
  el.innerHTML = `<span class="spinner"></span><span>${esc(filename)}</span>`;
  return el;
}

addPdfBtn.addEventListener('click', async () => {
  const paths = await window.api.pickFiles();
  if (paths.length) await addPdfFiles(paths);
});

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', async e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const pdfs = [...e.dataTransfer.files].filter(f => f.name.toLowerCase().endsWith('.pdf'));
  if (pdfs.length) await addPdfFiles(pdfs.map(f => f.path));
});

// ── History ───────────────────────────────────────────────────────────────────
function renderHistory(history) {
  // Remove all non-empty-state nodes then re-add the empty state
  [...chatLog.children].forEach(c => { if (c !== chatEmpty) c.remove(); });

  history.forEach(entry => {
    if (entry.role === 'user') {
      appendUserMsg(entry.content, false);
    } else if (entry.role === 'assistant') {
      appendAssistantMsg(entry.content);
    }
  });

  chatEmpty.style.display = history.length ? 'none' : '';
  scrollToBottom();
}

// ── Chat rendering ────────────────────────────────────────────────────────────
function appendUserMsg(content, animate = true) {
  chatEmpty.style.display = 'none';
  const el = document.createElement('div');
  el.className = 'msg user';
  if (!animate) el.style.animation = 'none';

  if (Array.isArray(content)) {
    // content blocks from history (image + text)
    content.forEach(block => {
      if (block.type === 'image') {
        const img = document.createElement('img');
        img.src = `data:${block.source.media_type};base64,${block.source.data}`;
        el.appendChild(img);
      } else if (block.type === 'text' && block.text) {
        const span = document.createElement('span');
        span.textContent = block.text;
        el.appendChild(span);
      }
    });
  } else {
    el.textContent = content;
  }

  chatLog.appendChild(el);
  return el;
}

function appendAssistantMsg(text, streaming = false) {
  chatEmpty.style.display = 'none';
  const el = document.createElement('div');
  el.className = 'msg assistant' + (streaming ? ' streaming' : '');

  const md = document.createElement('div');
  md.className = 'md';
  md.innerHTML = renderContent(text);
  el.appendChild(md);
  chatLog.appendChild(el);
  return el;
}

function appendErrorMsg(text) {
  const el = document.createElement('div');
  el.className = 'msg error';
  el.textContent = text;
  chatLog.appendChild(el);
  scrollToBottom();
}

function showError(text) {
  appendErrorMsg(text);
}

function scrollToBottom() {
  chatLog.scrollTop = chatLog.scrollHeight;
}

// ── Streaming ─────────────────────────────────────────────────────────────────
function beginStream() {
  streamBuf = '';
  streamEl  = appendAssistantMsg('', true);
  scrollToBottom();
}

function flushStream() {
  if (!streamEl) return;
  const md = streamEl.querySelector('.md');
  md.innerHTML = renderContent(streamBuf);
  scrollToBottom();
  rafPending = false;
}

function onDelta(delta) {
  streamBuf += delta;
  if (!rafPending) {
    rafPending = true;
    requestAnimationFrame(flushStream);
  }
}

function finalizeStream() {
  // Ensure final render without cursor
  if (streamEl) {
    const md = streamEl.querySelector('.md');
    md.innerHTML = renderContent(streamBuf);
    streamEl.classList.remove('streaming');
    streamEl = null;
    streamBuf = '';
    rafPending = false;
  }
  scrollToBottom();
}

// ── Sending ───────────────────────────────────────────────────────────────────
async function sendMessage(quizMode) {
  if (isStreaming) return;

  const text        = inputEl.value.trim();
  const imageUrl    = pendingImageUrl;  // capture before clearing
  const hasContent  = text || imageUrl || quizMode;
  if (!hasContent) return;

  setSending(true);

  // Show user message
  if (quizMode) {
    const el = appendUserMsg('5 Pruefungs-Fragen generieren', true);
    el.style.color = 'var(--text-muted)';
    el.style.fontStyle = 'italic';
  } else if (imageUrl) {
    const el = document.createElement('div');
    el.className = 'msg user';
    el.style.animation = 'none';
    const img = document.createElement('img');
    img.src = imageUrl;
    el.appendChild(img);
    if (text) {
      const span = document.createElement('span');
      span.style.display = 'block';
      span.style.marginTop = '8px';
      span.textContent = text;
      el.appendChild(span);
    }
    chatEmpty.style.display = 'none';
    chatLog.appendChild(el);
  } else {
    appendUserMsg(text, true);
  }

  // Clear input
  inputEl.value = '';
  clearImagePreview();

  beginStream();
  scrollToBottom();

  window.api.sendChat({
    moduleId:        currentModule.id,
    moduleName:      currentModule.name,
    userMessage:     text,
    userImageDataUrl: imageUrl || null,
    quizMode:        quizMode || null,
  });
}

function setSending(active) {
  isStreaming       = active;
  sendBtn.disabled  = active;
  inputEl.disabled  = active;
  quizBtn.disabled  = active;
}

// IPC events
window.api.onChatDelta(delta => onDelta(delta));

window.api.onChatDone(info => {
  finalizeStream();
  setSending(false);

  if (info && info.usage) {
    const u       = info.usage;
    const cached  = u.cache_read_input_tokens  || 0;
    const created = u.cache_creation_input_tokens || 0;
    const parts   = [
      `<b>${u.input_tokens}</b> in / <b>${u.output_tokens}</b> out`,
      cached  ? `Cache gelesen: <b>${cached}</b>`   : '',
      created ? `Cache erstellt: <b>${created}</b>` : '',
    ].filter(Boolean);
    usageBox.innerHTML   = parts.join(' &nbsp;|&nbsp; ');
    usageBox.style.display = '';
  }
});

window.api.onChatError(err => {
  finalizeStream();
  setSending(false);
  appendErrorMsg('Fehler: ' + err);
});

// ── Input handling ────────────────────────────────────────────────────────────
inputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
sendBtn.addEventListener('click', () => sendMessage());

// Auto-resize textarea
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + 'px';
});

// ── Quiz ──────────────────────────────────────────────────────────────────────
quizBtn.addEventListener('click', () => {
  if (isStreaming) return;
  sendMessage({ count: 5, focus: 'gemischt' });
});

// ── Clear history ─────────────────────────────────────────────────────────────
clearHistBtn.addEventListener('click', async () => {
  if (!confirm('Verlauf wirklich loeschen?')) return;
  await window.api.clearHistory(currentModule.id);
  [...chatLog.children].forEach(c => { if (c !== chatEmpty) c.remove(); });
  chatEmpty.style.display = '';
  usageBox.style.display  = 'none';
});

// ── Image attachment ──────────────────────────────────────────────────────────
function setImagePreview(dataUrl) {
  pendingImageUrl  = dataUrl;
  previewImg.src   = dataUrl;
  imgPreviewBar.classList.remove('hidden');
  inputEl.focus();
}

function clearImagePreview() {
  pendingImageUrl = null;
  previewImg.src  = '';
  imgPreviewBar.classList.add('hidden');
}

previewRemove.addEventListener('click', clearImagePreview);

attachBtn.addEventListener('click', () => {
  const picker     = document.createElement('input');
  picker.type      = 'file';
  picker.accept    = 'image/png,image/jpeg,image/webp,image/gif';
  picker.onchange  = () => {
    const file = picker.files[0];
    if (!file) return;
    const reader    = new FileReader();
    reader.onload   = e => setImagePreview(e.target.result);
    reader.readAsDataURL(file);
  };
  picker.click();
});

// Ctrl+V paste image into textarea
inputEl.addEventListener('paste', e => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const reader   = new FileReader();
      reader.onload  = ev => setImagePreview(ev.target.result);
      reader.readAsDataURL(item.getAsFile());
      return;
    }
  }
});

// Drag image onto textarea
inputEl.addEventListener('dragover', e => e.preventDefault());
inputEl.addEventListener('drop', e => {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (!file) return;
  if (file.type.startsWith('image/')) {
    const reader   = new FileReader();
    reader.onload  = ev => setImagePreview(ev.target.result);
    reader.readAsDataURL(file);
  }
});

// ── Settings modal ────────────────────────────────────────────────────────────
settingsBtn.addEventListener('click', async () => {
  const s = await window.api.getSettings();
  apiKeyInput.value = s.hasKey ? '(gespeichert)' : '';
  settingsModal.classList.remove('hidden');
  if (!s.hasKey) apiKeyInput.focus();
});

settingsCancel.addEventListener('click', () => settingsModal.classList.add('hidden'));

settingsSave.addEventListener('click', async () => {
  const val = apiKeyInput.value.trim();
  if (val && val !== '(gespeichert)') {
    await window.api.setApiKey(val);
  }
  settingsModal.classList.add('hidden');
});

settingsModal.addEventListener('click', e => {
  if (e.target === settingsModal) settingsModal.classList.add('hidden');
});

apiKeyInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') settingsSave.click();
  if (e.key === 'Escape') settingsCancel.click();
});

apiKeyInput.addEventListener('focus', () => {
  if (apiKeyInput.value === '(gespeichert)') apiKeyInput.value = '';
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  renderTiles();
  const s = await window.api.getSettings();
  if (!s.hasKey) {
    homeHint.textContent = 'Kein API Key gesetzt — bitte zuerst in den Einstellungen eintragen.';
  }
}

init();

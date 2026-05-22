'use strict';

const MODULES = [
  { id: 'iatprak', name: 'IAT Praktikum', examDate: '2026-06-25' },
  { id: 'iat',    name: 'IAT',            examDate: '2026-07-08' },
  { id: 'hm2',    name: 'HM II',          examDate: '2026-07-25' },
  { id: 'eet',    name: 'EET',            examDate: '2026-07-29' },
  { id: 'hm3',    name: 'HM III',         examDate: '2026-08-08' },
  { id: 'esws',   name: 'ES Workshop',    examDate: '2026-08-26' },
  { id: 'es',     name: 'ES',             examDate: '2026-09-08' },
];

const SEM_START = new Date('2026-04-14');

const SYSTEM_BASE = name =>
  `Du bist ein erfahrener Tutor fuer das Modul "${name}" an der Universitaet Karlsruhe (KIT), ` +
  `Studiengang Elektrotechnik und Informationstechnik.\n\n` +
  `Antworte praezise, in Deutsch. Bei mathematischen Inhalten nutze LaTeX: Inline mit $...$ und Block mit $$...$$. ` +
  `Wenn der Studierende eine Aufgabe stellt, fuehre den Loesungsweg Schritt fuer Schritt vor. ` +
  `Beziehe dich aktiv auf die hochgeladenen Modul-Materialien wenn relevant, zitiere mit der Datei-Bezeichnung.\n\n` +
  `Bei unklaren Fragen frage gezielt nach. Vermeide unnoetige Floskeln.`;

// ── LocalStorage helpers ──────────────────────────────────────────────────────
const LS = 'st2026:';

function lsGet(key, def = null) {
  try {
    const v = localStorage.getItem(LS + key);
    return v === null ? def : JSON.parse(v);
  } catch { return def; }
}

function lsSet(key, val) {
  try {
    localStorage.setItem(LS + key, JSON.stringify(val));
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      alert('Browser-Speicher voll. Bitte alten Verlauf oder Materialien loeschen.');
    }
  }
}

// ── Settings ──────────────────────────────────────────────────────────────────
function getApiKey() { return (lsGet('settings') || {}).apiKey || ''; }
function saveApiKey(k) { lsSet('settings', { ...lsGet('settings', {}), apiKey: k }); }

// ── Module state — materials stored in-memory (text) + localStorage (metadata)
// History stored fully in localStorage (text only, images stripped on save)
// ─────────────────────────────────────────────────────────────────────────────
const memMaterials = {}; // { [moduleId]: [{ id, filename, text, pages, chars }] }

function getMemMaterials(id) { return memMaterials[id] || []; }

function getMeta(id) { return lsGet('meta:' + id, { materials: [] }); }
function saveMeta(id, m) { lsSet('meta:' + id, m); }

function getHistory(id) { return lsGet('hist:' + id, []); }
function saveHistory(id, h) { lsSet('hist:' + id, h); }

function addMaterial(id, mat) {
  if (!memMaterials[id]) memMaterials[id] = [];
  memMaterials[id].push(mat);
  // Save metadata (no text)
  const meta = getMeta(id);
  meta.materials.push({ id: mat.id, filename: mat.filename, pages: mat.pages, chars: mat.chars });
  saveMeta(id, meta);
}

function removeMaterial(moduleId, matId) {
  if (memMaterials[moduleId]) {
    memMaterials[moduleId] = memMaterials[moduleId].filter(m => m.id !== matId);
  }
  const meta = getMeta(moduleId);
  meta.materials = meta.materials.filter(m => m.id !== matId);
  saveMeta(moduleId, meta);
}

// ── PDF extraction (pdfjs from CDN, lazy-loaded) ──────────────────────────────
let _pdfjs = null;

async function getPdfjs() {
  if (_pdfjs) return _pdfjs;
  const mod = await import(
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.min.mjs'
  );
  mod.GlobalWorkerOptions.workerSrc =
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs';
  _pdfjs = mod;
  return mod;
}

async function extractPdfText(file) {
  const pdfjs = await getPdfjs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    out += `\n\n--- Seite ${i} ---\n${tc.items.map(it => it.str).join(' ')}`;
  }
  return { text: out, pages: doc.numPages, chars: out.length };
}

// ── Content rendering (math before markdown) ──────────────────────────────────
function renderContent(text) {
  const blocks = [];
  text = text.replace(/\$\$([^$]+)\$\$/g, (_, tex) => {
    const id = blocks.length;
    try { blocks.push(katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false })); }
    catch { blocks.push(`<code>$$${esc(tex)}$$</code>`); }
    return `\x00M${id}\x00`;
  });
  text = text.replace(/\$([^$\n\r]{1,400}?)\$/g, (_, tex) => {
    const id = blocks.length;
    try { blocks.push(katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false })); }
    catch { blocks.push(`<code>${esc(tex)}</code>`); }
    return `\x00M${id}\x00`;
  });
  let html;
  try { html = marked.parse(text, { breaks: true, gfm: true }); }
  catch { html = `<p>${esc(text)}</p>`; }
  blocks.forEach((r, i) => { html = html.replace(`\x00M${i}\x00`, r); });
  return html;
}

// ── Anthropic streaming via fetch + SSE ───────────────────────────────────────
async function streamChat(payload, onDelta, onDone, onError) {
  const apiKey = getApiKey();
  if (!apiKey) { onError('Kein API Key gesetzt. Bitte oben rechts auf "API Key" tippen.'); return; }

  const mats = getMemMaterials(payload.moduleId);
  const history = getHistory(payload.moduleId);

  const system = [{ type: 'text', text: SYSTEM_BASE(payload.moduleName) }];
  if (mats.length > 0) {
    const matText = mats.map(m => `### Datei: ${m.filename}\n${m.text}`).join('\n\n');
    system.push({ type: 'text', text: `Modul-Materialien:\n\n${matText}`, cache_control: { type: 'ephemeral' } });
  }

  const messages = history.map(h => ({ role: h.role, content: h.content }));

  let newUserContent;
  if (payload.userImageDataUrl) {
    const m = payload.userImageDataUrl.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/);
    const blocks = [];
    if (m) blocks.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
    blocks.push({ type: 'text', text: payload.userMessage || 'Analysiere dieses Bild.' });
    newUserContent = blocks;
  } else if (payload.quizMode) {
    newUserContent = `Generiere ${payload.quizMode.count || 5} Pruefungs-Fragen aus den hochgeladenen Modul-Materialien. Fokus: ${payload.quizMode.focus || 'gemischt'}. Format pro Frage: nummeriert, kurzer Aufgabentext, dann auf neue Zeile "Hinweis: [Tipp wo im Material]" — aber zeige NICHT die Loesung. Am Ende: "Antworte mir mit deiner Loesung zu Frage X und ich pruefe."`;
  } else {
    newUserContent = payload.userMessage;
  }
  messages.push({ role: 'user', content: newUserContent });

  let resp;
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-allow-browser': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 8000, stream: true, system, messages }),
    });
  } catch (e) {
    onError('Netzwerkfehler: ' + e.message);
    return;
  }

  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    try { const j = await resp.json(); msg = j.error?.message || msg; } catch {}
    onError(msg);
    return;
  }

  const reader  = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '', fullText = '', inputTok = 0, outputTok = 0, cachedTok = 0, createdTok = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === '[DONE]') continue;
        try {
          const evt = JSON.parse(raw);
          if (evt.type === 'message_start') {
            const u = evt.message?.usage || {};
            inputTok   = u.input_tokens  || 0;
            cachedTok  = u.cache_read_input_tokens    || 0;
            createdTok = u.cache_creation_input_tokens || 0;
          } else if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            fullText += evt.delta.text;
            onDelta(evt.delta.text);
          } else if (evt.type === 'message_delta') {
            outputTok = evt.usage?.output_tokens || 0;
          }
        } catch {}
      }
    }
  } catch (e) {
    onError('Stream-Fehler: ' + e.message);
    return;
  }

  // Persist history (strip image data from user content to save space)
  const userEntry = {
    role: 'user',
    content: Array.isArray(newUserContent)
      ? newUserContent.map(b => b.type === 'image' ? { type: 'text', text: '[Bild]' } : b)
      : newUserContent,
    ts: Date.now(),
  };
  const assistantEntry = { role: 'assistant', content: fullText, ts: Date.now() };
  const h = getHistory(payload.moduleId);
  h.push(userEntry, assistantEntry);
  saveHistory(payload.moduleId, h);

  onDone({ usage: { input_tokens: inputTok, output_tokens: outputTok, cache_read_input_tokens: cachedTok, cache_creation_input_tokens: createdTok } });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function today() { const d = new Date(); d.setHours(0,0,0,0); return d; }
function daysUntil(ds) { const t = new Date(ds); t.setHours(0,0,0,0); return Math.round((t - today()) / 86400000); }
function fmtDate(ds) { return new Date(ds).toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric' }); }
function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2,8)}`; }

// ── State ─────────────────────────────────────────────────────────────────────
let currentModule   = null;
let pendingImageUrl = null;
let isStreaming     = false;
let streamEl        = null;
let streamBuf       = '';
let rafPending      = false;

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

const chatLog       = document.getElementById('chat-log');
const chatEmpty     = document.getElementById('chat-empty');
const imgPreviewBar = document.getElementById('image-preview-bar');
const previewImg    = document.getElementById('preview-img');
const previewRemove = document.getElementById('preview-remove');
const inputEl       = document.getElementById('input');
const attachBtn     = document.getElementById('attach-image');
const sendBtn       = document.getElementById('send');

const pdfFileInput  = document.getElementById('pdf-file-input');
const imgFileInput  = document.getElementById('img-file-input');

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
  loadModuleView();
}

brandEl.addEventListener('click', showHome);

// ── Tiles ─────────────────────────────────────────────────────────────────────
function renderTiles() {
  tilesEl.innerHTML = '';
  const now = today();

  MODULES.forEach(mod => {
    const days     = daysUntil(mod.examDate);
    const examDate = new Date(mod.examDate); examDate.setHours(0,0,0,0);

    let state, badge;
    if      (days < 0)       { state = 'done';     badge = 'Vorbei'; }
    else if (days === 0)     { state = 'today';    badge = 'Heute!'; }
    else if (days <= 7)      { state = 'urgent';   badge = `${days}d`; }
    else                     { state = 'upcoming'; badge = `${days}d`; }

    const countdown = days < 0 ? 'Fertig' : days === 0 ? 'Heute!' : `${days}d`;

    const span  = examDate - SEM_START;
    const done  = now - SEM_START;
    const pct   = Math.max(0, Math.min(100, (done / span) * 100));
    const barCl = days < 0 ? 'done' : days <= 7 ? 'urgent' : '';

    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.innerHTML = `
      <div class="tile-header">
        <div class="name">${esc(mod.name)}</div>
        <span class="badge ${state}">${badge}</span>
      </div>
      <div class="countdown ${state}">${countdown}</div>
      <div class="exam-date">Pruefung ${fmtDate(mod.examDate)}</div>
      <div class="bar-wrap"><div class="bar"><div class="bar-fill ${barCl}" style="width:${pct.toFixed(1)}%"></div></div></div>
    `;
    tile.addEventListener('click', () => showModule(mod));
    tilesEl.appendChild(tile);
  });

  const next = MODULES.find(m => daysUntil(m.examDate) >= 0);
  homeHint.textContent = next
    ? (daysUntil(next.examDate) === 0 ? `${next.name} ist heute!` : `Naechste Pruefung: ${next.name} in ${daysUntil(next.examDate)} Tagen`)
    : 'Alle Pruefungen abgeschlossen.';
}

// ── Module view ───────────────────────────────────────────────────────────────
function loadModuleView() {
  chatLog.innerHTML = '';
  chatLog.appendChild(chatEmpty);
  chatEmpty.style.display = '';
  usageBox.style.display  = 'none';
  pendingImageUrl = null;
  imgPreviewBar.classList.add('hidden');

  renderMaterials();

  const hist = getHistory(currentModule.id);
  hist.forEach(e => {
    if (e.role === 'user')      appendUserMsg(e.content, false);
    else if (e.role === 'assistant') appendAssistantMsg(e.content);
  });
  if (hist.length) chatEmpty.style.display = 'none';
  scrollBottom();
}

// ── Materials ─────────────────────────────────────────────────────────────────
function renderMaterials() {
  materialsList.innerHTML = '';
  const meta = getMeta(currentModule.id);
  const inMem = getMemMaterials(currentModule.id);

  if (!meta.materials.length) {
    materialsList.innerHTML = '<div class="empty-materials">Noch keine PDFs</div>';
    return;
  }
  meta.materials.forEach(m => {
    const loaded = inMem.some(im => im.id === m.id);
    const item = document.createElement('div');
    item.className = 'material-item';
    item.innerHTML = `
      <div class="material-icon">PDF</div>
      <span class="fname" title="${esc(m.filename)}">${esc(m.filename)}</span>
      <span class="meta">${m.pages}S ${Math.round(m.chars/1024)}k${loaded ? '' : ' ⚠︎'}</span>
      <button class="remove-btn" data-id="${esc(m.id)}">&times;</button>
    `;
    if (!loaded) item.querySelector('.fname').title += ' — nicht geladen (nach Seitenneuladung bitte erneut hochladen)';
    item.querySelector('.remove-btn').addEventListener('click', () => {
      removeMaterial(currentModule.id, m.id);
      renderMaterials();
    });
    materialsList.appendChild(item);
  });
}

async function handlePdfFiles(files) {
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.pdf')) continue;
    const loading = document.createElement('div');
    loading.className = 'pdf-loading';
    loading.innerHTML = `<span class="spinner"></span><span>${esc(file.name)}</span>`;
    materialsList.appendChild(loading);

    try {
      const { text, pages, chars } = await extractPdfText(file);
      const id = uid();
      addMaterial(currentModule.id, { id, filename: file.name, text, pages, chars });
    } catch (e) {
      appendErrorMsg(`PDF-Fehler (${esc(file.name)}): ${e.message}`);
    }
    loading.remove();
  }
  renderMaterials();
}

addPdfBtn.addEventListener('click', () => pdfFileInput.click());
pdfFileInput.addEventListener('change', () => {
  if (pdfFileInput.files.length) handlePdfFiles([...pdfFileInput.files]);
  pdfFileInput.value = '';
});

dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', async e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  const files = [...e.dataTransfer.files].filter(f => f.name.toLowerCase().endsWith('.pdf'));
  if (files.length) await handlePdfFiles(files);
});

// ── Chat rendering ────────────────────────────────────────────────────────────
function appendUserMsg(content, animate = true) {
  chatEmpty.style.display = 'none';
  const el = document.createElement('div');
  el.className = 'msg user';
  if (!animate) el.style.animation = 'none';

  if (Array.isArray(content)) {
    content.forEach(b => {
      if (b.type === 'image') {
        const img = document.createElement('img');
        img.src = `data:${b.source.media_type};base64,${b.source.data}`;
        el.appendChild(img);
      } else if (b.type === 'text' && b.text && b.text !== '[Bild]') {
        const span = document.createElement('span');
        span.style.display = 'block';
        span.textContent = b.text;
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
  scrollBottom();
}

function scrollBottom() { chatLog.scrollTop = chatLog.scrollHeight; }

// ── Streaming ─────────────────────────────────────────────────────────────────
function beginStream() {
  streamBuf = '';
  streamEl  = appendAssistantMsg('', true);
  scrollBottom();
}

function flushStream() {
  if (!streamEl) return;
  streamEl.querySelector('.md').innerHTML = renderContent(streamBuf);
  scrollBottom();
  rafPending = false;
}

function onDelta(delta) {
  streamBuf += delta;
  if (!rafPending) { rafPending = true; requestAnimationFrame(flushStream); }
}

function finalizeStream() {
  if (streamEl) {
    flushStream();
    streamEl.classList.remove('streaming');
    streamEl = null;
    streamBuf = '';
    rafPending = false;
  }
  scrollBottom();
}

// ── Sending ───────────────────────────────────────────────────────────────────
async function sendMessage(quizMode) {
  if (isStreaming) return;
  const text     = inputEl.value.trim();
  const imageUrl = pendingImageUrl;
  if (!text && !imageUrl && !quizMode) return;

  setSending(true);

  if (quizMode) {
    const el = appendUserMsg('5 Pruefungs-Fragen generieren', true);
    el.style.color = 'var(--text-muted)';
    el.style.fontStyle = 'italic';
  } else if (imageUrl) {
    const el = document.createElement('div');
    el.className = 'msg user';
    const img = document.createElement('img');
    img.src = imageUrl;
    el.appendChild(img);
    if (text) { const s = document.createElement('span'); s.style.display='block'; s.style.marginTop='8px'; s.textContent=text; el.appendChild(s); }
    chatEmpty.style.display = 'none';
    chatLog.appendChild(el);
  } else {
    appendUserMsg(text, true);
  }

  inputEl.value = '';
  inputEl.style.height = 'auto';
  clearImagePreview();
  beginStream();
  scrollBottom();

  streamChat(
    { moduleId: currentModule.id, moduleName: currentModule.name, userMessage: text, userImageDataUrl: imageUrl || null, quizMode: quizMode || null },
    delta => onDelta(delta),
    info => {
      finalizeStream();
      setSending(false);
      if (info?.usage) {
        const u = info.usage;
        const parts = [`<b>${u.input_tokens}</b> in / <b>${u.output_tokens}</b> out`];
        if (u.cache_read_input_tokens)     parts.push(`Cache gelesen: <b>${u.cache_read_input_tokens}</b>`);
        if (u.cache_creation_input_tokens) parts.push(`Cache erstellt: <b>${u.cache_creation_input_tokens}</b>`);
        usageBox.innerHTML = parts.join(' &nbsp;|&nbsp; ');
        usageBox.style.display = '';
      }
    },
    err => {
      finalizeStream();
      setSending(false);
      appendErrorMsg('Fehler: ' + err);
    },
  );
}

function setSending(v) {
  isStreaming      = v;
  sendBtn.disabled = v;
  inputEl.disabled = v;
  quizBtn.disabled = v;
}

// ── Input events ──────────────────────────────────────────────────────────────
inputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
sendBtn.addEventListener('click', () => sendMessage());
quizBtn.addEventListener('click', () => { if (!isStreaming) sendMessage({ count: 5, focus: 'gemischt' }); });

inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + 'px';
});

clearHistBtn.addEventListener('click', () => {
  if (!confirm('Verlauf wirklich loeschen?')) return;
  saveHistory(currentModule.id, []);
  [...chatLog.children].forEach(c => { if (c !== chatEmpty) c.remove(); });
  chatEmpty.style.display = '';
  usageBox.style.display  = 'none';
});

// ── Image attach ──────────────────────────────────────────────────────────────
function setImagePreview(dataUrl) {
  pendingImageUrl = dataUrl;
  previewImg.src  = dataUrl;
  imgPreviewBar.classList.remove('hidden');
}

function clearImagePreview() {
  pendingImageUrl = null;
  previewImg.src  = '';
  imgPreviewBar.classList.add('hidden');
}

previewRemove.addEventListener('click', clearImagePreview);

attachBtn.addEventListener('click', () => imgFileInput.click());
imgFileInput.addEventListener('change', () => {
  const file = imgFileInput.files[0];
  if (!file) return;
  const r = new FileReader();
  r.onload = e => setImagePreview(e.target.result);
  r.readAsDataURL(file);
  imgFileInput.value = '';
});

inputEl.addEventListener('paste', e => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const r = new FileReader();
      r.onload = ev => setImagePreview(ev.target.result);
      r.readAsDataURL(item.getAsFile());
      return;
    }
  }
});

// ── Settings modal ────────────────────────────────────────────────────────────
settingsBtn.addEventListener('click', () => {
  const k = getApiKey();
  apiKeyInput.value = k ? '(gespeichert)' : '';
  settingsModal.classList.remove('hidden');
  if (!k) apiKeyInput.focus();
});
settingsCancel.addEventListener('click', () => settingsModal.classList.add('hidden'));
settingsSave.addEventListener('click', () => {
  const v = apiKeyInput.value.trim();
  if (v && v !== '(gespeichert)') saveApiKey(v);
  settingsModal.classList.add('hidden');
});
settingsModal.addEventListener('click', e => { if (e.target === settingsModal) settingsModal.classList.add('hidden'); });
apiKeyInput.addEventListener('keydown', e => { if (e.key === 'Enter') settingsSave.click(); if (e.key === 'Escape') settingsCancel.click(); });
apiKeyInput.addEventListener('focus', () => { if (apiKeyInput.value === '(gespeichert)') apiKeyInput.value = ''; });

// ── Init ──────────────────────────────────────────────────────────────────────
renderTiles();
if (!getApiKey()) {
  homeHint.textContent = 'Kein API Key gesetzt — bitte oben rechts auf "API Key" tippen.';
}

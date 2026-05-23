const { app, BrowserWindow, ipcMain, safeStorage, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fssync = require('fs');
const OpenAI = require('openai');

const USER_DATA = app.getPath('userData');
const SETTINGS_PATH = path.join(USER_DATA, 'settings.json');
const MODULES_DIR = path.join(USER_DATA, 'modules');

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function readJSON(p, fallback) {
  try {
    const txt = await fs.readFile(p, 'utf8');
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}

async function writeJSON(p, obj) {
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, JSON.stringify(obj, null, 2), 'utf8');
}

async function getSettings() {
  const raw = await readJSON(SETTINGS_PATH, {});
  if (raw.apiKeyEnc && safeStorage.isEncryptionAvailable()) {
    try {
      raw.apiKey = safeStorage.decryptString(Buffer.from(raw.apiKeyEnc, 'base64'));
    } catch {
      raw.apiKey = '';
    }
  }
  return raw;
}

async function saveSettings(s) {
  const out = { ...s };
  if (out.apiKey && safeStorage.isEncryptionAvailable()) {
    out.apiKeyEnc = safeStorage.encryptString(out.apiKey).toString('base64');
    delete out.apiKey;
  }
  await writeJSON(SETTINGS_PATH, out);
}

function moduleDir(id) {
  return path.join(MODULES_DIR, id);
}

async function getModuleState(id) {
  const dir = moduleDir(id);
  await ensureDir(dir);
  const meta = await readJSON(path.join(dir, 'meta.json'), { materials: [] });
  const history = await readJSON(path.join(dir, 'history.json'), []);
  return { meta, history, dir };
}

async function extractPdfText(filePath) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await fs.readFile(filePath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  let out = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const txt = tc.items.map(it => it.str).join(' ');
    out += `\n\n--- Seite ${i} ---\n${txt}`;
  }
  return out;
}

async function buildSystemForModule(moduleName, meta) {
  const parts = [];
  for (const m of meta.materials) {
    if (m.text) {
      parts.push(`### Datei: ${m.filename}\n${m.text}`);
    }
  }
  return parts.join('\n\n');
}

const KIT_BASE_URL = 'https://ki-toolbox.scc.kit.edu/api/v1';
const KIT_DEFAULT_MODEL = 'azure.gpt-4.1';

const SYSTEM_BASE = (moduleName) => `Du bist ein erfahrener Tutor fuer das Modul "${moduleName}" an der Universitaet Karlsruhe (KIT), Studiengang Elektrotechnik und Informationstechnik.

Antworte praezise, in Deutsch. Bei mathematischen Inhalten nutze LaTeX: Inline mit $...$ und Block mit $$...$$. Wenn der Studierende eine Aufgabe stellt, fuehre den Loesungsweg Schritt fuer Schritt vor. Beziehe dich aktiv auf die hochgeladenen Modul-Materialien wenn relevant, zitiere mit der Datei-Bezeichnung.

Bei unklaren Fragen frage gezielt nach. Vermeide unnoetige Floskeln.`;

async function migrateFromOpencode() {
  const s = await getSettings();
  if (s.apiKey) return;
  try {
    const cfgPath = path.join(process.env.USERPROFILE || process.env.HOME, '.config', 'opencode', 'opencode.json');
    const cfg = JSON.parse(await fs.readFile(cfgPath, 'utf8'));
    const kit = cfg?.provider?.kit?.options;
    if (kit?.apiKey) {
      await saveSettings({ apiKey: kit.apiKey, baseURL: kit.baseURL || KIT_BASE_URL, model: KIT_DEFAULT_MODEL });
    }
  } catch (_) {}
}

async function streamChat(event, { moduleId, moduleName, userMessage, userImageDataUrl, quizMode }) {
  const settings = await getSettings();
  if (!settings.apiKey) {
    event.sender.send('chat:error', 'Kein API Key gesetzt. Bitte in den Einstellungen eintragen.');
    return;
  }
  const { meta, history } = await getModuleState(moduleId);
  const materialsText = await buildSystemForModule(moduleName, meta);

  let systemText = SYSTEM_BASE(moduleName);
  if (materialsText.trim()) {
    systemText += `\n\nModul-Materialien (durchsuchbar):\n\n${materialsText}`;
  }

  // Build OpenAI-format messages
  const messages = [{ role: 'system', content: systemText }];
  for (const h of history) {
    const text = typeof h.content === 'string'
      ? h.content
      : (h.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    messages.push({ role: h.role, content: text });
  }

  let newUserContent;
  if (userImageDataUrl) {
    newUserContent = [
      { type: 'image_url', image_url: { url: userImageDataUrl } },
      { type: 'text', text: userMessage && userMessage.trim() ? userMessage : 'Bitte analysiere dieses Bild im Kontext des Moduls.' },
    ];
  } else if (quizMode) {
    newUserContent = `Generiere ${quizMode.count || 5} Pruefungs-Fragen aus den hochgeladenen Modul-Materialien. Fokus: ${quizMode.focus || 'gemischt'}. Format pro Frage: nummeriert, kurzer Aufgabentext, dann auf neue Zeile "Hinweis: [Tipp wo im Material]" — aber zeige NICHT die Loesung. Am Ende: "Antworte mir mit deiner Loesung zu Frage X und ich pruefe."`;
  } else {
    newUserContent = userMessage;
  }
  messages.push({ role: 'user', content: newUserContent });

  const client = new OpenAI({
    apiKey: settings.apiKey,
    baseURL: settings.baseURL || KIT_BASE_URL,
  });

  let fullText = '';
  try {
    const stream = await client.chat.completions.create({
      model: settings.model || KIT_DEFAULT_MODEL,
      max_tokens: 8000,
      messages,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) {
        fullText += delta;
        event.sender.send('chat:delta', delta);
      }
    }

    // Persist history (store text only for portability)
    const userEntry = { role: 'user', content: typeof newUserContent === 'string' ? newUserContent : (userMessage || '[Bild]'), ts: Date.now() };
    const assistantEntry = { role: 'assistant', content: fullText, ts: Date.now() };
    history.push(userEntry, assistantEntry);
    await writeJSON(path.join(moduleDir(moduleId), 'history.json'), history);

    event.sender.send('chat:done', { usage: null });
  } catch (err) {
    event.sender.send('chat:error', err && err.message ? err.message : String(err));
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Study Tutor — SS2026',
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  await ensureDir(MODULES_DIR);
  await migrateFromOpencode();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('settings:get', async () => {
  const s = await getSettings();
  return {
    hasKey: !!s.apiKey,
    model: s.model || KIT_DEFAULT_MODEL,
    baseURL: s.baseURL || KIT_BASE_URL,
  };
});

ipcMain.handle('settings:setKey', async (_e, payload) => {
  const s = await getSettings();
  if (typeof payload === 'string') {
    s.apiKey = payload;
  } else {
    if (payload.apiKey) s.apiKey = payload.apiKey;
    if (payload.baseURL) s.baseURL = payload.baseURL;
    if (payload.model) s.model = payload.model;
  }
  await saveSettings(s);
  return true;
});

ipcMain.handle('module:state', async (_e, moduleId) => {
  const { meta, history } = await getModuleState(moduleId);
  return {
    materials: meta.materials.map(m => ({
      id: m.id, filename: m.filename, pages: m.pages, chars: m.text ? m.text.length : 0,
    })),
    history,
  };
});

ipcMain.handle('module:addPdf', async (_e, { moduleId, filePath, filename }) => {
  const dir = moduleDir(moduleId);
  await ensureDir(dir);
  let text;
  try {
    text = await extractPdfText(filePath);
  } catch (err) {
    return { ok: false, error: `PDF konnte nicht gelesen werden: ${err.message}` };
  }
  const { meta } = await getModuleState(moduleId);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  meta.materials.push({ id, filename, text, pages: (text.match(/--- Seite/g) || []).length });
  await writeJSON(path.join(dir, 'meta.json'), meta);
  return { ok: true, id, filename, chars: text.length };
});

ipcMain.handle('module:removeMaterial', async (_e, { moduleId, materialId }) => {
  const { meta } = await getModuleState(moduleId);
  meta.materials = meta.materials.filter(m => m.id !== materialId);
  await writeJSON(path.join(moduleDir(moduleId), 'meta.json'), meta);
  return true;
});

ipcMain.handle('module:clearHistory', async (_e, moduleId) => {
  await writeJSON(path.join(moduleDir(moduleId), 'history.json'), []);
  return true;
});

ipcMain.handle('dialog:pickFiles', async () => {
  const res = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  return res.canceled ? [] : res.filePaths;
});

ipcMain.on('chat:send', (event, payload) => {
  streamChat(event, payload);
});

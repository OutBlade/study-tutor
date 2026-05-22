const { app, BrowserWindow, ipcMain, safeStorage, dialog } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const fssync = require('fs');
const Anthropic = require('@anthropic-ai/sdk').default;

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

const SYSTEM_BASE = (moduleName) => `Du bist ein erfahrener Tutor fuer das Modul "${moduleName}" an der Universitaet Karlsruhe (KIT), Studiengang Elektrotechnik und Informationstechnik.

Antworte praezise, in Deutsch. Bei mathematischen Inhalten nutze LaTeX: Inline mit $...$ und Block mit $$...$$. Wenn der Studierende eine Aufgabe stellt, fuehre den Loesungsweg Schritt fuer Schritt vor. Beziehe dich aktiv auf die hochgeladenen Modul-Materialien wenn relevant, zitiere mit der Datei-Bezeichnung.

Bei unklaren Fragen frage gezielt nach. Vermeide unnoetige Floskeln.`;

async function streamChat(event, { moduleId, moduleName, userMessage, userImageDataUrl, quizMode }) {
  const settings = await getSettings();
  if (!settings.apiKey) {
    event.sender.send('chat:error', 'Kein API Key gesetzt. Bitte in den Einstellungen eintragen.');
    return;
  }
  const { meta, history } = await getModuleState(moduleId);
  const materialsText = await buildSystemForModule(moduleName, meta);

  const system = [
    { type: 'text', text: SYSTEM_BASE(moduleName) },
  ];
  if (materialsText.trim().length > 0) {
    system.push({
      type: 'text',
      text: `Modul-Materialien (durchsuchbar):\n\n${materialsText}`,
      cache_control: { type: 'ephemeral' },
    });
  }

  const messages = history.map(h => ({ role: h.role, content: h.content }));

  let newUserContent;
  if (userImageDataUrl) {
    const m = userImageDataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/);
    const blocks = [];
    if (m) {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: m[1], data: m[2] },
      });
    }
    if (userMessage && userMessage.trim()) {
      blocks.push({ type: 'text', text: userMessage });
    } else {
      blocks.push({ type: 'text', text: 'Bitte analysiere dieses Bild im Kontext des Moduls.' });
    }
    newUserContent = blocks;
  } else if (quizMode) {
    newUserContent = `Generiere ${quizMode.count || 5} Pruefungs-Fragen aus den hochgeladenen Modul-Materialien. Fokus: ${quizMode.focus || 'gemischt'}. Format pro Frage: nummeriert, kurzer Aufgabentext, dann auf neue Zeile "Hinweis: [Tipp wo im Material]" — aber zeige NICHT die Loesung. Am Ende: "Antworte mir mit deiner Loesung zu Frage X und ich pruefe."`;
  } else {
    newUserContent = userMessage;
  }
  messages.push({ role: 'user', content: newUserContent });

  const client = new Anthropic({ apiKey: settings.apiKey });

  let fullText = '';
  let usage = null;
  try {
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      system,
      messages,
    });

    stream.on('text', (delta) => {
      fullText += delta;
      event.sender.send('chat:delta', delta);
    });

    const finalMsg = await stream.finalMessage();
    usage = finalMsg.usage;

    // Persist history
    const userEntry = { role: 'user', content: newUserContent, ts: Date.now() };
    const assistantEntry = { role: 'assistant', content: fullText, ts: Date.now() };
    history.push(userEntry, assistantEntry);
    await writeJSON(path.join(moduleDir(moduleId), 'history.json'), history);

    event.sender.send('chat:done', { usage });
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
  return { hasKey: !!s.apiKey, model: s.model || 'claude-sonnet-4-6' };
});

ipcMain.handle('settings:setKey', async (_e, apiKey) => {
  const s = await getSettings();
  s.apiKey = apiKey;
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

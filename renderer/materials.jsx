// BLADE Study Tutor — Materials panel + Settings modal (IPC-wired)
const { useState: useStateM, useEffect: useEffectM, useRef: useRefM } = React;

function IconX() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 3l10 10M13 3 3 13" /></svg>;
}

function MaterialsPanel({ moduleId, module: mod }) {
  const [materials, setMaterials] = useStateM([]);
  const [dropping, setDropping] = useStateM(false);
  const [loadingName, setLoadingName] = useStateM(null);
  const fileInputRef = useRefM(null);

  const refreshMaterials = async () => {
    if (!moduleId) return;
    try {
      const state = await window.api.moduleState(moduleId);
      setMaterials(state.materials || []);
    } catch (_) {}
  };

  useEffectM(() => {
    setMaterials([]);
    refreshMaterials();
  }, [moduleId]);

  // Listen for PDF add requests from ChatPanel (via custom DOM event)
  useEffectM(() => {
    const handler = async (e) => {
      const { path, name } = e.detail;
      setLoadingName(name);
      try {
        await window.api.addPdf(moduleId, path, name);
      } finally {
        setLoadingName(null);
        refreshMaterials();
      }
    };
    window.addEventListener('blade:addPdf', handler);
    return () => window.removeEventListener('blade:addPdf', handler);
  }, [moduleId]);

  const addFiles = async (files) => {
    for (const file of files) {
      setLoadingName(file.name);
      try {
        await window.api.addPdf(moduleId, file.path, file.name);
      } finally {}
    }
    setLoadingName(null);
    refreshMaterials();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDropping(false);
    const pdfs = Array.from(e.dataTransfer.files || []).filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (pdfs.length > 0) addFiles(pdfs);
  };

  const handleFileInput = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length > 0) addFiles(files);
  };

  const handleRemove = async (materialId) => {
    await window.api.removeMaterial(moduleId, materialId);
    refreshMaterials();
  };

  return (
    <aside className="materials">
      <div className="materials-header">
        <h2>Materialien</h2>
        <div className="stat">{materials.length} PDF{materials.length !== 1 ? 's' : ''} · {mod.code}</div>
      </div>

      <div
        className="dropzone"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDropping(true); }}
        onDragLeave={() => setDropping(false)}
        onDrop={handleDrop}
        style={dropping ? { borderColor: 'var(--accent)', color: 'var(--fg-1)' } : {}}
      >
        <span className="plus">+</span>
        PDFs hier ablegen<br />
        oder klicken zum Hochladen
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileInput}
      />

      <div className="pdf-list">
        {loadingName && (
          <div className="pdf">
            <div className="pdf-icon" style={{ color: 'var(--fg-3)' }}>PDF</div>
            <div className="pdf-meta">
              <div className="pdf-name" style={{ color: 'var(--fg-3)' }}>{loadingName}</div>
              <div className="pdf-info">
                <span style={{ color: 'var(--accent)' }}>Extrahiere Text…</span>
              </div>
            </div>
          </div>
        )}
        {materials.map((m) => (
          <div className="pdf" key={m.id}>
            <div className="pdf-icon">PDF</div>
            <div className="pdf-meta">
              <div className="pdf-name" title={m.filename}>{m.filename}</div>
              <div className="pdf-info">
                <span>{m.pages} S.</span>
                {m.chars > 0 && <span>{Math.round(m.chars / 1000)}k Z.</span>}
              </div>
            </div>
            <div className="pdf-actions">
              <button className="icon-btn" title="Entfernen" onClick={() => handleRemove(m.id)}>
                <IconX />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="materials-footer">
        <div className="cache-stat">
          <span>PROMPT CACHE</span>
          <span className="v">AKTIV</span>
        </div>
        <div className="cache-bar" />
        <div className="cache-stat" style={{ marginTop: 4 }}>
          <span>MATERIALIEN</span>
          <span className="v">
            {materials.length} <span style={{ color: 'var(--fg-3)' }}>/ unbegrenzt</span>
          </span>
        </div>
      </div>
    </aside>
  );
}

const KIT_MODELS = [
  { id: 'azure.gpt-4.1', label: 'GPT-4.1 (Empfohlen)' },
  { id: 'azure.gpt-5', label: 'GPT-5' },
  { id: 'azure.gpt-4.1-mini', label: 'GPT-4.1 Mini (Schnell)' },
  { id: 'azure.o4-mini', label: 'o4-mini (Reasoning)' },
  { id: 'kit.qwen3.5-397b-A17b', label: 'Qwen 3.5 397B (Lokal)' },
];

// Settings modal (IPC-wired)
function SettingsModal({ onClose, onSaved }) {
  const [key, setKey] = useStateM('');
  const [baseURL, setBaseURL] = useStateM('https://ki-toolbox.scc.kit.edu/api/v1');
  const [model, setModel] = useStateM('azure.gpt-4.1');
  const [saving, setSaving] = useStateM(false);
  const MASK = '••••••••••••';

  useEffectM(() => {
    window.api.getSettings().then(s => {
      if (s.hasKey) setKey(MASK);
      if (s.baseURL) setBaseURL(s.baseURL);
      if (s.model) setModel(s.model);
    });
  }, []);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    const payload = { baseURL, model };
    const trimmed = key.trim();
    if (trimmed && trimmed !== MASK) payload.apiKey = trimmed;
    await window.api.setApiKey(payload);
    onSaved && onSaved(true);
    setSaving(false);
    onClose();
  };

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="eyebrow">KIT KI-Toolbox</span>
            <h2>Einstellungen</h2>
          </div>
          <button className="modal-close" onClick={onClose}><IconX /></button>
        </div>
        <div className="modal-body">
          <label className="label">API Key</label>
          <input
            className="input"
            type="password"
            value={key}
            placeholder="sk-…"
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
            onFocus={(e) => { if (e.target.value === MASK) setKey(''); }}
          />
          <p className="muted" style={{ marginTop: 8 }}>
            API Key wird mit Windows DPAPI verschlüsselt gespeichert.
          </p>

          <label className="label">Modell</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {KIT_MODELS.map(m => (
              <button
                key={m.id}
                className="btn"
                onClick={() => setModel(m.id)}
                style={model === m.id ? { borderColor: 'var(--accent)', color: 'var(--fg-0)', background: 'var(--bg-3)' } : { color: 'var(--fg-2)' }}
              >
                {model === m.id && '▸ '}{m.label}
              </button>
            ))}
          </div>

          <label className="label">Base URL</label>
          <input
            className="input"
            type="text"
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}
          />
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Abbrechen</button>
          <button className="send-btn" onClick={handleSave} style={{ opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Speichern…' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
}

window.MaterialsPanel = MaterialsPanel;
window.SettingsModal = SettingsModal;

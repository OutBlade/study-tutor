// BLADE Study Tutor — App root (IPC-wired)
const { useState: useStateApp, useEffect: useEffectApp } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#ff4d2e",
  "density": "default",
  "theme": "dark",
  "showMaterials": true,
  "diagonalEtch": true
}/*EDITMODE-END*/;

function App() {
  const { MODULES } = window.BLADE_DATA;
  const [activeId, setActiveId] = useStateApp(MODULES[0].id);
  const [settingsOpen, setSettingsOpen] = useStateApp(false);
  const [hasApiKey, setHasApiKey] = useStateApp(false);
  const tweaks = window.useTweaks ? window.useTweaks(TWEAK_DEFAULTS) : [TWEAK_DEFAULTS, () => {}];
  const [t, setTweak] = tweaks;

  const mod = MODULES.find((m) => m.id === activeId) || MODULES[0];

  useEffectApp(() => {
    window.api.getSettings().then(s => setHasApiKey(!!s.hasKey));
  }, []);

  useEffectApp(() => {
    const root = document.documentElement;
    root.style.setProperty('--accent', t.accent);
    root.style.setProperty('--accent-glow', `color-mix(in oklch, ${t.accent} 24%, transparent)`);
    root.setAttribute('data-density', t.density);
    root.setAttribute('data-theme', t.theme);
    const app = document.querySelector('.app');
    if (app) app.style.setProperty('--etch-opacity', t.diagonalEtch ? '0.5' : '0');
  }, [t.accent, t.density, t.theme, t.diagonalEtch]);

  return (
    <div className={`app${t.showMaterials ? '' : ' no-materials'}`} style={{ '--etch-opacity': t.diagonalEtch ? '0.5' : '0' }}>
      <Sidebar
        activeId={activeId}
        onSelect={setActiveId}
        onOpenSettings={() => setSettingsOpen(true)}
        hasApiKey={hasApiKey}
      />
      <ChatPanel moduleId={activeId} module={mod} />
      {t.showMaterials && <MaterialsPanel moduleId={activeId} module={mod} />}

      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onSaved={(v) => setHasApiKey(v)}
        />
      )}

      {window.TweaksPanel && (
        <window.TweaksPanel title="BLADE Tweaks">
          <window.TweakSection label="Brand">
            <window.TweakColor
              label="Accent"
              value={t.accent}
              onChange={(v) => setTweak('accent', v)}
              options={['#ff4d2e', '#D97757', '#3B82F6', '#22C55E', '#A855F7', '#E11D48', '#06B6D4']}
            />
          </window.TweakSection>
          <window.TweakSection label="Layout">
            <window.TweakRadio
              label="Theme"
              value={t.theme}
              onChange={(v) => setTweak('theme', v)}
              options={[{ label: 'Dark', value: 'dark' }, { label: 'Light', value: 'light' }]}
            />
            <window.TweakRadio
              label="Density"
              value={t.density}
              onChange={(v) => setTweak('density', v)}
              options={[{ label: 'Compact', value: 'compact' }, { label: 'Default', value: 'default' }, { label: 'Roomy', value: 'roomy' }]}
            />
            <window.TweakToggle
              label="Materialien"
              value={t.showMaterials}
              onChange={(v) => setTweak('showMaterials', v)}
            />
            <window.TweakToggle
              label="Diagonales Etch"
              value={t.diagonalEtch}
              onChange={(v) => setTweak('diagonalEtch', v)}
            />
          </window.TweakSection>
        </window.TweaksPanel>
      )}
    </div>
  );
}

// Force etch-opacity CSS var on ::before pseudo-element
const _etchStyle = document.createElement('style');
_etchStyle.textContent = `.app::before { opacity: var(--etch-opacity, 0.5) !important; }`;
document.head.appendChild(_etchStyle);

const _root = ReactDOM.createRoot(document.getElementById('root'));
_root.render(<App />);

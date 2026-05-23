// BLADE Study Tutor — Sidebar
const { useState, useEffect, useRef, useMemo } = React;

function daysBetween(dateStr) {
  const target = new Date(dateStr + 'T08:00:00');
  const now = new Date();
  return Math.ceil((target - now) / 86400000);
}

function formatDate(s) {
  const [y, m, d] = s.split('-');
  return `${d}.${m}.${y.slice(2)}`;
}

function nowStr() {
  return new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function IconBolt() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M9 1L2.5 9h4l-1 6L13 6h-4l1-5z" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconCog() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" />
    </svg>
  );
}

function Sidebar({ activeId, onSelect, onOpenSettings, hasApiKey }) {
  const { MODULES } = window.BLADE_DATA;
  const sorted = useMemo(
    () => [...MODULES].sort((a, b) => new Date(a.date) - new Date(b.date)),
    [MODULES]
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 12 L9 2 L11 6 L7 8 L13 8 L14 14 Z" />
          </svg>
        </div>
        <div className="brand-word">
          <span className="brand-logo">BLADE</span>
          <span className="brand-sub">Study Tutor · SS26</span>
        </div>
      </div>

      <div className="sidebar-section">
        <span>Prüfungen</span>
        <span className="count">{sorted.length}</span>
      </div>

      <div className="modules">
        {sorted.map((m) => {
          const days = daysBetween(m.date);
          const urgent = days <= 60;
          return (
            <div
              key={m.id}
              className={`module ${activeId === m.id ? 'active' : ''} ${urgent ? 'urgent' : ''}`}
              onClick={() => onSelect(m.id)}
            >
              <div className="module-code">{m.code}</div>
              <div className="module-meta">
                <div className="module-name">{m.name}</div>
                <div className="module-date">{formatDate(m.date)}</div>
              </div>
              <div className="module-days">
                <span className="n">{days}</span>
                <span className="l">Tage</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="sidebar-footer">
        <div className="api-status" onClick={onOpenSettings}>
          <span className="dot" style={{ background: hasApiKey ? 'var(--ok)' : 'var(--fg-3)', boxShadow: hasApiKey ? '0 0 10px var(--ok)' : 'none' }} />
          <span>{hasApiKey ? 'API verbunden' : 'Kein API Key'}</span>
        </div>
        <button className="icon-btn" onClick={onOpenSettings} aria-label="Einstellungen">
          <IconCog />
        </button>
      </div>
    </aside>
  );
}

window.Sidebar = Sidebar;
window.bladeHelpers = { daysBetween, formatDate, nowStr };

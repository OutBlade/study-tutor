// BLADE Study Tutor — Chat panel (IPC-wired)
const { useState: useStateChat, useEffect: useEffectChat, useRef: useRefChat } = React;

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  return '';
}

function historyToMessages(history) {
  return (history || []).map(h => ({
    role: h.role,
    time: h.ts ? new Date(h.ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '--:--',
    text: contentToText(h.content),
    streaming: false,
    cached: false,
  }));
}

function renderRichText(text, refEl) {
  if (!refEl || text == null) return;
  const html = window.marked.parse(String(text), { breaks: true });
  refEl.innerHTML = html;
  if (window.renderMathInElement) {
    window.renderMathInElement(refEl, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
      ],
      throwOnError: false,
    });
  }
}

function MessageBody({ text }) {
  const ref = useRefChat(null);
  useEffectChat(() => { renderRichText(text, ref.current); }, [text]);
  return <div className="msg-content" ref={ref} />;
}

function Message({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`msg${isUser ? ' user' : ''}`}>
      <div className={`msg-avatar ${isUser ? 'user' : 'ai'}`} aria-hidden="true">
        {isUser ? 'DU' : 'B'}
      </div>
      <div className="msg-body">
        <div className="msg-meta">
          <span className="who">{isUser ? 'Du' : 'Blade'}</span>
          <span>·</span>
          <span>{msg.time}</span>
          {msg.cached && <span className="cache">CACHE HIT</span>}
          {msg.streaming && (
            <span className="cache" style={{ color: 'var(--accent)', borderColor: 'var(--accent)' }}>
              STREAMING
            </span>
          )}
        </div>
        <MessageBody text={msg.text} />
        {msg.streaming && <span className="stream-cursor" />}
      </div>
    </div>
  );
}

function IconPaperclip() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M10.5 3.5 5 9a2 2 0 1 0 2.83 2.83l5.67-5.66a3.5 3.5 0 1 0-4.95-4.95L3 6.5" /></svg>;
}
function IconImage() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="3" width="12" height="10" rx="0.5" /><circle cx="6" cy="7" r="1" /><path d="M2 11l3.5-3 3 2.5L11 8l3 3" /></svg>;
}
function IconArrow() {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8 13V3M3 8l5-5 5 5" /></svg>;
}
function IconTrash() {
  return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 4h10M5 4V2.5h6V4M5 4l.6 9h4.8L11 4M7 7v4M9 7v4" /></svg>;
}

function Composer({ onSend, onPdfPick, busy }) {
  const [text, setText] = useStateChat('');
  const [dropping, setDropping] = useStateChat(false);
  const [imgAttachment, setImgAttachment] = useStateChat(null);
  const taRef = useRefChat(null);
  const imgInputRef = useRefChat(null);

  useEffectChat(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(180, ta.scrollHeight) + 'px';
  }, [text]);

  const submit = () => {
    if (busy || (!text.trim() && !imgAttachment)) return;
    onSend(text, imgAttachment);
    setText('');
    setImgAttachment(null);
  };

  const handleImgFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => setImgAttachment({ name: file.name, dataUrl: e.target.result });
    reader.readAsDataURL(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDropping(false);
    const files = Array.from(e.dataTransfer.files || []);
    const pdfs = files.filter(f => f.name.toLowerCase().endsWith('.pdf'));
    const imgs = files.filter(f => (f.type || '').startsWith('image/'));
    if (pdfs.length > 0) onPdfPick(pdfs);
    if (imgs.length > 0) handleImgFile(imgs[0]);
  };

  const canSend = !busy && (!!text.trim() || !!imgAttachment);

  return (
    <div className="composer-wrap">
      <div
        className={`composer${dropping ? ' dropping' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDropping(true); }}
        onDragLeave={() => setDropping(false)}
        onDrop={handleDrop}
      >
        {imgAttachment && (
          <div className="composer-attach-row">
            <div className="attachment-chip">
              <span className="thumb">IMG</span>
              <span>{imgAttachment.name}</span>
              <span className="close" onClick={() => setImgAttachment(null)}>×</span>
            </div>
          </div>
        )}
        <textarea
          ref={taRef}
          className="composer-textarea"
          placeholder="Frage an Blade — Enter senden, Shift+Enter neue Zeile, PDF hier ablegen…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
        />
        <div className="composer-bar">
          <button className="icon-btn" title="PDF zu Materialien hinzufügen" onClick={() => onPdfPick(null)}>
            <IconPaperclip />
          </button>
          <button className="icon-btn" title="Bild anhängen" onClick={() => imgInputRef.current?.click()}>
            <IconImage />
          </button>
          <input
            ref={imgInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            style={{ display: 'none' }}
            onChange={(e) => { handleImgFile(e.target.files[0]); e.target.value = ''; }}
          />
          <span className="hint">
            <span className="kbd">Enter</span> Senden &nbsp;
            <span className="kbd">⇧ Enter</span> Zeile
          </span>
          <button className={`send-btn${canSend ? '' : ' disabled'}`} onClick={submit}>
            <span>Senden</span>
            <IconArrow />
          </button>
        </div>
      </div>
    </div>
  );
}

function ChatPanel({ moduleId, module: mod }) {
  const [messages, setMessages] = useStateChat([]);
  const [busy, setBusy] = useStateChat(false);
  const scrollRef = useRefChat(null);
  const streamTextRef = useRefChat('');
  const rafPendingRef = useRefChat(false);

  // Load chat history when module changes
  useEffectChat(() => {
    if (!moduleId) return;
    setMessages([]);
    setBusy(false);
    streamTextRef.current = '';
    window.api.moduleState(moduleId).then(({ history }) => {
      setMessages(historyToMessages(history));
    });
  }, [moduleId]);

  // Register IPC stream listeners once at mount
  useEffectChat(() => {
    window.api.onChatDelta((delta) => {
      streamTextRef.current += delta;
      if (!rafPendingRef.current) {
        rafPendingRef.current = true;
        requestAnimationFrame(() => {
          rafPendingRef.current = false;
          const txt = streamTextRef.current;
          setMessages(prev => {
            if (!prev.length) return prev;
            const msgs = [...prev];
            const last = msgs[msgs.length - 1];
            if (last && last.streaming) {
              msgs[msgs.length - 1] = { ...last, text: txt };
            }
            return msgs;
          });
        });
      }
    });

    window.api.onChatDone(() => {
      setBusy(false);
      setMessages(prev => {
        if (!prev.length) return prev;
        const msgs = [...prev];
        const last = msgs[msgs.length - 1];
        if (last && last.streaming) {
          msgs[msgs.length - 1] = { ...last, streaming: false };
        }
        return msgs;
      });
    });

    window.api.onChatError((err) => {
      setBusy(false);
      setMessages(prev => [
        ...prev.filter(m => !m.streaming),
        { role: 'assistant', time: window.bladeHelpers.nowStr(), text: `Fehler: ${err}`, streaming: false },
      ]);
    });
  }, []);

  // Auto-scroll to bottom on new messages
  useEffectChat(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const doSend = (userText, imgAttachment, quizMode) => {
    const displayText = quizMode ? '5 Prüfungsfragen generieren…' : userText;
    const userMsg = { role: 'user', time: window.bladeHelpers.nowStr(), text: displayText, streaming: false };
    const placeholder = { role: 'assistant', time: window.bladeHelpers.nowStr(), streaming: true, text: '' };
    streamTextRef.current = '';
    setMessages(prev => [...prev, userMsg, placeholder]);
    setBusy(true);
    window.api.sendChat({
      moduleId,
      moduleName: mod.name,
      userMessage: quizMode ? '' : userText,
      userImageDataUrl: imgAttachment ? imgAttachment.dataUrl : null,
      quizMode: quizMode ? { count: 5 } : false,
    });
  };

  const handleSend = (text, imgAttachment) => doSend(text, imgAttachment, false);
  const handleSendQuiz = () => { if (!busy) doSend('', null, true); };
  const handleClearHistory = async () => {
    await window.api.clearHistory(moduleId);
    setMessages([]);
  };

  // PDF files from Composer — broadcast to MaterialsPanel via custom event
  const handlePdfPick = (files) => {
    if (files && files.length > 0) {
      // Called from drop with File objects (Electron provides .path)
      Array.from(files).forEach(file => {
        window.dispatchEvent(new CustomEvent('blade:addPdf', { detail: { path: file.path, name: file.name } }));
      });
    } else {
      // Called from button — open system dialog
      window.api.pickFiles().then(paths => {
        paths.forEach(p => {
          const name = p.split(/[\\/]/).pop();
          window.dispatchEvent(new CustomEvent('blade:addPdf', { detail: { path: p, name } }));
        });
      });
    }
  };

  const days = window.bladeHelpers.daysBetween(mod.date);

  return (
    <section className="main">
      <header className="topbar">
        <div className="topbar-title">
          <h1>{mod.name}</h1>
          <span className="full">{mod.full}</span>
        </div>
        <div className="exam-countdown">
          <span className="pip" />
          <span>Klausur</span>
          <span style={{ color: 'var(--fg-3)' }}>{window.bladeHelpers.formatDate(mod.date)}</span>
          <span style={{ color: 'var(--fg-3)' }}>·</span>
          <span className="days">T-{days}</span>
        </div>
        <div className="topbar-actions">
          <button className="btn-accent btn" onClick={handleSendQuiz} disabled={busy} style={{ opacity: busy ? 0.5 : 1 }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M3 8l3-5 4 8 3-5" />
            </svg>
            5 Klausurfragen
          </button>
          <button className="btn btn-ghost btn-icon-only" title="Verlauf löschen" onClick={handleClearHistory}>
            <IconTrash />
          </button>
        </div>
      </header>

      <div className="chat-wrap" ref={scrollRef}>
        <div className="chat-stream">
          {messages.length === 0 && (
            <div className="empty" style={{ margin: '60px auto', maxWidth: 360 }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>&#128218;</div>
              <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--fg-1)', marginBottom: 6 }}>
                Bereit zum Lernen
              </div>
              <div style={{ fontSize: 13, color: 'var(--fg-3)', lineHeight: 1.6 }}>
                Stelle eine Frage oder lade PDFs in die Materialien. Klausurfragen werden aus deinen Unterlagen generiert.
              </div>
            </div>
          )}
          {messages.map((m, i) => <Message key={i} msg={m} />)}
        </div>
      </div>

      <Composer onSend={handleSend} onPdfPick={handlePdfPick} busy={busy} />
    </section>
  );
}

window.ChatPanel = ChatPanel;

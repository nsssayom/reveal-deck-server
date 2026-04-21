(function () {
  const cfg = window.__MULTIPLEX__;
  if (!cfg || !cfg.deckId || typeof io === 'undefined') return;

  // The speaker-view page hosts the deck in an iframe and drives it directly
  // via contentWindow.Reveal. In that context we don't want a second socket
  // or the keyboard handler — the parent owns both.
  if (window.top !== window.self) return;

  const roomId = cfg.deckId;
  const socket = io({ transports: ['websocket', 'polling'] });

  function attach() {
    if (typeof Reveal === 'undefined' || typeof Reveal.on !== 'function') {
      return setTimeout(attach, 50);
    }

    socket.on('connect', () => socket.emit('multiplex-follow', { id: roomId }));
    socket.on(`sync:${roomId}`, (msg) => {
      if (msg && msg.state) {
        try { Reveal.setState(msg.state); } catch {}
      }
    });

    try {
      Reveal.configure({ controls: false, keyboard: false, touch: false });
    } catch {}

    // Keep one local shortcut: F to toggle fullscreen.
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'f' && e.key !== 'F') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target && e.target.tagName) || '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      e.preventDefault();
      const el = document.documentElement;
      if (!document.fullscreenElement) {
        (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
      } else {
        (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
      }
    });

    const badge = document.createElement('div');
    badge.textContent = 'follower';
    Object.assign(badge.style, {
      position: 'fixed',
      bottom: '8px',
      left: '8px',
      zIndex: '99999',
      padding: '2px 8px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: '11px',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      background: '#2f4056',
      color: '#fff',
      borderRadius: '3px',
      opacity: '0.55',
      pointerEvents: 'none',
      userSelect: 'none',
    });
    document.body.appendChild(badge);
  }

  attach();
})();

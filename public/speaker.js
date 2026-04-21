(function () {
  const deckMatch = location.pathname.match(/\/speaker\/([^/?#]+)/);
  const deckId = deckMatch ? decodeURIComponent(deckMatch[1]) : '';
  if (!deckId) return;

  const params = new URLSearchParams(location.search);
  const secret = params.get('secret') || '';

  const $ = (id) => document.getElementById(id);
  const body        = document.body;
  const root        = document.documentElement;
  const deckNameEl  = $('deckName');
  const counterEl   = $('counter');
  const timerEl     = $('timer');
  const timerBtn    = $('timerToggle');
  const notesEl     = $('notes');
  const prevBtn     = $('prev');
  const nextBtn     = $('next');
  const connEl      = $('conn');
  const frame       = $('deck');
  const fontDown    = $('fontDown');
  const fontUp      = $('fontUp');
  const fullBtn     = $('fullscreenBtn');
  const splitter    = $('splitter');
  const workspace   = $('workspace');
  const layoutBtns  = Array.from(document.querySelectorAll('.seg-btn[data-layout]'));

  document.title = `Speaker · ${deckId}`;
  deckNameEl.textContent = deckId;
  frame.src = `/decks/${encodeURIComponent(deckId)}/`;

  /* ===================================================================
     Persistent state
     =================================================================== */
  const STORE_KEY = 'speaker-view.v1';
  const defaults = { layout: 'wide', deckPct: 62, notesSize: 17 };
  let state;
  try { state = Object.assign({}, defaults, JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); }
  catch { state = Object.assign({}, defaults); }

  const saveState = () => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
  };

  const applyLayout = () => {
    body.dataset.layout = state.layout;
    layoutBtns.forEach((b) => b.classList.toggle('active', b.dataset.layout === state.layout));
  };
  const applyDeckPct = () => root.style.setProperty('--deck-pct', `${state.deckPct}%`);
  const applyNotesSize = () => root.style.setProperty('--notes-size', `${state.notesSize}px`);

  applyLayout();
  applyDeckPct();
  applyNotesSize();

  /* ===================================================================
     Socket
     =================================================================== */
  const socket = io({ transports: ['websocket', 'polling'] });
  const setConn = (cls) => { connEl.className = `conn-indicator ${cls}`; };
  socket.on('connect',       () => setConn('ok'));
  socket.on('disconnect',    () => setConn('bad'));
  socket.on('connect_error', () => setConn('bad'));

  const getReveal = (f) => {
    try { return f.contentWindow && f.contentWindow.Reveal; }
    catch { return null; }
  };

  function sendState() {
    const R = getReveal(frame);
    if (!R || typeof R.getState !== 'function') return;
    try {
      const payload = { id: deckId, state: R.getState() };
      if (secret) payload.secret = secret;
      socket.emit('multiplex-statechanged', payload);
    } catch {}
  }

  function updateNotesAndCounter() {
    const R = getReveal(frame);
    if (!R) return;
    try {
      const past  = typeof R.getSlidePastCount === 'function' ? R.getSlidePastCount() : 0;
      const total = typeof R.getTotalSlides === 'function'   ? R.getTotalSlides()   : 0;
      counterEl.textContent = total ? `${past + 1} / ${total}` : '—';

      const slide = R.getCurrentSlide && R.getCurrentSlide();
      const notes = slide ? slide.querySelector('aside.notes') : null;
      const html  = notes ? notes.innerHTML.trim() : '';
      notesEl.innerHTML = html || '<em class="empty">No notes.</em>';
      notesEl.scrollTop = 0;
    } catch {}
  }

  function onMainReady() {
    const R = getReveal(frame);
    if (!R) return;
    const events = [
      'slidechanged', 'fragmentshown', 'fragmenthidden',
      'overviewshown', 'overviewhidden', 'paused', 'resumed',
    ];
    events.forEach((ev) => R.on(ev, () => { sendState(); updateNotesAndCounter(); }));
    sendState();
    updateNotesAndCounter();
  }

  function waitForReveal(f, cb) {
    const R = getReveal(f);
    if (!R || typeof R.on !== 'function') { setTimeout(() => waitForReveal(f, cb), 80); return; }
    if (R.isReady && R.isReady()) cb();
    else R.on('ready', cb);
  }
  frame.addEventListener('load', () => waitForReveal(frame, onMainReady));

  /* ===================================================================
     Layout switcher
     =================================================================== */
  layoutBtns.forEach((b) => {
    b.addEventListener('click', () => {
      state.layout = b.dataset.layout;
      applyLayout();
      saveState();
    });
  });

  /* ===================================================================
     Font size
     =================================================================== */
  const setNotesSize = (px) => {
    state.notesSize = Math.max(12, Math.min(30, px));
    applyNotesSize();
    saveState();
  };
  fontDown.addEventListener('click', () => setNotesSize(state.notesSize - 1));
  fontUp.addEventListener('click',   () => setNotesSize(state.notesSize + 1));

  /* ===================================================================
     Resizable splitter (mouse + touch + keyboard)
     =================================================================== */
  let dragging = false;
  const clampPct = (p) => Math.max(20, Math.min(85, p));

  // Derive orientation from the splitter's rendered shape so the mobile
  // media-query fallback doesn't desync from state.layout.
  function isHorizontalSplit() {
    const r = splitter.getBoundingClientRect();
    return r.height > r.width;
  }

  function pointerToPct(e) {
    const r = workspace.getBoundingClientRect();
    return isHorizontalSplit()
      ? clampPct(((e.clientX - r.left) / r.width)  * 100)
      : clampPct(((e.clientY - r.top)  / r.height) * 100);
  }

  function onPointerMove(e) {
    if (!dragging) return;
    state.deckPct = pointerToPct(e);
    applyDeckPct();
    e.preventDefault();
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove('dragging');
    frame.style.pointerEvents = '';
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    saveState();
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup',   endDrag);
    window.removeEventListener('pointercancel', endDrag);
  }

  splitter.addEventListener('pointerdown', (e) => {
    if (state.layout === 'reader') return;
    dragging = true;
    splitter.classList.add('dragging');
    // Freeze iframe pointer so the deck doesn't swallow the drag
    frame.style.pointerEvents = 'none';
    document.body.style.cursor = isHorizontalSplit() ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove',   onPointerMove);
    window.addEventListener('pointerup',     endDrag);
    window.addEventListener('pointercancel', endDrag);
    e.preventDefault();
  });

  splitter.addEventListener('keydown', (e) => {
    if (state.layout === 'reader') return;
    const step = e.shiftKey ? 5 : 2;
    let delta = 0;
    if (isHorizontalSplit()) {
      if (e.key === 'ArrowLeft')  delta = -step;
      if (e.key === 'ArrowRight') delta =  step;
    } else {
      if (e.key === 'ArrowUp')    delta = -step;
      if (e.key === 'ArrowDown')  delta =  step;
    }
    if (e.key === 'Home') { state.deckPct = 50; applyDeckPct(); saveState(); e.preventDefault(); return; }
    if (delta) {
      state.deckPct = clampPct(state.deckPct + delta);
      applyDeckPct();
      saveState();
      e.preventDefault();
    }
  });

  /* ===================================================================
     Timer — click to pause, double-click to reset
     =================================================================== */
  let t0 = Date.now(), paused = false, pausedAt = 0, pausedAccum = 0;
  function renderTimer() {
    const s = paused
      ? Math.floor((pausedAt - t0 - pausedAccum) / 1000)
      : Math.floor((Date.now() - t0 - pausedAccum) / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, '0');
    const ss = String(s % 60).padStart(2, '0');
    timerEl.textContent = `${mm}:${ss}`;
  }
  setInterval(renderTimer, 500);
  renderTimer();

  timerBtn.addEventListener('click', () => {
    if (!paused) { paused = true; pausedAt = Date.now(); timerBtn.classList.add('paused'); }
    else         { pausedAccum += Date.now() - pausedAt; paused = false; timerBtn.classList.remove('paused'); }
    renderTimer();
  });
  timerBtn.addEventListener('dblclick', (e) => {
    e.preventDefault();
    t0 = Date.now(); pausedAccum = 0;
    if (paused) { pausedAt = t0; }
    renderTimer();
  });

  /* ===================================================================
     Navigation + keyboard
     =================================================================== */
  prevBtn.addEventListener('click', () => { const R = getReveal(frame); if (R) try { R.prev(); } catch {} });
  nextBtn.addEventListener('click', () => { const R = getReveal(frame); if (R) try { R.next(); } catch {} });

  fullBtn.addEventListener('click', () => {
    const el = document.documentElement;
    if (!document.fullscreenElement) {
      (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target && e.target.tagName) || '';
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
    const R = getReveal(frame);
    if (!R) return;
    try {
      switch (e.key) {
        case 'ArrowRight': case 'PageDown': case ' ': R.next(); e.preventDefault(); break;
        case 'ArrowLeft':  case 'PageUp':             R.prev(); e.preventDefault(); break;
        case 'ArrowDown': R.down(); e.preventDefault(); break;
        case 'ArrowUp':   R.up();   e.preventDefault(); break;
        case '.':         R.togglePause && R.togglePause(); e.preventDefault(); break;
        case 'f': case 'F': fullBtn.click(); e.preventDefault(); break;
        case '+': case '=': setNotesSize(state.notesSize + 1); e.preventDefault(); break;
        case '-': case '_': setNotesSize(state.notesSize - 1); e.preventDefault(); break;
      }
    } catch {}
  });
})();

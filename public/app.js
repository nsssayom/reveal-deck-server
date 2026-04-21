(async function () {
  const list = document.getElementById('decks');
  const empty = document.getElementById('empty');
  const footer = document.getElementById('footer');

  let secretRequired = false;
  try {
    const cfg = await fetch('/api/config').then((r) => r.json());
    secretRequired = !!cfg.secretRequired;
  } catch {}

  footer.textContent = secretRequired
    ? "Server requires a master secret — you'll be prompted when opening speaker view."
    : 'Server is running with no master secret — anyone on the network can drive a deck.';

  try {
    const resp = await fetch('/api/decks');
    const decks = await resp.json();
    list.removeAttribute('aria-busy');
    if (!decks.length) { empty.hidden = false; return; }

    for (const d of decks) {
      const li = document.createElement('li');

      const name = document.createElement('a');
      name.href = `/decks/${encodeURIComponent(d)}/`;
      name.textContent = d;
      name.className = 'deck-name';
      name.title = 'Open presentation view (follower)';

      const actions = document.createElement('span');
      actions.className = 'deck-actions';

      const present = document.createElement('a');
      present.href = `/decks/${encodeURIComponent(d)}/`;
      present.textContent = 'Presentation';
      present.className = 'deck-link';

      const speaker = document.createElement('a');
      speaker.href = `/speaker/${encodeURIComponent(d)}`;
      speaker.textContent = 'Speaker';
      speaker.className = 'deck-link deck-link-speaker';
      speaker.addEventListener('click', (e) => {
        if (!secretRequired) return;
        e.preventDefault();
        const entered = window.prompt(`Master secret for "${d}"`);
        if (!entered) return;
        const q = new URLSearchParams({ secret: entered });
        window.open(`/speaker/${encodeURIComponent(d)}?${q}`, '_blank');
      });

      actions.append(present, speaker);
      li.append(name, actions);
      list.append(li);
    }
  } catch (err) {
    list.removeAttribute('aria-busy');
    empty.textContent = `Failed to list decks: ${err.message}`;
    empty.hidden = false;
  }
})();

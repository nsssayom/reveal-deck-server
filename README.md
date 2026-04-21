# reveal-deck-server

Serve multiple reveal.js decks from one host, and drive one device (laptop,
TV) from another (phone, tablet, second laptop) over Socket.IO. Single-user
setup — no accounts, no tenants, optional shared master secret.

```
reveal-deck-server/
├── server.mjs              Express + Socket.IO relay
├── package.json
├── .env.sample             copy to .env to configure
├── public/
│   ├── index.html          landing page that lists decks/
│   ├── app.js              landing-page client
│   ├── style.css
│   └── multiplex.js        self-wiring plugin injected into every deck
└── decks/                  drop deck folders here
    └── my-talk/            each folder must contain index.html
        ├── index.html
        ├── slides.html
        ├── css/
        └── figures/
```

## Run

```
npm install
npm start
```

By default the server runs without a master secret — anyone on the network
who knows the URL can drive a deck. That's fine for a personal server on a
trusted LAN/VPN. If you want auth, copy `.env.sample` to `.env` and set
`DECK_SECRET`:

```
cp .env.sample .env
$EDITOR .env       # uncomment DECK_SECRET=…
npm start
```

`server.mjs` loads `.env` via `dotenv` at startup; no extra script needed.

Options (all overridable via `.env` or shell env):

| env           | default     | notes                                                   |
| ------------- | ----------- | ------------------------------------------------------- |
| `PORT`        | `3000`      |                                                         |
| `HOST`        | `0.0.0.0`   | bind address                                            |
| `DECKS_DIR`   | `./decks`   | absolute or relative to the server's `cwd`              |
| `DECK_SECRET` | *(unset)*   | if set, master URLs must include `?master=1&secret=…`   |

Open `http://<server>:3000/` — you'll see every folder under `decks/` that
contains an `index.html`.

## Display vs control

Each deck's folder name is its room id. No deck code changes are required;
the server rewrites `index.html` on the fly to include Socket.IO and the
multiplex bootstrap.

The landing page at `http://server:3000/` lists every deck with two links:

- **Presentation view** — the screen the audience looks at (follower):
  `http://server:3000/decks/my-talk/`
- **Speaker view** — the device you drive the deck from (master):
  `http://server:3000/speaker/my-talk`
  (the landing page will prompt for the secret and append
  `?secret=<DECK_SECRET>` when the server requires one)

The speaker view is its own page — the deck renders in the left pane, and
the right pane holds notes, a timer (click to pause, double-click to
reset), a slide counter, and prev/next buttons. On narrow screens the
notes take the top of the viewport and the deck shrinks to a bottom
preview, so it works on a phone. Old `?speaker=1` links redirect to the
new URL.

Followers have keyboard, mouse, and touch navigation disabled so stray
input can't desync them. One local shortcut is kept: press **`F`** on the
follower to toggle browser fullscreen (Esc exits, as usual). A follower
that connects mid-session receives the last known state immediately, so
it catches up without you having to resend.

## How the sync works

The server implements the same protocol shape as the original
[`reveal/multiplex`](https://github.com/reveal/multiplex):

1. Master subscribes to Reveal events (`slidechanged`, `fragmentshown`,
   etc.) and emits `multiplex-statechanged` with `{id, state}` (plus
   `secret` when configured).
2. If `DECK_SECRET` is set, the server verifies
   `sha256(secret) === sha256(DECK_SECRET)` in constant time. Either way
   it strips the secret and re-emits `sync:<id>` to every follower joined
   to that deck's room.
3. Followers receive `sync:<id>` and call `Reveal.setState(state)`.

Rooms are keyed on the deck's folder name, so two decks on the same server
can run independent sessions at once without any extra configuration.

## Adding a deck

Drop the deck folder into `decks/`. A deck is anything with an `index.html`
at its root that initializes Reveal — for example:

```
cp -R /path/to/presentation  decks/my-talk
```

Refresh the landing page. No edits to the deck are needed.

The speaker view reads notes directly from each slide's
`<aside class="notes">…</aside>` block. The deck doesn't need to load
reveal's `RevealNotes` plugin — the speaker page scrapes the notes itself.

## Limitations

- Trust model: with no `DECK_SECRET`, anyone on the network with the URL
  can drive. With one set, anyone holding it can drive. There are no
  per-user accounts. Put it behind a VPN or Tailscale if that matters.
- The replay cache is in-memory — restarting the server drops it, and a
  mid-session follower will then see a blank deck until the master
  advances once.
- `Reveal.setState` syncs slide index, fragment index, overview, and pause
  state. Free-form clicks, scrolls inside iframes, and HTML video play
  state are not part of reveal state and don't sync.

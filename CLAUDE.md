# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PromptVault is a static SPA for storing and organizing personal prompts. It lives entirely in Puter (each user sees their own isolated data) but falls back to a localStorage demo mode when served outside Puter.

- **Language:** Spanish UI
- **Stack:** Pure HTML + CSS + JS. No build step, no bundler, no package manager.
- **Dependencies:** Puter.js v2 (CDN), Fuse.js (vendored)

## Local Development

No build step is required. To run locally:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`. The app detects it is not running inside Puter and enters demo mode using `localStorage`.

`.claude/launch.json` also carries a `promptvault-node` configuration (`npx http-server` on 8081) for machines without Python.

`debug.html` is the diagnostic page. It loads Puter.js (it used to not, which is why its "Puter.js" card always reported *No*) and its **Ubicación real en Puter** card prints `puter.env`, the user, and the absolute path `stat('PromptVault')` resolves to. Open it from the `puter.site` site and from inside Puter — `register-app.html` can register a throwaway `promptvault-debug` app pointing at it — to compare the two.

There are no linters or formatters configured. Tests live in `tests.html` — a self-contained browser suite over `storage.js` in localStorage mode. Open `http://localhost:8080/tests.html` and press **Ejecutar tests**; every case must pass before deploying. Note the dev server sends no cache headers, so bump the port (or hard-reload) after editing a `.js`/`.css` file or the browser will happily re-run the old one.

## Deployment

Live at **https://witty-meerkat-9381.puter.site**. Each `puter site deploy` creates a fresh `/Ahiram1701/Sites/witty-meerkat-9381/deployment (N)` and repoints the subdomain at it; `puter.hosting.get('witty-meerkat-9381').root_dir.path` tells you which one is live.

Deploy with the script, which stages a clean `dist/` and publishes it via the official Puter CLI:

```bash
./deploy.ps1
```

One-time setup: `npm install -g @heyputer/cli` then `puter login`. For CI, set `PUTER_AUTH_TOKEN` instead of logging in.

`deploy.ps1` deploys only what `index.html` actually references (plus `debug.html` / `tests.html`); the dead backups (`app.full.js`, `app.js.v0.9.bak`, `.app.js.bak-pre-v0.9.3`) are deliberately excluded. Afterwards it walks **every file in `dist/`, subdirectories included**, and SHA-256s it against the same path on the live site.

**The Puter CLI flattens subdirectories.** Verified on both 0.1.2 and 0.2.0: deploying a tree uploads every file into the site root, so `vendor/xlsx.full.min.js` was served at `/xlsx.full.min.js` while `index.html` asked for `./vendor/xlsx.full.min.js` — a 404 that silently cost production both Excel import/export and fuzzy search. `deploy.ps1` therefore stages the vendored libs flat in `dist/` and rewrites those two `<script src>` paths **in the `dist/` copy only**; the repo keeps `vendor/`, so local dev is unaffected. The old verification loop only checked the six root files, which is why this shipped unnoticed — never narrow it back to a hardcoded list.

**Do not deploy by pasting file contents through a tool that re-encodes text.** Doing so silently converts literal `\uXXXX` escapes in the source into the raw characters they denote — this already corrupted `app.js` once. The CLI uploads bytes from disk and is immune to it.

Each visitor authenticates with their own Puter account and sees only their data.

## Script Load Order

`index.html` loads scripts in this exact order:

1. `https://js.puter.com/v2/` (CDN)
2. `./vendor/fuse.min.js`
3. `./storage.js`
4. `./app.js`

`storage.js` must load before `app.js` because `app.js` calls `window.PromptVaultStorage` during bootstrap.

## High-Level Architecture

### Dual-Backend Persistence (`storage.js`)

`storage.js` exposes `window.PromptVaultStorage` with two backends:

- **`PuterBackend`** — Uses `global.puter.fs` (mkdir, read, write, delete, rename). Stores data under `~/PromptVault/prompts/`.

  **The root is resolved, not assumed.** Puter's docs say non-absolute paths resolve against "the app's root directory", and that a registered app is sandboxed to `~/AppData/<app-id>/` — which would make `'PromptVault/prompts'` mean different folders in the website and in the app. **Measured, that is not what happens here:** opening the registered app on this account (still serving the old relative-path code) listed the real prompts, so both contexts resolve to the same place. `resolvePuterRoot()` is therefore a guard, not a migration — it pins the root once: the absolute `.path` from `stat('PromptVault')` when the folder already exists, which is the branch that actually fires and keeps today's behaviour byte-for-byte; otherwise, in app mode, `puter.perms.request('folder', …)` for the home-dir folder; and only then the bare relative name. It exists so that a future change in how Puter assigns app roots can't silently split the two. Every path comes from `await puterPaths()`; the old `PUTER_PROMPTS_DIR` / `PUTER_INDEX_PATH` / `PUTER_BACKUPS_DIR` constants are gone because they would hardcode an assumption. `_invalidateRoot()` is separate from `_invalidateCache()` on purpose: the root only goes stale on a session change, and resetting it per write would cost a `stat` on every save.
- **`LocalBackend`** — Uses `localStorage`. Keys are prefixed with `promptvault:`.

At runtime the host is auto-detected in `app.js` bootstrap via `puterAvailable()` (is `puter.fs` usable?) and `puterSignedIn()` (`puter.auth.isSignedIn()`, when the SDK exposes it). If the SDK has no `auth.isSignedIn`, bootstrap stays optimistic and lets `loadAll` probe for real, falling back to `'local'` on a `PUTER_AUTH:` error.

### Two Hosts: Website vs Registered Puter App

PromptVault runs in two shapes and `app.js` branches on `puter.env`:

- **`'web'`** — served from `*.puter.site` or localhost. The user signs in through the topbar cloud button; `connectPuter()` / `disconnectPuter()` are the whole story.
- **`'app'` / `'gui'`** — running inside the Puter desktop as the registered app `promptvault` (`https://puter.com/app/promptvault`). `isPuterApp()` is the single predicate for this; everything else derives from it.

In app mode: the session is already resolved by the handshake with the parent window, so `bootstrap()` sets `state.host = 'puter'` **without** consulting `auth.isSignedIn()`; `updateConnectionUI()` hides `#puter-connect` and says "app de Puter"; and `openMoreMenu()` must not offer "Cerrar sesión de Puter" — that session belongs to the parent window and signing out would just break the app. `bootstrap()` also sets `data-puter-app` on `<html>`, which `styles.css` uses to hide `h1.topbar-title` (the Puter window already has a title bar).

The app entry itself is metadata only: `app-manifest.js` holds it and `register-app.html` pushes it with `puter.apps.create()` / `update()`. `indexURL` points at the same `puter.site` deployment, **so registering changes nothing about how you ship** — it is still `./deploy.ps1`. Both files are dev tools and are deliberately absent from `deploy.ps1`'s `$files`.

Two consequences worth knowing before reaching for the CLI or deleting the site:

- **The Puter CLI cannot register an app.** `puter app` is read-only (`list`, `get`) as of 0.3.0 — it deploys sites and workers, not apps. Registration only happens from a page with an authenticated `puter` object: `register-app.html`, the Dev Center at `puter.com/app/dev-center`, or `puter.apps.*` from any signed-in page.
- **The site is not optional.** Puter loads `indexURL` in an iframe; it never keeps a copy of the code. `witty-meerkat-9381.puter.site` *is* the app. Delete the subdomain and the app window loads nothing.

**Two browser APIs are avoided in app mode as a precaution** — neither has been observed failing against the live app, but both fail *silently* if the iframe sandbox does block them, which is why they were not left to chance. `window.confirm` can return `false` without asking, which would make deleting a prompt quietly do nothing; every confirmation goes through `confirmDialog()`, which uses `puter.ui.alert` in app mode and `window.confirm` outside. `XLSX.writeFile` downloads via an `<a download>` that a sandbox can block, so `exportExcel()` switches to `puter.ui.showSaveFilePicker`; `startImportExcel()` is the mirror image with `showOpenFilePicker`, and is also what `filetypeAssociations: ['.xlsx']` + `puter.ui.onLaunchedWithItems` feed. If you ever confirm the sandbox actually permits these, the native paths are still the better UX — don't revert them, just correct this note.

`bindPuterAppEvents()` is one-shot like `bindEvents()` — never call it twice.

### Connecting / Disconnecting from Puter (`app.js`)

`updateConnectionUI()` is the single source of truth for connection state: it sets the `#status` text and shows/hides the `#puter-connect` topbar button (hidden when already on Puter or when the SDK is absent). Call it instead of writing `#status` directly.

- **`connectPuter()`** — bound to `#puter-connect`. `puter.auth.signIn()` **must be the first `await`** in the handler; any earlier `await` loses the user gesture and the browser blocks the popup. Handles `popup_blocked` and `auth_window_closed` distinctly. Then invalidates `PuterBackend._invalidateCache()` (its 30 s cache may hold the failed pre-auth result), loads the cloud, and — if local prompts exist — offers to merge them via `mergeById()` (union by `id`, latest `updatedAt` wins). `state.host` must be set to `'puter'` **before** `persistAll()`, which reads it to pick the backend. On failure it rolls back to `'local'` with the original items.
- **`disconnectPuter()`** — pushed into the `openMoreMenu()` action list only when `state.host === 'puter'`.
- **`reloadAfterHostChange()`** — re-renders after a backend switch. It must never call `bindEvents()` or `bindKeyboardViewport()`, which are one-shot and would double-bind every listener.

Note `flashHint()` writes to `#save-hint`, which lives inside `#editor-form` and is hidden whenever no prompt is selected (and on the whole list view on mobile). It now falls back to `toast()` — a floating `#toast` element appended to `<body>` — whenever the inline hint is not visible, or whenever the message is an error. Pass `inlineOnly = true` for routine chatter (the autosave "Guardado") that should simply not be announced when the editor is off-screen. For connection state use `setStatus()` / `updateConnectionUI()` instead, which own the topbar.

`.status` is `display: none` on mobile, so any connection affordance must be a button, not status text.

The storage API consumed by `app.js` is:

- `loadAll(host)` → `{ items: Prompt[], index: { host, count, updatedAt } }`
- `saveAll(items, host)` — bulk save that diffs against the backend: puts new/updated items, deletes items no longer in the array
- `backup(host)` — silent auto-backup on load; also triggered manually from the UI

### Data Model

Each prompt is a JSON object:

```js
{ id, title, body, tags: string[], favorite: boolean, createdAt, updatedAt }
```

**Puter file layout** (under the root that `resolvePuterRoot()` pins, normally `~/PromptVault/`):
- `~/PromptVault/prompts/<id>.json` — one file per prompt
- `~/PromptVault/prompts/index.json` — array of `ids` with `updatedAt`
- `~/PromptVault/Backups/<iso-stamp>/manifest.json` + `items.json`

**LocalStorage layout:**
- `promptvault:index` — array of `ids` with `updatedAt`
- `promptvault:prompt:<id>` — individual prompt JSON
- `promptvault:backup` — latest snapshot
- `promptvault:backups` — last 5 backup metadata entries

### In-Memory State + Debounced Saves (`app.js`)

`app.js` keeps the source of truth in `state.items` (an in-memory array). Edits in the form trigger `onFormChange`, which:

1. Mutates the corresponding item in `state.items`
2. Calls `updateListItem(item)` to patch only that `<li>` in the DOM (avoids re-rendering the whole list on every keystroke)
3. Calls `refreshTagFilterOptionsPreservingValue()` to repopulate the tag `<select>` without losing the current selection
4. Calls `scheduleSave()`, which debounces `persistAll()` by **600 ms**

`persistAll()` writes the entire `state.items` array to the backend via `saveAll`. This diff-based bulk save avoids full overwrites of unchanged items.

Three rules keep that debounce from eating data — all three were violated at some point and each cost a real edit:

- **Never drop a save.** When `persistAll()` is called while `state.saveInFlight`, it sets `state.saveQueued` and re-runs once the current write finishes. Returning early instead means the user's last keystroke — or a deletion — never reaches the backend, and nothing schedules a retry.
- **`cancelPendingSave()` must not touch `saveInFlight`.** That flag tracks a real write in progress; clearing it lets two `saveAll` calls interleave their read-modify-write of `index.json`, so the slower one resurrects prompts the faster one just deleted. `storage.js` also serializes `saveAll` through `_saveChain` as a second line of defence.
- **Prefer `flushPendingSave()` over `cancelPendingSave()`.** `selectPrompt()` used to cancel, which discarded the pending edit of the prompt you were leaving. Cancelling is only correct where the caller immediately calls `persistAll()` itself (create, delete, import), since that writes all of `state.items` anyway.

`bindEvents()` also flushes on `visibilitychange` (hidden) and `pagehide`: on mobile the tab can be frozen or killed without ever firing `beforeunload`. Neither of those fires when a **Puter window** is closed, so `bindPuterAppEvents()` adds a fourth net: `puter.ui.onWindowClose` awaits `flushPendingSave()` and only then calls `puter.ui.exit()`. Without it, closing the app right after typing dropped the last edit with the 600 ms timer.

### `[hidden]` and CSS `display`

`styles.css` starts with `[hidden] { display: none !important; }`. It has to: `[hidden]` only comes from the user-agent stylesheet, so any author rule that sets `display` (`.editor-form { display: flex }`, `.empty-editor { display: flex }`, `.app { display: grid }`) silently overrides it and the element keeps rendering with `hidden = true`. That is how the editor form and the "select a prompt" empty state ended up painted on top of each other.

The flip side: with that rule in place, an element whose visibility CSS owns must not be left with a stale `hidden` attribute in `index.html`. `#new-fab` was — nothing ever cleared it, and the FAB only appeared because the `[hidden]` was being overridden. `bootstrap()` now clears it alongside `els.app.hidden = false`; the media queries still decide whether it actually shows.

### Mobile View Switching

The UI uses a single-view pattern on mobile controlled by `data-view="list"` or `data-view="editor"` on `#app`:

- **List view** — sidebar with search, tag filter, and prompt list
- **Editor view** — form with title, tags, body, favorite checkbox

On desktop both panes are visible side-by-side. On mobile, selecting a prompt switches to editor view and shows a back button.

### Selective Rendering Optimizations

To keep typing responsive:

- `updateListItem(item)` — finds the existing `<li>` by `data-id` and updates only its title and meta text.
- `refreshTagFilterOptionsPreservingValue()` — rebuilds the `<select>` options but restores the previously selected value if the tag still exists.
- Full `renderList()` only runs on filter changes, search input, creation, or deletion.

### Fuzzy Search

Fuse.js is initialized once in `buildFuse()` with `state.items` as the collection. On search:

- If a tag filter or favorites filter is active, the Fuse collection is reset to the already-filtered subset via `state.fuse.setCollection(base)`.
- Otherwise it searches the full index.

Keys and weights: `title` (0.6), `body` (0.3), `tags` (0.1). Threshold: 0.4.

### Theme

Dark mode is default. Theme is toggled via `data-theme` on `<html>` and persisted in `localStorage` under `promptvault-theme`. The switch is handled entirely in `app.js` (`setTheme` / `toggleTheme`).

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

There are no tests, linters, or formatters configured in this repo.

## Deployment

Deployed by uploading the folder to Puter (`puter.hosting`) and assigning a subdomain (e.g. `promptvault.puter.site`). Each visitor authenticates with their own Puter account and sees only their data.

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
- **`LocalBackend`** — Uses `localStorage`. Keys are prefixed with `promptvault:`.

At runtime the host is auto-detected in `app.js` bootstrap: `'puter'` if `window.puter` is defined, otherwise `'local'`.

The storage API consumed by `app.js` is:

- `loadAll(host)` → `{ items: Prompt[], index: { host, count, updatedAt } }`
- `saveAll(items, host)` — bulk save that diffs against the backend: puts new/updated items, deletes items no longer in the array
- `backup(host)` — silent auto-backup on load; also triggered manually from the UI

### Data Model

Each prompt is a JSON object:

```js
{ id, title, body, tags: string[], favorite: boolean, createdAt, updatedAt }
```

**Puter file layout:**
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

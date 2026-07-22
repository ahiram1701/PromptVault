// PromptVault — capa de persistencia.
// v0.8: reconcilia el contrato con app.js (loadAll/saveAll/backup).
// Mantiene backends 'puter' (puter.fs) y 'local' (localStorage) ya existentes
// y añade la API agregada que app.js espera:
//   - loadAll()         -> { items: Prompt[], index: { host, count, updatedAt, backend? } }
//   - saveAll(items)    -> persiste todos los prompts vía put/delete
//   - backup()          -> { copies: number, snapshot, mirror? }
(function (global) {
  'use strict';

  // Puter.js v2: paths relativos al home del usuario (sin '~').
  var PUTER_ROOT = 'PromptVault';
  var PUTER_PROMPTS_DIR = PUTER_ROOT + '/prompts';
  var PUTER_INDEX_PATH = PUTER_PROMPTS_DIR + '/index.json';
  var PUTER_BACKUPS_DIR = PUTER_ROOT + '/Backups';
  var LOCAL_INDEX_KEY = 'promptvault:index';
  var LOCAL_BACKUP_KEY = 'promptvault:backup'; // snapshot más reciente
  var LOCAL_BACKUP_HISTORY_KEY = 'promptvault:backups'; // historial ligero (últimos 5)
  var LOCAL_PROMPT_KEY = function (id) { return 'promptvault:prompt:' + id; };

  function nowIso() { return new Date().toISOString(); }
  function backupStamp() {
    // Seguro para usar como segmento de path y como localStorage key.
    return new Date().toISOString().replace(/[:.]/g, '-');
  }
  function newId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID();
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  // -------------------- helpers Puter --------------------
  async function puterEnsureDirs() {
    if (!global.puter || !global.puter.fs) throw new Error('Puter.fs no disponible');
    var dirs = [PUTER_ROOT, PUTER_PROMPTS_DIR, PUTER_BACKUPS_DIR];
    for (var i = 0; i < dirs.length; i++) {
      try { await global.puter.fs.mkdir(dirs[i]); }
      catch (err) {
        var msg = (err && err.message) || String(err);
        // Ignorar "ya existe"; cualquier otro error es fatal.
        if (/already exist|already exists|exist/i.test(msg)) continue;
        throw err;
      }
    }
  }
  async function puterReadText(path) {
    try {
      var data = await global.puter.fs.read(path);
      if (data == null) return null;
      if (typeof data === 'string') return data;
      if (data instanceof Blob) return await data.text();
      if (data && typeof data.text === 'function') return await data.text();
      return JSON.stringify(data);
    } catch (err) {
      var msg = (err && err.message) || String(err);
      // Errores de autenticación / sesión NO deben confundirse con "archivo no existe".
      if (/Subject does not exist|not authenticated|auth|unauthorized|forbidden|401|403/i.test(msg)) {
        throw new Error('PUTER_AUTH: ' + msg);
      }
      // Puter.js v2 lanza mensajes distintos según versión/estado.
      if (/Entry not found|not found|ENOENT|No such file|Can'?t find/i.test(msg)) return null;
      throw err;
    }
  }
  function isRetryablePuterError(err) {
    var msg = (err && err.message) || String(err);
    return /network|timeout|offline|fetch|aborted|ECONNRESET|ETIMEDOUT|ENOTFOUND|503|502|504/i.test(msg);
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  async function puterWriteAtomic(path, text) {
    // Puter.js v2: escribimos directamente. Retry con backoff para errores transitorios.
    var lastErr = null;
    for (var attempt = 0; attempt < 3; attempt++) {
      try {
        await global.puter.fs.write(path, text);
        return;
      } catch (err) {
        lastErr = err;
        if (!isRetryablePuterError(err)) throw err;
        if (attempt < 2) {
          var delay = 500 * Math.pow(2, attempt); // 500, 1000, 2000
          console.warn('puterWriteAtomic: reintentando', path, 'en', delay, 'ms', err);
          await sleep(delay);
        }
      }
    }
    throw lastErr;
  }
  async function puterListFromIndex() {
    var text = await puterReadText(PUTER_INDEX_PATH);
    if (!text) return { ids: [], updatedAt: null };
    try {
      var idx = JSON.parse(text);
      if (!idx || !Array.isArray(idx.ids)) return { ids: [], updatedAt: null };
      return idx;
    } catch (_) { return { ids: [], updatedAt: null }; }
  }
  async function puterWriteIndex(ids) {
    var payload = JSON.stringify({ ids: ids, updatedAt: nowIso() }, null, 2);
    await puterWriteAtomic(PUTER_INDEX_PATH, payload);
  }
  async function puterCopyTo(srcPath, destPath) {
    // puter.fs.copy conserva contenido entre rutas; fallback a read+write si no existe.
    if (global.puter.fs.copy) {
      try { await global.puter.fs.copy(srcPath, destPath); return; }
      catch (_) { /* fallback abajo */ }
    }
    var text = await puterReadText(srcPath);
    if (text == null) return;
    await puterWriteAtomic(destPath, text);
  }

  // -------------------- backend Puter --------------------
  var PuterBackend = {
    name: 'puter',
    _cache: null,
    _cacheAt: 0,
    _CACHE_TTL: 30000,
    _invalidateCache() { this._cache = null; this._cacheAt = 0; },
    async list() {
      if (this._cache && (Date.now() - this._cacheAt) < this._CACHE_TTL) {
        return this._cache.slice();
      }
      await puterEnsureDirs();
      var idx = await puterListFromIndex();
      var out = [];
      for (var i = 0; i < idx.ids.length; i++) {
        var id = idx.ids[i];
        var path = PUTER_PROMPTS_DIR + '/' + id + '.json';
        var text = await puterReadText(path);
        if (!text) continue;
        try { out.push(JSON.parse(text)); } catch (_) {}
      }
      this._cache = out.slice();
      this._cacheAt = Date.now();
      return out;
    },
    async get(id) {
      var text = await puterReadText(PUTER_PROMPTS_DIR + '/' + id + '.json');
      return text ? JSON.parse(text) : null;
    },
    async put(prompt) {
      var next = sanitizePrompt(prompt);
      if (!next) throw new Error('Prompt inválido: falta id');
      await puterEnsureDirs();
      var now = nowIso();
      next.createdAt = next.createdAt || now;
      next.updatedAt = now;
      var path = PUTER_PROMPTS_DIR + '/' + next.id + '.json';
      await puterWriteAtomic(path, JSON.stringify(next, null, 2));
      var idx = await puterListFromIndex();
      if (idx.ids.indexOf(next.id) === -1) idx.ids.push(next.id);
      idx.updatedAt = now;
      await puterWriteIndex(idx.ids);
      this._invalidateCache();
      return next;
    },
    async delete(id) {
      var path = PUTER_PROMPTS_DIR + '/' + id + '.json';
      try { await global.puter.fs.delete(path); }
      catch (err) {
        var msg = (err && err.message) || String(err);
        if (!/not found|does not exist|ENOENT|No such file/i.test(msg)) throw err;
      }
      var idx = await puterListFromIndex();
      var before = idx.ids.length;
      idx.ids = idx.ids.filter(function (x) { return x !== id; });
      if (idx.ids.length !== before) await puterWriteIndex(idx.ids);
      this._invalidateCache();
      return true;
    },
    async exportAll() {
      var items = await this.list();
      return JSON.stringify({ version: 1, exportedAt: nowIso(), items: items }, null, 2);
    },
    async importAll(jsonText) {
      var data = JSON.parse(jsonText);
      var items = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
      var imported = 0;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it || typeof it !== 'object') continue;
        await this.put(Object.assign({}, it, { id: it.id || newId() }));
        imported += 1;
      }
      return imported;
    },
  };

  function localStorageSafeSet(key, value) {
    try {
      global.localStorage.setItem(key, value);
    } catch (err) {
      if (err && (err.name === 'QuotaExceededError' || /quota|exceeded|storage/i.test(err.message))) {
        throw new Error('STORAGE_FULL: No hay espacio suficiente en localStorage. Elimina prompts o exporta datos.');
      }
      throw err;
    }
  }

  // -------------------- backend Local --------------------
  var LocalBackend = {
    name: 'local',
    _cache: null,
    _cacheAt: 0,
    _CACHE_TTL: 30000,
    _invalidateCache() { this._cache = null; this._cacheAt = 0; },
    _readIndex() {
      try {
        var raw = global.localStorage.getItem(LOCAL_INDEX_KEY);
        if (!raw) return { ids: [], updatedAt: null };
        var idx = JSON.parse(raw);
        if (!idx || !Array.isArray(idx.ids)) return { ids: [], updatedAt: null };
        return idx;
      } catch (_) { return { ids: [], updatedAt: null }; }
    },
    _writeIndex(ids) {
      localStorageSafeSet(LOCAL_INDEX_KEY, JSON.stringify({ ids: ids, updatedAt: nowIso() }));
    },
    async list() {
      if (this._cache && (Date.now() - this._cacheAt) < this._CACHE_TTL) {
        return this._cache.slice();
      }
      var idx = this._readIndex();
      var out = [];
      for (var i = 0; i < idx.ids.length; i++) {
        var id = idx.ids[i];
        var raw = global.localStorage.getItem(LOCAL_PROMPT_KEY(id));
        if (!raw) continue;
        try { out.push(JSON.parse(raw)); } catch (_) {}
      }
      this._cache = out.slice();
      this._cacheAt = Date.now();
      return out;
    },
    async get(id) {
      var raw = global.localStorage.getItem(LOCAL_PROMPT_KEY(id));
      return raw ? JSON.parse(raw) : null;
    },
    async put(prompt) {
      var next = sanitizePrompt(prompt);
      if (!next) throw new Error('Prompt inválido: falta id');
      var now = nowIso();
      next.createdAt = next.createdAt || now;
      next.updatedAt = now;
      localStorageSafeSet(LOCAL_PROMPT_KEY(next.id), JSON.stringify(next));
      var idx = this._readIndex();
      if (idx.ids.indexOf(next.id) === -1) idx.ids.push(next.id);
      idx.updatedAt = now;
      this._writeIndex(idx.ids);
      this._invalidateCache();
      return next;
    },
    async delete(id) {
      global.localStorage.removeItem(LOCAL_PROMPT_KEY(id));
      var idx = this._readIndex();
      var before = idx.ids.length;
      idx.ids = idx.ids.filter(function (x) { return x !== id; });
      if (idx.ids.length !== before) this._writeIndex(idx.ids);
      this._invalidateCache();
      return true;
    },
    async exportAll() {
      var items = await this.list();
      return JSON.stringify({ version: 1, exportedAt: nowIso(), items: items }, null, 2);
    },
    async importAll(jsonText) {
      var data = JSON.parse(jsonText);
      var items = Array.isArray(data) ? data : (Array.isArray(data.items) ? data.items : []);
      var imported = 0;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it || typeof it !== 'object') continue;
        await this.put(Object.assign({}, it, { id: it.id || newId() }));
        imported += 1;
      }
      return imported;
    },
  };

  // -------------------- API agregada (loadAll/saveAll/backup) --------------------
  async function loadAll(host) {
    var backend = host === 'puter' ? PuterBackend : LocalBackend;
    var items = [];
    var updatedAt = null;
    try {
      items = await backend.list();
    } catch (err) {
      var msg = (err && err.message) || String(err);
      // Errores de autenticación deben propagarse para que bootstrap haga fallback.
      if (/PUTER_AUTH|Subject does not exist|not authenticated|auth/i.test(msg)) throw err;
      console.warn('loadAll: backend.list falló, devolviendo vacío', err);
      items = [];
    }
    if (backend === LocalBackend) {
      var idx = LocalBackend._readIndex();
      updatedAt = idx && idx.updatedAt ? idx.updatedAt : null;
    } else if (backend === PuterBackend) {
      try {
        var pIdx = await puterListFromIndex();
        updatedAt = pIdx && pIdx.updatedAt ? pIdx.updatedAt : null;
      } catch (_) { updatedAt = null; }
    }
    return {
      items: items,
      index: {
        host: backend.name,
        count: items.length,
        updatedAt: updatedAt,
        backend: backend.name,
      },
    };
  }

  function sanitizePrompt(item) {
    if (!item || typeof item !== 'object') return null;
    var id = (item.id != null) ? String(item.id).trim() : '';
    if (!id) return null;
    var title = String(item.title || '').trim().slice(0, 500);
    var body = String(item.body || '').slice(0, 100000);
    var favorite = !!item.favorite;
    var tags = [];
    if (Array.isArray(item.tags)) {
      for (var t = 0; t < item.tags.length && tags.length < 50; t++) {
        var tag = String(item.tags[t]).trim().toLowerCase().slice(0, 50);
        if (tag) tags.push(tag);
      }
    }
    var createdAt = (item.createdAt != null) ? String(item.createdAt) : nowIso();
    var updatedAt = (item.updatedAt != null) ? String(item.updatedAt) : nowIso();
    return { id: id, title: title, body: body, tags: tags, favorite: favorite, createdAt: createdAt, updatedAt: updatedAt };
  }

  function shallowEqual(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.title !== b.title) return false;
    if (a.body !== b.body) return false;
    if (a.favorite !== b.favorite) return false;
    var ta = (a.tags || []).join(',');
    var tb = (b.tags || []).join(',');
    if (ta !== tb) return false;
    return true;
  }

  async function saveAll(items, host) {
    var backend = host === 'puter' ? PuterBackend : LocalBackend;
    var incoming = Array.isArray(items) ? items : [];

    // 1) Obtener IDs actuales del índice (sin leer todo el contenido).
    var currentIds = [];
    try {
      if (backend === PuterBackend) {
        var pIdx = await puterListFromIndex();
        currentIds = pIdx.ids || [];
      } else {
        var lIdx = LocalBackend._readIndex();
        currentIds = lIdx.ids || [];
      }
    } catch (_) { currentIds = []; }

    // 2) Sanitizar y deduplicar incoming.
    var incomingById = {};
    var deduped = [];
    var seen = new Set();
    for (var j = 0; j < incoming.length; j++) {
      var it = sanitizePrompt(incoming[j]);
      if (!it || !it.id || seen.has(it.id)) continue;
      seen.add(it.id);
      incomingById[it.id] = it;
      deduped.push(it);
    }
    incoming = deduped;

    // 3) Para items existentes, leer solo los que necesitamos comparar (diff real).
    var currentById = {};
    for (var k = 0; k < incoming.length; k++) {
      var item = incoming[k];
      if (currentIds.indexOf(item.id) !== -1) {
        try {
          currentById[item.id] = await backend.get(item.id);
        } catch (_) { /* si falla la lectura, asumimos que hay que re-escribir */ }
      }
    }

    // 4) put nuevos o modificados.
    var saved = 0;
    var lastErr = null;
    for (var m = 0; m < incoming.length; m++) {
      var item = incoming[m];
      var existing = currentById[item.id];
      if (existing && shallowEqual(item, existing)) continue;
      try {
        await backend.put(item);
        saved++;
      } catch (err) {
        lastErr = err;
        console.warn('saveAll: fallo al guardar item', item.id, err);
      }
    }

    // 5) delete los que ya no estén.
    for (var n = 0; n < currentIds.length; n++) {
      var cid = currentIds[n];
      if (!incomingById[cid]) {
        try { await backend.delete(cid); }
        catch (err) { console.warn('saveAll: fallo al borrar item', cid, err); }
      }
    }

    if (lastErr) throw lastErr;
    return { count: saved };
  }

  async function backup(host) {
    var backend = host === 'puter' ? PuterBackend : LocalBackend;
    var stamp = backupStamp();
    var items = await backend.list();
    var snapshot = {
      version: 1,
      exportedAt: nowIso(),
      host: backend.name,
      items: items,
    };
    var copies = 0;

    if (backend === LocalBackend) {
      var text = JSON.stringify(snapshot, null, 2);
      try {
        localStorageSafeSet(LOCAL_BACKUP_KEY, text);
        copies += 1;
      } catch (err) {
        console.warn('backup local: no se pudo escribir snapshot', err);
      }
      // historial ligero (últimos 5)
      try {
        var rawH = global.localStorage.getItem(LOCAL_BACKUP_HISTORY_KEY);
        var history = rawH ? JSON.parse(rawH) : [];
        if (!Array.isArray(history)) history = [];
        history.unshift({ at: snapshot.exportedAt, count: items.length });
        if (history.length > 5) history = history.slice(0, 5);
        localStorageSafeSet(LOCAL_BACKUP_HISTORY_KEY, JSON.stringify(history));
      } catch (_) { /* no crítico */ }
      return { copies: copies, snapshot: snapshot };
    }

    // Puter: copia espejo en ~/PromptVault/Backups/<stamp>/
    if (!global.puter || !global.puter.fs) {
      return { copies: 0, snapshot: snapshot };
    }
    try {
      await puterEnsureDirs();
      var destDir = PUTER_BACKUPS_DIR + '/' + stamp;
      try { await global.puter.fs.mkdir(destDir); }
      catch (err) {
        var msg = (err && err.message) || String(err);
        if (!/already exist|already exists|exist/i.test(msg)) throw err;
      }
      var manifest = JSON.stringify({
        version: 1,
        exportedAt: snapshot.exportedAt,
        itemCount: items.length,
      }, null, 2);
      await puterWriteAtomic(destDir + '/manifest.json', manifest);
      await puterWriteAtomic(destDir + '/items.json', JSON.stringify(items, null, 2));
      copies += 1;
    } catch (err) {
      console.warn('backup puter: no se pudo crear snapshot', err);
    }
    return { copies: copies, snapshot: snapshot, mirror: PUTER_BACKUPS_DIR };
  }

  // -------------------- factory --------------------
  function selectBackend(host) { return host === 'puter' ? PuterBackend : LocalBackend; }
  function makeStorage(host) {
    var backend = selectBackend(host);
    return {
      host: backend.name,
      // API por item (ya estaba)
      list: function () { return backend.list(); },
      get: function (id) { return backend.get(id); },
      put: function (prompt) { return backend.put(prompt); },
      delete: function (id) { return backend.delete(id); },
      exportAll: function () { return backend.exportAll(); },
      importAll: function (text) { return backend.importAll(text); },
      backend: backend,
    };
  }

  global.PromptVaultStorage = global.PromptVaultStorage || {
    make: makeStorage,
    loadAll: loadAll,
    saveAll: saveAll,
    backup: backup,
    newId: newId,
    backends: { puter: PuterBackend, local: LocalBackend },
    _internals: {
      PUTER_ROOT: PUTER_ROOT,
      PUTER_PROMPTS_DIR: PUTER_PROMPTS_DIR,
      PUTER_INDEX_PATH: PUTER_INDEX_PATH,
      PUTER_BACKUPS_DIR: PUTER_BACKUPS_DIR,
      LOCAL_INDEX_KEY: LOCAL_INDEX_KEY,
      LOCAL_BACKUP_KEY: LOCAL_BACKUP_KEY,
      LOCAL_BACKUP_HISTORY_KEY: LOCAL_BACKUP_HISTORY_KEY,
      newId: newId,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);

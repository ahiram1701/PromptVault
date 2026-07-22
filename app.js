// PromptVault — entry point.
// v0.6: UX móvil mejorada — swipe-to-go-back, swipe actions en lista,
// bottom sheet, textarea auto-expandible, empty state prominente,
// ripple effect, haptic feedback, toggle filtros, optimización con teclado.

(function () {
  'use strict';

  // ---------- estado y refs DOM ----------
  const els = {
    status: document.getElementById('status'),
    app: document.getElementById('app'),
    list: document.getElementById('prompt-list'),
    promptList: document.getElementById('prompt-list'),
    search: document.getElementById('search'),
    tagFilter: document.getElementById('tag-filter'),
    showFav: document.getElementById('show-favorites'),
    newBtn: document.getElementById('new-prompt'),
    newFab: document.getElementById('new-fab'),
    backBtn: document.getElementById('back-to-list'),
    moreBtn: document.getElementById('more-menu'),
    exportExcelBtn: document.getElementById('export-excel'),
    importExcelBtn: document.getElementById('import-excel'),
    importExcelFile: document.getElementById('import-excel-file'),
    backupBtn: document.getElementById('backup-now'),
    title: document.getElementById('prompt-title'),
    body: document.getElementById('prompt-body'),
    tags: document.getElementById('prompt-tags'),
    tagsField: document.getElementById('tags-field'),
    fav: document.getElementById('prompt-favorite'),
    deleteBtn: document.getElementById('delete-prompt'),
    saveHint: document.getElementById('save-hint'),
    emptyEditor: document.getElementById('empty-editor'),
    editorForm: document.getElementById('editor-form'),
    themeToggle: document.getElementById('theme-toggle'),
    copyBody: document.getElementById('copy-body'),
    filterToggle: document.getElementById('filter-toggle'),
    filters: document.getElementById('filters')
  };

  const state = {
    host: 'local',
    items: [],
    index: null,
    selectedId: null,
    fuse: null,
    filter: { q: '', tag: '', onlyFav: false },
    saveTimer: null,
    initialized: false,
    saveInFlight: false
  };

  // ---------- helpers ----------
  function setStatus(text) { if (els.status) els.status.textContent = text; }

  function setView(view) {
    if (!els.app) return;
    if (view !== 'list' && view !== 'editor') return;
    els.app.dataset.view = view;
    if (els.backBtn) els.backBtn.hidden = (view === 'list');
  }

  function nowIso() { return new Date().toISOString(); }

  function debounce(fn, ms) {
    let t = null;
    const wrapped = function () {
      const args = arguments;
      const ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { t = null; fn.apply(ctx, args); }, ms);
    };
    wrapped.cancel = function () { clearTimeout(t); t = null; };
    wrapped.isPending = function () { return t !== null; };
    return wrapped;
  }

  function cancelPendingSave() {
    if (scheduleSave && typeof scheduleSave.cancel === 'function') {
      scheduleSave.cancel();
    }
    state.saveInFlight = false;
  }

  function normalize(text) {
    return (text || '')
      .toString()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function haptic(pattern) {
    if (typeof navigator === 'undefined' || !navigator.vibrate) return;
    try {
      var p = pattern || [40];
      // Respetar prefers-reduced-motion para no vibrar si el usuario lo desactiv\u00f3.
      if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      navigator.vibrate(p);
    } catch (_) { /* ignore */ }
  }

  function addRipple(ev) {
    var target = ev.currentTarget;
    if (!target) return;
    var rect = target.getBoundingClientRect();
    var ripple = document.createElement('span');
    ripple.className = 'ripple';
    var size = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = (ev.clientX - rect.left - size / 2) + 'px';
    ripple.style.top = (ev.clientY - rect.top - size / 2) + 'px';
    target.appendChild(ripple);
    setTimeout(function () { if (ripple.parentNode) ripple.parentNode.removeChild(ripple); }, 500);
  }

  function parseTags(text) {
    return (text || '')
      .split(/[,\n]/)
      .map(function (t) { return t.trim().toLowerCase(); })
      .filter(function (t) { return t.length > 0; });
  }

  function uniqueTags(items) {
    const set = new Set();
    items.forEach(function (it) {
      (it.tags || []).forEach(function (t) { set.add(t); });
    });
    return Array.from(set).sort();
  }

  // ---------- render: lista ----------
  function buildFuse() {
    if (typeof window.Fuse !== 'function') return null;
    return new window.Fuse(state.items, {
      keys: [
        { name: 'title', weight: 0.6 },
        { name: 'body', weight: 0.3 },
        { name: 'tags', weight: 0.1 }
      ],
      threshold: 0.4,
      ignoreLocation: true,
      includeScore: false,
      useExtendedSearch: false
    });
  }

  function getVisibleItems() {
    let items = state.items.slice();
    if (state.filter.tag) {
      items = items.filter(function (it) {
        return Array.isArray(it.tags) && it.tags.indexOf(state.filter.tag) !== -1;
      });
    }
    if (state.filter.onlyFav) {
      items = items.filter(function (it) { return !!it.favorite; });
    }
    if (state.filter.q && state.fuse) {
      const base = (state.filter.tag || state.filter.onlyFav) ? items : state.items;
      // Reutiliza el índice Fuse global en lugar de recrear uno en cada búsqueda.
      state.fuse.setCollection(base);
      items = state.fuse.search(state.filter.q).map(function (r) { return r.item; });
    }
    items.sort(function (a, b) {
      const af = a.favorite ? 0 : 1;
      const bf = b.favorite ? 0 : 1;
      if (af !== bf) return af - bf;
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });
    return items;
  }

  function renderList() {
    if (!els.list) return;
    const prevScroll = els.list.scrollTop || 0;
    const items = getVisibleItems();
    els.list.innerHTML = '';
    if (items.length === 0) {
      var li = document.createElement('li');
      if (state.items.length === 0 && !state.filter.q && !state.filter.tag && !state.filter.onlyFav) {
        li.className = 'prompt-empty-state';
        li.innerHTML = '<div class="empty-emoji" aria-hidden="true">📦</div>' +
          '<div class="empty-title">Aún no tienes prompts</div>' +
          '<div class="empty-desc">Guarda aquí tus mejores prompts para usarlos cuando los necesites.</div>' +
          '<button type="button" class="btn btn-primary" id="empty-create-btn">Crear mi primer prompt</button>';
      } else {
        li.className = 'prompt-empty';
        li.textContent = 'Sin resultados para los filtros actuales.';
      }
      els.list.appendChild(li);
      var createBtn = li.querySelector('#empty-create-btn');
      if (createBtn) {
        createBtn.addEventListener('click', function () { createPrompt(); });
      }
      return;
    }
    if (els.list) {
      els.list.classList.toggle('is-large', items.length > 200);
    }
    const frag = document.createDocumentFragment();
    items.forEach(function (it) {
      var wrap = document.createElement('li');
      wrap.className = 'prompt-item-wrap';
      wrap.dataset.id = it.id;

      // Acciones tras el swipe
      var actions = document.createElement('div');
      actions.className = 'prompt-actions';
      var favBtn = document.createElement('button');
      favBtn.type = 'button';
      favBtn.className = 'prompt-action-btn prompt-action-fav';
      favBtn.textContent = '★';
      favBtn.title = 'Favorito';
      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'prompt-action-btn prompt-action-del';
      delBtn.textContent = '🗑';
      delBtn.title = 'Eliminar';
      actions.appendChild(favBtn);
      actions.appendChild(delBtn);

      // Frente deslizable
      var front = document.createElement('div');
      front.className = 'prompt-item-front ripple-container' + (it.id === state.selectedId ? ' is-selected' : '');
      front.tabIndex = 0;
      front.setAttribute('role', 'button');
      front.setAttribute('aria-label', 'Abrir prompt: ' + (it.title || '(sin título)'));
      var title = document.createElement('div');
      title.className = 'prompt-item-title';
      title.textContent = it.title || '(sin título)';
      var meta = document.createElement('div');
      meta.className = 'prompt-item-meta';
      var tagCount = (it.tags || []).length;
      var parts = [];
      if (it.favorite) parts.push('★');
      if (tagCount > 0) parts.push(tagCount + ' tag' + (tagCount === 1 ? '' : 's'));
      meta.textContent = parts.join(' · ');
      front.appendChild(title);
      front.appendChild(meta);

      wrap.appendChild(actions);
      wrap.appendChild(front);

      // Handlers
      var openHandler = function () { selectPrompt(it.id); };
      front.addEventListener('click', function (ev) {
        if (wrap.classList.contains('is-actions-open')) {
          wrap.classList.remove('is-actions-open');
          return;
        }
        addRipple(ev);
        openHandler();
      });
      front.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          openHandler();
        }
      });
      favBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        haptic([40]);
        it.favorite = !it.favorite;
        it.updatedAt = nowIso();
        state.fuse = buildFuse();
        renderList();
        scheduleSave();
      });
      delBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var name = it.title || '(sin título)';
        if (!window.confirm('¿Eliminar el prompt "' + name + '"? Esta acción no se puede deshacer.')) {
          wrap.classList.remove('is-actions-open');
          return;
        }
        haptic([60, 30]);
        var idx = state.items.findIndex(function (x) { return x.id === it.id; });
        if (idx !== -1) {
          state.items.splice(idx, 1);
          state.fuse = buildFuse();
          renderTagFilter();
          if (state.selectedId === it.id) clearEditor();
          renderList();
          scheduleSave();
        }
      });

      // Swipe horizontal
      bindSwipeActions(wrap, front);

      frag.appendChild(wrap);
    });
    els.list.appendChild(frag);
    // Restaurar scroll para que el usuario no pierda su posición al re-pintar.
    requestAnimationFrame(function () {
      if (els.list) els.list.scrollTop = prevScroll;
    });
  }

  function renderTagFilter() {
    if (!els.tagFilter) return;
    const tags = uniqueTags(state.items);
    const current = state.filter.tag;
    els.tagFilter.innerHTML = '';
    const all = document.createElement('option');
    all.value = ''; all.textContent = 'Todos los tags';
    els.tagFilter.appendChild(all);
    tags.forEach(function (t) {
      const opt = document.createElement('option');
      opt.value = t; opt.textContent = '#' + t;
      els.tagFilter.appendChild(opt);
    });
    if (current && tags.indexOf(current) !== -1) els.tagFilter.value = current;
    else els.tagFilter.value = '';
  }

  // ---------- render: editor ----------
  function selectPrompt(id) {
    cancelPendingSave();
    state.selectedId = id;
    var item = state.items.find(function (it) { return it.id === id; });
    if (!item) return clearEditor();
    if (els.emptyEditor) els.emptyEditor.hidden = true;
    if (els.editorForm) els.editorForm.hidden = false;
    els.title.value = item.title || '';
    els.body.value = item.body || '';
    renderTagChips(item.tags || []);
    els.fav.checked = !!item.favorite;
    setView('editor');
    renderList();
    requestAnimationFrame(function () {
      autoResizeTextarea();
      if (els.title) els.title.focus();
    });
  }

  function clearEditor() {
    state.selectedId = null;
    if (els.emptyEditor) els.emptyEditor.hidden = false;
    if (els.editorForm) els.editorForm.hidden = true;
    els.title.value = '';
    els.body.value = '';
    renderTagChips([]);
    els.fav.checked = false;
    setView('list');
    renderList();
  }

  function collectForm() {
    return {
      title: els.title.value.trim(),
      body: els.body.value,
      tags: readTagChips(),
      favorite: !!els.fav.checked
    };
  }

  // ---------- persistencia ----------
  async function persistAll(silent) {
    if (state.saveInFlight) return;
    try {
      state.saveInFlight = true;
      // Asegura createdAt solo si falta; no toca updatedAt de items no editados.
      state.items.forEach(function (it) {
        if (!it.createdAt) it.createdAt = nowIso();
      });
      await window.PromptVaultStorage.saveAll(state.items, state.host);
      if (!silent) { flashHint('Guardado'); haptic([20]); }
    } catch (err) {
      console.error('persistAll error', err);
      var msg = (err && err.message) || String(err);
      if (/STORAGE_FULL/i.test(msg)) {
        flashHint('Sin espacio: elimina prompts o exporta datos', true);
      } else if (/network|timeout|offline|fetch/i.test(msg)) {
        flashHint('Error de red al guardar. Revisa tu conexión.', true);
      } else {
        flashHint('Error al guardar', true);
      }
    } finally {
      state.saveInFlight = false;
    }
  }

  async function backupNow() {
    try {
      setStatus('Respaldando…');
      const res = await window.PromptVaultStorage.backup(state.host);
      flashHint('Respaldo creado (' + (res && res.copies ? res.copies : '?') + ' copias)');
      setStatus(state.host === 'puter' ? 'conectado a Puter' : 'modo local (localStorage)');
    } catch (err) {
      console.error('backup error', err);
      flashHint('Error en respaldo', true);
    }
  }

  const scheduleSave = debounce(function () { persistAll(false); }, 600);

  let _hintTimer = null;
  let _moreMenuDocClick = null;
  let _moreMenuKeyDown = null;
  function flashHint(text, isError) {
    if (!els.saveHint) return;
    if (_hintTimer) { clearTimeout(_hintTimer); _hintTimer = null; }
    var prefix = isError ? '✗ ' : '✓ ';
    els.saveHint.textContent = prefix + text;
    els.saveHint.classList.toggle('is-error', !!isError);
    // Los errores duran más para dar tiempo a leerlos.
    var duration = isError ? 3500 : 1800;
    _hintTimer = setTimeout(function () {
      els.saveHint.textContent = '';
      els.saveHint.classList.remove('is-error');
      _hintTimer = null;
    }, duration);
  }

  // ---------- creación / borrado ----------
  async function createPrompt() {
    cancelPendingSave();
    // Evitar crear varios prompts vacíos seguidos sin editar.
    var last = state.items[0];
    if (last && last.title === 'Nuevo prompt' && !last.body && (!last.tags || last.tags.length === 0)) {
      selectPrompt(last.id);
      return;
    }
    haptic([50]);
    const item = {
      id: window.PromptVaultStorage.newId(),
      title: 'Nuevo prompt',
      body: '',
      tags: [],
      favorite: false,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    state.items.unshift(item);
    state.fuse = buildFuse();
    renderTagFilter();
    renderList();
    if (els.list) els.list.scrollTop = 0;
    selectPrompt(item.id);
    await persistAll(false);
  }

  async function deleteSelected() {
    cancelPendingSave();
    if (!state.selectedId) return;
    const item = state.items.find(function (it) { return it.id === state.selectedId; });
    if (!item) return;
    const name = item.title || '(sin título)';
    if (!window.confirm('¿Eliminar el prompt "' + name + '"? Esta acción no se puede deshacer.')) {
      return;
    }
    haptic([60, 30]);
    const id = state.selectedId;
    const idx = state.items.findIndex(function (it) { return it.id === id; });
    if (idx === -1) return;
    state.items.splice(idx, 1);
    state.fuse = buildFuse();
    renderTagFilter();
    clearEditor();
    renderList();
    await persistAll(false);
  }

  // ---------- import / export Excel ----------
  function exportExcel() {
    try {
      if (!state.items.length) { flashHint('No hay prompts para exportar', true); return; }
      if (typeof window.XLSX === 'undefined') { flashHint('Librería Excel no disponible', true); return; }
      var data = state.items.map(function (it) {
        return {
          'ID': it.id,
          'Título': it.title,
          'Cuerpo': it.body,
          'Tags': (it.tags || []).join(', '),
          'Favorito': it.favorite ? 'Sí' : 'No',
          'Creado el': it.createdAt,
          'Actualizado el': it.updatedAt
        };
      });
      var ws = window.XLSX.utils.json_to_sheet(data);
      var wb = window.XLSX.utils.book_new();
      window.XLSX.utils.book_append_sheet(wb, ws, 'Prompts');
      window.XLSX.writeFile(wb, 'promptvault-export-' + Date.now() + '.xlsx');
      flashHint('Exportación Excel descargada');
    } catch (err) {
      console.error('exportExcel error', err);
      flashHint('Error al exportar Excel', true);
    }
  }

  function normalizeExcelHeader(key) {
    return String(key || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  function resolveExcelColumn(headerMap, aliases) {
    for (var i = 0; i < aliases.length; i++) {
      if (headerMap[aliases[i]] !== undefined) return headerMap[aliases[i]];
    }
    return undefined;
  }

  function parseExcelBoolean(val) {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val !== 0;
    var s = String(val).trim().toLowerCase();
    return s === 'sí' || s === 'si' || s === 'yes' || s === 'true' || s === '1' || s === 'x';
  }

  function handleImportExcelFile(file) {
    if (!file) return;
    if (typeof window.XLSX === 'undefined') { flashHint('Librería Excel no disponible', true); return; }
    var reader = new FileReader();
    reader.onload = function (e) {
      Promise.resolve()
        .then(function () {
          var data = new Uint8Array(e.target.result);
          var workbook = window.XLSX.read(data, { type: 'array' });
          var firstSheetName = workbook.SheetNames[0];
          if (!firstSheetName) throw new Error('El archivo Excel no contiene hojas');
          var worksheet = workbook.Sheets[firstSheetName];
          var rows = window.XLSX.utils.sheet_to_json(worksheet);
          if (!Array.isArray(rows) || rows.length === 0) throw new Error('La hoja está vacía o no tiene datos');

          var firstRow = rows[0];
          var headerMap = {};
          Object.keys(firstRow).forEach(function (k) {
            headerMap[normalizeExcelHeader(k)] = k;
          });

          var colId       = resolveExcelColumn(headerMap, ['id']);
          var colTitle    = resolveExcelColumn(headerMap, ['titulo', 'title', 'titul']);
          var colBody     = resolveExcelColumn(headerMap, ['cuerpo', 'body', 'prompt', 'contenido', 'texto']);
          var colTags     = resolveExcelColumn(headerMap, ['tags', 'tag', 'etiquetas', 'etiqueta']);
          var colFav      = resolveExcelColumn(headerMap, ['favorito', 'favorite', 'fav', 'destacado']);
          var colCreated  = resolveExcelColumn(headerMap, ['creado', 'creadoel', 'createdat', 'created', 'fechacreacion', 'fechadecreacion']);
          var colUpdated  = resolveExcelColumn(headerMap, ['actualizado', 'actualizadoel', 'updatedat', 'updated', 'fechaactualizacion', 'fechadeactualizacion']);

          if (!colTitle && !colBody) throw new Error('No se encontraron columnas de título o cuerpo');

          var seenIds = new Set(state.items.map(function (it) { return it.id; }));
          var added = 0, skipped = 0;
          rows.forEach(function (row) {
            if (!row || typeof row !== 'object') { skipped++; return; }
            var rawTitle = colTitle !== undefined ? row[colTitle] : '';
            var rawBody  = colBody  !== undefined ? row[colBody]  : '';
            if (!String(rawTitle || '').trim() && !String(rawBody || '').trim()) { skipped++; return; }

            var id = colId !== undefined && row[colId] ? String(row[colId]) : null;
            if (!id || seenIds.has(id)) id = window.PromptVaultStorage.newId();
            seenIds.add(id);

            var rawTags = colTags !== undefined ? row[colTags] : '';
            var tags = [];
            if (Array.isArray(rawTags)) {
              for (var tj = 0; tj < rawTags.length && tags.length < 50; tj++) {
                var t = String(rawTags[tj]).trim().toLowerCase().slice(0, 50);
                if (t) tags.push(t);
              }
            } else if (rawTags !== undefined && rawTags !== null) {
              var splitTags = String(rawTags).split(/[,\n]/);
              for (var tk = 0; tk < splitTags.length && tags.length < 50; tk++) {
                var t2 = splitTags[tk].trim().toLowerCase().slice(0, 50);
                if (t2) tags.push(t2);
              }
            }

            state.items.push({
              id: id,
              title: String(rawTitle || '').trim().slice(0, 500),
              body: String(rawBody || '').slice(0, 100000),
              tags: tags,
              favorite: colFav !== undefined ? parseExcelBoolean(row[colFav]) : false,
              createdAt: colCreated !== undefined && row[colCreated] ? String(row[colCreated]) : nowIso(),
              updatedAt: colUpdated !== undefined && row[colUpdated] ? String(row[colUpdated]) : nowIso()
            });
            added++;
          });

          state.fuse = buildFuse();
          renderTagFilter();
          renderList();
          cancelPendingSave();
          return persistAll(false).then(function () {
            flashHint('Importados desde Excel: ' + added + ', omitidos: ' + skipped);
          });
        })
        .catch(function (err) {
          console.error('import excel error', err);
          flashHint('Error al importar Excel: ' + (err && err.message ? err.message : 'desconocido'), true);
        });
    };
    reader.onerror = function () { flashHint('Error leyendo archivo Excel', true); };
    reader.readAsArrayBuffer(file);
  }

  // ---------- more menu (accesible: abre/cierra, Esc, ARIA) ----------
  function isMobileMenu() {
    return window.innerWidth <= 720;
  }

  function closeMoreMenu() {
    // Dropdown
    const existing = document.getElementById('more-menu-list');
    const wasInside = !!(existing && document.activeElement && existing.contains(document.activeElement));
    if (existing) existing.remove();
    // Bottom sheet
    var bs = document.getElementById('bottom-sheet');
    var bd = document.getElementById('bottom-sheet-backdrop');
    if (bs) {
      bs.classList.remove('is-open');
      setTimeout(function () { if (bs.parentNode) bs.parentNode.removeChild(bs); }, 280);
    }
    if (bd) {
      bd.classList.remove('is-open');
      setTimeout(function () { if (bd.parentNode) bd.parentNode.removeChild(bd); }, 200);
    }
    if (els.moreBtn) {
      els.moreBtn.setAttribute('aria-expanded', 'false');
      if (wasInside) els.moreBtn.focus();
    }
    if (_moreMenuDocClick) {
      document.removeEventListener('click', _moreMenuDocClick);
      _moreMenuDocClick = null;
    }
    if (_moreMenuKeyDown) {
      document.removeEventListener('keydown', _moreMenuKeyDown);
      _moreMenuKeyDown = null;
    }
    // Swipe del bottom sheet
    if (_bsTouchCleanup) {
      _bsTouchCleanup();
      _bsTouchCleanup = null;
    }
  }

  var _bsTouchCleanup = null;

  function openMoreMenu() {
    var actions = [
      { label: 'Respaldar ahora', icon: '💾', run: function () { backupNow(); } },
      { label: 'Exportar Excel',  icon: '📊', run: function () { exportExcel(); } },
      { label: 'Importar Excel',  icon: '📊', run: function () { if (els.importExcelFile) els.importExcelFile.click(); } }
    ];
    if (document.getElementById('more-menu-list') || document.getElementById('bottom-sheet')) {
      closeMoreMenu(); return;
    }

    if (isMobileMenu()) {
      // Bottom sheet para móvil
      var backdrop = document.createElement('div');
      backdrop.id = 'bottom-sheet-backdrop';
      backdrop.className = 'bottom-sheet-backdrop';
      var sheet = document.createElement('div');
      sheet.id = 'bottom-sheet';
      sheet.className = 'bottom-sheet';
      sheet.setAttribute('role', 'dialog');
      sheet.setAttribute('aria-label', 'Más opciones');

      var handle = document.createElement('div');
      handle.className = 'bottom-sheet-handle';
      sheet.appendChild(handle);

      actions.forEach(function (a) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bottom-sheet-item';
        btn.innerHTML = '<span class="bs-icon" aria-hidden="true">' + a.icon + '</span><span>' + escapeHtml(a.label) + '</span>';
        btn.addEventListener('click', function () { closeMoreMenu(); a.run(); });
        btn.addEventListener('touchstart', function () { /* activa :active en iOS */ }, { passive: true });
        sheet.appendChild(btn);
      });

      document.body.appendChild(backdrop);
      document.body.appendChild(sheet);
      if (els.moreBtn) els.moreBtn.setAttribute('aria-expanded', 'true');

      // Abrir con animación
      requestAnimationFrame(function () {
        backdrop.classList.add('is-open');
        sheet.classList.add('is-open');
      });

      backdrop.addEventListener('click', function () { closeMoreMenu(); });

      // Swipe hacia abajo para cerrar
      var startY = 0;
      var startTime = 0;
      function onTouchStart(ev) {
        if (ev.touches.length !== 1) return;
        startY = ev.touches[0].clientY;
        startTime = Date.now();
      }
      function onTouchMove(ev) {
        if (startY === 0) return;
        var dy = ev.touches[0].clientY - startY;
        if (dy > 0) {
          sheet.style.transform = 'translateY(' + dy + 'px)';
          sheet.style.transition = 'none';
        }
      }
      function onTouchEnd(ev) {
        var dy = (ev.changedTouches[0] ? ev.changedTouches[0].clientY : 0) - startY;
        var dt = Date.now() - startTime;
        sheet.style.transition = '';
        if (dy > 80 || (dy > 20 && dt < 200)) {
          closeMoreMenu();
        } else {
          sheet.style.transform = '';
        }
        startY = 0;
      }
      sheet.addEventListener('touchstart', onTouchStart, { passive: true });
      sheet.addEventListener('touchmove', onTouchMove, { passive: true });
      sheet.addEventListener('touchend', onTouchEnd, { passive: true });
      _bsTouchCleanup = function () {
        sheet.removeEventListener('touchstart', onTouchStart);
        sheet.removeEventListener('touchmove', onTouchMove);
        sheet.removeEventListener('touchend', onTouchEnd);
      };

      _moreMenuKeyDown = function (ev) {
        if (ev.key === 'Escape') { ev.preventDefault(); closeMoreMenu(); }
      };
      document.addEventListener('keydown', _moreMenuKeyDown);
      return;
    }

    // Dropdown para desktop
    var menu = document.createElement('ul');
    menu.id = 'more-menu-list';
    menu.className = 'more-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Más opciones');
    actions.forEach(function (a) {
      var li = document.createElement('li');
      li.setAttribute('role', 'none');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'more-menu-item';
      btn.setAttribute('role', 'menuitem');
      btn.setAttribute('tabindex', '-1');
      btn.textContent = a.label;
      btn.addEventListener('click', function () { closeMoreMenu(); a.run(); });
      li.appendChild(btn);
      menu.appendChild(li);
    });
    if (els.moreBtn && els.moreBtn.parentNode) {
      els.moreBtn.parentNode.style.position = 'relative';
      els.moreBtn.parentNode.appendChild(menu);
    } else {
      document.body.appendChild(menu);
    }
    if (els.moreBtn) els.moreBtn.setAttribute('aria-expanded', 'true');
    var firstItem = menu.querySelector('.more-menu-item');
    if (firstItem) firstItem.focus();

    _moreMenuDocClick = function (ev) {
      if (menu.contains(ev.target) || (els.moreBtn && els.moreBtn.contains(ev.target))) return;
      closeMoreMenu();
    };
    _moreMenuKeyDown = function (ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); closeMoreMenu(); }
    };
    setTimeout(function () {
      document.addEventListener('click', _moreMenuDocClick);
      document.addEventListener('keydown', _moreMenuKeyDown);
    }, 0);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---------- tag chips ----------
  function readTagChips() {
    if (!els.tagsField) return [];
    var chips = els.tagsField.querySelectorAll('.tag-chip');
    var out = [];
    chips.forEach(function (c) {
      var t = (c.dataset.tag || '').trim().toLowerCase();
      if (t) out.push(t);
    });
    return out;
  }

  function renderTagChips(tags) {
    if (!els.tagsField || !els.tags) return;
    var chips = els.tagsField.querySelectorAll('.tag-chip');
    chips.forEach(function (c) { c.remove(); });
    (tags || []).forEach(function (t) { addTagChip(t); });
  }

  function addTagChip(text) {
    if (!els.tagsField || !els.tags) return;
    var t = String(text).trim().toLowerCase();
    if (!t) return;
    var existing = els.tagsField.querySelectorAll('.tag-chip');
    for (var i = 0; i < existing.length; i++) {
      if ((existing[i].dataset.tag || '') === t) return;
    }
    var chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.dataset.tag = t;
    chip.textContent = '#' + t;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tag-chip-remove';
    btn.setAttribute('aria-label', 'Eliminar tag ' + t);
    btn.textContent = '×';
    btn.addEventListener('click', function () {
      chip.remove();
      onFormChange();
    });
    chip.appendChild(btn);
    els.tagsField.insertBefore(chip, els.tags);
  }

  function onFormChange() {
    if (!state.selectedId) return;
    var item = state.items.find(function (it) { return it.id === state.selectedId; });
    if (!item) return;
    var form = collectForm();
    var hadFav = item.favorite;
    var hadTags = (item.tags || []).join(',');
    item.title = form.title;
    item.body = form.body;
    item.tags = form.tags;
    item.favorite = form.favorite;
    item.updatedAt = nowIso();
    updateListItem(item);
    refreshTagFilterOptionsPreservingValue();
    var hasTags = (item.tags || []).join(',');
    if (hadFav !== item.favorite || hadTags !== hasTags || state.filter.q) {
      state.fuse = buildFuse();
      renderList();
    }
    scheduleSave();
  }

  function onBodyInput() {
    onFormChange();
    autoResizeTextarea();
  }

  function bindTagInput() {
    if (!els.tags || !els.tagsField) return;
    els.tags.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ',' || ev.key === ' ') {
        ev.preventDefault();
        var val = els.tags.value.trim();
        if (val) {
          addTagChip(val);
          els.tags.value = '';
          onFormChange();
        }
      } else if (ev.key === 'Backspace' && !els.tags.value) {
        var chips = els.tagsField.querySelectorAll('.tag-chip');
        if (chips.length) {
          chips[chips.length - 1].remove();
          onFormChange();
        }
      }
    });
    els.tags.addEventListener('input', function () {
      var val = els.tags.value;
      if (/[,\n]/.test(val)) {
        var parts = val.split(/[,\n]/);
        parts.forEach(function (p) { addTagChip(p); });
        els.tags.value = '';
        onFormChange();
      }
    });
  }

  // ---------- eventos UI ----------
  function bindEvents() {
    if (els.search) {
      els.search.addEventListener('input', function () {
        state.filter.q = els.search.value.trim();
        renderList();
      });
    }
    if (els.tagFilter) {
      els.tagFilter.addEventListener('change', function () {
        state.filter.tag = els.tagFilter.value;
        renderList();
      });
    }
    if (els.showFav) {
      els.showFav.addEventListener('change', function () {
        state.filter.onlyFav = !!els.showFav.checked;
        renderList();
      });
    }
    if (els.newBtn)  els.newBtn.addEventListener('click', createPrompt);
    if (els.newFab)  els.newFab.addEventListener('click', createPrompt);
    if (els.backBtn) els.backBtn.addEventListener('click', clearEditor);
    if (els.moreBtn) els.moreBtn.addEventListener('click', function (ev) { ev.stopPropagation(); openMoreMenu(); });
    if (els.deleteBtn) els.deleteBtn.addEventListener('click', deleteSelected);
    if (els.exportExcelBtn) els.exportExcelBtn.addEventListener('click', exportExcel);
    if (els.importExcelBtn && els.importExcelFile) {
      els.importExcelBtn.addEventListener('click', function () { els.importExcelFile.click(); });
      els.importExcelFile.addEventListener('change', function () {
        const f = els.importExcelFile.files && els.importExcelFile.files[0];
        handleImportExcelFile(f);
        els.importExcelFile.value = '';
      });
    }
    if (els.backupBtn) els.backupBtn.addEventListener('click', backupNow);
    if (els.themeToggle) els.themeToggle.addEventListener('click', toggleTheme);
    if (els.copyBody) els.copyBody.addEventListener('click', copyBodyToClipboard);
    // v0.7: auto-hide FAB al hacer scroll en la lista
    bindListScroll();

    // Toggle filtros avanzados en móvil
    if (els.filterToggle && els.filters) {
      var savedCollapsed = false;
      try {
        var raw = localStorage.getItem('promptvault:filters-collapsed');
        if (raw === '1') savedCollapsed = true;
      } catch (_) {}
      if (savedCollapsed) els.filters.classList.add('is-collapsed');
      els.filterToggle.addEventListener('click', function () {
        els.filters.classList.toggle('is-collapsed');
        try {
          localStorage.setItem('promptvault:filters-collapsed', els.filters.classList.contains('is-collapsed') ? '1' : '0');
        } catch (_) {}
      });
    }

    // Swipe-to-go-back
    bindSwipeBack();

    // Advertir si hay cambios sin guardar al cerrar la pestaña.
    window.addEventListener('beforeunload', function (ev) {
      if (state.saveInFlight || (scheduleSave && scheduleSave.isPending())) {
        ev.preventDefault();
        ev.returnValue = '';
      }
    });

    if (els.title) els.title.addEventListener('input', onFormChange);
    if (els.body)  els.body.addEventListener('input', onBodyInput);
    if (els.fav)   els.fav.addEventListener('change', onFormChange);
    bindTagInput();
  }

  // Actualiza solo el <li> correspondiente al item; no toca el resto de la lista.
  function updateListItem(item) {
    if (!els.list || !item) return;
    var wrap = els.list.querySelector('li.prompt-item-wrap[data-id="' + item.id + '"]');
    if (!wrap) { renderList(); return; }
    var front = wrap.querySelector('.prompt-item-front');
    var title = front ? front.querySelector('.prompt-item-title') : null;
    var meta = front ? front.querySelector('.prompt-item-meta') : null;
    if (title) title.textContent = item.title || '(sin título)';
    if (meta) {
      var tagCount = (item.tags || []).length;
      var parts = [];
      if (item.favorite) parts.push('★');
      if (tagCount > 0) parts.push(tagCount + ' tag' + (tagCount === 1 ? '' : 's'));
      meta.textContent = parts.join(' · ');
    }
    if (front) {
      front.classList.toggle('is-selected', item.id === state.selectedId);
    }
  }

  // Re-pinta solo las <option> del filtro de tags conservando la selección actual.
  function refreshTagFilterOptionsPreservingValue() {
    if (!els.tagFilter) return;
    const tags = uniqueTags(state.items);
    const current = els.tagFilter.value;
    els.tagFilter.innerHTML = '';
    const all = document.createElement('option');
    all.value = ''; all.textContent = 'Todos los tags';
    els.tagFilter.appendChild(all);
    tags.forEach(function (t) {
      const opt = document.createElement('option');
      opt.value = t; opt.textContent = '#' + t;
      els.tagFilter.appendChild(opt);
    });
    if (current && tags.indexOf(current) !== -1) els.tagFilter.value = current;
    else if (state.filter.tag && tags.indexOf(state.filter.tag) !== -1) els.tagFilter.value = state.filter.tag;
    else els.tagFilter.value = '';
  }

  // v0.7: ocultar el FAB al hacer scroll en la lista y mostrarlo al volver arriba.
  function bindListScroll() {
    if (!els.promptList || !els.newFab) return;
    let lastY = 0;
    let ticking = false;
    const THRESHOLD = 8;
    const onScroll = function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () {
        const y = els.promptList.scrollTop || 0;
        const delta = y - lastY;
        if (y <= 0) {
          els.newFab.classList.remove('is-hidden');
        } else if (delta > THRESHOLD) {
          els.newFab.classList.add('is-hidden'); // scroll hacia abajo -> ocultar
        } else if (delta < -THRESHOLD) {
          els.newFab.classList.remove('is-hidden'); // scroll hacia arriba -> mostrar
        }
        lastY = y;
        ticking = false;
      });
    };
    els.promptList.addEventListener('scroll', onScroll, { passive: true });
  }

  // Swipe actions en items de lista
  function bindSwipeActions(wrap, front) {
    if (!wrap || !front) return;
    var startX = 0, startY = 0, currentX = 0, tracking = false;
    var THRESHOLD = 64; // px para abrir acciones

    function onTouchStart(ev) {
      if (ev.touches.length !== 1) return;
      startX = ev.touches[0].clientX;
      startY = ev.touches[0].clientY;
      currentX = 0;
      tracking = true;
    }
    function onTouchMove(ev) {
      if (!tracking || ev.touches.length !== 1) return;
      var x = ev.touches[0].clientX;
      var y = ev.touches[0].clientY;
      var dx = startX - x; // negativo = izquierda, positivo = derecha
      var dy = Math.abs(y - startY);
      if (dy > Math.abs(dx) && dy > 10) { tracking = false; return; }
      if (dx > 0) {
        // Deslizar hacia izquierda: revelar acciones
        currentX = Math.min(dx, 128);
        front.style.transition = 'none';
        front.style.transform = 'translateX(-' + currentX + 'px)';
      }
    }
    function onTouchEnd() {
      if (!tracking) return;
      tracking = false;
      front.style.transition = '';
      front.style.transform = '';
      if (currentX >= THRESHOLD) {
        wrap.classList.add('is-actions-open');
      } else {
        wrap.classList.remove('is-actions-open');
      }
      currentX = 0;
    }
    function onTouchCancel() {
      tracking = false;
      front.style.transition = '';
      front.style.transform = '';
    }
    front.addEventListener('touchstart', onTouchStart, { passive: true });
    front.addEventListener('touchmove', onTouchMove, { passive: true });
    front.addEventListener('touchend', onTouchEnd, { passive: true });
    front.addEventListener('touchcancel', onTouchCancel, { passive: true });
  }

  // v0.7: visualizar/ocultar topbar al abrir/cerrar el teclado en móvil.
  function bindKeyboardViewport() {
    if (!window.visualViewport) return;
    const vv = window.visualViewport;
    const onResize = function () {
      // Consideramos "teclado abierto" si el alto visible cae por debajo del 75% del inicial.
      const ratio = vv.height / Math.max(1, window.innerHeight);
      if (ratio < 0.75) {
        if (els.app) els.app.classList.add('is-keyboard-open');
      } else {
        if (els.app) els.app.classList.remove('is-keyboard-open');
      }
      // Recalcular altura del textarea tras cambio de viewport
      autoResizeTextarea();
    };
    vv.addEventListener('resize', onResize);
    onResize();
  }

  // Swipe-to-go-back desde el editor en móvil
  function bindSwipeBack() {
    if (!els.app) return;
    var editor = els.app.querySelector('.editor');
    if (!editor) return;
    var startX = 0, startY = 0, startTime = 0, tracking = false;
    var EDGE_ZONE = 40; // px desde el borde izquierdo

    editor.addEventListener('touchstart', function (ev) {
      if (ev.touches.length !== 1) return;
      var touch = ev.touches[0];
      // Solo si estamos en editor y el toque empieza cerca del borde izquierdo
      if (window.innerWidth > 720) return;
      if (touch.clientX > EDGE_ZONE) return;
      startX = touch.clientX;
      startY = touch.clientY;
      startTime = Date.now();
      tracking = true;
      editor.classList.add('is-swipe-back');
    }, { passive: true });

    editor.addEventListener('touchmove', function (ev) {
      if (!tracking || ev.touches.length !== 1) return;
      var touch = ev.touches[0];
      var dx = touch.clientX - startX;
      var dy = touch.clientY - startY;
      if (dx < 0) { tracking = false; editor.classList.remove('is-swipe-back'); editor.style.setProperty('--swipe-x', '0px'); editor.style.setProperty('--swipe-x-abs', '0px'); return; }
      // Si el movimiento vertical es mayor que el horizontal, cancelar
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) { tracking = false; editor.classList.remove('is-swipe-back'); editor.style.setProperty('--swipe-x', '0px'); editor.style.setProperty('--swipe-x-abs', '0px'); return; }
      editor.style.setProperty('--swipe-x', dx + 'px');
      editor.style.setProperty('--swipe-x-abs', Math.abs(dx) + 'px');
    }, { passive: true });

    editor.addEventListener('touchend', function (ev) {
      if (!tracking) return;
      tracking = false;
      editor.classList.remove('is-swipe-back');
      var touch = ev.changedTouches[0];
      var dx = (touch ? touch.clientX : 0) - startX;
      var dt = Date.now() - startTime;
      // Umbral: 80px o velocidad rápida
      if (dx > 80 || (dx > 40 && dt < 200)) {
        haptic([30]);
        clearEditor();
      }
      editor.style.setProperty('--swipe-x', '0px');
      editor.style.setProperty('--swipe-x-abs', '0px');
    }, { passive: true });

    editor.addEventListener('touchcancel', function () {
      tracking = false;
      editor.classList.remove('is-swipe-back');
      editor.style.setProperty('--swipe-x', '0px');
      editor.style.setProperty('--swipe-x-abs', '0px');
    }, { passive: true });
  }

  // Textarea auto-expandible
  function autoResizeTextarea() {
    if (!els.body) return;
    var ta = els.body;
    ta.style.height = 'auto';
    var maxH = computeTextareaMaxHeight();
    var desired = ta.scrollHeight + 2;
    ta.style.height = Math.min(desired, maxH) + 'px';
  }

  function computeTextareaMaxHeight() {
    if (!els.app || !els.body) return 400;
    var appH = els.app.clientHeight || window.innerHeight;
    // Restar elementos que ocupan espacio vertical
    var topbarH = document.querySelector('.topbar') ? document.querySelector('.topbar').offsetHeight : 44;
    var headerH = els.editorForm ? (els.editorForm.querySelector('.editor-header') || {}).offsetHeight || 50 : 50;
    var tagsH = els.editorForm ? ((els.editorForm.querySelector('.field') || {}).offsetHeight || 60) : 60;
    var footerH = els.editorForm ? (els.editorForm.querySelector('.editor-footer') || {}).offsetHeight || 44 : 44;
    var padding = 32;
    var safeBottom = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom')) || 0;
    // Si el teclado está abierto, el footer está oculto (CSS), así que no restamos footer
    var isKeyboard = els.app.classList.contains('is-keyboard-open');
    var available = appH - topbarH - headerH - tagsH - padding - safeBottom;
    if (!isKeyboard) available -= footerH;
    return Math.max(120, available);
  }

  // ---------- theme switcher (oscuro/claro con persistencia) ----------
  function getTheme() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
  }
  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('promptvault-theme', theme); } catch (e) { /* ignore */ }
  }
  function toggleTheme() {
    setTheme(getTheme() === 'light' ? 'dark' : 'light');
  }

  // ---------- copy body al portapapeles ----------
  function copyBodyToClipboard() {
    const body = els.body ? els.body.value : '';
    if (!body) { flashHint('Nada que copiar', true); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(body).then(function () {
        haptic([30]);
        flashHint('¡Copiado!');
      }).catch(function () {
        fallbackCopy(body);
      });
    } else {
      fallbackCopy(body);
    }
  }
  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      haptic([30]);
      flashHint('¡Copiado!');
    } catch (err) {
      flashHint('Error al copiar', true);
    }
  }

  // ---------- bootstrap ----------
  async function bootstrap() {
    // Detectar Puter: intentamos operar si fs existe; el loadAll hará el probe real.
    var hasPuter = (
      typeof window.puter !== 'undefined' &&
      window.puter &&
      typeof window.puter.fs !== 'undefined' &&
      window.puter.fs &&
      typeof window.puter.fs.write === 'function' &&
      typeof window.puter.fs.read === 'function'
    );
    state.host = hasPuter ? 'puter' : 'local';
    setStatus(state.host === 'puter' ? 'conectando a Puter…' : 'cargando datos locales…');
    try {
      const data = await window.PromptVaultStorage.loadAll(state.host);
      state.items = (data && Array.isArray(data.items)) ? data.items : [];
      state.index = data && data.index ? data.index : null;
    } catch (err) {
      console.error('loadAll error', err);
      // Si Puter falló (p. ej. autenticación pendiente), caemos a local
      // para que el usuario no pierda la sesión de trabajo.
      if (state.host === 'puter') {
        console.warn('Puter no disponible; cambiando a modo local');
        state.host = 'local';
        try {
          const data = await window.PromptVaultStorage.loadAll(state.host);
          state.items = (data && Array.isArray(data.items)) ? data.items : [];
          state.index = data && data.index ? data.index : null;
        } catch (err2) {
          console.error('loadAll fallback local error', err2);
          state.items = [];
        }
      } else {
        state.items = [];
      }
    }
    // restaurar tema persistido (oscuro por defecto)
    let savedTheme = null;
    try { savedTheme = localStorage.getItem('promptvault-theme'); } catch (e) { /* ignore */ }
    if (savedTheme === 'light' || savedTheme === 'dark') setTheme(savedTheme);
    else setTheme('dark');

    state.fuse = buildFuse();
    bindEvents();
    bindKeyboardViewport();
    renderTagFilter();
    renderList();
    clearEditor();
    if (els.app) {
      els.app.hidden = false;
      setView('list'); // explícito: al arrancar siempre lista
    }
    var hasPuterAtEnd = (
      typeof window.puter !== 'undefined' &&
      window.puter &&
      typeof window.puter.fs !== 'undefined'
    );
    if (state.host === 'puter') {
      setStatus('conectado a Puter');
    } else if (hasPuterAtEnd) {
      setStatus('modo local (Puter no autenticado)');
    } else {
      setStatus('modo local (localStorage)');
    }
    state.initialized = true;
    // respaldo automático silencioso al cargar (sólo si el backend elegido funciona)
    try {
      await window.PromptVaultStorage.backup(state.host);
    } catch (err) {
      console.warn('auto-backup warning', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();

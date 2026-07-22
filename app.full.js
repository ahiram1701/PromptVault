// PromptVault — entry point.
// v0.9.1: preservar scrollTop en re-renders
// v0.5: UX móvil — vista única (sidebar|editor) con data-view, FAB + Nuevo,
// botones back/more en topbar, safe-area. Se conserva toda la lógica previa.

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
    exportBtn: document.getElementById('export-local'),
    importBtn: document.getElementById('import-local'),
    importFile: document.getElementById('import-file'),
    backupBtn: document.getElementById('backup-now'),
    title: document.getElementById('prompt-title'),
    body: document.getElementById('prompt-body'),
    tags: document.getElementById('prompt-tags'),
    fav: document.getElementById('prompt-favorite'),
    deleteBtn: document.getElementById('delete-prompt'),
    saveHint: document.getElementById('save-hint'),
    emptyEditor: document.getElementById('empty-editor'),
    editorForm: document.getElementById('editor-form'),
    themeToggle: document.getElementById('theme-toggle'),
    copyBody: document.getElementById('copy-body')
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
    listScrollTop: 0
  };

  // ---------- helpers ----------
  function setStatus(text) { if (els.status) els.status.textContent = text; }

  function setView(view) {
    if (!els.app) return;
    if (view !== 'list' && view !== 'editor') return;
    els.app.dataset.view = view;
  }

  function uid() {
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function nowIso() { return new Date().toISOString(); }

  function debounce(fn, ms) {
    let t = null;
    return function () {
      const args = arguments;
      const ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  function normalize(text) {
    return (text || '')
      .toString()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
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
      const fuse = new window.Fuse(base, {
        keys: [
          { name: 'title', weight: 0.6 },
          { name: 'body', weight: 0.3 },
          { name: 'tags', weight: 0.1 }
        ],
        threshold: 0.4,
        ignoreLocation: true,
        includeScore: false
      });
      items = fuse.search(state.filter.q).map(function (r) { return r.item; });
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
    const items = getVisibleItems();
    // v0.9.1: preservar scrollTop al re-render para no perder la posición cuando cambia el filtro.
    const _prevScroll = els.list.scrollTop || 0;
    els.list.innerHTML = '';
    if (items.length === 0) {
      const li = document.createElement('li');
      li.className = 'prompt-empty';
      li.textContent = state.items.length === 0
        ? 'Aún no tienes prompts. Pulsa "Nuevo" para empezar.'
        : 'Sin resultados para los filtros actuales.';
      els.list.appendChild(li);
      return;
    }
    const frag = document.createDocumentFragment();
    items.forEach(function (it) {
      const li = document.createElement('li');
      li.className = 'prompt-item' + (it.id === state.selectedId ? ' is-selected' : '');
      li.dataset.id = it.id;
      li.tabIndex = 0;
      li.setAttribute('role', 'button');
      li.setAttribute('aria-label', 'Abrir prompt: ' + (it.title || '(sin título)'));
      const title = document.createElement('div');
      title.className = 'prompt-item-title';
      title.textContent = it.title || '(sin título)';
      const meta = document.createElement('div');
      meta.className = 'prompt-item-meta';
      const tagCount = (it.tags || []).length;
      const parts = [];
      if (it.favorite) parts.push('★');
      if (tagCount > 0) parts.push(tagCount + ' tag' + (tagCount === 1 ? '' : 's'));
      meta.textContent = parts.join(' · ');
      li.appendChild(title);
      li.appendChild(meta);
      const openHandler = function () { selectPrompt(it.id); };
      li.addEventListener('click', openHandler);
      li.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          openHandler();
        }
      });
      frag.appendChild(li);
    });
    els.list.appendChild(frag);
    // v0.9.1: restaurar scrollTop (el re-render lo resetea a 0 al vaciar innerHTML).
    if (_prevScroll > 0) {
      els.list.scrollTop = _prevScroll;
    }
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
    state.selectedId = id;
    const item = state.items.find(function (it) { return it.id === id; });
    if (!item) return clearEditor();
    if (els.emptyEditor) els.emptyEditor.hidden = true;
    if (els.editorForm) els.editorForm.hidden = false;
    els.title.value = item.title || '';
    els.body.value = item.body || '';
    els.tags.value = (item.tags || []).join(', ');
    els.fav.checked = !!item.favorite;
    setView('editor');
    renderList();
  }

  function clearEditor() {
    state.selectedId = null;
    if (els.emptyEditor) els.emptyEditor.hidden = false;
    if (els.editorForm) els.editorForm.hidden = true;
    els.title.value = '';
    els.body.value = '';
    els.tags.value = '';
    els.fav.checked = false;
    setView('list');
    renderList();
  }

  function collectForm() {
    return {
      title: els.title.value.trim(),
      body: els.body.value,
      tags: parseTags(els.tags.value),
      favorite: !!els.fav.checked
    };
  }

  // ---------- persistencia ----------
  async function persistAll(silent) {
    try {
      await window.PromptVaultStorage.saveAll(state.items);
      if (!silent) flashHint('Guardado');
    } catch (err) {
      console.error('persistAll error', err);
      flashHint('Error al guardar', true);
    }
  }

  async function backupNow() {
    try {
      setStatus('Respaldando…');
      const res = await window.PromptVaultStorage.backup();
      flashHint('Respaldo creado (' + (res && res.copies ? res.copies : '?') + ' copias)');
      setStatus(state.host === 'puter' ? 'conectado a Puter' : 'modo local (localStorage)');
    } catch (err) {
      console.error('backup error', err);
      flashHint('Error en respaldo', true);
    }
  }

  const scheduleSave = debounce(function () { persistAll(false); }, 600);

  let _hintTimer = null;
  function flashHint(text, isError) {
    if (!els.saveHint) return;
    if (_hintTimer) { clearTimeout(_hintTimer); _hintTimer = null; }
    els.saveHint.textContent = text;
    els.saveHint.classList.toggle('is-error', !!isError);
    _hintTimer = setTimeout(function () {
      els.saveHint.textContent = '';
      els.saveHint.classList.remove('is-error');
      _hintTimer = null;
    }, 1800);
  }

  // ---------- creación / borrado ----------
  async function createPrompt() {
    const item = {
      id: uid(),
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
    selectPrompt(item.id);
    await persistAll(false);
  }

  async function deleteSelected() {
    if (!state.selectedId) return;
    const item = state.items.find(function (it) { return it.id === state.selectedId; });
    if (!item) return;
    const name = item.title || '(sin título)';
    if (!window.confirm('¿Eliminar el prompt "' + name + '"? Esta acción no se puede deshacer.')) {
      return;
    }
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

  // ---------- import / export local ----------
  function exportLocal() {
    try {
      const blob = new Blob([JSON.stringify({
        version: 1,
        exportedAt: nowIso(),
        items: state.items
      }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'promptvault-export-' + Date.now() + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      flashHint('Exportación descargada');
    } catch (err) {
      console.error('export error', err);
      flashHint('Error al exportar', true);
    }
  }

  function handleImportFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function () {
      try {
        const data = JSON.parse(String(reader.result));
        const incoming = Array.isArray(data) ? data : (data && Array.isArray(data.items) ? data.items : null);
        if (!incoming) throw new Error('Formato no reconocido');
        const existingIds = new Set(state.items.map(function (it) { return it.id; }));
        let added = 0, skipped = 0;
        incoming.forEach(function (raw) {
          if (!raw || typeof raw !== 'object') { skipped++; return; }
          if (!raw.id || existingIds.has(raw.id)) { skipped++; return; }
          state.items.push({
            id: String(raw.id),
            title: String(raw.title || '(sin título)'),
            body: String(raw.body || ''),
            tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
            favorite: !!raw.favorite,
            createdAt: raw.createdAt || nowIso(),
            updatedAt: raw.updatedAt || nowIso()
          });
          added++;
        });
        state.fuse = buildFuse();
        renderTagFilter();
        renderList();
        await persistAll(false);
        flashHint('Importados: ' + added + ', omitidos: ' + skipped);
      } catch (err) {
        console.error('import error', err);
        flashHint('Error al importar', true);
      }
    };
    reader.onerror = function () { flashHint('Error leyendo archivo', true); };
    reader.readAsText(file);
  }

  // ---------- more menu (accesible: abre/cierra, Esc, ARIA) ----------
  function closeMoreMenu() {
    const existing = document.getElementById('more-menu-list');
    // Si el foco está dentro del menú (click en opción, Esc sobre un item),
    // lo devolvemos al botón para que el usuario no pierda el contexto.
    // Si el cierre vino de un click fuera, el foco ya está en otro sitio y no lo robamos.
    const wasInside = !!(existing && document.activeElement && existing.contains(document.activeElement));
    if (existing) existing.remove();
    if (els.moreBtn) {
      els.moreBtn.setAttribute('aria-expanded', 'false');
      if (wasInside) els.moreBtn.focus();
    }
  }

  function openMoreMenu() {
    // Acciones disponibles en el menú "…" — reusan los botones existentes.
    const actions = [
      { label: 'Respaldar ahora', run: function () { backupNow(); } },
      { label: 'Exportar JSON',   run: function () { exportLocal(); } },
      { label: 'Importar JSON',   run: function () { if (els.importFile) els.importFile.click(); } }
    ];
    if (document.getElementById('more-menu-list')) { closeMoreMenu(); return; }
    const menu = document.createElement('ul');
    menu.id = 'more-menu-list';
    menu.className = 'more-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Más opciones');
    actions.forEach(function (a) {
      const li = document.createElement('li');
      li.setAttribute('role', 'none');
      const btn = document.createElement('button');
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
    // Foco inicial al primer item para navegación con teclado (Esc vuelve al botón).
    const firstItem = menu.querySelector('.more-menu-item');
    if (firstItem) firstItem.focus();

    const onDocClick = function (ev) {
      if (menu.contains(ev.target) || (els.moreBtn && els.moreBtn.contains(ev.target))) return;
      closeMoreMenu();
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onKeyDown);
    };
    const onKeyDown = function (ev) {
      if (ev.key === 'Escape') { ev.preventDefault(); closeMoreMenu(); }
    };
    setTimeout(function () {
      document.addEventListener('click', onDocClick);
      document.addEventListener('keydown', onKeyDown);
    }, 0);
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
    if (els.exportBtn) els.exportBtn.addEventListener('click', exportLocal);
    if (els.importBtn && els.importFile) {
      els.importBtn.addEventListener('click', function () { els.importFile.click(); });
      els.importFile.addEventListener('change', function () {
        const f = els.importFile.files && els.importFile.files[0];
        handleImportFile(f);
        els.importFile.value = '';
      });
    }
    if (els.backupBtn) els.backupBtn.addEventListener('click', backupNow);
    if (els.themeToggle) els.themeToggle.addEventListener('click', toggleTheme);
    if (els.copyBody) els.copyBody.addEventListener('click', copyBodyToClipboard);
    // v0.7: auto-hide FAB al hacer scroll en la lista
    bindListScroll();

    const onFormChange = function () {
      if (!state.selectedId) return;
      const item = state.items.find(function (it) { return it.id === state.selectedId; });
      if (!item) return;
      const form = collectForm();
      item.title = form.title;
      item.body = form.body;
      item.tags = form.tags;
      item.favorite = form.favorite;
      item.updatedAt = nowIso();
      // Render selectivo: solo actualizamos el <li> del item actual y los <option> del filtro de tags
      // para no perder foco en el input ni re-pintar toda la lista en cada tecla.
      updateListItem(item);
      refreshTagFilterOptionsPreservingValue();
      scheduleSave();
    };
    if (els.title) els.title.addEventListener('input', onFormChange);
    if (els.body)  els.body.addEventListener('input', onFormChange);
    if (els.tags)  els.tags.addEventListener('input', onFormChange);
    if (els.fav)   els.fav.addEventListener('change', onFormChange);
  }

  // Actualiza solo el <li> correspondiente al item; no toca el resto de la lista.
  function updateListItem(item) {
    if (!els.list || !item) return;
    const li = els.list.querySelector('li.prompt-item[data-id="' + item.id + '"]');
    if (!li) { renderList(); return; }
    const title = li.querySelector('.prompt-item-title');
    const meta = li.querySelector('.prompt-item-meta');
    if (title) title.textContent = item.title || '(sin título)';
    if (meta) {
      const tagCount = (item.tags || []).length;
      const parts = [];
      if (item.favorite) parts.push('★');
      if (tagCount > 0) parts.push(tagCount + ' tag' + (tagCount === 1 ? '' : 's'));
      meta.textContent = parts.join(' · ');
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
    };
    vv.addEventListener('resize', onResize);
    onResize();
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
      flashHint('¡Copiado!');
    } catch (err) {
      flashHint('Error al copiar', true);
    }
  }

  // ---------- bootstrap ----------
  async function bootstrap() {
    state.host = (typeof window.puter !== 'undefined') ? 'puter' : 'local';
    setStatus(state.host === 'puter' ? 'conectando a Puter…' : 'cargando datos locales…');
    try {
      const data = await window.PromptVaultStorage.loadAll();
      state.items = (data && Array.isArray(data.items)) ? data.items : [];
      state.index = data && data.index ? data.index : null;
    } catch (err) {
      console.error('loadAll error', err);
      state.items = [];
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
    setStatus(state.host === 'puter' ? 'conectado a Puter' : 'modo local (localStorage)');
    state.initialized = true;
    // respaldo automático silencioso al cargar
    try {
      await window.PromptVaultStorage.backup();
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

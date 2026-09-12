// ------------------------------------------------------------------
// Corkboard Todo — renderer
// ------------------------------------------------------------------

// In-browser preview shim: when running outside Electron, provide a
// safe fallback for the `corkboard` bridge so the UI still works.
const api = window.corkboard || (function () {
  const noop = () => Promise.resolve();
  return {
    minimize: noop,
    close: noop,
    setPinned: (v) => Promise.resolve({ pinned: !!v }),
    isPinned: () => Promise.resolve({ pinned: false }),
    pickFiles: () => new Promise((resolve) => pickFromBrowser(false, resolve)),
    pickImages: () => new Promise((resolve) => pickFromBrowser(true, resolve)),
    openFile: () => Promise.resolve(),
    revealFile: () => Promise.resolve(),
    deleteFile: () => Promise.resolve(),
    openWebBrowser: () => { alert('The in-app web browser is available in the desktop version.'); return Promise.resolve(); },
    onWebImage: () => {},
    openSourceFolder: () => { alert('This opens the app source folder in the desktop version.'); return Promise.resolve(); },
    openUserDataFolder: () => { alert('This opens the app data folder in the desktop version.'); return Promise.resolve(); },
    openAttachmentsFolder: () => { alert('This opens the attachments folder in the desktop version.'); return Promise.resolve(); },
    paths: () => Promise.resolve({
      source: '(browser preview — run desktop app for real path)',
      userData: '(browser preview)',
      attachments: '(browser preview)',
      platform: 'web',
      version: 'preview',
      packaged: false,
    }),
  };
})();

// Browser fallback file picker — stores files as data URLs inside the note
function pickFromBrowser(imagesOnly, resolve) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.multiple = true;
  if (imagesOnly) inp.accept = 'image/*';
  inp.onchange = async () => {
    const items = [];
    for (const f of Array.from(inp.files || [])) {
      const url = await new Promise((r) => {
        const rd = new FileReader();
        rd.onload = () => r(rd.result);
        rd.readAsDataURL(f);
      });
      items.push({ name: f.name, path: f.name, fileUrl: url, mime: f.type || 'application/octet-stream' });
    }
    resolve(items);
  };
  inp.click();
}

// ---------- Persistence ----------
const LS_KEY = 'corkboard.state.v1';
const defaultState = () => ({
  boards: [
    { id: uid(), name: 'My Board', tasks: [] },
  ],
  activeBoardId: null,
  settings: {
    theme: 'cork',
    bgColor: '#7a4a24',
    frameColor: '#5a2f14',
    font: 'marker',
    easterEgg: true,
    startupPinned: false,
    realistic: false,
    holder: 'mixed',
    customBg: '',
    meowOnClick: true,
  },
});

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) {
      const s = defaultState();
      s.activeBoardId = s.boards[0].id;
      return s;
    }
    const s = JSON.parse(raw);
    if (!s.boards || !s.boards.length) return defaultState();
    if (!s.activeBoardId) s.activeBoardId = s.boards[0].id;
    s.settings = Object.assign(defaultState().settings, s.settings || {});
    return s;
  } catch {
    return defaultState();
  }
}
function saveState() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

let state = loadState();

// ---------- Utilities ----------
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }
function el(sel) { return document.querySelector(sel); }
function all(sel) { return Array.from(document.querySelectorAll(sel)); }
function activeBoard() { return state.boards.find(b => b.id === state.activeBoardId) || state.boards[0]; }
function fmtDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}
function isOverdue(iso) {
  if (!iso) return false;
  const now = new Date(); now.setHours(0,0,0,0);
  const d = new Date(iso + 'T00:00:00');
  return d < now;
}

// ---------- Rendering ----------
function applySettingsToBody() {
  const s = state.settings;
  const cls = [`theme-${s.theme}`, `font-${s.font}`];
  if (document.body.classList.contains('pinned')) cls.push('pinned');
  if (s.realistic) cls.push('realistic');
  if (s.realistic && s.customBg) cls.push('custombg');
  document.body.className = cls.join(' ');

  if (s.customBg) {
    document.documentElement.style.setProperty('--custom-bg', `url("${s.customBg}")`);
  } else {
    document.documentElement.style.removeProperty('--custom-bg');
  }
  if (s.theme === 'solid') {
    document.documentElement.style.setProperty('--board-solid', s.bgColor);
  } else {
    document.documentElement.style.removeProperty('--board-solid');
  }
  document.documentElement.style.setProperty('--frame', s.frameColor);
  // Derived shading
  document.documentElement.style.setProperty('--frame-hi', shade(s.frameColor, 22));
  document.documentElement.style.setProperty('--frame-lo', shade(s.frameColor, -30));
}

// ---------- Note holders (pins / magnets / real cat memes) ----------
const HOLDER_PINS = ['#c0392b', '#2e86de', '#27ae60', '#8e44ad', '#e67e22'];
const HOLDER_MAGS = ['#c0392b', '#2d6cdf', '#e6b800', '#3ca35a', 'star'];
const HOLDER_CATS = ['cat1', 'cat2', 'cat3', 'cat4', 'cat5', 'cat6', 'cat7', 'cat8'];
function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}
function makeHolder(id) {
  const h = hashStr(String(id));
  const types = ['pin', 'magnet', 'cat'];
  return {
    type: types[h % 3],
    rot: ((h >>> 3) % 13) - 6,
    pin: HOLDER_PINS[(h >>> 6) % HOLDER_PINS.length],
    magnet: HOLDER_MAGS[(h >>> 6) % HOLDER_MAGS.length],
    cat: HOLDER_CATS[(h >>> 6) % HOLDER_CATS.length],
  };
}
let _holderDirty = false;
function ensureHolderOn(obj) {
  if (!obj.holder || !obj.holder.type) { obj.holder = makeHolder(obj.id); _holderDirty = true; }
  else if (!obj.holder.pin || !obj.holder.magnet || !obj.holder.cat) {
    const fresh = makeHolder(obj.id);
    obj.holder = Object.assign(fresh, { type: obj.holder.type, rot: obj.holder.rot });
    _holderDirty = true;
  }
  return obj.holder;
}
function holderTypeFor(obj) {
  const mode = state.settings.holder;
  if (mode === 'pins') return 'pin';
  if (mode === 'magnets') return 'magnet';
  if (mode === 'cats') return 'cat';
  return ensureHolderOn(obj).type;
}
function buildHolder(obj) {
  const H = ensureHolderOn(obj);
  const type = holderTypeFor(obj);
  const wrap = document.createElement('div');
  const isStar = type === 'magnet' && H.magnet === 'star';
  wrap.className = 'holder ' + type + (isStar ? ' star' : '');
  wrap.style.setProperty('--hrot', H.rot + 'deg');
  wrap.dataset.testid = 'holder-' + obj.id;
  if (type === 'pin') {
    wrap.style.setProperty('--pinc', H.pin);
    const head = document.createElement('div'); head.className = 'head';
    const needle = document.createElement('div'); needle.className = 'needle';
    wrap.appendChild(head); wrap.appendChild(needle);
  } else if (type === 'magnet') {
    wrap.style.setProperty('--magc', isStar ? '#3ca35a' : H.magnet);
  } else {
    const img = document.createElement('img');
    img.src = '../assets/' + H.cat + '.jpg';
    img.alt = 'cat meme';
    img.onerror = () => { console.warn('holder cat image failed to load:', img.src); wrap.className = 'holder pin'; wrap.style.setProperty('--pinc', '#c0392b'); wrap.innerHTML = ''; const hd = document.createElement('div'); hd.className = 'head'; wrap.appendChild(hd); };
    wrap.appendChild(img);
  }
  return wrap;
}

// ---------- Decor layer: stickers + polaroid photos ----------
const BUILTIN_STICKERS = ['⭐','❤️','🔥','✅','📌','🎉','☕','🌈','👍','💡','🍔','🐱','🌸','⚡','🎯','😎','🚀','🌟','🍕','🎨','💯','🙌','🌵','🦄'];
let _saveT = null;
function saveStateDebounced() { clearTimeout(_saveT); _saveT = setTimeout(saveState, 400); }

function renderDecor() {
  const b = activeBoard();
  if (!b.decor) b.decor = [];
  const layer = el('#decorLayer');
  if (!layer) return;
  layer.innerHTML = '';
  b.decor.forEach(item => {
    if (item.kind === 'polaroid') layer.appendChild(buildPolaroid(item));
    else layer.appendChild(buildSticker(item));
  });
}

function addDecorControls(elm, item) {
  const del = document.createElement('button');
  del.className = 'decor-del';
  del.textContent = '×';
  del.dataset.testid = 'decor-del-' + item.id;
  del.onclick = (e) => {
    e.stopPropagation();
    const b = activeBoard();
    b.decor = (b.decor || []).filter(x => x.id !== item.id);
    saveState();
    renderDecor();
  };
  elm.appendChild(del);
}

function makeDraggable(elm, item) {
  elm.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.decor-del') || e.target.closest('.caption')) return;
    e.preventDefault();
    const startX = e.clientX, startY = e.clientY;
    const ox = item.x, oy = item.y;
    elm.classList.add('dragging');
    try { elm.setPointerCapture(e.pointerId); } catch (_) {}
    const move = (ev) => {
      item.x = Math.max(0, ox + (ev.clientX - startX));
      item.y = Math.max(0, oy + (ev.clientY - startY));
      elm.style.left = item.x + 'px';
      elm.style.top = item.y + 'px';
    };
    const up = () => {
      elm.classList.remove('dragging');
      elm.removeEventListener('pointermove', move);
      elm.removeEventListener('pointerup', up);
      saveState();
    };
    elm.addEventListener('pointermove', move);
    elm.addEventListener('pointerup', up);
  });
}

function buildSticker(item) {
  const s = document.createElement('div');
  s.className = 'decor sticker' + (item.src ? ' img' : ' emoji');
  s.style.left = item.x + 'px';
  s.style.top = item.y + 'px';
  s.style.setProperty('--drot', (item.rot || 0) + 'deg');
  s.dataset.testid = 'sticker-' + item.id;
  if (item.src) {
    const img = document.createElement('img');
    img.src = item.src;
    img.alt = 'sticker';
    s.appendChild(img);
  } else {
    const sp = document.createElement('div');
    sp.className = 'emoji-glyph';
    sp.textContent = item.emoji || '⭐';
    s.appendChild(sp);
  }
  addDecorControls(s, item);
  makeDraggable(s, item);
  return s;
}

function buildPolaroid(item) {
  const p = document.createElement('div');
  p.className = 'decor polaroid';
  p.style.left = item.x + 'px';
  p.style.top = item.y + 'px';
  p.style.setProperty('--drot', (item.rot || 0) + 'deg');
  p.dataset.testid = 'polaroid-' + item.id;

  const holder = buildHolder(item);
  holder.classList.add('decor-holder');
  p.appendChild(holder);

  const photo = document.createElement('div');
  photo.className = 'photo';
  const img = document.createElement('img');
  img.src = item.src;
  img.alt = 'photo';
  photo.appendChild(img);
  p.appendChild(photo);

  const cap = document.createElement('input');
  cap.className = 'caption';
  cap.value = item.caption || '';
  cap.placeholder = 'Write a title…';
  cap.dataset.testid = 'polaroid-caption-' + item.id;
  cap.oninput = () => { item.caption = cap.value; saveStateDebounced(); };
  p.appendChild(cap);

  addDecorControls(p, item);
  makeDraggable(p, item);
  return p;
}

function addSticker(data) {
  const b = activeBoard();
  if (!b.decor) b.decor = [];
  const layer = el('#decorLayer');
  const w = layer ? layer.clientWidth : 600;
  const h = layer ? layer.clientHeight : 400;
  b.decor.push(Object.assign({
    id: uid(),
    kind: 'sticker',
    x: Math.max(10, w / 2 - 42 + (Math.random() * 90 - 45)),
    y: Math.max(10, h / 2 - 42 + (Math.random() * 90 - 45)),
    rot: Math.round(Math.random() * 24 - 12),
  }, data));
  saveState();
  renderDecor();
}

function addPolaroid(src) {
  const b = activeBoard();
  if (!b.decor) b.decor = [];
  const layer = el('#decorLayer');
  const w = layer ? layer.clientWidth : 600;
  const h = layer ? layer.clientHeight : 400;
  b.decor.push({
    id: uid(),
    kind: 'polaroid',
    src,
    caption: '',
    x: Math.max(10, w / 2 - 95 + (Math.random() * 60 - 30)),
    y: Math.max(10, h / 2 - 120 + (Math.random() * 40 - 20)),
    rot: Math.round(Math.random() * 12 - 6),
  });
  saveState();
  renderDecor();
}

// ---------- Sticker picker modal ----------
function openStickerPicker() {
  const grid = el('#stickerGrid');
  grid.innerHTML = '';
  BUILTIN_STICKERS.forEach(em => {
    const btn = document.createElement('button');
    btn.className = 'sticker-choice emoji';
    btn.textContent = em;
    btn.dataset.testid = 'sticker-choice-' + em;
    btn.onclick = () => { addSticker({ emoji: em }); closeStickerPicker(); };
    grid.appendChild(btn);
  });
  HOLDER_CATS.forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'sticker-choice img';
    const img = document.createElement('img');
    img.src = '../assets/' + c + '.jpg';
    btn.appendChild(img);
    btn.dataset.testid = 'sticker-choice-' + c;
    btn.onclick = () => { addSticker({ src: '../assets/' + c + '.jpg' }); closeStickerPicker(); };
    grid.appendChild(btn);
  });
  el('#stickerModal').hidden = false;
}
function closeStickerPicker() { el('#stickerModal').hidden = true; }
function shade(hex, amt) {
  const c = hex.replace('#','');
  const num = parseInt(c, 16);
  let r = (num >> 16) + amt;
  let g = ((num >> 8) & 0xff) + amt;
  let b = (num & 0xff) + amt;
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return '#' + ((1<<24) + (r<<16) + (g<<8) + b).toString(16).slice(1);
}

function renderBoardTabs() {
  const box = el('#boardTabs');
  box.innerHTML = '';
  state.boards.forEach(b => {
    const t = document.createElement('button');
    t.className = 'board-tab' + (b.id === state.activeBoardId ? ' active' : '');
    t.textContent = b.name || 'Untitled';
    t.dataset.testid = 'board-tab-' + b.id;
    t.onclick = () => { state.activeBoardId = b.id; saveState(); renderAll(); };
    box.appendChild(t);
  });
}

function renderBoardHeader() {
  const b = activeBoard();
  el('#boardName').value = b.name || '';
}

function renderTasks() {
  const b = activeBoard();
  const wrap = el('#tasks');
  wrap.innerHTML = '';
  if (!b.tasks.length) {
    el('#emptyState').hidden = false;
    return;
  }
  el('#emptyState').hidden = true;

  b.tasks.forEach(task => {
    const note = document.createElement('div');
    note.className = 'note' + (task.done ? ' done' : '');
    note.style.setProperty('--noteBg', task.color || '#fff4a3');
    note.dataset.testid = 'task-note-' + task.id;

    const tack = buildHolder(task);
    note.appendChild(tack);

    // Title row
    const title = document.createElement('div');
    title.className = 'title';
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = !!task.done;
    chk.dataset.testid = 'task-check-' + task.id;
    chk.onchange = () => {
      task.done = chk.checked;
      saveState();
      renderTasks();
      maybeTriggerEasterEgg();
    };
    const label = document.createElement('span');
    label.textContent = task.title || '(untitled)';
    title.appendChild(chk);
    title.appendChild(label);
    note.appendChild(title);

    // Description
    if (task.desc) {
      const d = document.createElement('div');
      d.className = 'desc';
      d.textContent = task.desc;
      note.appendChild(d);
    }

    // Attachments strip
    if (task.attachments && task.attachments.length) {
      const strip = document.createElement('div');
      strip.className = 'attach-strip';
      task.attachments.forEach(a => {
        if ((a.mime || '').startsWith('image/')) {
          const th = document.createElement('div');
          th.className = 'thumb';
          const img = document.createElement('img');
          img.src = a.fileUrl || ('file://' + (a.path || '').replace(/\\/g,'/'));
          img.onerror = () => { th.textContent = a.name || 'image'; };
          th.appendChild(img);
          th.title = a.name || '';
          th.onclick = () => api.openFile(a.path);
          strip.appendChild(th);
        } else {
          const c = document.createElement('div');
          c.className = 'file-chip';
          c.textContent = '📎 ' + (a.name || 'file');
          c.onclick = () => api.openFile(a.path);
          strip.appendChild(c);
        }
      });
      note.appendChild(strip);
    }

    // Meta row
    const meta = document.createElement('div');
    meta.className = 'meta';
    const left = document.createElement('span');
    if (task.category && task.category !== 'none') {
      const t = document.createElement('span');
      t.className = 'tag ' + task.category;
      t.textContent = task.category;
      left.appendChild(t);
    }
    const right = document.createElement('span');
    if (task.due) {
      right.className = 'due' + (!task.done && isOverdue(task.due) ? ' overdue' : '');
      right.textContent = (task.start ? fmtDate(task.start) + ' → ' : '') + '📅 ' + fmtDate(task.due);
    }
    meta.appendChild(left);
    meta.appendChild(right);
    note.appendChild(meta);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'row-actions';
    const edit = document.createElement('button');
    edit.className = 'icon-btn';
    edit.textContent = 'Edit';
    edit.dataset.testid = 'task-edit-' + task.id;
    edit.onclick = () => openEditor(task.id);
    const del = document.createElement('button');
    del.className = 'icon-btn danger';
    del.textContent = 'Delete';
    del.dataset.testid = 'task-delete-' + task.id;
    del.onclick = () => {
      if (!confirm('Delete this task?')) return;
      b.tasks = b.tasks.filter(x => x.id !== task.id);
      saveState();
      renderTasks();
    };
    actions.appendChild(edit);
    actions.appendChild(del);
    note.appendChild(actions);

    wrap.appendChild(note);
  });
  if (_holderDirty) { _holderDirty = false; saveState(); }
}

function renderAll() {
  applySettingsToBody();
  renderBoardTabs();
  renderBoardHeader();
  renderTasks();
  renderDecor();
}

// ---------- Task CRUD ----------
function addTask(title) {
  const b = activeBoard();
  const clean = (title || '').trim();
  if (!clean) return;
  b.tasks.unshift({
    id: uid(),
    title: clean,
    desc: '',
    done: false,
    category: 'none',
    color: pickPastel(),
    start: '',
    due: '',
    attachments: [],
    createdAt: Date.now(),
  });
  saveState();
  renderTasks();
  maybeTriggerEasterEgg();
}
function pickPastel() {
  const palette = ['#fff4a3', '#ffd1dc', '#c8f0d3', '#cfe4ff', '#f6c9ff', '#ffe0b3', '#e6e6ff'];
  return palette[Math.floor(Math.random() * palette.length)];
}

// ---------- Editor modal ----------
let editingId = null;
function openEditor(taskId) {
  const b = activeBoard();
  const t = b.tasks.find(x => x.id === taskId);
  if (!t) return;
  editingId = taskId;
  el('#editTitle').value = t.title || '';
  el('#editDesc').value = t.desc || '';
  el('#editCategory').value = t.category || 'none';
  el('#editColor').value = t.color || '#fff4a3';
  el('#editStart').value = t.start || '';
  el('#editDue').value = t.due || '';
  renderAttachList(t.attachments || []);
  el('#modal').hidden = false;
}
function closeEditor() { el('#modal').hidden = true; editingId = null; }
function renderAttachList(list) {
  const box = el('#attachList');
  box.innerHTML = '';
  list.forEach((a, idx) => {
    const cell = document.createElement('div');
    cell.className = 'att';
    if ((a.mime || '').startsWith('image/')) {
      const img = document.createElement('img');
      img.src = a.fileUrl || ('file://' + (a.path || '').replace(/\\/g,'/'));
      img.onerror = () => { cell.textContent = a.name || 'image'; };
      cell.appendChild(img);
    } else {
      cell.textContent = a.name || 'file';
    }
    const rm = document.createElement('button');
    rm.className = 'remove'; rm.textContent = '×';
    rm.onclick = (e) => {
      e.stopPropagation();
      const t = activeBoard().tasks.find(x => x.id === editingId);
      if (!t) return;
      const removed = t.attachments.splice(idx, 1)[0];
      if (removed && removed.path) api.deleteFile(removed.path);
      renderAttachList(t.attachments);
    };
    cell.appendChild(rm);
    cell.onclick = () => api.openFile(a.path);
    box.appendChild(cell);
  });
}

function saveEditor() {
  const b = activeBoard();
  const t = b.tasks.find(x => x.id === editingId);
  if (!t) return;
  t.title = el('#editTitle').value.trim() || t.title;
  t.desc = el('#editDesc').value;
  t.category = el('#editCategory').value;
  t.color = el('#editColor').value;
  t.start = el('#editStart').value;
  t.due = el('#editDue').value;
  saveState();
  renderTasks();
  closeEditor();
}

// ---------- Boards ----------
function addBoard() {
  const name = prompt('New board name?', 'New Board');
  if (name === null) return;
  const b = { id: uid(), name: name.trim() || 'New Board', tasks: [] };
  state.boards.push(b);
  state.activeBoardId = b.id;
  saveState();
  renderAll();
}
function deleteBoard() {
  if (state.boards.length <= 1) { alert('You need at least one board.'); return; }
  if (!confirm('Delete this board and all its tasks?')) return;
  state.boards = state.boards.filter(b => b.id !== state.activeBoardId);
  state.activeBoardId = state.boards[0].id;
  saveState();
  renderAll();
}

// ---------- Settings modal ----------
async function openSettings() {
  const s = state.settings;
  el('#setTheme').value = s.theme;
  el('#setBgColor').value = s.bgColor;
  el('#setFrameColor').value = s.frameColor;
  el('#setFont').value = s.font;
  el('#setStartupPinned').checked = !!s.startupPinned;
  el('#setRealistic').checked = !!s.realistic;
  el('#setHolder').value = s.holder || 'mixed';
  refreshSettingsUI();
  try {
    const paths = await api.paths();
    el('#pathSource').textContent = paths.source;
    el('#pathData').textContent = paths.userData;
    el('#pathAttach').textContent = paths.attachments;
  } catch (_e) { /* paths optional */ }
  el('#settingsModal').hidden = false;
}
function refreshSettingsUI() {
  const s = state.settings;
  const nameEl = el('#customBgName');
  if (nameEl) nameEl.textContent = s.customBg ? 'Custom image applied ✓' : 'Uses realistic cork when empty';
  if (el('#setRealistic')) el('#setRealistic').checked = !!s.realistic;
}
function closeSettings() { el('#settingsModal').hidden = true; }
function commitSettings() {
  state.settings.theme = el('#setTheme').value;
  state.settings.bgColor = el('#setBgColor').value;
  state.settings.frameColor = el('#setFrameColor').value;
  state.settings.font = el('#setFont').value;
  state.settings.startupPinned = el('#setStartupPinned').checked;
  state.settings.realistic = el('#setRealistic').checked;
  state.settings.holder = el('#setHolder').value;
  saveState();
  applySettingsToBody();
}

// Live preview while tweaking
['setTheme','setBgColor','setFrameColor','setFont'].forEach(id => {
  document.addEventListener('input', (e) => {
    if (e.target && e.target.id === id) { commitSettings(); }
  });
});

// ---------- Pin (widget mode) ----------
async function togglePin() {
  const cur = await api.isPinned();
  const next = !cur.pinned;
  const res = await api.setPinned(next);
  document.body.classList.toggle('pinned', !!res.pinned);
  el('#btnPin').classList.toggle('active', !!res.pinned);
}

// ---------- Easter egg: 1/50 chance ----------
function maybeTriggerEasterEgg() {
  if (!state.settings.easterEgg) return;
  if (Math.floor(Math.random() * 50) !== 0) return;
  triggerRandomEgg();
}

function showSpinningCat() {
  const layer = el('#eggLayer');
  const cat = el('#eggCat');
  // random position within the visible area
  const w = window.innerWidth, h = window.innerHeight;
  const x = 60 + Math.random() * Math.max(1, w - 340);
  const y = 60 + Math.random() * Math.max(1, h - 340);
  cat.style.left = x + 'px';
  cat.style.top = y + 'px';
  cat.style.transform = 'translate(0,0) scale(0)';
  requestAnimationFrame(() => {
    cat.classList.add('show');
    cat.style.transform = 'translate(0,0) scale(1)';
  });
  setTimeout(() => {
    cat.classList.remove('show');
    cat.style.transform = 'translate(0,0) scale(0)';
  }, 2600);
}

// Web Audio synth: a goofy "chomp/burger" burst
let audioCtx = null;
function playHamburgerSound() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audioCtx.currentTime;

    // Deep chomp thump
    const o1 = audioCtx.createOscillator();
    const g1 = audioCtx.createGain();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(220, t0);
    o1.frequency.exponentialRampToValueAtTime(60, t0 + 0.25);
    g1.gain.setValueAtTime(0.0001, t0);
    g1.gain.exponentialRampToValueAtTime(0.6, t0 + 0.02);
    g1.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
    o1.connect(g1).connect(audioCtx.destination);
    o1.start(t0); o1.stop(t0 + 0.4);

    // Crunch noise
    const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.35, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 1.5);
    }
    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;
    const bp = audioCtx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
    const g2 = audioCtx.createGain();
    g2.gain.setValueAtTime(0.35, t0 + 0.05);
    g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
    noise.connect(bp).connect(g2).connect(audioCtx.destination);
    noise.start(t0 + 0.05);

    // "Ba-da" celebratory blip
    const o2 = audioCtx.createOscillator();
    const g3 = audioCtx.createGain();
    o2.type = 'square';
    o2.frequency.setValueAtTime(660, t0 + 0.35);
    o2.frequency.setValueAtTime(880, t0 + 0.5);
    g3.gain.setValueAtTime(0.0001, t0 + 0.35);
    g3.gain.exponentialRampToValueAtTime(0.25, t0 + 0.38);
    g3.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);
    o2.connect(g3).connect(audioCtx.destination);
    o2.start(t0 + 0.35); o2.stop(t0 + 0.75);
  } catch (e) { /* audio unavailable, ignore */ }
}

// ---------- Cat meow synth (1 in 30 on any button tap) ----------
function synthMeow() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = audioCtx;
    const t0 = ctx.currentTime;
    const dur = 0.55;

    // vocal-cord-ish source
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(470, t0);
    osc.frequency.linearRampToValueAtTime(720, t0 + 0.12);   // "me"
    osc.frequency.linearRampToValueAtTime(660, t0 + 0.30);
    osc.frequency.linearRampToValueAtTime(380, t0 + dur);    // "ow"

    // vibrato
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 16;
    lfoGain.gain.value = 18;
    lfo.connect(lfoGain).connect(osc.frequency);

    // two formants make it read as a cat voice
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass'; f1.frequency.value = 900; f1.Q.value = 6;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass'; f2.frequency.value = 2200; f2.Q.value = 8;

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(0.5, t0 + 0.06);
    amp.gain.setValueAtTime(0.45, t0 + 0.30);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.05);

    osc.connect(f1); osc.connect(f2);
    f1.connect(amp); f2.connect(amp);
    amp.connect(ctx.destination);

    osc.start(t0); lfo.start(t0);
    osc.stop(t0 + dur + 0.1); lfo.stop(t0 + dur + 0.1);
  } catch (e) { /* audio unavailable, ignore */ }
}

// Real recorded meows (CC0), with a synth fallback if audio can't play
const MEOWS = ['../assets/meow1.mp3', '../assets/meow2.mp3'];
function playMeow() {
  try {
    const a = new Audio(MEOWS[Math.floor(Math.random() * MEOWS.length)]);
    a.volume = 0.85;
    const p = a.play();
    if (p && p.catch) p.catch(() => synthMeow());
  } catch (e) {
    synthMeow();
  }
}

function maybeMeowOnClick() {
  if (!state.settings.meowOnClick) return;
  if (Math.floor(Math.random() * 30) !== 0) return;
  playMeow();
}

// ---------- Extra Easter eggs: confetti + cat parade ----------
function showConfetti() {
  const layer = document.createElement('div');
  layer.className = 'confetti-layer';
  const colors = ['#ff5a5a', '#ffce3a', '#3ca35a', '#2d6cdf', '#b7a0ff', '#ff8ac2', '#ff9f43'];
  for (let i = 0; i < 90; i++) {
    const bit = document.createElement('i');
    bit.className = 'confetti-bit';
    bit.style.left = Math.random() * 100 + '%';
    bit.style.background = colors[i % colors.length];
    bit.style.animationDelay = (Math.random() * 0.7) + 's';
    bit.style.animationDuration = (1.6 + Math.random() * 1.6) + 's';
    bit.style.setProperty('--spin', (Math.random() * 720 - 360) + 'deg');
    if (i % 4 === 0) bit.style.borderRadius = '50%';
    layer.appendChild(bit);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 3400);
}

function showCatParade() {
  const layer = document.createElement('div');
  layer.className = 'parade-layer';
  const cats = ['cat1', 'cat2', 'cat3', 'cat4', 'cat5', 'cat6', 'cat7', 'cat8'];
  for (let i = 0; i < 6; i++) {
    const img = document.createElement('img');
    img.className = 'parade-cat';
    img.src = '../assets/' + cats[Math.floor(Math.random() * cats.length)] + '.jpg';
    img.alt = '';
    img.style.bottom = (12 + Math.random() * 46) + 'px';
    img.style.animationDelay = (i * 0.32) + 's';
    img.style.setProperty('--sz', (58 + Math.random() * 46) + 'px');
    layer.appendChild(img);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 4400);
  playMeow();
}

function triggerRandomEgg() {
  const eggs = [
    () => { playHamburgerSound(); showSpinningCat(); },
    showConfetti,
    showCatParade,
  ];
  eggs[Math.floor(Math.random() * eggs.length)]();
}

// ---------- Board backup: export / import ----------
function exportBoards() {
  try {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cork-manager-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch (e) {
    alert('Export failed: ' + e.message);
  }
}
function importBoards() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'application/json,.json';
  inp.onchange = () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const parsed = JSON.parse(rd.result);
        if (!parsed || !parsed.boards || !parsed.boards.length) {
          alert('That file does not look like a Cork Manager backup.');
          return;
        }
        if (!confirm('Import this backup? It will replace your current boards & settings.')) return;
        state = parsed;
        state.settings = Object.assign(defaultState().settings, state.settings || {});
        if (!state.activeBoardId) state.activeBoardId = state.boards[0].id;
        saveState();
        renderAll();
        closeSettings();
        alert('Backup imported ✓');
      } catch (e) {
        alert('Could not read that file: ' + e.message);
      }
    };
    rd.readAsText(f);
  };
  inp.click();
}

// ---------- Super secret settings ----------
let brandTaps = 0;
let brandTimer = null;
function registerBrandTap() {
  brandTaps += 1;
  clearTimeout(brandTimer);
  brandTimer = setTimeout(() => { brandTaps = 0; }, 800);
  if (brandTaps >= 3) {
    brandTaps = 0;
    clearTimeout(brandTimer);
    openSecret();
  }
}
function openSecret() {
  el('#setEasterEgg').checked = !!state.settings.easterEgg;
  el('#setMeow').checked = !!state.settings.meowOnClick;
  el('#secretModal').hidden = false;
}
function closeSecret() { el('#secretModal').hidden = true; }

// ---------- Wire up UI ----------
function bind() {
  el('#btnAddTask').onclick = () => {
    const v = el('#newTaskInput').value;
    el('#newTaskInput').value = '';
    addTask(v);
  };
  el('#newTaskInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') el('#btnAddTask').click();
  });

  el('#boardName').addEventListener('input', () => {
    activeBoard().name = el('#boardName').value;
    saveState();
    renderBoardTabs();
  });

  el('#btnAddBoard').onclick = addBoard;
  el('#btnDeleteBoard').onclick = deleteBoard;

  // Stickers & polaroid photos
  el('#btnAddSticker').onclick = openStickerPicker;
  el('#btnAddPhoto').onclick = async () => {
    const picked = await api.pickImages();
    if (picked && picked.length) {
      picked.forEach(p => addPolaroid(p.fileUrl || ('file://' + (p.path || '').replace(/\\/g, '/'))));
    }
  };
  el('#btnAddWeb').onclick = () => api.openWebBrowser('photo');
  el('#stickerClose').onclick = closeStickerPicker;
  el('#stickerDone').onclick = closeStickerPicker;
  el('#btnStickerUpload').onclick = async () => {
    const picked = await api.pickImages();
    if (picked && picked.length) {
      picked.forEach(p => addSticker({ src: p.fileUrl || ('file://' + (p.path || '').replace(/\\/g, '/')) }));
      closeStickerPicker();
    }
  };
  el('#btnStickerWeb').onclick = () => { closeStickerPicker(); api.openWebBrowser('sticker'); };

  // Window controls
  el('#btnMin').onclick = () => api.minimize();
  el('#btnClose').onclick = () => api.close();
  el('#btnPin').onclick = togglePin;
  el('#btnSettings').onclick = openSettings;

  // Editor
  el('#modalClose').onclick = closeEditor;
  el('#btnCancelEdit').onclick = closeEditor;
  el('#btnSaveTask').onclick = saveEditor;
  el('#btnDeleteTask').onclick = () => {
    if (!editingId) return;
    if (!confirm('Delete this task?')) return;
    const b = activeBoard();
    b.tasks = b.tasks.filter(x => x.id !== editingId);
    saveState();
    renderTasks();
    closeEditor();
  };
  el('#btnAttachImages').onclick = async () => {
    const t = activeBoard().tasks.find(x => x.id === editingId);
    if (!t) return;
    const picked = await api.pickImages();
    if (picked && picked.length) {
      t.attachments = (t.attachments || []).concat(picked);
      renderAttachList(t.attachments);
    }
  };
  el('#btnAttachFiles').onclick = async () => {
    const t = activeBoard().tasks.find(x => x.id === editingId);
    if (!t) return;
    const picked = await api.pickFiles();
    if (picked && picked.length) {
      t.attachments = (t.attachments || []).concat(picked);
      renderAttachList(t.attachments);
    }
  };

  // Settings
  el('#settingsClose').onclick = closeSettings;
  el('#settingsDone').onclick = () => { commitSettings(); closeSettings(); };
  el('#setStartupPinned').onchange = () => { commitSettings(); };
  el('#setRealistic').onchange = () => { commitSettings(); };
  el('#setHolder').onchange = () => { commitSettings(); renderTasks(); };

  // Super secret settings (open by tapping the app name 3×)
  el('#brandTap').addEventListener('click', registerBrandTap);
  el('#secretClose').onclick = closeSecret;
  el('#secretDone').onclick = closeSecret;
  el('#setEasterEgg').onchange = () => { state.settings.easterEgg = el('#setEasterEgg').checked; saveState(); };
  el('#setMeow').onchange = () => { state.settings.meowOnClick = el('#setMeow').checked; saveState(); };
  el('#testSurprise').onclick = () => { playHamburgerSound(); showSpinningCat(); };
  el('#testSpin').onclick = () => { showSpinningCat(); };
  el('#testMeow').onclick = () => { playMeow(); };
  el('#testConfetti').onclick = () => { showConfetti(); };
  el('#testParade').onclick = () => { showCatParade(); };

  el('#btnCustomBgWeb').onclick = () => api.openWebBrowser('bg');
  el('#btnCustomBg').onclick = async () => {
    const picked = await api.pickImages();
    if (picked && picked.length) {
      const p = picked[0];
      state.settings.customBg = p.fileUrl || ('file://' + (p.path || '').replace(/\\/g, '/'));
      if (!state.settings.realistic) state.settings.realistic = true; // custom bg implies realistic board
      saveState();
      applySettingsToBody();
      refreshSettingsUI();
    }
  };
  el('#btnClearBg').onclick = () => {
    state.settings.customBg = '';
    saveState();
    applySettingsToBody();
    refreshSettingsUI();
  };
  el('#btnOpenSource').onclick = () => api.openSourceFolder();
  el('#btnOpenData').onclick = () => api.openUserDataFolder();
  el('#btnOpenAttach').onclick = () => api.openAttachmentsFolder();
  el('#btnExportBoards').onclick = exportBoards;
  el('#btnImportBoards').onclick = importBoards;
  el('#btnResetAll').onclick = () => {
    if (!confirm('This will wipe all boards, tasks and settings. Are you sure?')) return;
    localStorage.removeItem(LS_KEY);
    state = loadState();
    renderAll();
    closeSettings();
  };
}

// ---------- Boot ----------
async function boot() {
  bind();
  renderAll();

  // 1-in-30 cat meow on any button tap
  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('button') : null;
    if (btn) maybeMeowOnClick();
  }, true);

  // Images grabbed from the in-app web browser
  api.onWebImage((payload) => {
    if (!payload || !payload.item) return;
    const it = payload.item;
    const src = it.fileUrl || (it.path ? 'file://' + it.path.replace(/\\/g, '/') : '');
    if (!src) return;
    if (payload.mode === 'sticker') {
      addSticker({ src });
    } else if (payload.mode === 'bg') {
      state.settings.customBg = src;
      if (!state.settings.realistic) state.settings.realistic = true;
      saveState();
      applySettingsToBody();
      refreshSettingsUI();
    } else {
      addPolaroid(src);
    }
  });

  // Apply "start pinned" preference on launch
  if (state.settings.startupPinned) {
    const res = await api.setPinned(true);
    document.body.classList.toggle('pinned', !!res.pinned);
    el('#btnPin').classList.toggle('active', !!res.pinned);
  }
}
boot();

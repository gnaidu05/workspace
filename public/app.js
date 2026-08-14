'use strict';

const state = {
  view: 'my-drive', // 'my-drive' | 'starred' | 'search'
  folderId: null,
  searchQuery: '',
};

const el = (id) => document.getElementById(id);

// ---------- API helpers ----------
async function api(path, options = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...options });
  if (res.status === 401) {
    window.location.href = '/login.html';
    throw new Error('unauthorized');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function toast(message) {
  const t = el('toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => (t.hidden = true), 2800);
}

// ---------- Formatting ----------
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function iconFor(mime) {
  if (!mime) return '📄';
  if (mime.startsWith('image/')) return '🖼️';
  if (mime.startsWith('video/')) return '🎬';
  if (mime.startsWith('audio/')) return '🎵';
  if (mime === 'application/pdf') return '📕';
  if (mime.includes('zip') || mime.includes('compressed')) return '🗜️';
  if (mime.startsWith('text/') || mime.includes('json') || mime.includes('javascript')) return '📝';
  return '📄';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Rendering ----------
async function loadUser() {
  const { user } = await api('/api/auth/me');
  el('user-name').textContent = user.name;
}

async function loadStorage() {
  try {
    const { used_bytes } = await api('/api/files/storage');
    el('storage-used').textContent = `${formatBytes(used_bytes)} used`;
  } catch {
    /* non-critical */
  }
}

async function renderBreadcrumb() {
  const bc = el('breadcrumb');
  const rootLabel = state.view === 'starred' ? 'Starred' : 'My Drive';
  let html = `<a data-folder="root">${rootLabel}</a>`;

  if (state.view === 'my-drive' && state.folderId) {
    const { breadcrumb } = await api(`/api/folders/${state.folderId}/breadcrumb`);
    breadcrumb.forEach((f, idx) => {
      const isLast = idx === breadcrumb.length - 1;
      html += `<span class="sep">›</span>`;
      html += isLast
        ? `<span class="current">${escapeHtml(f.name)}</span>`
        : `<a data-folder="${f.id}">${escapeHtml(f.name)}</a>`;
    });
  }
  bc.innerHTML = html;
  bc.querySelectorAll('a[data-folder]').forEach((a) => {
    a.addEventListener('click', () => {
      const val = a.dataset.folder;
      openFolder(val === 'root' ? null : parseInt(val, 10));
    });
  });
}

function folderCard(folder) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <span class="icon">📁</span>
    <div class="meta"><div class="name">${escapeHtml(folder.name)}</div></div>
    <div class="actions">
      <button class="icon-btn" data-act="rename" title="Rename">✏️</button>
      <button class="icon-btn" data-act="delete" title="Delete">🗑️</button>
    </div>`;
  card.addEventListener('click', (e) => {
    if (e.target.closest('.actions')) return;
    openFolder(folder.id);
  });
  card.querySelector('[data-act="rename"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    const name = prompt('Rename folder', folder.name);
    if (name && name.trim()) {
      await api(`/api/folders/${folder.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      refresh();
    }
  });
  card.querySelector('[data-act="delete"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (confirm(`Delete "${folder.name}" and everything inside it?`)) {
      await api(`/api/folders/${folder.id}`, { method: 'DELETE' });
      toast('Folder deleted');
      refresh();
    }
  });
  return card;
}

function fileCard(file) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <span class="icon">${iconFor(file.mime_type)}</span>
    <div class="meta">
      <div class="name">${escapeHtml(file.name)}</div>
      <div class="sub">${formatBytes(file.size_bytes)}</div>
    </div>
    <div class="actions">
      <button class="icon-btn ${file.starred ? 'starred' : ''}" data-act="star" title="Star">${file.starred ? '★' : '☆'}</button>
      <button class="icon-btn" data-act="download" title="Download">⬇️</button>
      <button class="icon-btn" data-act="rename" title="Rename">✏️</button>
      <button class="icon-btn" data-act="delete" title="Delete">🗑️</button>
    </div>`;

  card.addEventListener('click', (e) => {
    if (e.target.closest('.actions')) return;
    window.open(`/api/files/${file.id}/raw`, '_blank');
  });
  card.querySelector('[data-act="download"]').addEventListener('click', (e) => {
    e.stopPropagation();
    window.location.href = `/api/files/${file.id}/download`;
  });
  card.querySelector('[data-act="star"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    await api(`/api/files/${file.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ starred: !file.starred }),
    });
    refresh();
  });
  card.querySelector('[data-act="rename"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    const name = prompt('Rename file', file.name);
    if (name && name.trim()) {
      await api(`/api/files/${file.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      refresh();
    }
  });
  card.querySelector('[data-act="delete"]').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (confirm(`Delete "${file.name}"?`)) {
      await api(`/api/files/${file.id}`, { method: 'DELETE' });
      toast('File deleted');
      refresh();
    }
  });
  return card;
}

async function refresh() {
  await renderBreadcrumb();

  const foldersSection = el('folders-section');
  const foldersGrid = el('folders-grid');
  const filesGrid = el('files-grid');
  const filesTitle = el('files-title');
  foldersGrid.innerHTML = '';
  filesGrid.innerHTML = '';

  let folders = [];
  let files = [];

  if (state.view === 'search') {
    foldersSection.hidden = true;
    filesTitle.textContent = `Results for "${state.searchQuery}"`;
    ({ files } = await api(`/api/files?q=${encodeURIComponent(state.searchQuery)}`));
  } else if (state.view === 'starred') {
    foldersSection.hidden = true;
    filesTitle.textContent = 'Starred';
    ({ files } = await api('/api/files?starred=1'));
  } else {
    foldersSection.hidden = false;
    filesTitle.textContent = 'Files';
    const folderQuery = state.folderId ? `?parent_id=${state.folderId}` : '';
    ({ folders } = await api(`/api/folders${folderQuery}`));
    const fileQuery = state.folderId ? `?folder_id=${state.folderId}` : '';
    ({ files } = await api(`/api/files${fileQuery}`));
  }

  folders.forEach((f) => foldersGrid.appendChild(folderCard(f)));
  files.forEach((f) => filesGrid.appendChild(fileCard(f)));

  foldersSection.hidden = state.view !== 'my-drive' || folders.length === 0;
  el('empty-state').hidden = !(folders.length === 0 && files.length === 0);

  loadStorage();
}

// ---------- Navigation ----------
function openFolder(folderId) {
  state.view = 'my-drive';
  state.folderId = folderId;
  el('search-input').value = '';
  setActiveNav('my-drive');
  refresh();
}

function setActiveNav(view) {
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.view === view);
  });
}

// ---------- Uploads ----------
async function uploadFiles(fileList) {
  const files = Array.from(fileList);
  if (files.length === 0) return;
  for (const file of files) {
    const form = new FormData();
    form.append('file', file);
    if (state.view === 'my-drive' && state.folderId) {
      form.append('folder_id', state.folderId);
    }
    try {
      const res = await fetch('/api/files', { method: 'POST', body: form, credentials: 'same-origin' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Upload failed');
      }
    } catch (err) {
      toast(`${file.name}: ${err.message}`);
    }
  }
  toast(files.length === 1 ? 'File uploaded' : `${files.length} files uploaded`);
  refresh();
}

// ---------- Wire up events ----------
function init() {
  el('logout-btn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  el('upload-btn').addEventListener('click', () => el('file-input').click());
  el('file-input').addEventListener('change', (e) => {
    uploadFiles(e.target.files);
    e.target.value = '';
  });

  el('new-folder-btn').addEventListener('click', async () => {
    const name = prompt('New folder name');
    if (name && name.trim()) {
      await api('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), parent_id: state.folderId }),
      });
      openFolder(state.folderId);
    }
  });

  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const view = item.dataset.view;
      state.view = view;
      state.folderId = null;
      el('search-input').value = '';
      setActiveNav(view);
      refresh();
    });
  });

  let searchTimer;
  el('search-input').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    searchTimer = setTimeout(() => {
      if (q) {
        state.view = 'search';
        state.searchQuery = q;
        setActiveNav(null);
        refresh();
      } else {
        openFolder(null);
      }
    }, 250);
  });

  // Drag & drop
  const dz = el('drop-zone');
  ['dragenter', 'dragover'].forEach((evt) =>
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      dz.classList.add('dragover');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    dz.addEventListener(evt, (e) => {
      e.preventDefault();
      if (evt === 'dragleave' && dz.contains(e.relatedTarget)) return;
      dz.classList.remove('dragover');
    })
  );
  dz.addEventListener('drop', (e) => {
    if (state.view !== 'my-drive') openFolder(null);
    uploadFiles(e.dataTransfer.files);
  });

  loadUser().then(refresh).catch(() => {});
}

init();

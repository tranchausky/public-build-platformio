const folderInput = document.querySelector('#folderInput');
const addProjectBtn = document.querySelector('#addProjectBtn');
const refreshBtn = document.querySelector('#refreshBtn');
const savedProjectsEl = document.querySelector('#savedProjects');
const buildListEl = document.querySelector('#buildList');
const currentProjectEl = document.querySelector('#currentProject');
const messageEl = document.querySelector('#message');

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function showMessage(text, type = 'error') {
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }

  messageEl.innerHTML = `<div class="message ${type}">${escapeHtml(text)}</div>`;
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    throw new Error(data?.error || data || `HTTP ${response.status}`);
  }

  return data;
}

async function loadConfig() {
  const config = await api('/api/config');
  renderProjects(config);

  if (config.lastProject) {
    folderInput.value = config.lastProject;
  }
}

function renderProjects(config) {
  const projects = Array.isArray(config.projects) ? config.projects : [];

  if (!projects.length) {
    savedProjectsEl.innerHTML = '<div class="empty">No saved projects yet.</div>';
    return;
  }

  savedProjectsEl.innerHTML = projects.map(folder => {
    const active = folder === config.lastProject ? ' active' : '';
    return `
      <div class="saved-item${active}">
        <button class="saved-select" data-folder="${escapeHtml(folder)}" title="Open project">
          <strong>${escapeHtml(folder.split(/[\\/]/).pop() || folder)}</strong>
          <span>${escapeHtml(folder)}</span>
        </button>
        <button class="remove-btn" data-remove="${escapeHtml(folder)}" title="Remove">×</button>
      </div>
    `;
  }).join('');

  savedProjectsEl.querySelectorAll('[data-folder]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        showMessage('');
        const folder = btn.dataset.folder;
        await api('/api/projects/select', {
          method: 'POST',
          body: JSON.stringify({ folder })
        });
        folderInput.value = folder;
        await refreshAll();
      } catch (error) {
        showMessage(error.message);
      }
    });
  });

  savedProjectsEl.querySelectorAll('[data-remove]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        const folder = btn.dataset.remove;
        await api('/api/projects', {
          method: 'DELETE',
          body: JSON.stringify({ folder })
        });
        await refreshAll();
      } catch (error) {
        showMessage(error.message);
      }
    });
  });
}

async function loadBuilds() {
  buildListEl.innerHTML = '<div class="empty">Scanning...</div>';

  const data = await api('/api/builds');
  currentProjectEl.textContent = data.project || 'No project selected';

  if (!data.project) {
    buildListEl.innerHTML = '<div class="empty">Add a PlatformIO project folder above.</div>';
    return;
  }

  if (!data.builds.length) {
    buildListEl.innerHTML = '<div class="empty">No build containing firmware.bin found in .pio/build.</div>';
    return;
  }

  buildListEl.innerHTML = data.builds.map(build => `
    <article class="build-card">
      <div class="build-head">
        <div>
          <h3>${escapeHtml(build.env)}</h3>
          <span class="chip">${escapeHtml(build.chipFamily)}</span>
        </div>
        <esp-web-install-button manifest="/api/manifest/${encodeURIComponent(build.env)}">
          <button slot="activate" class="install-btn">Install</button>
          <span slot="unsupported">Web Serial is not supported in this browser.</span>
          <span slot="not-allowed">Open this page on localhost or HTTPS.</span>
        </esp-web-install-button>
      </div>

      <div class="files">
        ${build.files.map(file => `
          <div class="file-row">
            <span>${escapeHtml(file.name)}</span>
            <small>${formatBytes(file.size)}</small>
          </div>
        `).join('')}
      </div>
    </article>
  `).join('');
}

async function refreshAll() {
  try {
    showMessage('');
    await loadConfig();
    await loadBuilds();
  } catch (error) {
    showMessage(error.message);
    buildListEl.innerHTML = '';
  }
}

addProjectBtn.addEventListener('click', async () => {
  try {
    showMessage('');
    const folder = folderInput.value.trim();
    if (!folder) return showMessage('Enter a project folder first.');

    await api('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ folder })
    });

    showMessage('Project saved.', 'success');
    await refreshAll();
  } catch (error) {
    showMessage(error.message);
  }
});

folderInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') addProjectBtn.click();
});

refreshBtn.addEventListener('click', loadBuilds);

refreshAll();

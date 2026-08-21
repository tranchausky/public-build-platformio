const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const ROOT = __dirname;
const CONFIG_FILE = path.join(ROOT, 'config.json');

app.use(express.json());
app.use(express.static(path.join(ROOT, 'public')));

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return { projects: [], lastProject: '' };
  }
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

function normalizeProjectFolder(folder) {
  if (!folder || typeof folder !== 'string') return null;
  return path.resolve(folder.trim());
}

function getBuildRoot(projectFolder) {
  return path.join(projectFolder, '.pio', 'build');
}

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function getFileInfo(fullPath) {
  const stat = fs.statSync(fullPath);
  return {
    name: path.basename(fullPath),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString()
  };
}

function detectChipFamily(envName, projectFolder) {
  const lower = envName.toLowerCase();

  if (lower.includes('esp32-s3') || lower.includes('esp32s3')) return 'ESP32-S3';
  if (lower.includes('esp32-s2') || lower.includes('esp32s2')) return 'ESP32-S2';
  if (lower.includes('esp32-c6') || lower.includes('esp32c6')) return 'ESP32-C6';
  if (lower.includes('esp32-c5') || lower.includes('esp32c5')) return 'ESP32-C5';
  if (lower.includes('esp32-c3') || lower.includes('esp32c3')) return 'ESP32-C3';
  if (lower.includes('esp32-c2') || lower.includes('esp32c2')) return 'ESP32-C2';
  if (lower.includes('esp32-h2') || lower.includes('esp32h2')) return 'ESP32-H2';
  if (lower.includes('esp8266')) return 'ESP8266';

  // Small fallback by reading platformio.ini board line inside the env section.
  try {
    const ini = fs.readFileSync(path.join(projectFolder, 'platformio.ini'), 'utf8');
    const sectionRegex = new RegExp(`\\[env:${envName.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\]([\\s\\S]*?)(?=\\n\\[|$)`, 'i');
    const section = ini.match(sectionRegex)?.[1] || '';
    const board = section.match(/^\\s*board\\s*=\\s*(.+?)\\s*$/im)?.[1]?.toLowerCase() || '';

    if (board.includes('s3')) return 'ESP32-S3';
    if (board.includes('s2')) return 'ESP32-S2';
    if (board.includes('c6')) return 'ESP32-C6';
    if (board.includes('c5')) return 'ESP32-C5';
    if (board.includes('c3')) return 'ESP32-C3';
    if (board.includes('c2')) return 'ESP32-C2';
    if (board.includes('h2')) return 'ESP32-H2';
    if (board.includes('8266')) return 'ESP8266';
  } catch {}

  return 'ESP32';
}

function scanBuilds(projectFolder) {
  const buildRoot = getBuildRoot(projectFolder);
  if (!isDirectory(buildRoot)) return [];

  return fs.readdirSync(buildRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => {
      const env = entry.name;
      const envFolder = path.join(buildRoot, env);
      const files = fs.readdirSync(envFolder)
        .filter(name => name.toLowerCase().endsWith('.bin'))
        .map(name => getFileInfo(path.join(envFolder, name)))
        .sort((a, b) => a.name.localeCompare(b.name));

      return {
        env,
        chipFamily: detectChipFamily(env, projectFolder),
        files
      };
    })
    .filter(build => build.files.some(file => file.name === 'firmware.bin'));
}

function getCurrentProject() {
  const config = readConfig();
  return normalizeProjectFolder(config.lastProject);
}

function safeBuildFolder(projectFolder, env) {
  const buildRoot = path.resolve(getBuildRoot(projectFolder));
  const envFolder = path.resolve(buildRoot, env);

  if (!envFolder.startsWith(buildRoot + path.sep)) {
    throw new Error('Invalid environment');
  }

  return envFolder;
}

function makeManifest(projectFolder, env) {
  const envFolder = safeBuildFolder(projectFolder, env);
  if (!isDirectory(envFolder)) throw new Error('Build environment not found');

  const chipFamily = detectChipFamily(env, projectFolder);
  const exists = name => fs.existsSync(path.join(envFolder, name));

  // ESP8266 normally flashes app from address 0.
  if (chipFamily === 'ESP8266') {
    if (!exists('firmware.bin')) throw new Error('firmware.bin not found');
    return {
      name: `PlatformIO - ${env}`,
      version: 'local',
      new_install_prompt_erase: true,
      builds: [{
        chipFamily,
        parts: [{ path: `/firmware/${encodeURIComponent(env)}/firmware.bin`, offset: 0 }]
      }]
    };
  }

  const parts = [];

  // Common PlatformIO ESP32 layout.
  if (exists('bootloader.bin')) {
    parts.push({ path: `/firmware/${encodeURIComponent(env)}/bootloader.bin`, offset: 0x1000 });
  }

  if (exists('partitions.bin')) {
    parts.push({ path: `/firmware/${encodeURIComponent(env)}/partitions.bin`, offset: 0x8000 });
  }

  if (exists('boot_app0.bin')) {
    parts.push({ path: `/firmware/${encodeURIComponent(env)}/boot_app0.bin`, offset: 0xe000 });
  }

  if (exists('firmware.bin')) {
    parts.push({ path: `/firmware/${encodeURIComponent(env)}/firmware.bin`, offset: 0x10000 });
  }

  if (!parts.length || !exists('firmware.bin')) {
    throw new Error('Required firmware files not found');
  }

  return {
    name: `PlatformIO - ${env}`,
    version: 'local',
    new_install_prompt_erase: true,
    builds: [{ chipFamily, parts }]
  };
}

app.get('/api/config', (req, res) => {
  res.json(readConfig());
});

app.post('/api/projects', (req, res) => {
  const folder = normalizeProjectFolder(req.body.folder);

  if (!folder || !isDirectory(folder)) {
    return res.status(400).json({ error: 'Folder does not exist.' });
  }

  const buildRoot = getBuildRoot(folder);
  if (!isDirectory(buildRoot)) {
    return res.status(400).json({ error: 'No .pio/build folder found. Build the PlatformIO project first.' });
  }

  const config = readConfig();
  config.projects = Array.isArray(config.projects) ? config.projects : [];

  if (!config.projects.includes(folder)) {
    config.projects.unshift(folder);
  }

  config.lastProject = folder;
  saveConfig(config);

  res.json({ success: true, config });
});

app.post('/api/projects/select', (req, res) => {
  const folder = normalizeProjectFolder(req.body.folder);
  const config = readConfig();

  if (!folder || !config.projects.includes(folder) || !isDirectory(folder)) {
    return res.status(400).json({ error: 'Saved project folder is invalid.' });
  }

  config.lastProject = folder;
  saveConfig(config);
  res.json({ success: true });
});

app.delete('/api/projects', (req, res) => {
  const folder = normalizeProjectFolder(req.body.folder);
  const config = readConfig();

  config.projects = (config.projects || []).filter(p => normalizeProjectFolder(p) !== folder);
  if (normalizeProjectFolder(config.lastProject) === folder) {
    config.lastProject = config.projects[0] || '';
  }

  saveConfig(config);
  res.json({ success: true, config });
});

app.get('/api/builds', (req, res) => {
  const projectFolder = getCurrentProject();

  if (!projectFolder || !isDirectory(projectFolder)) {
    return res.json({ project: null, builds: [] });
  }

  try {
    res.json({
      project: projectFolder,
      builds: scanBuilds(projectFolder)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/manifest/:env', (req, res) => {
  const projectFolder = getCurrentProject();
  if (!projectFolder) return res.status(400).json({ error: 'No project selected.' });

  try {
    const manifest = makeManifest(projectFolder, req.params.env);
    res.setHeader('Cache-Control', 'no-store');
    res.json(manifest);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/firmware/:env/:file', (req, res) => {
  const projectFolder = getCurrentProject();
  if (!projectFolder) return res.status(400).send('No project selected.');

  const allowedFiles = new Set([
    'firmware.bin',
    'bootloader.bin',
    'partitions.bin',
    'boot_app0.bin'
  ]);

  if (!allowedFiles.has(req.params.file)) {
    return res.status(403).send('Forbidden');
  }

  try {
    const envFolder = safeBuildFolder(projectFolder, req.params.env);
    const filePath = path.resolve(envFolder, req.params.file);

    if (!filePath.startsWith(envFolder + path.sep)) {
      return res.status(403).send('Forbidden');
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).send('File not found');
    }

    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(filePath);
  } catch (error) {
    res.status(400).send(error.message);
  }
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`ESP32 Local Installer: http://localhost:${PORT}`);
});

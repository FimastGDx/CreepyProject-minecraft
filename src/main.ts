import { app, BrowserWindow, Menu, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import { exec, spawn, ChildProcess } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import started from 'electron-squirrel-startup';
import AdmZip from 'adm-zip';
import nodeFetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
import config from "./config";

if (started) app.quit();

type IpcHandler = Promise<{
  ok: boolean;
  data: any;
  error?: undefined;
} | {
  ok: boolean;
  error: any;
  data?: undefined;
}>

// global state
let proxyUrl: string | null = null;
let runningGame: ChildProcess | null = null;
let mainWindow: BrowserWindow | null = null;

const PROXY_CREDS: string = config.proxy;

// version folder
function getVersionsDir(): string {
  if (!app.isPackaged) {
    return path.join(app.getAppPath(), 'versions');
  }
  const exeDir = path.dirname(app.getPath('exe'));
  const updateExe = path.join(exeDir, '..', 'Update.exe');
  if (fs.existsSync(updateExe)) {
    return path.join(exeDir, '..', 'versions');
  }
  return path.join(exeDir, 'versions');
}

// universal fetch (with proxy support)
async function apiFetch(url: string, timeoutMs = 15000): Promise<nodeFetch.Response> {
  const controller = new AbortController();
  const timer = timeoutMs > 0
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  const options: any = { signal: controller.signal };
  if (proxyUrl) {
    options.agent = new HttpsProxyAgent(proxyUrl);
  }

  try {
    const res = await nodeFetch(url, options);
    if (timer) clearTimeout(timer);
    return res;
  } catch (e) {
    if (timer) clearTimeout(timer);
    throw e;
  }
}

// API query (timeout 15s)
ipcMain.handle('api-fetch', async (_e, url: string): IpcHandler => {
  try {
    const res = await apiFetch(url, 15000);
    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

// try reconnect with proxy
ipcMain.handle('try-proxy', async (_e, url: string) => {
  try {
    const agent = new HttpsProxyAgent(PROXY_CREDS);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await nodeFetch(url, { signal: controller.signal, agent } as any);
    clearTimeout(timer);
    const data = await res.json();
    proxyUrl = PROXY_CREDS;
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

// open external link
ipcMain.handle('open-external', async (_e, url: string) => {
  await shell.openExternal(url);
});

// system dialog
ipcMain.handle('show-dialog', async (
  _e,
  type: 'info' | 'error',
  title: string,
  message: string
) => {
  if (type === 'error') {
    dialog.showErrorBox(title, message);
  } else {
    await dialog.showMessageBox(mainWindow!, {
      type: 'info',
      title,
      message,
      buttons: ['OK'],
    });
  }
});

// check version installation
ipcMain.handle('check-version-installed', (_e, versionId: string) => {
  const bootFile = path.join(getVersionsDir(), versionId, 'boot.yml');
  return fs.existsSync(bootFile);
});

// check direct link (s3:// -> https://)
ipcMain.handle('resolve-url', async (_e, rawUrl: string) => {
  if (rawUrl.startsWith('https://')) {
    return { ok: true, url: rawUrl };
  }

  const filename = rawUrl.replace('s3://', '');
  const resolveEndpoint = `https://creepy.fimastgd.forever-host.xyz/files/${filename}`;

  try {
    const res = await apiFetch(resolveEndpoint);

    if (!res.ok) {
      return { ok: false, error: `Resolve endpoint returned HTTP ${res.status}` };
    }

    const contentType = res.headers.get('content-type') ?? '';

    if (contentType.includes('application/json')) {
      const json = await res.json() as any;
      const url: string = json.url ?? json.link ?? json.download_url ?? '';
      if (!url.startsWith('http')) {
        return { ok: false, error: `JSON response has no valid url field: ${JSON.stringify(json)}` };
      }
      return { ok: true, url };
    }

    const directUrl = (await res.text()).trim();

    if (!directUrl.startsWith('http')) {
      return {
        ok: false,
        error: `Resolve endpoint returned unexpected content:\n${directUrl.slice(0, 200)}`
      };
    }

    return { ok: true, url: directUrl };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
});

// download and unpack version
ipcMain.handle('download-version', async (
  event,
  versionId: string,
  downloadUrl: string
) => {
  const versionsDir = getVersionsDir();
  fs.mkdirSync(versionsDir, { recursive: true });

  const zipPath = path.join(versionsDir, `${versionId}.zip`);

  try {
    const res = await apiFetch(downloadUrl, 0);

    if (!res.ok) {
      return { ok: false, error: `Download server returned HTTP ${res.status}: ${res.statusText}` };
    }

    const total = parseInt(res.headers.get('content-length') ?? '0', 10);
    let downloaded = 0;

    // check progress with stream
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        downloaded += chunk.length;
        const pct = total > 0 ? (downloaded / total) * 100 : 0;
        event.sender.send('download-progress', {
          percent: pct.toFixed(1),
          downloadedMB: (downloaded / 1024 / 1024).toFixed(1),
          totalMB: (total / 1024 / 1024).toFixed(1),
        });
        cb(null, chunk);
      }
    });

    const dest = fs.createWriteStream(zipPath);

    // pipeline: correct backpressure + wait full flush to a disk
    await pipeline(
      res.body as NodeJS.ReadableStream,
      counter,
      dest
    );

    // check ZIP signature (PK = 0x50 0x4B)
    const fd = fs.openSync(zipPath, 'r');
    const sig = Buffer.alloc(4);
    fs.readSync(fd, sig, 0, 4, 0);
    fs.closeSync(fd);

    if (sig[0] !== 0x50 || sig[1] !== 0x4B) {
      const preview = fs.readFileSync(zipPath).slice(0, 300).toString('utf8');
      fs.unlinkSync(zipPath);
      return {
        ok: false,
        error: `Downloaded file is not a valid ZIP archive.\nFile preview:\n${preview}`
      };
    }

    // unpack
    event.sender.send('extract-status', { extracting: true });
    await new Promise(r => setTimeout(r, 50));

    const versionDir = path.join(versionsDir, versionId);
    fs.mkdirSync(versionDir, { recursive: true });

    const zip = new AdmZip(zipPath);
    zip.extractAllTo(versionDir, true);
    fs.unlinkSync(zipPath);

    event.sender.send('extract-status', { extracting: false });

    return { ok: true };
  } catch (err: any) {
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    return { ok: false, error: err.message };
  }
});

// launch game
ipcMain.handle('launch-game', (_e, versionId: string) => {
  if (runningGame) {
    return { ok: false, error: 'Game is already running' };
  }

  const versionDir = path.join(getVersionsDir(), versionId);
  const bootFile = path.join(versionDir, 'boot.yml');

  if (!fs.existsSync(bootFile)) {
    return { ok: false, error: 'boot.yml not found' };
  }

  const bootContent = fs.readFileSync(bootFile, 'utf8');

  let cmd = '';

  // variant 1: boot_script: | (YAML scalar-block)
  const blockMatch = bootContent.match(/boot_script:\s*\|\s*\r?\n([\s\S]+?)(?:\r?\n\S|$)/);
  if (blockMatch?.[1]) {
    // Собираем все строки блока, убираем отступы и объединяем
    cmd = blockMatch[1]
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean)
      .join(' ');
  } else {
    // variant 2: boot_script: "command" or boot_script: command (single line)
    const inlineMatch = bootContent.match(/boot_script:\s*["']?(.*?)["']?\s*(?:\r?\n|$)/m);
    if (inlineMatch?.[1]) {
      cmd = inlineMatch[1].trim();
    }
  }

  if (!cmd) {
    return { ok: false, error: 'boot_script not found in boot.yml' };
  }

  runningGame = spawn(cmd, {
    shell: true,
    cwd: versionDir,
    detached: false,
  });

  mainWindow?.webContents.send('game-state', { running: true });

  runningGame.on('exit', () => {
    runningGame = null;
    mainWindow?.webContents.send('game-state', { running: false });
  });

  runningGame.on('error', (err) => {
    runningGame = null;
    mainWindow?.webContents.send('game-state', { running: false, error: err.message });
  });

  return { ok: true };
});

// check game status
ipcMain.handle('is-game-running', () => runningGame !== null);

// check java 8 or java 11 (add later)
ipcMain.handle('check-java-8', (): Promise<boolean> => {
  return new Promise((resolve) => {
    exec('java -version', (_error, stdout, stderr) => {
      const output = (stderr + stdout).toLowerCase();
      resolve(output.includes('"1.8.'));
    });
  });
});
ipcMain.handle('check-java-11', (): Promise<boolean> => {
  return new Promise((resolve) => {
    exec('java -version', (_error, stdout, stderr) => {
      const output = (stderr + stdout).toLowerCase();
      resolve(output.includes('"11.'));
    });
  });
});

// system info
ipcMain.handle('get-system-info', () => ({
  totalRam: Math.round(os.totalmem() / 1024 / 1024),
  freeRam: Math.round(os.freemem() / 1024 / 1024),
  platform: os.platform(),
  cpuModel: os.cpus()[0]?.model ?? 'Unknown',
}));

// window
const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 690,
    resizable: false,
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'assets/img/icon.ico')
      : path.join(__dirname, '../../assets/img/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    );
  }
};

app.on('ready', () => {
  Menu.setApplicationMenu(null);
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
import './index.css';
import config from './config';

// electronAPI types
declare global {
  interface Window {
    electronAPI: {
      checkJava8: () => Promise<boolean>;
      checkJava11: () => Promise<boolean>;
      getSystemInfo: () => Promise<{
        totalRam: number; freeRam: number;
        platform: string; cpuModel: string;
      }>;
      apiFetch: (url: string) => Promise<{ ok: boolean; data?: any; error?: string }>;
      tryProxy: (url: string) => Promise<{ ok: boolean; data?: any; error?: string }>;
      openExternal: (url: string) => Promise<void>;
      showDialog: (type: 'info' | 'error', title: string, message: string) => Promise<void>;
      checkVersionInstalled: (versionId: string) => Promise<boolean>;
      listInstalledVersions: () => Promise<string[]>;
      deleteVersion: (versionId: string) => Promise<{ ok: boolean; error?: string }>;
      resolveUrl: (rawUrl: string) => Promise<{ ok: boolean; url?: string; error?: string }>;
      downloadVersion: (versionId: string, url: string) => Promise<{ ok: boolean; cancelled?: boolean; error?: string }>;
      cancelDownload: () => Promise<{ ok: boolean; error?: string }>;
      launchGame: (versionId: string) => Promise<{ ok: boolean; error?: string }>;
      isGameRunning: () => Promise<boolean>;
      onDownloadProgress: (cb: (d: { percent: string; downloadedMB: string; totalMB: string }) => void) => () => void;
      onExtractStatus: (cb: (d: { extracting: boolean }) => void) => () => void;
      onGameState: (cb: (d: { running: boolean; error?: string }) => void) => () => void;
    };
  }
}

// click sound
const clickSound = new Audio(new URL('../assets/sounds/CP_click01.mp3', import.meta.url).href);
function playClick() {
  clickSound.currentTime = 0;
  clickSound.play().catch(() => { });
}
function addClick(el: HTMLElement | null) {
  el?.addEventListener('click', playClick);
}

// loading screen elements
const loadingScreen = document.getElementById('loading-screen')!;
const mainContent = document.getElementById('main-content')!;
const progressBar = document.getElementById('progress-bar')!;

// status text (below the progress bar)
const loadingStatus = (() => {
  const p = document.createElement('p');
  p.id = 'loading-status';
  p.className = 'r';
  p.style.cssText = 'margin-top:10px;font-size:0.75rem;opacity:0.75;min-height:1.2em;';
  loadingScreen.appendChild(p);
  return p;
})();

// progress variables
const API_URL = 'https://creepy.fimastgd.forever-host.xyz/api/latest-version';

let progress: number = 0;
let apiResponseReceived: boolean = false;
let apiSlowMode: boolean = false;
let loadingComplete: boolean = false;

const TICK: number = 50;

function getProgressStep(): number {
  if (progress < 30) return 1.8;
  if (apiResponseReceived) return 3.0;
  if (apiSlowMode) return 0.04;
  return 0.15;
}

const loadInterval = setInterval((): void => {
  if (loadingComplete) return;
  const max = apiResponseReceived ? 100 : (apiSlowMode ? 55 : 80);
  progress = Math.min(progress + getProgressStep(), max);
  progressBar.style.width = `${progress}%`;
  if (progress >= 100) {
    clearInterval(loadInterval);
    transitionToMain();
  }
}, TICK);

function transitionToMain() {
  if (loadingComplete) return;
  loadingComplete = true;
  setTimeout(() => {
    loadingScreen.style.display = 'none';
    mainContent.style.display = 'block';
    initMain();
  }, 150);
}

// Start: fetch API + proxy fallback
(async () => {
  loadingStatus.textContent = 'Fetching data...';

  const slowTimer = setTimeout(() => { apiSlowMode = true; }, 2500);
  const result = await window.electronAPI.apiFetch(API_URL);
  clearTimeout(slowTimer);
  apiSlowMode = false;

  if (result.ok) {
    handleApiSuccess(result.data);
    return;
  }

  loadingStatus.textContent = '[node:fetch] Connection error, reconnecting with proxy...';
  const proxyResult = await window.electronAPI.tryProxy(API_URL);

  if (proxyResult.ok) {
    handleApiSuccess(proxyResult.data);
    return;
  }

  apiResponseReceived = true;
  await waitForProgress(100);
  transitionToMain();
  await window.electronAPI.showDialog(
    'error',
    'Connection Error',
    '[node:fetch] Can not connect to CreepyProject API, check your network connection'
  );
})();

let latestApiVersion: string = config.current_version;
let latestApiVersionCode: number = config.current_version_code;

function handleApiSuccess(data: { version: string; version_code: number }) {
  latestApiVersion = data.version;
  latestApiVersionCode = data.version_code;
  apiResponseReceived = true;
  loadingStatus.textContent = '';
}

function waitForProgress(target: number): Promise<void> {
  return new Promise(resolve => {
    const id = setInterval(() => {
      if (progress >= target) { clearInterval(id); resolve(); }
    }, 50);
  });
}

// ─────────────────────────────────────────────
// Confirm overlay with 5-second countdown
// ─────────────────────────────────────────────
function showConfirmOverlay(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.88);
      z-index:500;display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:20px;
    `;

    let countdown = 5;

    const warningEl = document.createElement('p');
    warningEl.className = 'c';
    warningEl.style.cssText = 'font-size:1rem;max-width:55%;margin:0;line-height:1.7;color:#fff;';
    warningEl.innerHTML = `
      ⚠ <b>Warning!</b><br><br>
      ${message}<br>
      <span style="opacity:0.7;font-size:0.85rem">All game saves and data for this version will be permanently erased.</span>
    `;

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:12px;margin-top:8px;';

    const cancelBtn = document.createElement('button') as HTMLButtonElement;
    cancelBtn.className = 'main-btn-small';
    cancelBtn.textContent = 'Cancel';

    const continueBtn = document.createElement('button') as HTMLButtonElement;
    continueBtn.className = 'main-btn-small-disabled';
    continueBtn.textContent = `Continue (${countdown}s)`;
    continueBtn.disabled = true;

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(continueBtn);
    overlay.appendChild(warningEl);
    overlay.appendChild(btnRow);
    document.body.appendChild(overlay);

    addClick(cancelBtn);

    const timer = setInterval(() => {
      countdown--;
      if (countdown <= 0) {
        clearInterval(timer);
        continueBtn.className = 'main-btn-small';
        continueBtn.disabled = false;
        continueBtn.textContent = 'Continue';
        addClick(continueBtn);
      } else {
        continueBtn.textContent = `Continue (${countdown}s)`;
      }
    }, 1000);

    cancelBtn.addEventListener('click', () => {
      clearInterval(timer);
      overlay.remove();
      resolve(false);
    });
    continueBtn.addEventListener('click', () => {
      if (continueBtn.disabled) return;
      clearInterval(timer);
      overlay.remove();
      resolve(true);
    });
  });
}

// ─────────────────────────────────────────────
// Manage Versions page — table + action buttons
// ─────────────────────────────────────────────
const managePage = document.getElementById('manage-versions-page')!;

let selectedVersionId: string | null = null;

function openManagePage() {
  selectedVersionId = null;
  mainContent.style.display = 'none';
  managePage.style.display = 'flex';
  loadInstalledVersionsList();
}

function closeManagePage() {
  managePage.style.display = 'none';
  mainContent.style.display = 'block';
}

function updateManageActionButtons() {
  const reinstallBtn = document.getElementById('manage-reinstall-btn') as HTMLButtonElement;
  const deleteBtn = document.getElementById('manage-delete-btn') as HTMLButtonElement;

  const hasSelection = selectedVersionId !== null;
  const canReinstall = hasSelection && !!config.versions.find(v => v.id === selectedVersionId);

  reinstallBtn.className = canReinstall ? 'main-btn-small' : 'main-btn-small-disabled';
  reinstallBtn.disabled = !canReinstall;

  deleteBtn.className = hasSelection ? 'main-btn-small' : 'main-btn-small-disabled';
  deleteBtn.disabled = !hasSelection;
}

async function loadInstalledVersionsList() {
  selectedVersionId = null;
  updateManageActionButtons();

  const tbody = document.getElementById('versions-tbody')!;
  tbody.innerHTML = '<div class="version-row-empty">Loading...</div>';

  const installedIds = await window.electronAPI.listInstalledVersions();
  tbody.innerHTML = '';

  if (installedIds.length === 0) {
    tbody.innerHTML = '<div class="version-row-empty">No versions installed</div>';
    return;
  }

  for (const id of installedIds) {
    const ver = config.versions.find(v => v.id === id);
    const name = ver?.name ?? id;

    const row = document.createElement('div');
    row.className = 'version-row';
    row.dataset.id = id;
    row.textContent = name;

    row.addEventListener('click', () => {
      document.querySelectorAll<HTMLElement>('.version-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      selectedVersionId = id;
      updateManageActionButtons();
    });

    tbody.appendChild(row);
  }
}

async function handleDelete() {
  if (!selectedVersionId) return;
  const id = selectedVersionId;
  const ver = config.versions.find(v => v.id === id);
  const name = ver?.name ?? id;

  const confirmed = await showConfirmOverlay(`You are about to delete <b>"${name}"</b>.`);
  if (!confirmed) return;

  const result = await window.electronAPI.deleteVersion(id);
  if (result.ok) {
    await loadInstalledVersionsList();
  } else {
    await window.electronAPI.showDialog('error', 'Delete Error', result.error ?? 'Unknown error');
  }
}

async function handleReinstall() {
  if (!selectedVersionId) return;
  const id = selectedVersionId;
  const ver = config.versions.find(v => v.id === id);
  if (!ver) return;

  const confirmed = await showConfirmOverlay(
    `You are about to reinstall <b>"${ver.name}"</b>. The version will be deleted and re-downloaded.`
  );
  if (!confirmed) return;

  const delResult = await window.electronAPI.deleteVersion(id);
  if (!delResult.ok) {
    await window.electronAPI.showDialog('error', 'Delete Error', delResult.error ?? 'Failed to delete version');
    return;
  }

  const resolved = await window.electronAPI.resolveUrl(ver.url);
  if (!resolved.ok || !resolved.url) {
    await window.electronAPI.showDialog('error', 'Download Error',
      `Failed to resolve download URL: ${resolved.error ?? 'unknown error'}`);
    return;
  }

  const dummyLabel = document.createElement('p');
  await startDownload(id, resolved.url, dummyLabel);
  await loadInstalledVersionsList();
}

// ─────────────────────────────────────────────
// Main init
// ─────────────────────────────────────────────
async function initMain() {
  document.getElementById('version-display')!.innerHTML =
    `Copyright FimastGD (GPL3 License)<br><br>${config.current_version}`;

  // Java check
  const javaEl = document.getElementById('java-status')!;
  try {
    const hasJava8 = await window.electronAPI.checkJava8();
    const hasJava11 = await window.electronAPI.checkJava11();
    if (hasJava8) {
      javaEl.textContent = 'Java 8 is installed';
      javaEl.style.color = '#ffffff';
    } else if (hasJava11) {
      javaEl.textContent = 'Java 11 is installed';
      javaEl.style.color = '#ffffff';
    } else {
      javaEl.textContent = 'Java 8 / 11 is not installed';
      javaEl.style.color = 'rgb(246,246,44)';
    }
  } catch {
    javaEl.textContent = 'Java status unknown';
  }

  // Update button
  const updateBtn = document.getElementById('update-btn')!;
  const needsUpdate = latestApiVersionCode > config.current_version_code;

  if (needsUpdate) {
    enableButton(updateBtn, 'main-btn-small');
    addClick(updateBtn);
    updateBtn.addEventListener('click', () => {
      window.electronAPI.openExternal(
        `https://github.com/FimastGDx/CreepyProject-minecraft/releases/tag/${latestApiVersion}`
      );
    });
    await window.electronAPI.showDialog(
      'info',
      'Update available',
      `Update available! Click 'Update' button to download new launcher version`
    );
  }

  // GitHub button
  const githubBtn = document.getElementById('github-btn')!;
  addClick(githubBtn);
  githubBtn.addEventListener('click', () => {
    window.electronAPI.openExternal('https://github.com/FimastGDx/CreepyProject-minecraft');
  });

  // Quit button
  const quitBtn = document.getElementById('quit-btn')!;
  addClick(quitBtn);
  quitBtn.addEventListener('click', () => window.close());

  // Manage Versions — open
  const manageBtn = document.getElementById('manage-btn')!;
  addClick(manageBtn);
  manageBtn.addEventListener('click', () => openManagePage());

  // Manage page — Back
  const manageBackBtn = document.getElementById('manage-back-btn')!;
  addClick(manageBackBtn);
  manageBackBtn.addEventListener('click', () => closeManagePage());

  // Manage page — Delete
  const manageDeleteBtn = document.getElementById('manage-delete-btn') as HTMLButtonElement;
  manageDeleteBtn.addEventListener('click', () => {
    if (!manageDeleteBtn.disabled) { playClick(); handleDelete(); }
  });

  // Manage page — Reinstall
  const manageReinstallBtn = document.getElementById('manage-reinstall-btn') as HTMLButtonElement;
  manageReinstallBtn.addEventListener('click', () => {
    if (!manageReinstallBtn.disabled) { playClick(); handleReinstall(); }
  });

  // Version selector
  let versionIndex = 0;
  const versionBtn = document.getElementById('version-btn')!;
  const selectVersionLabel = document.getElementById('select-version-label')!;

  versionBtn.textContent = config.versions[0]?.name ?? 'N/A';
  addClick(versionBtn);

  versionBtn.addEventListener('click', () => {
    versionIndex = (versionIndex + 1) % config.versions.length;
    versionBtn.textContent = config.versions[versionIndex].name;
    selectVersionLabel.textContent = 'Select version:';
    selectVersionLabel.style.color = '';
  });

  // Launch button
  const launchBtn = document.getElementById('launch-btn')!;
  addClick(launchBtn);

  let gameRunning = await window.electronAPI.isGameRunning();
  setLaunchEnabled(!gameRunning);

  window.electronAPI.onGameState((state) => {
    gameRunning = state.running;
    setLaunchEnabled(!state.running);
  });

  launchBtn.addEventListener('click', async () => {
    if (gameRunning) return;

    const ver = config.versions[versionIndex];
    if (!ver) return;

    const installed = await window.electronAPI.checkVersionInstalled(ver.id);

    if (!installed) {
      const resolved = await window.electronAPI.resolveUrl(ver.url);
      if (!resolved.ok || !resolved.url) {
        await window.electronAPI.showDialog('error', 'Download Error',
          `Failed to resolve download URL: ${resolved.error ?? 'unknown error'}`);
        return;
      }
      await startDownload(ver.id, resolved.url, selectVersionLabel);

      const nowInstalled = await window.electronAPI.checkVersionInstalled(ver.id);
      if (!nowInstalled) return;
    }

    const result = await window.electronAPI.launchGame(ver.id);
    if (!result.ok) {
      await window.electronAPI.showDialog('error', 'Launch Error',
        result.error ?? 'Failed to launch game');
    }
  });

  initDebug();
}

// ─────────────────────────────────────────────
// Download overlay (with Cancel button)
// ─────────────────────────────────────────────
async function startDownload(
  versionId: string,
  url: string,
  labelEl: HTMLElement
): Promise<void> {
  const overlay = createDownloadOverlay();
  document.body.appendChild(overlay);
  overlay.style.display = 'flex';

  const bar = overlay.querySelector<HTMLElement>('#dl-bar')!;
  const infoText = overlay.querySelector<HTMLElement>('#dl-info')!;
  const titleText = overlay.querySelector<HTMLElement>('#dl-title')!;
  const cancelBtn = overlay.querySelector<HTMLButtonElement>('#dl-cancel-btn')!;

  addClick(cancelBtn);

  let cancelRequested = false;
  cancelBtn.addEventListener('click', async () => {
    if (cancelRequested) return;
    cancelRequested = true;
    cancelBtn.disabled = true;
    cancelBtn.className = 'main-btn-small-disabled';
    cancelBtn.textContent = 'Cancelling...';
    await window.electronAPI.cancelDownload();
  });

  const unsub = window.electronAPI.onDownloadProgress(({ percent, downloadedMB, totalMB }) => {
    bar.style.width = `${percent}%`;
    infoText.textContent = `${percent}% — ${downloadedMB} MB / ${totalMB} MB`;
  });

  const unsubExtract = window.electronAPI.onExtractStatus(({ extracting }) => {
    if (extracting) {
      titleText.textContent = 'Extracting...';
      bar.style.width = '100%';
      infoText.textContent = 'Please wait...';
      cancelBtn.style.display = 'none';
    }
  });

  const result = await window.electronAPI.downloadVersion(versionId, url);
  unsub();
  unsubExtract();
  overlay.remove();

  if (result.cancelled) return;

  if (result.ok) {
    labelEl.textContent = 'Download completed!';
    labelEl.style.color = '#4cff6e';
  } else {
    await window.electronAPI.showDialog('error', 'Download Error',
      result.error ?? 'Unknown download error');
  }
}

function createDownloadOverlay(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.78);
    z-index:200;display:none;flex-direction:column;
    align-items:center;justify-content:center;gap:12px;
  `;
  wrap.innerHTML = `
    <p class="r" id="dl-title" style="font-size:1rem;margin:0">Downloading...</p>
    <div class="progress-container" style="width:55%">
      <div class="progress-bar-fill" id="dl-bar"></div>
    </div>
    <p class="r" id="dl-info" style="margin:0;font-size:0.8rem;opacity:0.85">0% — 0 MB / 0 MB</p>
    <button class="main-btn-small" id="dl-cancel-btn" style="margin-top:4px;">Cancel</button>
  `;
  return wrap;
}

// ─────────────────────────────────────────────
// Button utils
// ─────────────────────────────────────────────
function enableButton(el: HTMLElement, cls: string) {
  el.className = cls;
}

function setLaunchEnabled(enabled: boolean) {
  const btn = document.getElementById('launch-btn')! as HTMLButtonElement;
  btn.className = enabled ? 'main-btn' : 'main-btn-disabled';
  btn.disabled = !enabled;
}

// ─────────────────────────────────────────────
// FPS + debug overlay
// ─────────────────────────────────────────────
function initDebug() {
  const overlay = document.getElementById('debug-overlay')!;
  const fpsEl = document.getElementById('debug-fps')!;
  const ramEl = document.getElementById('debug-ram')!;
  const platEl = document.getElementById('debug-platform')!;
  const cpuEl = document.getElementById('debug-cpu')!;
  const appMemEl = document.getElementById('debug-app-mem')!;

  overlay.style.display = 'block';

  if (config.debug) {
    [ramEl, platEl, cpuEl, appMemEl].forEach(el => el.style.display = 'block');
    window.electronAPI.getSystemInfo().then(info => {
      platEl.textContent = `Platform: ${info.platform}`;
      cpuEl.textContent = `CPU: ${info.cpuModel}`;
    });
    setInterval(async () => {
      const info = await window.electronAPI.getSystemInfo();
      ramEl.textContent = `System RAM: ${info.freeRam} MB free / ${info.totalRam} MB`;
      const appMem = Math.round(((performance as any).memory?.usedJSHeapSize ?? 0) / 1024 / 1024);
      appMemEl.textContent = `Used RAM: ${appMem} MB`;
    }, 1000);
  } else {
    [ramEl, platEl, cpuEl, appMemEl].forEach(el => el.style.display = 'none');
  }

  let lastTime = performance.now();
  let frames = 0;
  const tick = () => {
    frames++;
    const now = performance.now();
    if (now - lastTime >= 1000) {
      fpsEl.textContent = `FPS: ${frames}`;
      frames = 0;
      lastTime = now;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
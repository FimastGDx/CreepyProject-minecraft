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
      resolveUrl: (rawUrl: string) => Promise<{ ok: boolean; url?: string; error?: string }>;
      downloadVersion: (versionId: string, url: string) => Promise<{ ok: boolean; error?: string }>;
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

// status text (bottom to the progressbar)
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

const TICK: number = 50; // ms

// progress speed in % for tick
function getProgressStep(): number {
  if (progress < 30) return 1.8;           // fast answer
  if (apiResponseReceived) return 3.0;     // fast loading
  if (apiSlowMode) return 0.04;            // slow API
  return 0.15;                             // normal loading
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

// goto main menu
function transitionToMain() {
  if (loadingComplete) return;
  loadingComplete = true;
  setTimeout(() => {
    loadingScreen.style.display = 'none';
    mainContent.style.display = 'block';
    initMain();
  }, 150);
}

// Start: fetch-api and proxy-fallback
(async () => {
  loadingStatus.textContent = 'Fetching data...';

  // фfter 2.5 seconds without a response, switch to "slow mode"
  const slowTimer = setTimeout(() => { apiSlowMode = true; }, 2500);

  const result = await window.electronAPI.apiFetch(API_URL);
  clearTimeout(slowTimer);
  apiSlowMode = false;

  if (result.ok) {
    handleApiSuccess(result.data);
    return;
  }

  // аailed - we are trying the proxy
  loadingStatus.textContent = '[node:fetch] Connection error, reconnecting with proxy...';
  const proxyResult = await window.electronAPI.tryProxy(API_URL);

  if (proxyResult.ok) {
    handleApiSuccess(proxyResult.data);
    return;
  }

  // сomplete failure - we show the main + error
  apiResponseReceived = true; // unlock progress to 100
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

// main init
async function initMain() {
  // launcher version
  document.getElementById('version-display')!.innerHTML = `Copyright FimastGD (GPL3 License)<br><br>${config.current_version}`;

  // Java checking
  const javaEl = document.getElementById('java-status')!;
  try {
    const hasJava8: boolean = await window.electronAPI.checkJava8();
    const hasJava11: boolean = await window.electronAPI.checkJava11();
    if (hasJava8) {
      javaEl.textContent = 'Java 8 is installed';
      javaEl.style.color = '#ffffff';
    } else if (hasJava11) {
      javaEl.textContent = 'Java 11 is installed';
      javaEl.style.color = '#ffffff';
    } else {
      javaEl.textContent = "Java 8 / 11 is not installed";
      javaEl.style.color = 'rgb(246,246,44)';
    }
  } catch {
    javaEl.textContent = 'Java status unknown';
  }

  // "Update" button
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

  // "GitHub" button
  const githubBtn = document.getElementById('github-btn')!;
  addClick(githubBtn);
  githubBtn.addEventListener('click', () => {
    window.electronAPI.openExternal(
      'https://github.com/FimastGDx/CreepyProject-minecraft'
    );
  });

  // Quit
  const quitBtn = document.getElementById('quit-btn')!;
  addClick(quitBtn);
  quitBtn.addEventListener('click', () => window.close());

  // version selector
  let versionIndex = 0;
  const versionBtn = document.getElementById('version-btn')!;
  const selectVersionLabel = document.getElementById('select-version-label')!;

  versionBtn.textContent = config.versions[0]?.name ?? 'N/A';
  addClick(versionBtn);

  versionBtn.addEventListener('click', () => {
    versionIndex = (versionIndex + 1) % config.versions.length;
    versionBtn.textContent = config.versions[versionIndex].name;
    // reset label "Download completed!" after version changing
    selectVersionLabel.textContent = 'Select version:';
    selectVersionLabel.style.color = '';
  });

  // Launch Game
  const launchBtn = document.getElementById('launch-btn')!;
  addClick(launchBtn);

  // monitoring the state of the game
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
      // need to download
      const resolved = await window.electronAPI.resolveUrl(ver.url);
      if (!resolved.ok || !resolved.url) {
        await window.electronAPI.showDialog('error', 'Download Error',
          `Failed to resolve download URL: ${resolved.error ?? 'unknown error'}`);
        return;
      }

      await startDownload(ver.id, resolved.url, selectVersionLabel);

      // check download
      const nowInstalled = await window.electronAPI.checkVersionInstalled(ver.id);
      if (!nowInstalled) return;
    }

    const result = await window.electronAPI.launchGame(ver.id);
    if (!result.ok) {
      await window.electronAPI.showDialog('error', 'Launch Error',
        result.error ?? 'Failed to launch game');
    }
  });

  // debug overlay
  initDebug();
}

// version loading
async function startDownload(
  versionId: string,
  url: string,
  labelEl: HTMLElement
): Promise<void> {
  // overlay
  const overlay = createDownloadOverlay();
  document.body.appendChild(overlay);
  overlay.style.display = 'flex';

  const bar = overlay.querySelector<HTMLElement>('#dl-bar')!;
  const infoText = overlay.querySelector<HTMLElement>('#dl-info')!;
  const titleText = overlay.querySelector<HTMLElement>('#dl-title')!;

  const unsub = window.electronAPI.onDownloadProgress(({ percent, downloadedMB, totalMB }) => {
    bar.style.width = `${percent}%`;
    infoText.textContent = `${percent}% — ${downloadedMB} MB / ${totalMB} MB`;
  });

  const unsubExtract = window.electronAPI.onExtractStatus(({ extracting }) => {
    if (extracting) {
      titleText.textContent = 'Extracting...';
      bar.style.width = '100%';
      infoText.textContent = 'Please wait...';
    }
  });

  const result = await window.electronAPI.downloadVersion(versionId, url);
  unsub();
  unsubExtract();
  overlay.remove();

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
  `;
  return wrap;
}

// button utils
function enableButton(el: HTMLElement, cls: string) {
  el.className = cls;
}

function setLaunchEnabled(enabled: boolean) {
  const btn = document.getElementById('launch-btn')!;
  btn.className = enabled ? 'main-btn' : 'main-btn-disabled';
  (btn as HTMLButtonElement).disabled = !enabled;
}

// FPS + debug
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
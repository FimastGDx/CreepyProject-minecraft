import { contextBridge, ipcRenderer } from 'electron';

type DownloadProgressData = {
    percent: string;
    downloadedMB: string;
    totalMB: string;
};

type GameStateData = {
    running: boolean;
    error?: string;
};

contextBridge.exposeInMainWorld('electronAPI', {
    checkJava8: (): Promise<boolean> =>
        ipcRenderer.invoke('check-java-8'),
    checkJava11: (): Promise<boolean> =>
        ipcRenderer.invoke('check-java-11'),

    getSystemInfo: (): Promise<{
        totalRam: number;
        freeRam: number;
        platform: string;
        cpuModel: string;
    }> => ipcRenderer.invoke('get-system-info'),

    // network
    apiFetch: (url: string): Promise<{ ok: boolean; data?: any; error?: string }> =>
        ipcRenderer.invoke('api-fetch', url),

    tryProxy: (url: string): Promise<{ ok: boolean; data?: any; error?: string }> =>
        ipcRenderer.invoke('try-proxy', url),

    // dialogs / navigation
    openExternal: (url: string): Promise<void> =>
        ipcRenderer.invoke('open-external', url),

    showDialog: (
        type: 'info' | 'error',
        title: string,
        message: string
    ): Promise<void> => ipcRenderer.invoke('show-dialog', type, title, message),

    // versions
    checkVersionInstalled: (versionId: string): Promise<boolean> =>
        ipcRenderer.invoke('check-version-installed', versionId),

    resolveUrl: (rawUrl: string): Promise<{ ok: boolean; url?: string; error?: string }> =>
        ipcRenderer.invoke('resolve-url', rawUrl),

    downloadVersion: (
        versionId: string,
        downloadUrl: string
    ): Promise<{ ok: boolean; error?: string }> =>
        ipcRenderer.invoke('download-version', versionId, downloadUrl),

    // game
    launchGame: (versionId: string): Promise<{ ok: boolean; error?: string }> =>
        ipcRenderer.invoke('launch-game', versionId),

    isGameRunning: (): Promise<boolean> =>
        ipcRenderer.invoke('is-game-running'),

    // events
    onDownloadProgress: (callback: (data: DownloadProgressData) => void) => {
        const handler = (_e: Electron.IpcRendererEvent, data: DownloadProgressData) =>
            callback(data);
        ipcRenderer.on('download-progress', handler);
        return () => ipcRenderer.removeListener('download-progress', handler);
    },

    onExtractStatus: (callback: (data: { extracting: boolean }) => void) => {
        const handler = (_e: Electron.IpcRendererEvent, data: { extracting: boolean }) =>
            callback(data);
        ipcRenderer.on('extract-status', handler);
        return () => ipcRenderer.removeListener('extract-status', handler);
    },

    onGameState: (callback: (data: GameStateData) => void) => {
        const handler = (_e: Electron.IpcRendererEvent, data: GameStateData) =>
            callback(data);
        ipcRenderer.on('game-state', handler);
        return () => ipcRenderer.removeListener('game-state', handler);
    },
});
const { contextBridge, ipcRenderer } = require('electron');

const controlPlaneUrl = String(
  process.env.SINGULARITY_CONTROL_PLANE_URL || 'http://127.0.0.1:3001',
).replace(/\/+$/, '');

contextBridge.exposeInMainWorld('singularityDesktop', {
  isDesktop: true,
  controlPlaneUrl,
  getShellContext: () => ipcRenderer.invoke('desktop:get-shell-context'),
  pingWorker: () => ipcRenderer.invoke('desktop:worker:ping'),
  getRuntimeStatus: () => ipcRenderer.invoke('desktop:runtime:status'),
  setActorContext: actor => ipcRenderer.invoke('desktop:runtime:actor-context', { actor }),
  setRuntimeToken: token => ipcRenderer.invoke('desktop:runtime:set-token', { token }),
  clearRuntimeToken: () => ipcRenderer.invoke('desktop:runtime:clear-token'),
  listRuntimeProviders: () => ipcRenderer.invoke('desktop:runtime:providers:list'),
  saveRuntimeProviderConfig: payload =>
    ipcRenderer.invoke('desktop:runtime:providers:config:set', payload || {}),
  validateRuntimeProvider: payload =>
    ipcRenderer.invoke('desktop:runtime:providers:validate', payload || {}),
  probeRuntimeProvider: payload =>
    ipcRenderer.invoke('desktop:runtime:providers:probe', payload || {}),
  getRuntimeProviderModels: providerKey =>
    ipcRenderer.invoke('desktop:runtime:providers:models', { providerKey }),
  setEmbeddingConfig: payload =>
    ipcRenderer.invoke('desktop:runtime:set-embedding-config', payload || {}),
  clearEmbeddingConfig: () => ipcRenderer.invoke('desktop:runtime:clear-embedding-config'),
  getDesktopPreferences: () => ipcRenderer.invoke('desktop:runtime:preferences:get'),
  setDesktopPreferences: prefs => ipcRenderer.invoke('desktop:runtime:preferences:set', prefs || {}),
  sendRuntimeChat: payload => ipcRenderer.invoke('desktop:runtime:chat', payload),
  claimCapabilityExecution: payload =>
    ipcRenderer.invoke('desktop:runtime:execution:claim', payload),
  releaseCapabilityExecution: payload =>
    ipcRenderer.invoke('desktop:runtime:execution:release', payload),
  streamRuntimeChat: (payload, onEvent) => {
    const streamId =
      payload?.streamId ||
      `desktop-chat-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
    const channel = `desktop:runtime:chat-stream:${streamId}`;
    const listener = (_event, eventPayload) => {
      if (typeof onEvent === 'function') {
        onEvent(eventPayload);
      }
    };

    ipcRenderer.on(channel, listener);

    return ipcRenderer
      .invoke('desktop:runtime:chat-stream', {
        streamId,
        ...payload,
      })
      .finally(() => {
        ipcRenderer.removeListener(channel, listener);
      });
  },
  cancelRuntimeChatStream: streamId =>
    ipcRenderer.invoke('desktop:runtime:chat-stream:cancel', { streamId }),
  listLocalConnectors: () => ipcRenderer.invoke('desktop:local-connectors:list'),
  saveLocalConnector: payload => ipcRenderer.invoke('desktop:local-connectors:save', payload),
  deleteLocalConnector: provider =>
    ipcRenderer.invoke('desktop:local-connectors:delete', { provider }),
  validateLocalConnector: provider =>
    ipcRenderer.invoke('desktop:local-connectors:validate', { provider }),
});

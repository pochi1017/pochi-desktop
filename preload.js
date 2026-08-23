const { contextBridge, ipcRenderer } = require('electron');

// 오버레이 제어: 패널 위에서만 클릭을 받도록 main에 알림 + 트레이 토글 수신
contextBridge.exposeInMainWorld('pochiOverlay', {
  setInteractive: (on) => ipcRenderer.send('overlay:interactive', !!on),
  onToggle: (cb) => ipcRenderer.on('overlay:toggle', () => cb()),

  // 책갈피 위치·패널 크기 저장/복원
  loadState: () => ipcRenderer.invoke('overlay:load'),
  saveState: (state) => ipcRenderer.send('overlay:save', state),
});

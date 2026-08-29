const { contextBridge, ipcRenderer } = require('electron');

// 오버레이 제어: 패널 위에서만 클릭을 받도록 main에 알림 + 트레이 토글 수신
contextBridge.exposeInMainWorld('pochiOverlay', {
  setInteractive: (on) => ipcRenderer.send('overlay:interactive', !!on),
  onToggle: (cb) => ipcRenderer.on('overlay:toggle', () => cb()),

  // 책갈피 위치·패널 크기 저장/복원
  loadState: () => ipcRenderer.invoke('overlay:load'),
  saveState: (state) => ipcRenderer.send('overlay:save', state),

  // 노션 OAuth 콜백 URL(schedule.pochi-day.com?code=)을 메인 앱 iframe으로 전달받기 위한 수신구.
  // (교환은 반드시 iframe 파티션 안에서 해야 토큰을 앱이 읽을 수 있음 — 저장소 파티셔닝 때문)
  onNotionCallback: (cb) => ipcRenderer.on('notion:callback', (e, url) => cb(url)),
});

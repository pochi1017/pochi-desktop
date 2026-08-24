const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let win, tray;

// 책갈피 위치·패널 크기 저장 (껐다 켜도 그대로)
const storeFile = () => path.join(app.getPath('userData'), 'overlay-state.json');

function readState() {
  try { return JSON.parse(fs.readFileSync(storeFile(), 'utf8')); } catch (e) { return {}; }
}

function writeState(state) {
  // 바로 덮어쓰면 쓰기 실패 시 0바이트로 날아감 → temp 쓰고 rename
  try {
    const tmp = storeFile() + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, storeFile());
  } catch (e) {}
}

function createWindow() {
  const b = screen.getPrimaryDisplay().bounds; // 전체 화면 영역
  win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    frame: false,
    transparent: true,        // 투명 → 실제 바탕화면이 비침
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,        // 작업표시줄에 안 뜸 (위젯)
    alwaysOnTop: true,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 기본: 클릭 통과(바탕화면/다른 앱 조작 가능) + 마우스 이동은 렌더러로 전달
  win.setIgnoreMouseEvents(true, { forward: true });

  win.webContents.setWindowOpenHandler(({ url }) => {
    // 구글/Firebase 로그인 팝업 → 앱 위에 크게 중앙 정렬된 창으로 (구글은 iframe 임베드를 막음).
    // Firebase Auth는 pochi-*.firebaseapp.com/__/auth/handler 팝업을 먼저 열므로 이것도 허용해야 한다.
    if (/^https:\/\/(accounts\.google\.com|[a-z0-9-]+\.googleusercontent\.com|[a-z0-9-]+\.firebaseapp\.com)\//.test(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 620,
          height: 760,
          center: true,
          parent: win,
          modal: true,
          transparent: false,
          frame: true,
          resizable: true,
          autoHideMenuBar: true,
          backgroundColor: '#ffffff',
          title: '구글 로그인',
        },
      };
    }
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// 렌더러가 "패널 위에 커서 있음/없음"을 알려주면 클릭 통과 토글
ipcMain.handle('overlay:load', () => readState());
ipcMain.on('overlay:save', (e, state) => {
  if (state && typeof state === 'object') writeState(state);
});

ipcMain.on('overlay:interactive', (e, on) => {
  if (!win) return;
  if (on) win.setIgnoreMouseEvents(false);
  else win.setIgnoreMouseEvents(true, { forward: true });
});

function makeTray() {
  let icon = nativeImage.createFromPath(path.join(__dirname, 'tray-icon.png'));
  if (!icon.isEmpty()) icon = icon.resize({ width: 18, height: 18 });
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('포치 (Pochi)');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '패널 접기 / 펴기', click: () => win && win.webContents.send('overlay:toggle') },
    { label: '새로고침', click: () => win && win.webContents.reload() },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]));
  tray.on('click', () => win && win.webContents.send('overlay:toggle'));
}

app.whenReady().then(() => {
  createWindow();
  makeTray();
});

// 트레이 상주형: 창이 닫혀도 앱은 트레이에 남음 (종료는 트레이 메뉴)
app.on('window-all-closed', () => {});

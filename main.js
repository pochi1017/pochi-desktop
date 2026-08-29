const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let win, tray;

// 표시 이름은 "포치 캘린더북". 단 상태 저장 경로(userData)는 기존 pochi-desktop으로 고정해야
// 위젯 위치·크기(overlay-state.json)가 초기화되지 않는다. appData 루트는 앱 이름과 무관하므로 안전.
try { app.setPath('userData', path.join(app.getPath('appData'), 'pochi-desktop')); } catch (e) {}
app.setName('포치 캘린더북');
if (process.platform === 'win32') app.setAppUserModelId('com.pochi.calendarbook');
// 창·작업표시줄 아이콘 = 당근(트레이와 동일 원본). 지정 안 하면 기본 Electron 아이콘이 뜬다.
const appIcon = nativeImage.createFromPath(path.join(__dirname, 'tray-icon.png'));

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
    title: '포치 캘린더북',
    icon: appIcon,
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
          icon: appIcon,
          title: '구글 로그인',
        },
      };
    }
    // 노션 OAuth 연결 → 앱 위 중앙 창으로. 외부 브라우저로 새면 redirect(schedule.pochi-day.com?code=)의
    // 코드 회수·세션(IndexedDB)이 위젯과 분리돼 연결이 안 잡힌다. authorize는 api.notion.com,
    // 로그인/워크스페이스 선택은 notion.so/notion.com에서 진행되므로 노션 도메인 전체를 이 창으로 연다.
    if (/^https:\/\/([a-z0-9-]+\.)?notion\.(so|com)\//.test(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 760,
          height: 860,
          center: true,
          // 모달·부모 종속 없음: 연결이 실패(예: 게스트 403)해도 메인 캘린더북을 계속 클릭할 수 있어야 한다.
          // 대신 alwaysOnTop으로 투명 오버레이(screen-saver 레벨) 위에 뜨게 한다.
          alwaysOnTop: true,
          transparent: false,
          frame: true,
          resizable: true,
          autoHideMenuBar: true,
          backgroundColor: '#ffffff',
          icon: appIcon,
          title: '노션 연결',
        },
      };
    }
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // 노션 연결 자식 창 후처리
  win.webContents.on('did-create-window', (child, details) => {
    try {
      if (!/^https:\/\/([a-z0-9-]+\.)?notion\.(so|com)\//.test(details.url || '')) return;
      // 투명 오버레이(screen-saver 레벨) 위에 확실히 뜨게. 모달이 아니므로 메인은 계속 클릭 가능.
      try { child.setAlwaysOnTop(true, 'screen-saver'); } catch (_) {}
      // 노션 연결은 이 한 창 안에서만 진행한다: 워크스페이스 선택·오류 확인 등에서 target=_blank가 나와도
      // 새 창을 띄우지 않고 같은 창에서 이동한다(사용자가 "새 창이 계속 열린다"고 한 문제). 콜백(redirect_uri)도 같은 창.
      child.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https:\/\/([a-z0-9-]+\.)?notion\.(so|com)\//.test(url) ||
            /^https:\/\/schedule\.pochi-day\.com\//.test(url)) {
          try { child.webContents.loadURL(url); } catch (_) {}
          return { action: 'deny' };
        }
        if (/^https?:\/\//.test(url)) shell.openExternal(url);
        return { action: 'deny' };
      });
      // 승인·저장이 끝나면 앱이 document.title='pochi:notion-done'을 세운다 → 그 창을 닫는다.
      child.webContents.on('page-title-updated', (e, title) => {
        if (title === 'pochi:notion-done') { try { child.close(); } catch (_) {} }
      });
    } catch (_) {}
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
  tray.setToolTip('포치 캘린더북');
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

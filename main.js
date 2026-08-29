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

// ── 노션 OAuth 교환을 데스크톱(Node)에서 단 한 번 수행 ──────────────────────────
// child 인증창과 iframe이 같은 1회용 code를 각각 교환하던 레이스(invalid_grant)를 원천 차단.
// Node fetch는 CORS 없음(실측: 프록시가 Node POST에 JSON 응답). 결과 {token,dbId,...}만 iframe에 전달.
const ZZ_PROXY = 'https://script.google.com/macros/s/AKfycbwZ1MYe13y_ePdU3nqNfz4IBQRUrGDeqlExtl8Uogn12Z7S_3E9erlkXMCBNgFqaGMKtw/exec';
function zzLog(msg) {
  try { fs.appendFileSync(path.join(app.getPath('userData'), 'notion-debug.log'), new Date().toISOString() + ' ' + msg + '\n'); } catch (e) {}
}
function zzNotionExchange(callbackUrl) {
  try {
    const u = new URL(callbackUrl);
    const code = u.searchParams.get('code');
    const mode = u.searchParams.get('state') || 'new';
    if (!code) { zzLog('exchange: no code'); return; }
    zzLog('exchange start mode=' + mode + ' code=' + code.slice(0, 8) + '…');
    try { win && win.webContents.send('notion:result', { pending: true }); } catch (e) {}  // 앱에 "연결 중" 표시
    fetch(ZZ_PROXY, { method: 'POST', body: JSON.stringify({ action: 'oauth_exchange', code: code, mode: mode }) })
      .then((r) => r.text())
      .then((t) => {
        let j; try { j = JSON.parse(t); } catch (e) { j = { ok: false, error: 'parse: ' + t.slice(0, 150) }; }
        zzLog('exchange result: ' + JSON.stringify({ ok: j.ok, dbId: j.dbId, ws: j.workspace, error: j.error }));
        try { win && win.webContents.send('notion:result', j); } catch (e) {}
      })
      .catch((e) => {
        zzLog('exchange fetch err: ' + String(e));
        try { win && win.webContents.send('notion:result', { ok: false, error: String(e) }); } catch (_) {}
      });
  } catch (e) { zzLog('exchange throw: ' + String(e)); }
}

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

      // 콜백(schedule.pochi-day.com)에 도달하면 보이는 창에 캘린더북을 렌더하지 않는다.
      //  - code 있음(승인 성공): 콜백 URL을 메인 창(렌더러)으로 보내 **메인 앱 iframe 안에서** 교환하게 한다.
      //    ⚠️ 위젯 앱은 file:// 안 iframe이라 저장소가 top-level 창과 파티션 분리됨(실측 확인). 별도 창에서
      //    교환하면 토큰이 다른 파티션에 저장돼 앱이 못 읽는다 → 반드시 iframe 파티션에서 교환해야 한다.
      //  - code 없음(취소/거부): 그냥 닫기.
      let zzHandled = false;
      const zzOnCallback = (ev, url) => {
        try {
          if (zzHandled) return;
          if (!/^https:\/\/schedule\.pochi-day\.com\//.test(url || '')) return;
          zzHandled = true;
          if (ev && ev.preventDefault) ev.preventDefault();      // 보이는 창의 캘린더북 로드 자체를 막음
          if (/[?&]code=/.test(url)) zzNotionExchange(url);       // 성공: 데스크톱(Node)에서 단일 교환 → 결과를 iframe에 전달
          try { child.close(); } catch (_) {}
        } catch (_) {}
      };
      child.webContents.on('will-redirect', zzOnCallback);
      child.webContents.on('will-navigate', zzOnCallback);
      child.webContents.on('did-navigate', (e, url) => zzOnCallback(null, url)); // 폴백: 못 막았어도 즉시 닫기

      // 노션 연결은 이 한 창 안에서만 진행(새 창 난립 차단). 콜백이 window.open로 와도 위 처리로 넘긴다.
      child.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https:\/\/schedule\.pochi-day\.com\//.test(url)) { zzOnCallback(null, url); return { action: 'deny' }; }
        if (/^https:\/\/([a-z0-9-]+\.)?notion\.(so|com)\//.test(url)) {
          try { child.webContents.loadURL(url); } catch (_) {}
          return { action: 'deny' };
        }
        if (/^https?:\/\//.test(url)) shell.openExternal(url);
        return { action: 'deny' };
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

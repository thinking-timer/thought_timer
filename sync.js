/* =========================================================
   생각 기록 타이머 - sync.js (구글 로그인 · 기록 동기화)

   - 로그인하지 않으면: 지금처럼 이 기기(localStorage)에만 저장
   - 로그인하면: 기록을 Firebase(Firestore)의 users/{내 uid} 문서에도 저장
     → 다른 기기에서 같은 계정으로 로그인하면 같은 기록이 보임
   - 로그아웃하면: 이 기기에 남은 기록을 지움 (공용 컴퓨터에서도 안전하게)

   [흐름]
   1. 페이지를 열면 → 계정에 저장된 기록을 불러와서 이 기기에 덮어씀 → 새로고침
   2. 메모 · 기록 등을 저장할 때마다(script.js의 save) → 1.5초 뒤 계정에도 저장
   3. 처음 로그인할 때 이 기기에 손님으로 쓴 기록이 있으면 → 계정 기록과 합침

   ※ firebase-config.js가 비어 있으면 아무것도 하지 않음 (로그인 버튼도 안 보임)
   ========================================================= */

(function () {
  // 계정에 함께 저장할 것들 (타이머 진행 상태 · 사이드바 숨김 · 메모장/할 일 중 뭘 보는지는 기기마다 따로)
  const SYNC_KEYS = ['ttt.memos', 'ttt.records', 'ttt.note', 'ttt.todos', 'ttt.pomodoro', 'ttt.theme', 'ttt.share'];
  const OWNER = 'ttt.owner';    // 이 기기의 기록이 어느 계정 것인지 (uid) — 없으면 손님 기록
  const DIRTY = 'ttt.dirty';    // 아직 계정에 못 올린 변경이 있으면 '1'
  const PULLED = 'ttt.pulled';  // (sessionStorage) 방금 불러와서 새로고침한 참이면 uid

  const $ = (id) => document.getElementById(id);
  const cfg = window.FIREBASE_CONFIG || {};

  // 설정값이 없거나 Firebase를 못 불러왔으면(인터넷 X) → 로그인 없이 그대로 사용
  if (!window.firebase || !cfg.apiKey || !cfg.projectId) {
    if (cfg.apiKey === undefined || cfg.apiKey === '') console.info('[sync] firebase-config.js가 비어 있어서 로그인 기능은 꺼져 있어요.');
    return;
  }

  firebase.initializeApp(cfg);
  const auth = firebase.auth();
  const db = firebase.firestore();
  auth.languageCode = 'ko';

  let user = null;        // 로그인한 사용자
  let ready = false;      // 처음 불러오기가 끝났는지 (끝나기 전에는 올리지 않음)
  let pushTimer = null;   // 1.5초 뒤 올리기 예약
  let changeNo = 0;       // 올리는 동안 또 바뀌었는지 확인용

  const userDoc = () => db.collection('users').doc(user.uid);
  const getLocal = (k) => localStorage.getItem(k);


  /* ---------- 화면 (사이드바 아래 로그인 칸) ---------- */

  const STATE_TEXT = { loading: '불러오는 중', saving: '저장 중', saved: '저장됨', error: '저장 안 됨' };

  function setState(state) {
    $('syncState').textContent = STATE_TEXT[state] || '';
    $('syncState').dataset.state = state;
  }

  function renderAccount() {
    $('account').hidden = false;
    $('loginBtn').hidden = !!user;
    $('profile').hidden = !user;
    if (!user) return;
    const name = user.displayName || user.email || '';
    $('profileName').textContent = name;
    $('profileInitial').textContent = name.trim().charAt(0).toUpperCase();
    const photo = $('profilePhoto');
    photo.hidden = !user.photoURL;
    if (user.photoURL) photo.src = user.photoURL;
    photo.onerror = () => { photo.hidden = true; };   // 사진을 못 불러오면 이름 첫 글자
  }


  /* ---------- 계정에 올리기 ---------- */

  // script.js의 save()가 부를 때마다
  window.onDataSaved = (key) => {
    if (!SYNC_KEYS.includes(key)) return;
    if (!getLocal(OWNER)) return;          // 손님 기록 (로그인 전)
    changeNo++;
    localStorage.setItem(DIRTY, '1');
    if (user && ready) {
      setState('saving');
      clearTimeout(pushTimer);
      pushTimer = setTimeout(push, 1500);  // 글자를 적을 때마다 올리지 않도록 잠깐 기다림
    }
  };

  async function push() {
    clearTimeout(pushTimer);
    pushTimer = null;
    if (!user) return false;
    const no = changeNo;
    const data = {};
    SYNC_KEYS.forEach((k) => {
      const v = getLocal(k);
      if (v !== null) data[k.slice(4)] = v;   // 'ttt.memos' → 'memos' (글자 그대로 저장)
    });
    setState('saving');
    try {
      await userDoc().set({ data, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      if (no === changeNo) localStorage.removeItem(DIRTY);
      setState(pushTimer ? 'saving' : 'saved');
      return true;
    } catch (err) {
      console.warn('[sync] 저장 실패', err);
      setState('error');
      return false;
    }
  }


  /* ---------- 계정에서 불러오기 ---------- */

  // 같은 id끼리는 계정 쪽을 쓰고, 이 기기에만 있는 것은 더함 (손님 기록 합치기)
  function mergeById(localText, cloudText) {
    const parse = (t) => { try { return JSON.parse(t) || []; } catch { return []; } };
    const cloud = parse(cloudText);
    const ids = new Set(cloud.map((x) => x.id));
    const extra = parse(localText).filter((x) => x && !ids.has(x.id));
    return JSON.stringify([...cloud, ...extra]);
  }

  // 메모장: 둘 다 내용이 있으면 이어 붙임 (손님 기록 합치기)
  function mergeNote(localText, cloudText) {
    const parse = (t) => { try { return JSON.parse(t) || ''; } catch { return ''; } };
    const a = parse(cloudText), b = parse(localText);
    if (!b.trim() || a.includes(b)) return cloudText;
    if (!a.trim()) return localText;
    return JSON.stringify(a + '\n\n' + b);
  }

  function clearLocal() {
    SYNC_KEYS.forEach((k) => localStorage.removeItem(k));
    localStorage.removeItem(OWNER);
    localStorage.removeItem(DIRTY);
  }

  async function pull() {
    const uid = user.uid;
    ready = false;

    // 방금 불러와서 새로고침한 참 → 그대로 쓰고, 고친 게 있으면 올림
    if (sessionStorage.getItem(PULLED) === uid) {
      sessionStorage.removeItem(PULLED);
      ready = true;
      if (getLocal(DIRTY)) push(); else setState('saved');
      return;
    }

    // 다른 계정의 기록이 남아 있으면 지움
    if (getLocal(OWNER) && getLocal(OWNER) !== uid) clearLocal();
    const guest = !getLocal(OWNER);

    // 이 기기에서 고친 것을 아직 못 올렸으면 → 이 기기 기록을 올림
    if (!guest && getLocal(DIRTY)) {
      ready = true;
      push();
      return;
    }

    setState('loading');
    let snap;
    try {
      snap = await userDoc().get();
    } catch (err) {
      console.warn('[sync] 불러오기 실패', err);
      setState('error');
      return;   // ready = false → 다음에 다시 시도
    }
    if (!user || user.uid !== uid) return;   // 그 사이 로그아웃
    if (!guest && getLocal(DIRTY)) {         // 불러오는 사이 이 기기에서 고쳤으면 그쪽을 올림
      ready = true;
      push();
      return;
    }

    // 계정에 아직 아무것도 없음 (처음 로그인) → 이 기기 기록을 올림
    if (!snap.exists) {
      localStorage.setItem(OWNER, uid);
      ready = true;
      push();
      return;
    }

    const cloud = (snap.data() || {}).data || {};
    let changed = false;   // 이 기기 기록이 바뀌었는지 → 새로고침
    let needPush = false;  // 합친 결과가 계정과 다른지 → 올림
    SYNC_KEYS.forEach((k) => {
      const name = k.slice(4);
      const local = getLocal(k);
      let value = cloud[name];
      if (guest && local !== null) {
        if (value === undefined) value = local;
        else if (name === 'memos' || name === 'records' || name === 'todos') value = mergeById(local, value);
        else if (name === 'note') value = mergeNote(local, value);
        if (value !== cloud[name]) needPush = true;
      }
      if (value === undefined || value === local) return;
      localStorage.setItem(k, value);
      changed = true;
    });
    localStorage.setItem(OWNER, uid);
    if (needPush) localStorage.setItem(DIRTY, '1');

    if (changed) {
      sessionStorage.setItem(PULLED, uid);
      location.reload();   // 불러온 기록으로 화면을 처음부터 다시 그림
      return;
    }
    ready = true;
    if (getLocal(DIRTY)) push(); else setState('saved');
  }


  /* ---------- 로그인 / 로그아웃 ---------- */

  async function login() {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });   // 계정 고르는 창이 항상 뜨게
    try {
      await auth.signInWithPopup(provider);
    } catch (err) {
      console.warn('[sync] 로그인 실패', err);
      // 팝업이 막히면 페이지를 옮겨서 로그인
      if (err.code === 'auth/popup-blocked' || err.code === 'auth/operation-not-supported-in-environment') {
        auth.signInWithRedirect(provider);
      }
    }
  }

  async function logout() {
    clearTimeout(pushTimer);
    if (getLocal(DIRTY) && !(await push())) return;   // 못 올린 게 있으면 올리고 나서
    await auth.signOut();
    clearLocal();
    location.reload();   // 손님 화면으로
  }

  $('loginBtn').addEventListener('click', login);
  $('logoutBtn').addEventListener('click', logout);

  auth.onAuthStateChanged((u) => {
    user = u;
    ready = false;
    renderAccount();
    if (u) pull();
  });

  // 다른 기기에서 고친 기록 반영: 이 탭으로 돌아왔을 때 다시 불러옴 (공부 중에는 X)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (pushTimer) push();   // 창을 닫거나 다른 앱으로 갈 때 바로 올림
      return;
    }
    const studying = typeof timer !== 'undefined' && timer.active;
    if (user && !pushTimer && !getLocal(DIRTY) && !studying) pull();
  });

  // 인터넷이 다시 연결되면 못 올린 것 올리기
  window.addEventListener('online', () => {
    if (!user) return;
    if (!ready) pull();
    else if (getLocal(DIRTY)) push();
  });
})();

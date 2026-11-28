/* =========================================================
   생각 기록 타이머 - script.js

   [코드 구조]
   1. 상수 / 저장소(localStorage) 도우미
   2. 상태(state) 불러오기
   3. 타이머 로직      ← 공부 공간
   4. 생각 메모        ← 생각 보관 공간
      4-2. 할 일 목록  ← 메모장 칸에서 [메모장 | 할 일] 전환
   5. 카테고리 자동 분류
   6. 공부 기록
      6-2. SNS용 이미지 만들기
   7. 화면 그리기(render)
      7-2. 화면 색상
   8. 이벤트 연결 & 시작
   9. 앞으로 만들 기능 (TODO)

   ※ 구글 로그인 · 기록 동기화는 sync.js에 따로 있음
   ========================================================= */


/* ---------- 1. 상수 / 저장소 도우미 ---------- */

// localStorage에 저장할 때 쓰는 이름(key)
const KEYS = {
  timer: 'ttt.timer',
  memos: 'ttt.memos',
  records: 'ttt.records',
  pomodoro: 'ttt.pomodoro',
  theme: 'ttt.theme',
  note: 'ttt.note',
  sideHidden: 'ttt.sideHidden',   // 사이드바를 숨겼는지
  share: 'ttt.share',             // SNS 이미지 꾸미기 설정   // 📝 메모장
  todos: 'ttt.todos',             // ✅ 할 일 목록
  pad: 'ttt.pad',                 // 메모장 칸에 보여 줄 것: 'note'(메모장) | 'todo'(할 일)
};


// 뽀모도로 기본 시간(분) — 사용자가 화면에서 바꾸면 localStorage에 저장됨
// 집중 / 휴식 시간 선택지(분) — 집중 0 = '제한 없음'(계속 흐르는 타이머), 그 외에는 뽀모도로처럼 집중 ↔ 휴식 반복
const FOCUS_CHOICES = [0, 15, 25, 60, 120];   // 집중 시간 버튼 (0 = 제한 없음)
const BREAK_CHOICES = [5, 10, 15, 20];        // 휴식 시간 버튼
const TIME_MAX = { focus: 240, break: 60 };   // +5 · +10분으로 늘릴 수 있는 최대 (집중 4시간, 휴식 1시간)
const DEFAULT_POMODORO = { focus: 0, break: 5 };

// 카테고리는 직접 고르지 않고, 메모 내용을 보고 자동으로 정함 (5. 카테고리 자동 분류)
const CATEGORIES = ['할 일', '아이디어', '궁금한 것', '기타'];

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback; // 저장된 값이 깨졌으면 기본값 사용
  }
}

function save(key, value) {
  const text = JSON.stringify(value);
  if (localStorage.getItem(key) === text) return;   // 바뀐 게 없으면 그대로
  localStorage.setItem(key, text);
  window.onDataSaved?.(key);   // 로그인 중이면 sync.js가 계정에도 저장함
}

// 메모 · 기록마다 붙이는 고유 번호
function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}


/* ---------- 2. 상태(state) ---------- */

// 타이머 상태의 기본 모양
function defaultTimer() {
  return {
    active: false,     // 공부 세션 진행 중인지 (시작 ~ 종료 사이). true면 보관함 잠김
    running: false,    // 지금 시간이 흐르고 있는지 (일시정지면 false)
    mode: 'normal',    // 'normal' | 'pomodoro'
    phase: 'focus',    // 뽀모도로 구간: 'focus' | 'break'
    phaseStart: null,  // 현재 구간을 (다시) 시작한 시각 (Date.now())
    phaseElapsed: 0,   // 일시정지 전까지 쌓인 시간(ms)
    studiedMs: 0,      // 뽀모도로에서 끝난 집중 구간들의 합
    sessionStart: null,// 이번 공부를 처음 시작한 시각
    goal: '',          // 공부 목표
    resumeId: null,    // 기록을 눌러 이어서 하는 중이면 그 기록의 id
    resumeBase: 0,     // 이어서 할 때, 이전까지 공부한 시간(ms)
    segStart: null,    // 지금 흐르고 있는 구간을 시작한 시각
    segments: [],      // 실제로 시간이 흐른 구간들 [[시작, 끝], ...] — SNS 이미지의 타임테이블용
  };
}

let timer = { ...defaultTimer(), ...load(KEYS.timer, {}) };
if (timer.running && timer.phase !== 'break' && !timer.segStart) timer.segStart = timer.phaseStart || Date.now(); // 예전 버전에서 공부하던 중이었으면
let memos = load(KEYS.memos, []);                       // [{ id, text, category, createdAt }]
// 예전 버전의 '공부 질문(공부 관련)' 카테고리는 없어졌으므로 '궁금한 것'으로 옮김
if (memos.some((m) => m.category === '공부 질문')) {
  memos = memos.map((m) => (m.category === '공부 질문' ? { ...m, category: '궁금한 것' } : m));
  save(KEYS.memos, memos);
}
// [{ id, date, studyMs, mode, goal, endedAt, sessions }] — 예전 기록에 id가 없으면 붙여 줌
let records = load(KEYS.records, []).map((r) => (r.id ? r : { ...r, id: makeId() }));
save(KEYS.records, records);   // (아래 6번의 mergeTodayRecords()로 오늘 같은 이름 기록도 합침)
let note = load(KEYS.note, '');                         // 📝 메모장 내용 (글 하나)
let todos = load(KEYS.todos, []);                       // ✅ 할 일 [{ id, text, done, createdAt }]
let padMode = load(KEYS.pad, 'note') === 'todo' ? 'todo' : 'note'; // 메모장 칸: 'note' | 'todo' (마지막에 보던 것 그대로)
let historyView = 'week';                               // 기록 자세히 보기: 'week' | 'month'
let historyCursor = new Date();                         // 기록 자세히 보기: 지금 보고 있는 주의 월요일 / 달의 1일
let historyDay = null;                                  // 기록함 그래프에서 누른 날 ('2026-11-27') → 그날 기록을 아래에 보여 줌
let pomoSetting = { ...DEFAULT_POMODORO, ...load(KEYS.pomodoro, {}) }; // { focus: 분(0 = 제한 없음), break: 분 }
// 예전 버전 값 맞추기: 일반 모드였으면 '제한 없음', 시간은 정해진 범위 안으로
{
  const oldTimer = load(KEYS.timer, {});
  if (oldTimer.mode === 'normal' && !oldTimer.active) pomoSetting.focus = 0;
  pomoSetting.focus = Math.min(TIME_MAX.focus, Math.max(0, Math.round(Number(pomoSetting.focus) || 0)));
  pomoSetting.break = Math.min(TIME_MAX.break, Math.max(1, Math.round(Number(pomoSetting.break) || 5)));
}
// 집중 시간 선택에 따라 정해지는 모드: 제한 없음 → 'normal', 시간을 고르면 → 'pomodoro'
const modeFromSetting = () => (pomoSetting.focus ? 'pomodoro' : 'normal');
if (!timer.active) timer.mode = modeFromSetting();

const saveTimer = () => save(KEYS.timer, timer);

// 뽀모도로 구간 길이(ms)
// 테스트할 때는 '* 60 * 1000'을 '* 1000'으로 바꾸면 분 대신 초 단위로 빨리 확인할 수 있음
function phaseLength(phase) {
  return pomoSetting[phase] * 60 * 1000;
}


/* ---------- 3. 타이머 로직 ----------
   [핵심] 1초마다 숫자를 1씩 더하지 않고,
   "시작한 시각"을 저장해 두고 (지금 시각 - 시작 시각)으로 계산한다.
   → 창을 닫았다 다시 열어도, 탭이 느려져도 시간이 정확하게 이어짐.
*/

// 현재 구간에서 흐른 시간(ms)
function phaseElapsed() {
  const runningPart = timer.running ? Date.now() - timer.phaseStart : 0;
  return timer.phaseElapsed + runningPart;
}

// 이번 세션에서 실제로 공부한 시간(ms) — 뽀모도로 휴식 시간은 제외
function totalStudyMs() {
  if (timer.mode === 'normal') return phaseElapsed();
  return timer.studiedMs + (timer.phase === 'focus' ? phaseElapsed() : 0);
}

function startTimer() {
  if (timer.running) return;

  if (!timer.active) {               // 새로운 공부 시작
    timer.mode = modeFromSetting();  // 고른 집중 시간에 따라 (제한 없음 / 뽀모도로)
    timer.active = true;
    timer.sessionStart = Date.now();
    // 이름을 안 적었으면 '공부 1', '공부 2' … 로 자동으로 붙임 (끝난 뒤에 고칠 수 있음)
    timer.goal = $('goalInput').value.trim() || nextDefaultName();
    timer.phase = 'focus';
    timer.phaseElapsed = 0;
    timer.studiedMs = 0;
  }
  timer.running = true;              // 시작 또는 계속하기
  timer.phaseStart = Date.now();
  timer.segStart = timer.phase === 'focus' ? Date.now() : null;   // 타임테이블용: 이 구간 시작 (휴식 중이면 X)

  saveTimer();
  renderAll();
}

// 흐르고 있던 구간을 [시작, 지금]으로 저장 (종료할 때)
function closeSegment() {
  if (!timer.segStart) return;
  if (!Array.isArray(timer.segments)) timer.segments = [];
  timer.segments.push([timer.segStart, Date.now()]);
  timer.segStart = null;
}


function stopTimer() {
  if (!timer.active) return;

  advancePomodoro();
  const studied = totalStudyMs();             // 이어서 한 경우 이전 시간까지 포함
  const added = studied - timer.resumeBase;   // 이번에 새로 공부한 시간
  const resumed = Boolean(timer.resumeId);
  const sessionMemos = memos.filter((m) => m.createdAt >= timer.sessionStart); // 이번 공부 동안 적은 생각

  if (timer.running) closeSegment();
  const record = added >= 1000 ? saveRecord(studied, added, timer.segments || []) : null;
  mergeTodayRecords();   // 오늘 같은 이름 기록이 있으면 합침 (이름은 기록함의 '수정'에서 고침)

  timer = { ...defaultTimer(), mode: modeFromSetting() }; // 초기화
  saveTimer();
  $('goalInput').value = '';

  renderAll(); // 집중 모드가 끝나면서 사이드바 메뉴가 다시 열림

  // 공부하면서 적은 생각이 있으면 그 생각만 큰 창으로 보여 줌 → '확인 완료'를 누르면 닫힘
  if (sessionMemos.length > 0) {
    openReview(added, sessionMemos);
  } else {
    const done = resumed && record ? `모두 ${fmtDuration(record.studyMs)} 집중했어요` : `${fmtDuration(added)} 집중했어요`;
    showToast('timerToast', `수고했어요! ${done}`);
  }
}

// 공부를 마친 뒤 보여 주는 창: 이번 공부 시간 + 이번에 적은 생각 목록 (삭제 · 카테고리 바꾸기)
let reviewIds = [];        // 이 창에 보여 줄 메모 id (이번 공부 동안 적은 것)

function openReview(addedMs, list) {
  reviewIds = list.map((m) => m.id);
  $('reviewTitle').textContent = `수고했어요! ${fmtDuration(addedMs)}`;
  renderReviewList();
  $('reviewModal').hidden = false;
  document.body.classList.add('no-scroll');
  $('reviewDone').focus();
}

function renderReviewList() {
  const list = memos
    .filter((m) => reviewIds.includes(m.id))
    .sort((a, b) => a.createdAt - b.createdAt);   // 적은 순서대로
  $('reviewDesc').textContent = list.length ? `적어 둔 생각 ${list.length}개` : '';
  $('reviewList').hidden = list.length === 0;
  const ul = $('reviewList');
  ul.replaceChildren();
  list.forEach((m) => ul.append(memoItem(m, { withDelete: true })));
}

function closeReview() {
  if ($('reviewModal').hidden) return;
  $('reviewModal').hidden = true;
  document.body.classList.remove('no-scroll');
  renderAll();
}

// 뽀모도로: 구간 시간이 다 되면 집중 ↔ 휴식 전환
// 창을 오래 닫아 두었다면 여러 구간이 지났을 수 있어서 while로 처리
function advancePomodoro() {
  if (timer.mode !== 'pomodoro' || !timer.running) return false;

  let elapsed = phaseElapsed();
  let changed = false;
  let phaseBegan = Date.now() - elapsed;   // 지금 구간이 시작된 시각

  while (elapsed >= phaseLength(timer.phase)) {
    const len = phaseLength(timer.phase);
    const boundary = phaseBegan + len;     // 집중 ↔ 휴식이 바뀐 시각
    if (timer.phase === 'focus') {
      timer.studiedMs += len;
      // 타임테이블: 집중 구간은 여기서 끝 (휴식 시간은 공부 시간에 넣지 않음)
      if (!Array.isArray(timer.segments)) timer.segments = [];
      if (timer.segStart && boundary > timer.segStart) timer.segments.push([timer.segStart, boundary]);
      timer.segStart = null;
    } else {
      timer.segStart = boundary;           // 휴식이 끝나면 새 집중 구간 시작
    }
    timer.phase = timer.phase === 'focus' ? 'break' : 'focus';
    phaseBegan = boundary;
    elapsed -= len;
    changed = true;
  }

  if (changed) {
    timer.phaseElapsed = 0;
    timer.phaseStart = Date.now() - elapsed; // 남은 시간만큼 이미 흐른 것으로
    saveTimer();
  }
  return changed;
}

// 0.25초마다 화면 갱신
function tick() {
  if (advancePomodoro()) {
    showToast('timerToast',
      timer.phase === 'break'
        ? `집중 끝! ${pomoSetting.break}분 쉬어 가요 ☕`
        : '휴식 끝! 다시 집중해 볼까요 📚');
  }
  renderTimer();
}


/* ---------- 4. 생각 메모 ---------- */

function addMemo(text, category) {
  memos.push({
    id: makeId(),
    text,
    category,
    createdAt: Date.now(),
  });
  save(KEYS.memos, memos);
}

function deleteMemo(id) {
  memos = memos.filter((m) => m.id !== id);
  save(KEYS.memos, memos);
}

// 카테고리 바꾸기 (자동 분류가 틀렸을 때 드롭다운에서 고름)
// 공부 기록 삭제 (되돌릴 수 없음)
function deleteRecord(id) {
  records = records.filter((r) => r.id !== id);
  save(KEYS.records, records);
}

function setCategory(id, category) {
  const m = memos.find((x) => x.id === id);
  if (!m) return;
  m.category = category;
  save(KEYS.memos, memos);
}


/* ---------- 4-2. 할 일 목록 ----------
   메모장 칸 위쪽 [📝 메모장 | ✅ 할 일] 버튼으로 바꿔 가며 씀
   - Enter로 추가, 체크하면 줄이 그어짐, × 로 하나 지우기
   - '완료한 것 지우기'로 체크한 것만 한꺼번에 정리 */

function addTodo(text) {
  todos.push({ id: makeId(), text, done: false, createdAt: Date.now() });
  save(KEYS.todos, todos);
}

function toggleTodo(id, done) {
  const t = todos.find((x) => x.id === id);
  if (!t) return;
  t.done = done;
  save(KEYS.todos, todos);
}

function deleteTodo(id) {
  todos = todos.filter((t) => t.id !== id);
  save(KEYS.todos, todos);
}

function clearDoneTodos() {
  todos = todos.filter((t) => !t.done);
  save(KEYS.todos, todos);
}



/* ---------- 5. 카테고리 자동 분류 ----------
   [방법] 글 속에 어떤 단어가 들어 있는지 보고 카테고리를 정하는 규칙 기반 분류
   1) 해야 할 일 표현이 있으면   → 할 일       예) 택배 주문해야지
   2) 아이디어 표현이 있으면     → 아이디어    예) 타이머에 알림 소리 넣으면 좋겠다
   3) 질문 표현이 있으면         → 궁금한 것   예) 고양이는 왜 상자를 좋아할까?
   4) 아무것도 해당하지 않으면   → 기타
   잘못 분류됐으면 보관함 창 · 마친 뒤 창에서 드롭다운으로 바꿀 수 있음 */

const KEYWORDS = {
  question: ['?', '왜', '어떻게', '뭐지', '뭘까', '무슨', '뜻', '의미', '차이', '이해가 안', '이해 안',
    '헷갈', '모르겠', '궁금', '맞나', '인가', '인지', '할까'],
  todo: ['해야', '써야', '봐야', '가야', '내야', '읽어야', '외워야', '사야', '사기', '주문', '예약', '연락', '전화', '보내', '제출', '챙기', '빨래', '청소', '택배',
    '결제', '신청', '답장', '메일', '내일', '까지', '잊지'],
  idea: ['아이디어', '하면 좋겠', '좋을 것 같', '해보면', '해 보면', '어떨까', '만들어', '넣으면', '바꾸면',
    '떠올', '생각났'],
};

// 글 속에 들어 있는 단어 개수
function countWords(text, words) {
  return words.filter((w) => text.includes(w)).length;
}

function classifyMemo(raw) {
  const text = raw.replace(/\s+/g, ' ');

  const question = countWords(text, KEYWORDS.question);
  const todo = countWords(text, KEYWORDS.todo);
  const idea = countWords(text, KEYWORDS.idea);

  if (todo) return '할 일';
  if (idea) return '아이디어';
  if (question) return '궁금한 것';
  return '기타';
}


/* ---------- 6. 공부 기록 ---------- */

// 공부를 끝낼 때 기록 저장
// - 오늘 기록을 이어서 했다면: 그 기록의 시간을 늘림
// - 새로 시작한 공부라면: 새 기록 추가
//   (이어서 하던 중 자정이 지나 날짜가 바뀐 경우에도 날짜별 합계가 맞도록 '새로 공부한 시간'만 새 기록에 저장)
// segments: 이번 공부에서 실제로 시간이 흐른 구간들 (타임테이블용)
function saveRecord(studied, added, segments) {
  const today = dateKey(new Date(timer.sessionStart));
  const old = records.find((r) => r.id === timer.resumeId);

  let record;
  if (old && old.date === today) {
    record = old;
    old.studyMs = studied;
    old.endedAt = Date.now();
    old.sessions = [...sessionsOf(old), ...segments];
  } else {
    record = {
      id: makeId(),
      date: today,
      studyMs: added,
      mode: timer.mode,
      goal: timer.goal,
      endedAt: Date.now(),
      sessions: segments,
    };
    records.push(record);
  }
  save(KEYS.records, records);
  // 같은 이름 기록 합치기는 끝난 뒤 창에서 이름 · 시간을 고친 다음에 함 (closeReview)
  return record;
}

// 이름을 안 적고 시작했을 때 붙이는 이름: 오늘 숫자로만 된 이름('1', '2' …) 중 가장 큰 번호 + 1
function nextDefaultName() {
  const today = dateKey(new Date());
  const nums = records
    .filter((r) => r.date === today)
    .map((r) => /^\d+$/.exec((r.goal || '').trim()))
    .filter(Boolean)
    .map((m) => Number(m[0]));
  return String(Math.max(0, ...nums) + 1);
}

// 기록의 공부 구간들 — 예전 기록에는 구간이 없어서 '끝난 시각 - 공부 시간 ~ 끝난 시각'으로 짐작
function sessionsOf(r) {
  if (Array.isArray(r.sessions) && r.sessions.length) return r.sessions;
  return r.endedAt ? [[r.endedAt - r.studyMs, r.endedAt]] : [];
}

// 오늘 기록 중 공부 목표 이름이 같은 것은 하나로 합침 (시간을 더함)
// - 오늘 기록끼리만 합치고, 지난 날 기록은 그대로 둠
// - 목표 이름이 비어 있는 기록('목표 없음')은 목표 없는 기록끼리 합침
// - 띄어쓰기가 두 칸 이상이거나 앞뒤에 공백이 있어도 같은 이름으로 봄
function mergeTodayRecords() {
  const today = dateKey(new Date());
  const firstByName = {};   // { '공학설계 보고서': 그 이름의 첫 기록, '': 목표 없는 첫 기록 }
  const before = records.length;

  records = records.filter((r) => {
    const name = (r.goal || '').trim().replace(/\s+/g, ' ');
    if (r.date !== today) return true;

    const first = firstByName[name];   // 목표 없음은 name이 '' (빈 이름끼리 묶임)
    if (!first) {
      firstByName[name] = r;
      return true;
    }
    first.studyMs += r.studyMs;                         // 시간을 첫 기록에 더하고
    first.endedAt = Math.max(first.endedAt, r.endedAt);
    first.sessions = [...sessionsOf(first), ...sessionsOf(r)];
    return false;                                       // 이 기록은 지움
  });

  if (records.length !== before) save(KEYS.records, records);
}

// 오늘 한 공부를 이어서 하기 (타이머 아래 '이어하기' 버튼) — 목표 · 모드는 그대로, 시간은 기록된 시간부터 이어짐
// (오늘 기록만 이어서 할 수 있음)
function resumeRecord(id) {
  const r = records.find((x) => x.id === id);
  if (!r || r.date !== dateKey(new Date())) return;
  if (timer.active) {
    showToast('timerToast', '진행 중인 타이머를 먼저 종료해 주세요');
    return;
  }
  const now = Date.now();
  timer = {
    ...defaultTimer(),
    active: true,
    running: true,
    mode: modeFromSetting(),        // 지금 고른 집중 시간 방식으로 이어서
    goal: r.goal,
    sessionStart: now,
    phaseStart: now,
    segStart: now,
    resumeId: r.id,
    resumeBase: r.studyMs,
  };
  if (timer.mode === 'normal') timer.phaseElapsed = r.studyMs; // 제한 없음: 시계가 기록된 시간부터 이어서 흐름
  else timer.studiedMs = r.studyMs;                        // 뽀모도로: 누적 공부 시간에 더해 새 집중 구간 시작

  saveTimer();
  closeDrawer(false);
  renderAll();
  showToast('timerToast', `${fmtDuration(r.studyMs)}부터 이어서 시작`);
}

// 날짜별 공부 시간 합계 { '2026-10-25': 3600000, ... }
function sumByDate() {
  const sums = {};
  records.forEach((r) => { sums[r.date] = (sums[r.date] || 0) + r.studyMs; });
  return sums;
}

/* ---------- 6-2. SNS용 이미지 만들기 (스프링 노트 플래너 스타일) ----------
   [꾸미기] 날짜 밑 문장(오늘의 명언 / 직접 쓰기) · 글꼴 · 이미지 색상 · 과목별 색 — 고른 것은 localStorage에 저장
   canvas(그림판)에 오늘 공부 기록을 손글씨 플래너처럼 그려서 PNG 이미지로 저장 / 공유
   - 날짜 칸 + TOTAL + 시작 · 끝 시각 + 한마디 + 공부한 내용 체크리스트 + 10분 타임테이블(초록 형광펜)
   - 크기: 정사각형 1080×1080 (SNS 피드용)
   - 글꼴: 여러 손글씨 · 기본 글꼴 중 고름 (index.html에서 불러옴, 인터넷이 없으면 기본 글꼴)
   - 적은 생각(메모)은 넣지 않음 (개인적인 내용이 SNS에 올라가지 않게) */

const SHARE_W = 1080;
const SHARE_H = 1080;
const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
const TIMETABLE_HOURS = [...Array(18).keys()].map((i) => i + 6).concat([0, 1, 2, 3, 4, 5]); // 6시 ~ 다음 날 5시

// 플래너 기본 색 (초록 플래너) — 이미지 색상 테마를 고르면 아래 SHARE_PALETTES의 색으로 덮어씀
const NOTE_BASE = {
  desk: '#E8EFE0',       // 바깥 배경
  paper: '#FFFFFF',
  line: '#E3E3DE',       // 공책 줄
  box: '#CFCFC8',        // 칸 테두리
  ink: '#3B3B3B',        // 손글씨
  soft: '#9A9A92',       // 연한 글씨
  pen: '#A8D07A',        // 형광펜
  penDark: '#6FA544',    // 체크 표시
  ring: '#6E6E6E',       // 스프링
};
const NOTE = { ...NOTE_BASE };   // 지금 그리는 이미지의 색 (그릴 때마다 테마에 맞춰 바뀜)

// ----- 꾸미기 ① 이미지 색상 테마 -----
const SHARE_PALETTES = [
  { id: 'green',  name: '초록', desk: '#E8EFE0', pen: '#A8D07A', penDark: '#6FA544' },
  { id: 'pink',   name: '분홍', desk: '#F7E7EB', pen: '#F5AFC1', penDark: '#D96B8C' },
  { id: 'sky',    name: '하늘', desk: '#E2ECF5', pen: '#A3CDF0', penDark: '#4F8EC6' },
  { id: 'yellow', name: '노랑', desk: '#F5EFD9', pen: '#F6D77E', penDark: '#C49A2C' },
  { id: 'purple', name: '보라', desk: '#ECE6F5', pen: '#C6B5EC', penDark: '#8869CB' },
  { id: 'night',  name: '밤',   desk: '#25272D', paper: '#33363E', line: '#444851', box: '#5A5E68',
    ink: '#F1F1EE', soft: '#9FA3AC', pen: '#7FCBB6', penDark: '#7FCBB6', ring: '#9A9DA5' },
];

// ----- 꾸미기 ② 글꼴 (index.html에서 불러옴) -----
// scale: 글꼴마다 글자 크기가 달라 보여서 맞추는 배율 / bold: 굵은 글꼴이 따로 있는지
const SHARE_FONTS = [
  { id: 'gaegu',       name: '개구',       family: '"Gaegu"',            scale: 1,    bold: true },
  { id: 'nanum-pen',   name: '나눔펜',     family: '"Nanum Pen Script"', scale: 1.25, bold: false },
  { id: 'hi-melody',   name: '하이멜로디', family: '"Hi Melody"',        scale: 1.1,  bold: false },
  { id: 'jua',         name: '주아',       family: '"Jua"',              scale: 0.92, bold: false },
  { id: 'gowun-dodum', name: '고운돋움',   family: '"Gowun Dodum"',      scale: 0.92, bold: false },
  { id: 'pretendard',  name: '프리텐다드', family: '"Pretendard"',       scale: 0.9,  bold: true },
];

// ----- 꾸미기 ③ 과목별 색 (형광펜 색) -----
const SUBJECT_COLORS = ['#A8D07A', '#F5AFC1', '#A3CDF0', '#F6D77E', '#C6B5EC', '#FFBE8F', '#8FDCCF'];

// ----- 꾸미기 ④ 날짜 밑 문장: 오늘의 명언 (날짜마다 바뀜) -----
const QUOTES = [
  ['천 리 길도 한 걸음부터', '속담'],
  ['시작이 반이다', '속담'],
  ['티끌 모아 태산', '속담'],
  ['낙숫물이 댓돌을 뚫는다', '속담'],
  ['고생 끝에 낙이 온다', '속담'],
  ['늦었다고 생각할 때가 가장 빠른 때다', '속담'],
  ['실패는 성공의 어머니', '속담'],
  ['뿌린 대로 거둔다', '속담'],
  ['멈추지만 않는다면 얼마나 천천히 가는지는 중요하지 않다', '공자'],
  ['배우고 때때로 익히면 즐겁지 아니한가', '공자'],
  ['아는 것을 안다 하고, 모르는 것을 모른다 하는 것이 앎이다', '공자'],
  ['가장 긴 여행도 한 걸음에서 시작된다', '노자'],
  ['오늘 할 수 있는 일을 내일로 미루지 마라', '벤저민 프랭클린'],
  ['잃어버린 시간은 다시 찾을 수 없다', '벤저민 프랭클린'],
  ['천재는 1%의 영감과 99%의 노력이다', '토머스 에디슨'],
  ['물방울이 바위를 뚫는 것은 힘이 아니라 꾸준함 덕분이다', '오비디우스'],
  ['인생이 짧은 것이 아니라, 우리가 많이 낭비하는 것이다', '세네카'],
  ['아는 것이 힘이다', '프랜시스 베이컨'],
  ['작은 기회로부터 위대한 일이 시작된다', '데모스테네스'],
  ['인내는 쓰다, 그러나 그 열매는 달다', '루소'],
  ['할 수 있다고 믿기에 할 수 있다', '베르길리우스'],
  ['배움은 결코 마음을 지치게 하지 않는다', '레오나르도 다 빈치'],
  ['잘 시작된 일은 반쯤 끝난 것이다', '아리스토텔레스'],
  ['서두르지 말고, 그러나 쉬지도 말라', '괴테'],
];

const DEFAULT_SHARE = {
  textMode: 'quote',     // 'quote' = 오늘의 명언 / 'custom' = 직접 쓴 문장
  custom: '',            // 직접 쓴 문장
  font: 'gaegu',
  palette: 'green',
  paletteColor: '#7FA8D9', // 무지개(직접 고르기)로 고른 색
  colors: {},            // { '미적분': '#F5AFC1', '영어': 'none', ... } 직접 고른 과목 색 ('none' = 색 없음)
  shift: { date: '', n: 0 }, // '오늘의 명언'을 누른 횟수 (그날만 — 누를 때마다 다음 명언)
};
let shareSet = { ...DEFAULT_SHARE, ...load(KEYS.share, {}) };
const saveShareSet = () => save(KEYS.share, shareSet);

const shareFont = () => SHARE_FONTS.find((f) => f.id === shareSet.font) || SHARE_FONTS[0];
const hand = (weight, size) => {
  const f = shareFont();
  return `${f.bold ? weight : 400} ${Math.round(size * f.scale)}px ${f.family}, "Pretendard", "Apple SD Gothic Neo", sans-serif`;
};

// 과목 이름을 같은 이름으로 보기 (앞뒤 공백 · 두 칸 띄어쓰기 무시)
const subjectKey = (name) => (name || '').trim().replace(/\s+/g, ' ') || '목표 없음';

// 오늘 기록의 과목 이름들 (처음 기록한 순서대로, 같은 이름은 한 번만)
function todaySubjects() {
  const today = dateKey(new Date());
  const names = records
    .filter((r) => r.date === today)
    .sort((a, b) => a.endedAt - b.endedAt)
    .map((r) => subjectKey(r.goal));
  return [...new Set(names)];
}

// 과목 색: 직접 고른 색이 있으면 그 색('none' = 색 없음), 없으면 오늘 순서대로 자동으로
function subjectColor(name) {
  const key = subjectKey(name);
  if (shareSet.colors[key]) return shareSet.colors[key];
  const i = todaySubjects().indexOf(key);
  return SUBJECT_COLORS[Math.max(0, i) % SUBJECT_COLORS.length];
}

// 날짜 밑 문장: 오늘의 명언(날짜마다 다른 명언) 또는 직접 쓴 문장
function shareSentence() {
  if (shareSet.textMode === 'custom') {
    const text = shareSet.custom.trim();
    return { text: text || '잡생각은 적어 두고, 공부는 계속했다!', author: '' };
  }
  const now = new Date();
  const day = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 86400000);
  const n = shareSet.shift.date === dateKey(now) ? shareSet.shift.n : 0;
  const [text, author] = QUOTES[(day + n) % QUOTES.length];
  return { text, author };
}

// 문장을 maxWidth 안에 들어가게 여러 줄로 나눔 (띄어쓰기 기준, 긴 단어는 글자 단위로)
function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let cur = '';
  text.split(' ').forEach((word) => {
    const next = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) { cur = next; return; }
    if (cur) lines.push(cur);
    cur = '';
    for (const ch of word) {
      if (ctx.measureText(cur + ch).width > maxWidth && cur) { lines.push(cur); cur = ''; }
      cur += ch;
    }
  });
  if (cur) lines.push(cur);
  return lines;
}

// 시간 표시: 플래너식 '4H 55M' / 타임테이블 옆 '9:10'
function fmtHM(ms) {
  const totalMin = Math.floor(ms / 60000);
  return `${Math.floor(totalMin / 60)}:${pad(totalMin % 60)}`;
}
function fmtHMLong(ms) {
  const totalMin = Math.floor(ms / 60000);
  return `${Math.floor(totalMin / 60)}H ${pad(totalMin % 60)}M`;
}
function fmtClockTime(ts) {
  const d = new Date(ts);
  return `${d.getHours()}:${pad(d.getMinutes())}`;
}

// 둥근 사각형
function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2)); // 모서리가 칸보다 크면 모양이 깨져서 줄임
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 글자가 너무 길면 '…'으로 자르기
function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
  return `${t}…`;
}

// #RRGGBB 색을 투명도와 함께 쓰기
function withAlpha(hex, a) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// 선 긋기
function line(ctx, x1, y1, x2, y2, color = NOTE.line, w = 2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

// 테두리만 있는 칸 (손으로 그은 느낌이 나게 살짝 둥글게)
function box(ctx, x, y, w, h) {
  roundRect(ctx, x, y, w, h, 6);
  ctx.strokeStyle = NOTE.box;
  ctx.lineWidth = 2;
  ctx.stroke();
}

// 초록 체크 표시
function check(ctx, x, y, size) {
  ctx.strokeStyle = NOTE.penDark;
  ctx.lineWidth = Math.max(3, size / 7);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y + size * 0.5);
  ctx.lineTo(x + size * 0.38, y + size * 0.85);
  ctx.lineTo(x + size, y);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

// 네잎클로버 낙서
function clover(ctx, cx, cy, r, rot = 0) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.fillStyle = NOTE.pen;
  for (let i = 0; i < 4; i++) {
    ctx.rotate(Math.PI / 2);
    ctx.beginPath();
    ctx.arc(0, -r * 0.62, r * 0.62, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = NOTE.penDark;
  ctx.lineWidth = r * 0.22;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(r * 0.4, r * 1.2, r * 0.1, r * 1.8);
  ctx.stroke();
  ctx.restore();
}

// 형광펜으로 칠한 듯한 칸 (끝이 살짝 둥글고 조금 투명)
function highlight(ctx, x, y, w, h, color = NOTE.pen) {
  ctx.fillStyle = withAlpha(color, 0.85);
  roundRect(ctx, x, y, w, h, Math.min(4, h / 3));
  ctx.fill();
}

// 공책 종이 + 왼쪽 스프링 → 종이 안쪽 영역을 돌려줌
function drawNotebook(ctx, W, H) {
  ctx.fillStyle = NOTE.desk;
  ctx.fillRect(0, 0, W, H);

  const px = 96;
  const py = 44;
  const pw = W - px - 44;
  const ph = H - py * 2;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.12)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 6;
  roundRect(ctx, px, py, pw, ph, 10);
  ctx.fillStyle = NOTE.paper;
  ctx.fill();
  ctx.restore();

  // 스프링: 종이에 뚫린 구멍 + 고리
  const gap = 46;
  for (let y = py + 40; y < py + ph - 30; y += gap) {
    ctx.fillStyle = NOTE.desk;
    ctx.beginPath();
    ctx.arc(px + 26, y, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = NOTE.ring;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px + 26, y);
    ctx.bezierCurveTo(px - 4, y - 4, px - 30, y + 2, px - 22, y + 12);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';

  return { L: px + 64, R: px + pw - 40, T: py + 40, B: py + ph - 40 };
}

// 위쪽: 날짜 숫자 칸들 + 요일 칸 → 다음 y를 돌려줌
function drawDateBoxes(ctx, x, y, digits, dayText) {
  const bw = 54;
  const bh = 68;
  [...digits].forEach((ch, i) => {
    const bx = x + i * (bw + 6);
    box(ctx, bx, y, bw, bh);
    ctx.font = hand(700, 50);
    ctx.fillStyle = NOTE.ink;
    ctx.textAlign = 'center';
    ctx.fillText(ch, bx + bw / 2, y + 52);
  });
  let nx = x + digits.length * (bw + 6) + 14;
  if (dayText) {
    ctx.strokeStyle = NOTE.box;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(nx + 34, y + bh / 2, 30, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = hand(700, 40);
    ctx.fillStyle = NOTE.ink;
    ctx.fillText(dayText, nx + 34, y + bh / 2 + 14);
    nx += 80;
  }
  ctx.textAlign = 'left';
  return { right: nx, bottom: y + bh };
}

// 오른쪽 위: TOTAL 칸 + 작은 표 2칸 (예: 시작 / 끝)
function drawTotalBox(ctx, R, y, totalMs, pairs) {
  const w = 300;
  const x = R - w;
  box(ctx, x, y, w, 68);
  ctx.font = hand(700, 26);
  ctx.fillStyle = NOTE.soft;
  ctx.fillText('TOTAL', x + 16, y + 42);
  ctx.font = hand(700, 50);
  ctx.fillStyle = NOTE.ink;
  ctx.textAlign = 'right';
  ctx.fillText(fmtHMLong(totalMs), R - 16, y + 52);
  ctx.textAlign = 'left';

  // 작은 표
  const ty = y + 84;
  const cw = w / 2;
  box(ctx, x, ty, w, 96);
  line(ctx, x + cw, ty, x + cw, ty + 96, NOTE.box);
  line(ctx, x, ty + 38, R, ty + 38, NOTE.box);
  pairs.forEach(([name, value], i) => {
    ctx.textAlign = 'center';
    ctx.font = hand(400, 24);
    ctx.fillStyle = NOTE.soft;
    ctx.fillText(name, x + cw * i + cw / 2, ty + 28);
    ctx.font = hand(700, 36);
    ctx.fillStyle = NOTE.ink;
    ctx.fillText(value, x + cw * i + cw / 2, ty + 82);
  });
  ctx.textAlign = 'left';
  return ty + 96;
}

// 날짜 밑 문장 (명언 또는 직접 쓴 문장) + 클로버
// 두 줄에 들어가도록 글자 크기를 줄여 보고, 그래도 길면 두 번째 줄 끝을 '…'으로
function drawComment(ctx, x, y, maxWidth, { text, author }) {
  let size = 34;
  let lines;
  do {
    ctx.font = hand(400, size);
    lines = wrapText(ctx, text, maxWidth);
    size -= 2;
  } while (lines.length > 2 && size >= 26);
  if (lines.length > 2) lines = [lines[0], fitText(ctx, lines.slice(1).join(' '), maxWidth)];

  ctx.fillStyle = NOTE.ink;
  lines.forEach((t, i) => ctx.fillText(t, x + 50, y + 40 + i * 42));
  if (author) {
    ctx.font = hand(400, 22);
    ctx.fillStyle = NOTE.soft;
    ctx.fillText(`- ${author}`, x + 50, y + 40 + lines.length * 42 - 8);
  }
  clover(ctx, x + 18, y + 22, 14, -0.3);
}

function drawShareImage(canvas) {
  const W = SHARE_W;
  const H = SHARE_H;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'alphabetic';
  // 고른 색상 테마로 색 바꾸기 (테마에 없는 색은 기본 색)
  Object.assign(NOTE, NOTE_BASE, currentPalette());
  const area = drawNotebook(ctx, W, H);
  drawNoteToday(ctx, area);
}

// 지금 고른 이미지 색: 테마 6개 중 하나, 또는 무지개로 직접 고른 색으로 만든 테마
function currentPalette() {
  if (shareSet.palette === 'custom') {
    const c = shareSet.paletteColor;
    return { desk: tint(c, 0.85), pen: tint(c, 0.45), penDark: c };
  }
  return SHARE_PALETTES.find((p) => p.id === shareSet.palette) || SHARE_PALETTES[0];
}

// ===== 오늘 =====
function drawNoteToday(ctx, { L, R, T, B }) {
  const now = new Date();
  const today = dateKey(now);
  const list = records.filter((r) => r.date === today).sort((a, b) => a.endedAt - b.endedAt);
  const total = list.reduce((n, r) => n + r.studyMs, 0);
  // 공부 구간마다 칠할 색: 과목 색 ('색 없음'이면 테마의 형광펜 색)
  const colorOf = (r) => {
    const c = subjectColor(r.goal);
    return c === 'none' ? NOTE.pen : c;
  };
  const allSessions = list.flatMap((r) => sessionsOf(r).map(([s, e]) => [s, e, colorOf(r)]));
  const start = allSessions.length ? Math.min(...allSessions.map((s) => s[0])) : null;
  const end = allSessions.length ? Math.max(...allSessions.map((s) => s[1])) : null;

  // 위쪽: 날짜 칸 (예: 26 11 13) + 요일 / 오른쪽: TOTAL + 시작 · 끝
  const digits = `${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  drawDateBoxes(ctx, L, T, digits, DAY_KO[now.getDay()]);
  const tableBottom = drawTotalBox(ctx, R, T, total, [
    ['시작', start ? fmtClockTime(start) : '-'],
    ['끝', end ? fmtClockTime(end) : '-'],
  ]);

  // 날짜 밑 문장 (오늘의 명언 / 직접 쓴 문장) — 오른쪽 TOTAL 칸 앞까지
  drawComment(ctx, L, T + 92, R - 300 - 24 - (L + 50), shareSentence());

  // 본문: 왼쪽 체크리스트 + 오른쪽 타임테이블 (같은 줄 간격을 함께 씀)
  const top = Math.max(tableBottom, T + 200) + 24;
  line(ctx, L, top, R, top, NOTE.ink, 2.5);
  const rows = TIMETABLE_HOURS.length;
  const rowH = (B - top) / rows;
  const ttW = Math.min(360, (R - L) * 0.42);        // 타임테이블 너비
  const TL = R - ttW;                                // 타임테이블 시작
  const hourW = 36;
  const GX = TL + hourW;
  const GW = R - GX;

  // 체크리스트: 목표 이름 + 오른쪽 체크
  // 정사각형은 줄이 좁아서 타임테이블 2줄을 체크리스트 1줄로 씀
  const listRowH = rowH < 40 ? rowH * 2 : rowH;
  const listRows = Math.floor((B - top) / listRowH);
  const listR = TL - 24;
  ctx.font = hand(700, Math.min(36, listRowH * 0.62));
  list.slice(0, listRows).forEach((r, i) => {
    const ry = top + i * listRowH;
    const cs = Math.min(30, listRowH * 0.5);
    const name = fitText(ctx, r.goal || '목표 없음', listR - L - cs - 20);
    // 이름 아래쪽에 그 과목 색으로 형광펜 밑줄 (타임테이블 색과 같음, '색 없음'이면 밑줄 없음)
    if (subjectColor(r.goal) !== 'none') {
      highlight(ctx, L, ry + listRowH * 0.42, ctx.measureText(name).width + 10, listRowH * 0.34, colorOf(r));
    }
    ctx.fillStyle = NOTE.ink;
    ctx.fillText(name, L + 4, ry + listRowH * 0.66);
    box(ctx, listR - cs, ry + (listRowH - cs) / 2, cs, cs);
    check(ctx, listR - cs + 3, ry + (listRowH - cs) / 2 + 2, cs);
  });

  // 공부한 시간대 칠하기 (초록 형광펜)
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  allSessions.forEach(([s, e, color]) => {
    TIMETABLE_HOURS.forEach((h, row) => {
      const hs = dayStart + h * 3600000;
      const a = Math.max(s, hs);
      const b = Math.min(e, hs + 3600000);
      if (b <= a) return;
      const x1 = GX + ((a - hs) / 3600000) * GW;
      const x2 = GX + ((b - hs) / 3600000) * GW;
      highlight(ctx, x1 + 1, top + row * rowH + rowH * 0.18, Math.max(3, x2 - x1 - 2), rowH * 0.64, color);
    });
  });

  // 줄 + 시각 숫자 + 10분 세로줄
  for (let i = 1; i <= listRows; i++) line(ctx, L, top + i * listRowH, TL, top + i * listRowH);   // 체크리스트 줄
  for (let i = 1; i <= rows; i++) line(ctx, TL, top + i * rowH, R, top + i * rowH);                 // 타임테이블 줄
  ctx.font = hand(700, Math.min(24, rowH * 0.62));
  ctx.fillStyle = NOTE.soft;
  ctx.textAlign = 'center';
  TIMETABLE_HOURS.forEach((h, row) => ctx.fillText(String(h), TL + hourW / 2, top + row * rowH + rowH * 0.7));
  ctx.textAlign = 'left';
  line(ctx, TL, top, TL, B, NOTE.box);
  for (let c = 0; c <= 6; c++) line(ctx, GX + (GW / 6) * c, top, GX + (GW / 6) * c, B, c === 0 || c === 6 ? NOTE.box : NOTE.line, 1.5);

  if (list.length === 0) {
    ctx.font = hand(400, 30);
    ctx.fillStyle = NOTE.soft;
    ctx.fillText('오늘은 아직 기록이 없어요', L + 4, top + listRowH * 0.66);
  }

  clover(ctx, TL - 70, B - 40, 18, 0.4);  // 아래쪽 클로버 낙서
}

// 고른 글꼴에서 이미지에 쓸 글자들을 불러오기
// 글꼴이 글자 묶음별로 나뉘어 있어서, 쓸 글자를 알려 줘야 그 부분을 내려받음
function loadHandFont() {
  if (!document.fonts) return Promise.resolve();
  const { text, author } = shareSentence();
  const sample = `0123456789:HMTOTAL시작끝월화수목금토일 ${records.map((r) => r.goal).join('')}${text}${author}-…오늘은 아직 기록이 없어요목표 없음`;
  return Promise.all([
    document.fonts.load(hand(400, 30), sample),
    document.fonts.load(hand(700, 30), sample),
  ]).catch(() => {});
}

// 미리보기 다시 그리기: 기록함의 작은 그림 + 수정 창의 큰 그림 (꾸미기 버튼들도 함께)
function drawSharePreviews() {
  drawShareImage($('shareCanvas'));
  const big = $('shareCanvasBig');
  big.width = SHARE_W;
  big.height = SHARE_H;
  big.getContext('2d').drawImage($('shareCanvas'), 0, 0);
}

function renderShare() {
  renderShareOptions();
  drawSharePreviews();
  // 손글씨 글꼴을 다 불러오면 한 번 더 그림 (먼저 그리면 기본 글꼴로 그려짐)
  loadHandFont().then(drawSharePreviews);
}

// 수정 창 열기 / 닫기 (기록함 창 위에 뜸)
function openShareEdit() {
  renderShare();
  $('shareModal').hidden = false;
  $('closeShareModal').focus();
}
function closeShareEdit() {
  if ($('shareModal').hidden) return false;
  $('shareModal').hidden = true;
  $('openShareEdit').focus();
  return true;
}

// 꾸미기 버튼들 그리기: 문장 / 글꼴 / 색상 / 과목 색
function renderShareOptions() {
  const chip = (text, data, active) => {
    const btn = el('button', 'time-chip', text);
    btn.type = 'button';
    Object.assign(btn.dataset, data);
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active);
    return btn;
  };

  // 문장: 오늘의 명언 / 직접 쓰기 (직접 쓰기일 때만 입력칸)
  const isQuote = shareSet.textMode === 'quote';
  document.querySelectorAll('[data-text-mode]').forEach((b) => {
    b.classList.toggle('active', b.dataset.textMode === shareSet.textMode);
    b.setAttribute('aria-pressed', b.dataset.textMode === shareSet.textMode);
  });
  $('shareText').hidden = isQuote;
  if (document.activeElement !== $('shareText')) $('shareText').value = shareSet.custom;

  // 글꼴: 버튼 글자를 그 글꼴로 보여 줌
  $('shareFonts').replaceChildren(...SHARE_FONTS.map((f) => {
    const btn = chip(f.name, { font: f.id }, f.id === shareSet.font);
    btn.style.fontFamily = `${f.family}, "Pretendard", sans-serif`;
    return btn;
  }));

  // 이미지 색상: 형광펜 색 동그라미 (배경색 테두리)
  $('sharePalettes').replaceChildren(...SHARE_PALETTES.map((p) => {
    const btn = el('button', 'palette-btn');
    btn.type = 'button';
    btn.dataset.palette = p.id;
    btn.title = p.name;
    btn.setAttribute('aria-label', p.name);
    btn.classList.toggle('active', p.id === shareSet.palette);
    btn.style.setProperty('--desk', p.desk);
    btn.style.setProperty('--pen', p.pen);
    return btn;
  }));
  // 무지개(직접 고르기): 고른 상태면 테두리 표시 — 이 버튼은 index.html에 고정 (다시 그리면 색 고르기 창이 닫혀서)
  $('paletteCustom').classList.toggle('active', shareSet.palette === 'custom');
  if (document.activeElement !== $('paletteColor')) $('paletteColor').value = shareSet.paletteColor;

  // 과목 색: 오늘 과목마다 색 고르기 (맨 끝 빨간 사선 동그라미 = 색 없음)
  const subjects = todaySubjects();
  const box = $('subjectList');
  if (subjects.length === 0) {
    box.replaceChildren(el('span', 'muted', '오늘 기록이 없어요'));
    return;
  }
  box.replaceChildren(...subjects.map((name) => {
    const row = el('div', 'subject-row');
    const dots = el('div', 'subject-dots');
    const current = subjectColor(name);
    SUBJECT_COLORS.forEach((c) => {
      const dot = el('button', 'subject-dot');
      dot.type = 'button';
      dot.dataset.subject = name;
      dot.dataset.color = c;
      dot.style.background = c;
      dot.classList.toggle('active', c === current);
      dot.setAttribute('aria-label', `${name} 색`);
      dots.append(dot);
    });
    const none = el('button', 'subject-dot subject-none');
    none.type = 'button';
    none.dataset.subject = name;
    none.dataset.color = 'none';
    none.title = '색 없음';
    none.setAttribute('aria-label', `${name} 색 없음`);
    none.classList.toggle('active', current === 'none');
    dots.append(none);
    row.append(el('span', 'subject-name', name), dots);
    return row;
  }));
}

// 꾸미기 설정을 바꾸고 미리보기 다시 그리기
function setShare(change) {
  Object.assign(shareSet, change);
  saveShareSet();
  renderShare();
}

function shareFileName() {
  return `생각기록타이머_${dateKey(new Date())}.png`;
}

// 이미지 파일로 저장
function saveShareImage(toastId = 'shareToast') {
  $('shareCanvas').toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = shareFileName();
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(toastId, '저장했어요');
  }, 'image/png');
}

// 휴대폰에서는 바로 공유 (인스타그램 · 카카오톡 등 공유 창이 열림)
function sendShareImage() {
  $('shareCanvas').toBlob(async (blob) => {
    const file = new File([blob], shareFileName(), { type: 'image/png' });
    try {
      await navigator.share({ files: [file], title: '생각 기록 타이머' });
    } catch {
      /* 공유 창을 닫은 경우 — 아무것도 안 함 */
    }
  }, 'image/png');
}

// 이 브라우저가 이미지 공유를 지원하는지 (주로 휴대폰)
function canShareImage() {
  try {
    const test = new File([''], 'test.png', { type: 'image/png' });
    return Boolean(navigator.canShare && navigator.canShare({ files: [test] }));
  } catch {
    return false;
  }
}


/* ---------- 7. 화면 그리기(render) ---------- */

const $ = (id) => document.getElementById(id);

// 요소 만들기 도우미 (사용자 글은 textContent로 넣어서 안전하게)
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const pad = (n) => String(n).padStart(2, '0');

function fmtClock(ms, withHours = true, roundUp = false) {
  const s = roundUp ? Math.ceil(ms / 1000) : Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return withHours ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m + h * 60)}:${pad(sec)}`;
}

function fmtDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}초`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

// 내 컴퓨터 시간 기준 날짜 문자열 (toISOString은 UTC라 한국 시간과 어긋날 수 있음)
function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtTime(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let toastTimers = {};
function showToast(id, msg) {
  const box = $(id);
  box.textContent = msg;
  box.classList.add('show');
  clearTimeout(toastTimers[id]);
  toastTimers[id] = setTimeout(() => box.classList.remove('show'), 3500);
}

// ① 타이머
function renderTimer() {
  const isPomo = timer.mode === 'pomodoro';
  let label;
  let clock;

  if (isPomo) {
    const remain = Math.max(0, phaseLength(timer.phase) - phaseElapsed());
    clock = fmtClock(remain, false, true);      // 남은 시간 (25:00 → 00:00)
    label = timer.phase === 'focus' ? '집중' : '휴식';
  } else {
    clock = fmtClock(phaseElapsed());           // 흐른 시간 (00:00:00 →)
    label = '집중';
  }
  if (!timer.active) label = '대기 중';
  else if (!timer.running) label += ' · 일시정지';

  $('phaseLabel').textContent = label;
  $('timeText').textContent = clock;
  $('studyTotal').textContent =
    isPomo && timer.active ? `누적 ${fmtClock(totalStudyMs())}` : '';
  $('timerSection').dataset.phase = timer.active ? timer.phase : 'idle';
  document.body.classList.toggle('studying', timer.active); // 공부 중이면 집중 모드 화면

  $('startBtn').disabled = timer.running;
  $('startBtn').textContent = timer.active && !timer.running ? '계속하기' : '시작'; // (예전 버전에서 일시정지해 둔 경우만 '계속하기')
  $('stopBtn').disabled = !timer.active;

  // 공부 중이면 '공부 중' 대신 공부 이름을 크게 표시 (뽀모도로 휴식 시간에는 '휴식 중')
  $('studyBanner').hidden = !timer.active;
  $('bannerText').textContent = isPomo && timer.phase === 'break' ? '휴식 중' : (timer.goal || '집중 중');
  $('studyBanner').classList.toggle('break', isPomo && timer.phase === 'break');

  // 공부 중에는 이름 입력칸 · 시간 선택을 숨김 (이름은 끝난 뒤 창에서 고침)
  $('goalInput').hidden = timer.active;
  $('pomoSettings').hidden = timer.active;

  document.title = timer.active ? `${clock} · 생각 기록 타이머` : '생각 기록 타이머';
}

// 보관함 창의 카테고리 필터 (예전에 직접 만든 카테고리의 메모가 남아 있으면 그것도 넣음)
function renderFilter() {
  const all = [...CATEGORIES, ...new Set(memos.map((m) => m.category).filter((c) => !CATEGORIES.includes(c)))];
  const filter = $('filterSelect');
  const prevFilter = filter.value || 'all';
  filter.replaceChildren(new Option('전체', 'all'), ...all.map((c) => new Option(c, c)));
  filter.value = prevFilter === 'all' || all.includes(prevFilter) ? prevFilter : 'all';
}

// 입력하는 동안 어떤 카테고리로 들어갈지 미리 보여 줌
function renderAutoHint() {
  const text = $('memoInput').value.trim();
  // 어느 카테고리로 들어갈지 짧게
  $('autoHint').textContent = text ? `✨ ${classifyMemo(text)}` : '';
}

// 📝 메모장 — 공부 중에는 항상, 시작 전에는 버튼을 눌렀을 때만 타이머 옆 박스에 보임
// (적는 중에는 덮어쓰지 않음 — 커서가 튀지 않게)
let noteOpen = false;   // 시작 전 화면에서 메모장을 열어 두었는지
function renderNote() {
  const area = $('noteInput');
  if (document.activeElement !== area && area.value !== note) area.value = note;

  // 메모장 ↔ 할 일 전환: 고른 쪽만 보여 줌
  const isTodo = padMode === 'todo';
  area.hidden = isTodo;
  $('todoPane').hidden = !isTodo;
  $('noteSaved').hidden = isTodo;
  document.querySelectorAll('.pad-tab').forEach((tab) => {
    const on = tab.dataset.pad === padMode;
    tab.classList.toggle('active', on);
    tab.setAttribute('aria-pressed', on);
  });
  if (isTodo) renderTodos();

  document.body.classList.toggle('note-open', noteOpen);
  $('openNote').classList.toggle('active', noteOpen);
  $('openNote').setAttribute('aria-pressed', noteOpen);
}

// ✅ 할 일 목록 그리기
function renderTodos() {
  const ul = $('todoList');
  ul.replaceChildren();
  if (todos.length === 0) ul.append(el('li', 'todo-empty', '할 일을 적어 보세요'));

  todos.forEach((t) => {
    const li = el('li', 'todo-item');
    li.classList.toggle('done', t.done);

    // 글자를 눌러도 체크되게 label로 감쌈
    const label = el('label', 'todo-label');
    const check = el('input', 'todo-check');
    check.type = 'checkbox';
    check.checked = t.done;
    check.dataset.todoId = t.id;
    label.append(check, el('span', 'todo-text', t.text));

    const del = el('button', 'todo-del', '×');
    del.type = 'button';
    del.dataset.todoDel = t.id;
    del.title = '지우기';
    del.setAttribute('aria-label', `'${t.text}' 지우기`);

    li.append(label, del);
    ul.append(li);
  });

  // 아래: 남은 개수 + 완료한 것 지우기
  const left = todos.filter((t) => !t.done).length;
  $('todoLeft').textContent = todos.length === 0 ? ''
    : left ? `남은 할 일 ${left}개`
    : '모두 끝냈어요! 🎉';
  $('todoClear').hidden = left === todos.length;   // 체크한 게 하나도 없으면 숨김
}

// 지금 보이는 칸(메모장 / 할 일 입력칸)에 커서 놓기
function focusPad() {
  $(padMode === 'todo' ? 'todoInput' : 'noteInput').focus();
}

function setPadMode(mode) {
  padMode = mode === 'todo' ? 'todo' : 'note';
  save(KEYS.pad, padMode);
  renderNote();
  focusPad();
}

function toggleNote(open = !noteOpen) {
  noteOpen = open;
  renderNote();
  if (noteOpen) focusPad();
}

// 맨 왼쪽 위 버튼: 사이드바 숨기기 / 보이기 (다음에 열어도 그대로)
let sideHidden = load(KEYS.sideHidden, false);
function renderSide() {
  document.body.classList.toggle('side-hidden', sideHidden);
  $('sideToggle').setAttribute('aria-label', sideHidden ? '사이드바 보이기' : '사이드바 숨기기');
}

let noteSavedTimer = null;
function saveNote(value) {
  note = value;
  save(KEYS.note, note);
  renderNote();
  $('noteSaved').textContent = '저장됨';
  clearTimeout(noteSavedTimer);
  noteSavedTimer = setTimeout(() => { $('noteSaved').textContent = ''; }, 1500);
}

// 카테고리를 고르는 드롭다운 (보관함 창 · 공부를 마친 뒤 창)
function categorySelect(m) {
  const sel = el('select', 'chip-select');
  sel.dataset.cat = m.id;
  sel.setAttribute('aria-label', '카테고리 바꾸기');
  const list = CATEGORIES.includes(m.category) ? CATEGORIES : [...CATEGORIES, m.category]; // 예전에 직접 만든 카테고리도 보이게
  list.forEach((c) => sel.append(new Option(c, c)));
  sel.value = m.category;
  return sel;
}

// 메모 한 개 (withDelete: 보관함 창 · 마친 뒤 창에서 삭제 · 카테고리 바꾸기 표시)
function memoItem(m, { withDelete = false } = {}) {
  const li = el('li', 'memo-item');
  const meta = el('div', 'memo-meta');
  const when = fmtTime(m.createdAt);
  if (withDelete) {
    meta.append(categorySelect(m), el('span', 'memo-time', when));
  } else {
    meta.append(el('span', 'chip', m.category), el('span', 'memo-time', when));
  }
  li.append(meta, el('p', 'memo-text', m.text));
  if (withDelete) {
    const del = el('button', 'del-btn', '삭제');
    del.dataset.id = m.id;
    li.append(del);
  }
  return li;
}

// ③ 생각 보관함 — 사이드바의 '생각 보관함'을 누르면 열리는 창
//    공부 중(active)에는 사이드바가 숨겨져서 열 수 없음
function renderVault() {
  const locked = timer.active;
  // 5. 지금 보관 중인 생각 개수 — 공부 중에는 이번 공부에서 적은 개수도 함께
  const sessionCount = locked ? memos.filter((m) => m.createdAt >= timer.sessionStart).length : 0;
  $('memoCount').textContent = locked
    ? `🔒 이번 ${sessionCount}개 · 전체 ${memos.length}개 보관 중`
    : `🔒 ${memos.length}개 보관 중`;
  $('vaultCount').textContent = memos.length ? memos.length : '';
  $('openVault').disabled = locked;
  $('openHistory').disabled = locked;
  if (locked) return;
  renderVaultList();
}

// 보관함 창: 날짜별로 묶은 전체 목록 + 카테고리 필터 + 삭제
function renderVaultList() {
  const filter = $('filterSelect').value;
  const list = memos
    .filter((m) => filter === 'all' || m.category === filter)
    .sort((a, b) => b.createdAt - a.createdAt);
  $('vaultTotal').textContent = `${list.length}개`;

  const box = $('vaultList');
  box.replaceChildren();
  if (list.length === 0) {
    box.append(el('p', 'empty with-char', '보관된 생각이 없어요.'));
    return;
  }

  let currentDate = null;
  let ul;
  list.forEach((m) => {
    const d = dateKey(new Date(m.createdAt));
    if (d !== currentDate) {          // 날짜가 바뀌면 새 묶음 시작
      currentDate = d;
      box.append(el('h3', 'date-head', d));
      ul = el('ul', 'memo-list');
      box.append(ul);
    }
    ul.append(memoItem(m, { withDelete: true }));
  });
}

// ④ 공부 기록 — 자세한 기록은 사이드바의 '기록함' 창에서
function renderRecords() {
  if (openedDrawer === 'historyDrawer') renderHistory();
}

// 타이머 아래: 오늘 한 공부 이어하기 버튼 (최근 3개, 공부 중이 아닐 때만)
function renderResume() {
  const today = dateKey(new Date());
  const todays = records
    .filter((r) => r.date === today)
    .sort((a, b) => b.endedAt - a.endedAt)
    .slice(0, 3);
  $('resumeBox').hidden = timer.active || todays.length === 0;

  const box = $('resumeList');
  box.replaceChildren();
  todays.forEach((r) => {
    const btn = el('button', 'resume-btn');
    btn.type = 'button';
    btn.dataset.recordId = r.id;
    btn.append(
      el('span', 'resume-play', '▶'),
      el('span', 'resume-goal', r.goal || '목표 없음'),
      el('span', 'resume-time', fmtDuration(r.studyMs)),
    );
    box.append(btn);
  });
}

// 공부 기록 한 줄
// - 모든 기록: '수정'으로 공부 목표를 고칠 수 있음
function recordItem(r, { withDate = false } = {}) {
  const li = el('li', 'record-item');

  const [, m, d] = r.date.split('-');
  const meta = `${withDate ? `${Number(m)}/${Number(d)} · ` : ''}${fmtDuration(r.studyMs)}`;

  const info = el('div', 'record-info');
  info.append(el('span', 'record-goal', r.goal || '목표 없음'), el('span', 'record-meta', meta));

  const actions = el('div', 'record-actions');
  const edit = el('button', 'record-edit', '수정');
  edit.type = 'button';
  edit.dataset.editId = r.id;
  edit.title = '이름 수정';
  const del = el('button', 'record-edit rec-del', '삭제');   // 한 번 누르면 빨갛게 → 한 번 더 누르면 지워짐
  del.type = 'button';
  del.dataset.delId = r.id;
  actions.append(edit, del);

  li.append(info, actions);
  return li;
}

// 기록의 공부 목표 고치기 — '수정'을 누르면 그 자리에 입력칸이 생김
// Enter 또는 다른 곳 클릭 = 저장, Esc = 취소
function startEditGoal(btn) {
  const li = btn.closest('.record-item');
  const r = records.find((x) => x.id === btn.dataset.editId);
  if (!li || !r || li.querySelector('.record-goal-input')) return;

  const input = el('input', 'record-goal-input');
  input.type = 'text';
  input.maxLength = 40;
  input.placeholder = '이름';
  input.value = r.goal;
  li.querySelector('.record-goal').replaceWith(input);
  btn.textContent = '저장';
  input.focus();
  input.select();

  let finished = false;
  const finish = (keep) => {
    if (finished) return;
    finished = true;
    if (keep) {
      r.goal = input.value.trim() || r.goal;   // 비워 두면 원래 이름 그대로
      save(KEYS.records, records);
      mergeTodayRecords(); // 이름을 바꿔서 오늘 다른 기록과 같아지면 합침
    }
    renderRecords();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.stopPropagation(); finish(false); } // Esc가 옆 창까지 닫지 않게
  });
  input.addEventListener('blur', () => finish(true));
}

// 주간 그래프 막대 위에 쓰는 짧은 시간 (예: 3시간, 45분)
function fmtShort(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}분`;
  const h = Math.round(min / 6) / 10;           // 소수 첫째 자리까지 (예: 1.5시간)
  return `${h}시간`;
}

// 그 주의 월요일 0시
function startOfWeek(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));   // 일요일(0) → 6일 전, 월요일(1) → 그대로
  return x;
}

// 이번 기간을 처음 보여 줄 때의 기준 날짜 (주간: 이번 주 월요일 / 월간: 이번 달 1일)
function currentPeriodStart(view) {
  const now = new Date();
  return view === 'week' ? startOfWeek(now) : new Date(now.getFullYear(), now.getMonth(), 1);
}

// ⑤ 기록 자세히 보기 — 주간(요일별 막대 7개) / 월간(일별 막대)
function renderHistory() {
  const sums = sumByDate();
  const now = new Date();
  const todayKey = dateKey(now);
  const isWeek = historyView === 'week';
  const bars = [];                               // { key, label, title, ms }

  if (isWeek) {
    for (let i = 0; i < 7; i++) {
      const d = new Date(historyCursor.getFullYear(), historyCursor.getMonth(), historyCursor.getDate() + i);
      const key = dateKey(d);
      bars.push({ key, label: DAY_KO[d.getDay()], title: `${d.getMonth() + 1}월 ${d.getDate()}일`, ms: sums[key] || 0 });
    }
    const first = historyCursor;
    const last = new Date(first.getFullYear(), first.getMonth(), first.getDate() + 6);
    $('periodLabel').textContent = first.getMonth() === last.getMonth()
      ? `${first.getMonth() + 1}월 ${first.getDate()}일 – ${last.getDate()}일`
      : `${first.getMonth() + 1}월 ${first.getDate()}일 – ${last.getMonth() + 1}월 ${last.getDate()}일`;
  } else {
    const y = historyCursor.getFullYear();
    const mo = historyCursor.getMonth();          // 0 = 1월
    $('periodLabel').textContent = `${y}년 ${mo + 1}월`;
    const lastDay = new Date(y, mo + 1, 0).getDate(); // 이번 달 마지막 날 (28~31)
    for (let d = 1; d <= lastDay; d++) {
      const key = `${y}-${pad(mo + 1)}-${pad(d)}`;
      bars.push({
        key,
        label: d === 1 || d % 5 === 0 ? String(d) : '', // 글자가 겹치지 않게 1, 5, 10…만 표시
        title: `${mo + 1}월 ${d}일`,
        ms: sums[key] || 0,
      });
    }
  }

  // 요약: 총 시간 / 공부한 날 수 / 공부한 날 기준 하루 평균
  const keys = bars.map((b) => b.key);
  const total = bars.reduce((n, b) => n + b.ms, 0);
  const days = bars.filter((b) => b.ms > 0).length;
  $('statTotal').textContent = fmtDuration(total);
  $('statDays').textContent = `${days}일`;
  $('statAvg').textContent = days ? fmtDuration(total / days) : '-';

  $('historyEmpty').hidden = total > 0;

  // 아래에 기록을 보여 줄 날: 누른 날이 이 기간에 없으면 → 오늘 / 공부한 마지막 날 / 기간의 마지막 날
  if (!keys.includes(historyDay)) {
    const studied = bars.filter((b) => b.ms > 0);
    historyDay = keys.includes(todayKey) ? todayKey
      : studied.length ? studied[studied.length - 1].key
      : keys[keys.length - 1];
  }

  // 이번 주(이번 달)보다 미래로는 못 넘어가게
  $('nextPeriod').disabled = historyCursor.getTime() >= currentPeriodStart(historyView).getTime();

  document.querySelectorAll('.hist-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === historyView);
  });

  // 막대그래프
  const max = Math.max(1, ...bars.map((b) => b.ms));
  const chart = $('historyChart');
  chart.dataset.view = historyView;
  chart.replaceChildren();
  bars.forEach((b) => {
    const col = el('button', 'bar-col');            // 막대를 누르면 그날 기록을 아래에 보여 줌
    col.type = 'button';
    col.dataset.day = b.key;
    if (b.key === todayKey) col.classList.add('today');
    col.classList.toggle('selected', b.key === historyDay);
    col.setAttribute('aria-pressed', b.key === historyDay);
    col.title = `${b.title}: ${fmtDuration(b.ms)}`; // 마우스를 올리면 정확한 시간 표시

    const bar = el('div', 'bar');
    bar.style.height = `${(b.ms / max) * 100}%`;
    const wrap = el('div', 'bar-wrap');
    wrap.append(bar);

    // 주간은 막대가 7개라 위에 시간을 적고, 월간은 31개라 생략
    const value = isWeek && b.ms ? fmtShort(b.ms) : '';
    col.append(el('span', 'bar-value', value), wrap, el('span', 'bar-label', b.label));
    chart.append(col);
  });

  // 누른 날의 기록 목록 (최근 것부터, '수정'으로 이름 고치기 · '삭제')
  const [y, m, d] = historyDay.split('-').map(Number);
  $('historyListTitle').textContent = `${m}월 ${d}일 (${DAY_KO[new Date(y, m - 1, d).getDay()]})`;
  const list = $('historyList');
  list.replaceChildren();
  const dayRecords = records
    .filter((r) => r.date === historyDay)
    .sort((a, b) => b.endedAt - a.endedAt);
  if (dayRecords.length === 0) list.append(el('li', 'empty', '기록이 없어요.'));
  dayRecords.forEach((r) => list.append(recordItem(r)));

  renderShare();
}

// ---------- 옆에서 열리는 창 열기 / 닫기 (한 번에 하나만 열림) ----------
let openedDrawer = null;   // 지금 열린 창
let drawerOpener = null;   // 창을 연 버튼 (닫으면 다시 이 버튼으로 포커스)

function openDrawer(id, opener) {
  closeDrawer(false);
  $(id).classList.add('open');
  $('drawerBackdrop').classList.add('open');
  document.body.classList.add('no-scroll'); // 뒤쪽 화면 스크롤 막기
  openedDrawer = id;
  drawerOpener = opener;
  $(id).querySelector('.icon-close').focus();
}

function closeDrawer(restoreFocus = true) {
  if (!openedDrawer) return;
  $(openedDrawer).classList.remove('open');
  $('drawerBackdrop').classList.remove('open');
  document.body.classList.remove('no-scroll');
  if (restoreFocus && drawerOpener) drawerOpener.focus();
  openedDrawer = null;
}

// 왼쪽 창: 공부 기록 자세히 보기
function openHistory() {
  historyCursor = currentPeriodStart(historyView); // 열 때마다 이번 주(이번 달)부터
  historyDay = null;                               // 아래 목록은 오늘부터
  renderHistory();
  openDrawer('historyDrawer', $('openHistory'));
}

// 왼쪽 창: 생각 보관함 전체 보기
function openVault() {
  if (timer.active) return; // 공부 중에는 잠김
  renderVault();
  openDrawer('vaultDrawer', $('openVault'));
}

// step: -1 = 이전, +1 = 다음
function moveHistory(step) {
  const y = historyCursor.getFullYear();
  const mo = historyCursor.getMonth();
  historyCursor = historyView === 'week'
    ? new Date(y, mo, historyCursor.getDate() + step * 7)   // 7일 앞 / 뒤 (달이 넘어가도 자동 계산됨)
    : new Date(y, mo + step, 1);                            // 12월 + 1 → 다음 해 1월로 자동 계산됨
  renderHistory();
}

// 집중 · 휴식 시간 고르기 (A안: 탭 전환형)
// 위 탭에서 집중 / 휴식을 고르면 → 아래 버튼들이 그 시간을 바꿈
let pomoTab = 'focus';   // 지금 고르고 있는 탭: 'focus' | 'break'

const minText = (min) => (min ? `${min}분` : '제한 없음');

function renderPomoSettings() {
  const focus = pomoSetting.focus;
  if (!focus) pomoTab = 'focus';   // 집중이 '제한 없음'이면 쉬는 시간이 없으므로 휴식 탭은 못 고름

  // 탭: [집중 25분] [휴식 5분]
  $('focusValue').textContent = minText(focus);
  $('breakValue').textContent = minText(pomoSetting.break);
  document.querySelectorAll('.pomo-tab').forEach((tab) => {
    const on = tab.dataset.tab === pomoTab;
    tab.classList.toggle('active', on);
    tab.setAttribute('aria-pressed', on);
    tab.disabled = tab.dataset.tab === 'break' && !focus;
  });

  // 시간 버튼: 집중 [제한 없음] [15분] [25분] [60분] [120분] / 휴식 [5분] [10분] [15분] [20분]
  const now = pomoSetting[pomoTab];
  const list = pomoTab === 'focus' ? FOCUS_CHOICES : BREAK_CHOICES;
  $('timeChoices').replaceChildren(...list.map((min) => {
    const btn = el('button', 'time-chip', minText(min));
    btn.type = 'button';
    btn.dataset.min = min;
    btn.classList.toggle('active', min === now);
    btn.setAttribute('aria-pressed', min === now);
    return btn;
  }));

  // +5 · +10분: 최대 시간이 되면 흐리게
  document.querySelectorAll('.time-add').forEach((btn) => { btn.disabled = now >= TIME_MAX[pomoTab]; });
}

// 시간 선택 저장 (공부 중이 아닐 때만)
function setPomoSetting(phase, minutes) {
  if (timer.active) return;
  pomoSetting[phase] = Math.min(TIME_MAX[phase], Math.max(0, minutes));
  save(KEYS.pomodoro, pomoSetting);
  timer.mode = modeFromSetting();
  timer.phase = 'focus';
  saveTimer();
  renderPomoSettings();
  renderTimer();
}

function renderAll() {
  renderSide();
  $('goalInput').placeholder = '이름';
  renderResume();
  renderFilter();
  renderAutoHint();
  renderNote();
  renderPomoSettings();
  renderTimer();
  renderVault();
  renderRecords();
}

/* ---------- 7-2. 화면 색상 ----------
   사이드바의 동그라미 4개 중 하나를 누르면 바로 바뀜 (창이 따로 뜨지 않음)
   마지막 무지개 동그라미를 누르면 원하는 색을 직접 고를 수 있음 ({ id: 'custom', primary })
   대표색 하나만 고르면, 배경 · 타이머 칸 색은 그 색을 연하게 해서 자동으로 맞춤
   style.css의 :root에 있는 색 변수(--bg, --primary 등)를 자바스크립트로 바꿔서 화면 전체 색을 바꿈 */

// 글자 · 카드 · 선 색 (테마와 상관없이 같음)
const BASE_COLORS = {
  card: '#FFFFFF', text: '#3A3A3A', muted: '#8A877D', line: '#EEEAE2',
  field: '#FCFAF7', border: '#E4E0D8', 'danger-bg': '#EBD9D3', 'danger-text': '#8A4B3E',
};

// 대표색 목록 — 기본 베이지는 원래 쓰던 색을 그대로 씀
const THEMES = [
  { id: 'beige',    name: '베이지', primary: '#8C8B79', bg: '#F5EEE8', cream: '#F5EDDA', sage: '#CFD1C7' },
  { id: 'sky',      name: '하늘',   primary: '#5D7FA3' },
  { id: 'mint',     name: '민트',   primary: '#5C8A72' },
  { id: 'lavender', name: '라벤더', primary: '#7B6CA6' },
];

let theme = load(KEYS.theme, { id: 'beige' }); // { id: 'sky' } 또는 { id: 'custom', primary: '#AABBCC' }

// 색의 밝기 (0 = 검정, 1 = 흰색)
function brightness(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

// 색을 흰색과 섞어서 연하게 (amount: 0 = 그대로, 1 = 흰색)
function tint(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(c + (255 - c) * amount).toString(16).padStart(2, '0');
  return `#${mix((n >> 16) & 255)}${mix((n >> 8) & 255)}${mix(n & 255)}`;
}

// 지금 테마의 색: 대표색 + 대표색으로 만든 배경 · 타이머 칸 색
function themeColors() {
  const t = theme.id === 'custom' && theme.primary
    ? { primary: theme.primary }
    : THEMES.find((x) => x.id === theme.id) || THEMES[0];
  return {
    primary: t.primary,
    bg: t.bg || tint(t.primary, 0.9),       // 배경: 아주 연하게
    cream: t.cream || tint(t.primary, 0.8), // 집중 중 타이머 칸
    sage: t.sage || tint(t.primary, 0.6),   // 휴식 중 타이머 칸
  };
}

function applyTheme() {
  const c = themeColors();
  const vars = {
    ...BASE_COLORS,
    ...c,
    'on-primary': brightness(c.primary) > 0.65 ? '#2A2A2A' : '#FFFFFF', // 대표색이 밝으면 버튼 글자를 어둡게
    'on-cream': BASE_COLORS.text,
    'on-sage': BASE_COLORS.text,
  };
  Object.entries(vars).forEach(([key, value]) => {
    document.documentElement.style.setProperty(`--${key}`, value);
  });
}

function setTheme(next) {
  theme = next;
  save(KEYS.theme, theme);
  applyTheme();
  renderTheme();
}


// 사이드바의 화면 색상: 대표색 동그라미(이름 없이) + 무지개 동그라미(직접 고르기)
function renderTheme() {
  const box = $('themePresets');
  box.replaceChildren();
  THEMES.forEach((t) => {
    const btn = el('button', 'theme-btn');
    btn.type = 'button';
    btn.dataset.theme = t.id;
    btn.classList.toggle('active', theme.id === t.id);
    btn.setAttribute('aria-pressed', theme.id === t.id);
    const dot = el('span', 'theme-dot');
    dot.style.background = t.primary;
    btn.title = t.name;                    // 이름은 마우스를 올렸을 때만
    btn.setAttribute('aria-label', t.name);
    btn.append(dot);
    box.append(btn);
  });

  const isCustom = theme.id === 'custom' && Boolean(theme.primary);
  $('customTheme').classList.toggle('active', isCustom);
  const input = $('colorMain');
  if (document.activeElement !== input) input.value = themeColors().primary.toLowerCase();
}


/* ---------- 8. 이벤트 연결 & 시작 ---------- */

// 타이머 버튼
$('startBtn').addEventListener('click', startTimer);
$('stopBtn').addEventListener('click', stopTimer);

// 집중 · 휴식 시간 선택
$('pomoSettings').addEventListener('click', (e) => {
  const tab = e.target.closest('.pomo-tab');
  if (tab && !tab.disabled) { pomoTab = tab.dataset.tab; renderPomoSettings(); }
  const choice = e.target.closest('[data-min]');
  if (choice) setPomoSetting(pomoTab, Number(choice.dataset.min));                               // 시간 버튼
  const add = e.target.closest('[data-add]');
  if (add) setPomoSetting(pomoTab, pomoSetting[pomoTab] + Number(add.dataset.add));             // +5 · +10분
});

// 메모 저장
$('memoForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('memoInput').value.trim();
  if (!text) return;

  const category = classifyMemo(text);   // 내용을 보고 자동 분류
  addMemo(text, category);
  $('memoInput').value = '';
  showToast('memoToast', `'${category}'에 보관`);

  renderAutoHint();
  renderVault();
  $('memoInput').focus();
});

// 입력하는 동안 자동 분류 결과 미리 보기
$('memoInput').addEventListener('input', renderAutoHint);

// 📝 메모장: 적는 대로 바로 저장
$('noteInput').addEventListener('input', (e) => saveNote(e.target.value));
$('openNote').addEventListener('click', () => toggleNote());          // 시작 전: 타이머 옆에 메모장 열기 / 닫기
$('closeNote').addEventListener('click', () => toggleNote(false));

// [📝 메모장 | ✅ 할 일] 버튼: 누르면 칸이 바뀜
document.querySelectorAll('.pad-tab').forEach((tab) => {
  tab.addEventListener('click', () => setPadMode(tab.dataset.pad));
});

// ✅ 할 일 추가 (Enter 또는 '추가' 버튼)
$('todoForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('todoInput').value.trim();
  if (!text) return;
  addTodo(text);
  $('todoInput').value = '';
  renderTodos();
  $('todoInput').focus();
});
// 한글 입력 중(조합 중) Enter가 두 번 처리되지 않게
$('todoInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    $('todoForm').requestSubmit();
  }
});
// 체크 / 체크 풀기
$('todoList').addEventListener('change', (e) => {
  const id = e.target.dataset.todoId;
  if (!id) return;
  toggleTodo(id, e.target.checked);
  renderTodos();
});
// × : 하나 지우기
$('todoList').addEventListener('click', (e) => {
  const del = e.target.closest('[data-todo-del]');
  if (!del) return;
  deleteTodo(del.dataset.todoDel);
  renderTodos();
  $('todoInput').focus();
});
// 완료한 것 한꺼번에 지우기
$('todoClear').addEventListener('click', () => {
  clearDoneTodos();
  renderTodos();
});

// 사이드바 숨기기 / 보이기
$('sideToggle').addEventListener('click', () => {
  sideHidden = !sideHidden;
  save(KEYS.sideHidden, sideHidden);
  renderSide();
});

// Enter = 저장, Shift+Enter = 줄바꿈
// isComposing: 한글 입력 중(조합 중)에 Enter가 두 번 처리되는 문제 방지
$('memoInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $('memoForm').requestSubmit();
  }
});

// 보관함 필터 / 메모 삭제
$('filterSelect').addEventListener('change', renderVault);

// 삭제 버튼: 팝업 대신 두 번 눌러야 지워짐 (첫 번째: '한 번 더 누르면 삭제')
// 지웠으면 true
function tryDelete(btn) {
  if (!btn.classList.contains('confirm')) {
    btn.classList.add('confirm');
    btn.textContent = '한 번 더 누르면 삭제';
    return false;
  }
  deleteMemo(btn.dataset.id);
  return true;
}

$('vaultList').addEventListener('click', (e) => {
  if (e.target.dataset.id && tryDelete(e.target)) {
    renderFilter();
    renderVault();
  }
});
// 카테고리 드롭다운에서 고르면 바로 바뀜
$('vaultList').addEventListener('change', (e) => {
  if (!e.target.dataset.cat) return;
  setCategory(e.target.dataset.cat, e.target.value);
  renderVault();
});

// 옆 창 열기 / 닫기 — × 버튼, 바깥 어두운 곳 클릭, Esc 키로 닫힘
$('openHistory').addEventListener('click', openHistory);
$('openVault').addEventListener('click', openVault);
$('closeHistory').addEventListener('click', () => closeDrawer());
$('closeVault').addEventListener('click', () => closeDrawer());
$('drawerBackdrop').addEventListener('click', () => closeDrawer());
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (closeShareEdit()) return;   // 수정 창이 열려 있으면 그것만 닫음
  closeReview();
  closeDrawer();
});

// 공부를 마친 뒤 창: '확인 완료' → 원래 화면으로
$('reviewDone').addEventListener('click', closeReview);

// 공부를 마친 뒤 창: 카테고리 바꾸기(드롭다운) / 삭제(두 번 누르기)
$('reviewList').addEventListener('click', (e) => {
  if (e.target.dataset.id && tryDelete(e.target)) {
    renderReviewList();
    renderVault();
  }
});
$('reviewList').addEventListener('change', (e) => {
  if (!e.target.dataset.cat) return;
  setCategory(e.target.dataset.cat, e.target.value);
});


// 기록함 창: '수정' → 목표 고치기 / '삭제' → 한 번 더 누르면 기록 지우기
$('historyList').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del-id]');
  if (del) {
    if (!del.classList.contains('confirm')) {
      resetDeleteButtons();
      del.classList.add('confirm');
      return;
    }
    deleteRecord(del.dataset.delId);
    renderAll();
    renderHistory();
    return;
  }
  const edit = e.target.closest('[data-edit-id]');
  if (edit) startEditGoal(edit);
});

// 빨갛게 바뀐 '삭제'는 다른 곳을 누르면 원래대로
function resetDeleteButtons() {
  document.querySelectorAll('.rec-del.confirm').forEach((b) => b.classList.remove('confirm'));
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.rec-del')) resetDeleteButtons();
});

// 타이머 아래 '이어하기' 버튼 → 그 공부를 이어서 시작
$('resumeList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-record-id]');
  if (btn) resumeRecord(btn.dataset.recordId);
});

// 이름 칸에서 Enter = 시작
$('goalInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); startTimer(); }
});

// 기록함 그래프: 막대(날)를 누르면 그날 기록 보기
$('historyChart').addEventListener('click', (e) => {
  const col = e.target.closest('[data-day]');
  if (!col) return;
  historyDay = col.dataset.day;
  renderHistory();
});

// 공부 기록 창: 이전 / 다음 기간, 주간 / 월간 전환
$('prevPeriod').addEventListener('click', () => moveHistory(-1));
$('nextPeriod').addEventListener('click', () => moveHistory(1));
document.querySelectorAll('.hist-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    historyView = tab.dataset.view;
    historyCursor = currentPeriodStart(historyView);   // 바꾸면 이번 주 / 이번 달부터
    renderHistory();
  });
});

// SNS용 이미지 꾸미기
// 오늘의 명언: 누를 때마다 다음 명언으로 (그날만 적용) / 직접 쓰기: 입력칸 열기
document.querySelectorAll('[data-text-mode]').forEach((b) => {
  b.addEventListener('click', () => {
    if (b.dataset.textMode === 'quote') {
      const today = dateKey(new Date());
      const n = shareSet.shift.date === today ? shareSet.shift.n + 1 : 1;
      setShare({ textMode: 'quote', shift: { date: today, n } });
    } else {
      setShare({ textMode: 'custom' });
      $('shareText').focus();
    }
  });
});
$('shareText').addEventListener('input', (e) => setShare({ custom: e.target.value }));
$('shareFonts').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-font]');
  if (btn) setShare({ font: btn.dataset.font });
});
$('sharePalettes').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-palette]');
  if (btn) setShare({ palette: btn.dataset.palette });
});
// 무지개: 색을 고르는 동안 바로 바뀜
$('paletteColor').addEventListener('input', (e) => setShare({ palette: 'custom', paletteColor: e.target.value }));
// 수정 창 열기 / 닫기 / 저장
$('openShareEdit').addEventListener('click', openShareEdit);
$('closeShareModal').addEventListener('click', closeShareEdit);
$('shareModalDone').addEventListener('click', closeShareEdit);
$('shareModalSave').addEventListener('click', () => saveShareImage('shareModalToast'));
$('shareModal').addEventListener('click', (e) => { if (e.target === $('shareModal')) closeShareEdit(); }); // 바깥 클릭
$('subjectList').addEventListener('click', (e) => {
  const dot = e.target.closest('[data-subject]');
  if (dot) setShare({ colors: { ...shareSet.colors, [dot.dataset.subject]: dot.dataset.color } });
});

// SNS용 이미지: 저장 / 공유
$('shareSave').addEventListener('click', () => saveShareImage());
$('shareSend').addEventListener('click', sendShareImage);
$('shareSend').hidden = !canShareImage();

// 화면 색상: 사이드바의 동그라미를 누르면 바로 바뀜
$('themePresets').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-theme]');
  if (btn) setTheme({ id: btn.dataset.theme });
});
// 무지개 동그라미: 색을 고르는 동안 바로 바뀜
$('colorMain').addEventListener('input', (e) => setTheme({ id: 'custom', primary: e.target.value }));

// 시작!
mergeTodayRecords();   // 예전에 따로 저장된 오늘 기록도 같은 이름이면 합침
applyTheme();
renderTheme();
renderAll();
setInterval(tick, 250);


/* ---------- 9. 앞으로 만들 기능 (개발 일정 기준) ----------

   TODO(11월 말) 2차 피드백 중 정하지 못한 것
   - 로고 정하기 / 전시회용 QR 코드 (웹페이지 주소가 정해지면)
   (후보) 뽀모도로 전환 알림 소리, 메모 수정 기능, 자동 분류 단어 목록 늘리기
*/

/* =========================================================
   생각 기록 타이머 - script.js

   [코드 구조]
   1. 상수 / 저장소(localStorage) 도우미
   2. 상태(state) 불러오기
   3. 타이머 로직      ← 공부 공간
   4. 생각 메모        ← 생각 보관 공간
   5. 카테고리 자동 분류
   6. 공부 기록
      6-2. SNS용 이미지 만들기
   7. 화면 그리기(render)
      7-2. 화면 색상
   8. 이벤트 연결 & 시작
   9. 앞으로 만들 기능 (TODO)
   ========================================================= */


/* ---------- 1. 상수 / 저장소 도우미 ---------- */

// localStorage에 저장할 때 쓰는 이름(key)
const KEYS = {
  timer: 'ttt.timer',
  memos: 'ttt.memos',
  records: 'ttt.records',
  pomodoro: 'ttt.pomodoro',
  theme: 'ttt.theme',
  sidebar: 'ttt.sidebar',
};


// 뽀모도로 기본 시간(분) — 사용자가 화면에서 바꾸면 localStorage에 저장됨
// 집중 / 휴식 시간 선택지(분) — 집중 0 = '제한 없음'(계속 흐르는 타이머), 그 외에는 뽀모도로처럼 집중 ↔ 휴식 반복
const FOCUS_CHOICES = [0, 15, 20, 60, 120];
const BREAK_CHOICES = [5, 10, 15, 20];
const DEFAULT_POMODORO = { focus: 0, break: 5 };

// 카테고리는 직접 고르지 않고, 메모 내용을 보고 자동으로 정함 (5. 카테고리 자동 분류)
const STUDY_Q = '공부 질문';     // 공부 중에도 화면에 메모지로 계속 보이는 카테고리
const CATEGORIES = [STUDY_Q, '할 일', '아이디어', '궁금한 것', '기타'];

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback; // 저장된 값이 깨졌으면 기본값 사용
  }
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
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
if (timer.running && !timer.segStart) timer.segStart = timer.phaseStart || Date.now(); // 예전 버전에서 공부하던 중이었으면
let memos = load(KEYS.memos, []);                       // [{ id, text, category, createdAt, done }]
// [{ id, date, studyMs, mode, goal, endedAt, sessions }] — 예전 기록에 id가 없으면 붙여 줌
let records = load(KEYS.records, []).map((r) => (r.id ? r : { ...r, id: makeId() }));
save(KEYS.records, records);   // (아래 6번의 mergeTodayRecords()로 오늘 같은 이름 기록도 합침)
let studyQMode = false;                                 // '📌 공부 질문' 버튼이 눌려 있는지
let historyView = 'week';                               // 공부 기록함: 'week' | 'month'
let historyCursor = new Date();                         // 공부 기록함: 지금 보고 있는 주(월요일) / 달
let sideClosed = load(KEYS.sidebar, false) || window.innerWidth <= 760; // 사이드바 접힘 (휴대폰은 처음에 접힌 상태)
let pomoSetting = { ...DEFAULT_POMODORO, ...load(KEYS.pomodoro, {}) }; // { focus: 분(0 = 제한 없음), break: 분 }
// 예전 버전 값 맞추기: 일반 모드였으면 '제한 없음', 선택지에 없는 시간이면 가장 가까운 선택지로
{
  const oldTimer = load(KEYS.timer, {});
  if (oldTimer.mode === 'normal' && !oldTimer.active) pomoSetting.focus = 0;
  const nearest = (list, v) => list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  if (!FOCUS_CHOICES.includes(pomoSetting.focus)) pomoSetting.focus = nearest(FOCUS_CHOICES.slice(1), pomoSetting.focus);
  if (!BREAK_CHOICES.includes(pomoSetting.break)) pomoSetting.break = nearest(BREAK_CHOICES, pomoSetting.break);
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

// 이름을 안 적고 시작하면 붙는 이름: 오늘 기록 중 '공부1, 공부2 …' 다음 번호
function nextStudyName() {
  const today = dateKey(new Date());
  const used = records
    .filter((r) => r.date === today)
    .map((r) => /^공부(\d+)$/.exec((r.goal || '').trim()))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  return `공부${used.length ? Math.max(...used) + 1 : 1}`;
}

function startTimer() {
  if (timer.running) return;

  if (!timer.active) {               // 새로운 공부 시작
    closeQuestions();
    timer.mode = modeFromSetting();  // 고른 집중 시간에 따라 (제한 없음 / 뽀모도로)
    timer.active = true;
    timer.sessionStart = Date.now();
    timer.goal = $('goalInput').value.trim() || nextStudyName(); // 비워 두면 '공부1'처럼
    timer.phase = 'focus';
    timer.phaseElapsed = 0;
    timer.studiedMs = 0;
  }
  timer.running = true;              // 시작 또는 계속하기
  timer.phaseStart = Date.now();
  timer.segStart = Date.now();       // 타임테이블용: 이 구간 시작

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
  const name = timer.goal;

  if (timer.running) closeSegment();
  if (added >= 1000) saveRecord(studied, added, timer.segments || []);

  timer = { ...defaultTimer(), mode: modeFromSetting() }; // 초기화
  saveTimer();
  $('goalInput').value = '';

  renderAll(); // 집중 모드가 끝나면서 사이드바 메뉴가 다시 열림
  const done = resumed
    ? `${name} · 이번에 ${fmtDuration(added)}, 모두 ${fmtDuration(studied)}`
    : `${name} · ${fmtDuration(studied)}`;

  // 공부하면서 적은 생각이 있으면 그 생각만 큰 창으로 보여 줌 → '확인 완료'를 누르면 닫힘
  if (sessionMemos.length > 0) {
    openReview(`${name} · ${fmtDuration(added)}`, sessionMemos);
  } else {
    showToast('timerToast', `수고했어요! ${done}`);
  }
}

// 공부를 마친 뒤 보여 주는 창: 이번 공부 시간 + 이번에 적은 생각 목록 (삭제 · 카테고리 바꾸기 가능)
let reviewIds = [];   // 이 창에 보여 줄 메모 id (이번 공부 동안 적은 것)

function openReview(summary, list) {
  reviewIds = list.map((m) => m.id);
  $('reviewTitle').textContent = `수고했어요! ${summary}`;
  renderReviewList();
  $('reviewModal').hidden = false;
  document.body.classList.add('no-scroll');
  $('reviewDone').focus();
}

function renderReviewList() {
  const list = memos
    .filter((m) => reviewIds.includes(m.id))
    .sort((a, b) => a.createdAt - b.createdAt);   // 적은 순서대로
  $('reviewDesc').textContent = list.length
    ? `적어 둔 생각 ${list.length}개`
    : '모두 정리했어요! 👍';
  const ul = $('reviewList');
  ul.replaceChildren();
  list.forEach((m) => ul.append(memoItem(m, { withDelete: true })));
}

function closeReview() {
  if ($('reviewModal').hidden) return;
  $('reviewModal').hidden = true;
  document.body.classList.remove('no-scroll');
}

// 뽀모도로: 구간 시간이 다 되면 집중 ↔ 휴식 전환
// 창을 오래 닫아 두었다면 여러 구간이 지났을 수 있어서 while로 처리
function advancePomodoro() {
  if (timer.mode !== 'pomodoro' || !timer.running) return false;

  let elapsed = phaseElapsed();
  let changed = false;

  while (elapsed >= phaseLength(timer.phase)) {
    const len = phaseLength(timer.phase);
    if (timer.phase === 'focus') timer.studiedMs += len;
    timer.phase = timer.phase === 'focus' ? 'break' : 'focus';
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

// 공부 질문 해결 표시 / 해제 — 해결한 질문은 공부 중 화면에서 사라지고, 보관함에는 남음
function toggleDone(id) {
  const m = memos.find((x) => x.id === id);
  if (!m) return;
  m.done = !m.done;
  save(KEYS.memos, memos);
}

// 보관함에서 카테고리 칩을 누르면 다음 카테고리로 바뀜 (자동 분류가 틀렸을 때 고치기)
function cycleCategory(id) {
  const m = memos.find((x) => x.id === id);
  if (!m) return;
  const i = CATEGORIES.indexOf(m.category);
  m.category = CATEGORIES[(i + 1) % CATEGORIES.length];
  save(KEYS.memos, memos);
}



/* ---------- 5. 카테고리 자동 분류 ----------
   [방법] 글 속에 어떤 단어가 들어 있는지 보고 카테고리를 정하는 규칙 기반 분류
   1) 공부 단어 + 질문 표현이 함께 있으면  → 공부 질문   예) 적분 공식이 왜 이렇게 되지?
   2) 해야 할 일 표현이 있으면              → 할 일       예) 택배 주문해야지
   3) 아이디어 표현이 있으면                → 아이디어    예) 타이머에 알림 소리 넣으면 좋겠다
   4) 질문 표현만 있으면                    → 궁금한 것   예) 고양이는 왜 상자를 좋아할까?
   5) 공부 단어만 있으면                    → 공부 질문   예) 3단원 개념 다시 보기
   6) 아무것도 해당하지 않으면              → 기타
   잘못 분류됐으면 보관함 창에서 카테고리 칩을 눌러 바꿀 수 있음 */

const KEYWORDS = {
  study: ['문제', '공식', '정리', '증명', '개념', '풀이', '정답', '해설', '시험', '과제', '숙제', '강의', '수업',
    '교재', '교수', '단원', '챕터', '페이지', '쪽', '문법', '단어', '수학', '미분', '적분', '물리', '화학', '생물',
    '코드', '코딩', '함수', '변수', '알고리즘', '에러', '오류', '보고서', '레포트', '발표', '퀴즈', '중간고사',
    '기말', '계산', '그래프', '행렬', '벡터', '확률', '통계', '실험', '이론', '법칙', '정의', '예제', '범위'],
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

  const study = countWords(text, KEYWORDS.study);
  const question = countWords(text, KEYWORDS.question);
  const todo = countWords(text, KEYWORDS.todo);
  const idea = countWords(text, KEYWORDS.idea);

  if (study && question) return STUDY_Q;
  if (todo) return '할 일';
  if (idea) return '아이디어';
  if (question) return '궁금한 것';
  if (study) return STUDY_Q;
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

  if (old && old.date === today) {
    old.studyMs = studied;
    old.goal = timer.goal;   // 이어서 하는 중에 목표를 고쳤다면 기록에도 반영
    old.endedAt = Date.now();
    old.sessions = [...sessionsOf(old), ...segments];
  } else {
    records.push({
      id: makeId(),
      date: today,
      studyMs: added,
      mode: timer.mode,
      goal: timer.goal,
      endedAt: Date.now(),
      sessions: segments,
    });
  }
  save(KEYS.records, records);
  mergeTodayRecords();
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
   canvas(그림판)에 오늘 공부 기록을 손글씨 플래너처럼 그려서 PNG 이미지로 저장 / 공유
   - 날짜 칸 + TOTAL + 시작 · 끝 시각 + 한마디 + 공부한 내용 체크리스트 + 10분 타임테이블(초록 형광펜)
   - 크기: 정사각형 1080×1080 (SNS 피드용)
   - 손글씨 글꼴: Gaegu (index.html에서 불러옴, 없으면 기본 글꼴)
   - 적은 생각(메모)은 넣지 않음 (개인적인 내용이 SNS에 올라가지 않게) */

const SHARE_W = 1080;
const SHARE_H = 1080;
const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
const TIMETABLE_HOURS = [...Array(18).keys()].map((i) => i + 6).concat([0, 1, 2, 3, 4, 5]); // 6시 ~ 다음 날 5시

// 플래너 색 (참고한 초록 플래너 느낌)
const NOTE = {
  desk: '#E8EFE0',       // 바깥 배경
  paper: '#FFFFFF',
  line: '#E3E3DE',       // 공책 줄
  ink: '#3B3B3B',        // 손글씨
  soft: '#9A9A92',       // 연한 글씨
  pen: '#A8D07A',        // 초록 형광펜
  penDark: '#6FA544',    // 체크 표시
  ring: '#6E6E6E',       // 스프링
};
const HAND = '"Gaegu", "Pretendard", "Apple SD Gothic Neo", sans-serif';
const hand = (weight, size) => `${weight} ${size}px ${HAND}`;

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
  ctx.strokeStyle = '#CFCFC8';
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
function highlight(ctx, x, y, w, h) {
  ctx.fillStyle = withAlpha(NOTE.pen, 0.85);
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
    ctx.strokeStyle = '#CFCFC8';
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
  line(ctx, x + cw, ty, x + cw, ty + 96, '#CFCFC8');
  line(ctx, x, ty + 38, R, ty + 38, '#CFCFC8');
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

// 손글씨 한마디 + 클로버
function drawComment(ctx, x, y, lines) {
  ctx.font = hand(400, 34);
  ctx.fillStyle = NOTE.ink;
  lines.forEach((t, i) => ctx.fillText(t, x + 50, y + 40 + i * 44));
  clover(ctx, x + 18, y + 22, 14, -0.3);
}

function drawShareImage(canvas) {
  const W = SHARE_W;
  const H = SHARE_H;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.textBaseline = 'alphabetic';
  const area = drawNotebook(ctx, W, H);
  drawNoteToday(ctx, area);

  // 오른쪽 아래 작은 앱 이름
  ctx.font = hand(700, 26);
  ctx.fillStyle = NOTE.soft;
  ctx.textAlign = 'right';
  ctx.fillText('생각 기록 타이머', area.R, area.B + 22);
  ctx.textAlign = 'left';
}

// ===== 오늘 =====
function drawNoteToday(ctx, { L, R, T, B }) {
  const now = new Date();
  const today = dateKey(now);
  const list = records.filter((r) => r.date === today).sort((a, b) => a.endedAt - b.endedAt);
  const total = list.reduce((n, r) => n + r.studyMs, 0);
  const allSessions = list.flatMap((r) => sessionsOf(r));
  const start = allSessions.length ? Math.min(...allSessions.map((s) => s[0])) : null;
  const end = allSessions.length ? Math.max(...allSessions.map((s) => s[1])) : null;

  // 위쪽: 날짜 칸 (예: 26 11 13) + 요일 / 오른쪽: TOTAL + 시작 · 끝
  const digits = `${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  drawDateBoxes(ctx, L, T, digits, DAY_KO[now.getDay()]);
  const tableBottom = drawTotalBox(ctx, R, T, total, [
    ['시작', start ? fmtClockTime(start) : '-'],
    ['끝', end ? fmtClockTime(end) : '-'],
  ]);

  // 한마디 (앱 소개 문구)
  drawComment(ctx, L, T + 92, ['잡생각은 적어 두고,', `공부는 계속했다!`]);

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
    ctx.fillStyle = NOTE.ink;
    ctx.fillText(fitText(ctx, r.goal || '목표 없음', listR - L - cs - 20), L + 4, ry + listRowH * 0.66);
    box(ctx, listR - cs, ry + (listRowH - cs) / 2, cs, cs);
    check(ctx, listR - cs + 3, ry + (listRowH - cs) / 2 + 2, cs);
  });

  // 공부한 시간대 칠하기 (초록 형광펜)
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  allSessions.forEach(([s, e]) => {
    TIMETABLE_HOURS.forEach((h, row) => {
      const hs = dayStart + h * 3600000;
      const a = Math.max(s, hs);
      const b = Math.min(e, hs + 3600000);
      if (b <= a) return;
      const x1 = GX + ((a - hs) / 3600000) * GW;
      const x2 = GX + ((b - hs) / 3600000) * GW;
      highlight(ctx, x1 + 1, top + row * rowH + rowH * 0.18, Math.max(3, x2 - x1 - 2), rowH * 0.64);
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
  line(ctx, TL, top, TL, B, '#CFCFC8');
  for (let c = 0; c <= 6; c++) line(ctx, GX + (GW / 6) * c, top, GX + (GW / 6) * c, B, c === 0 || c === 6 ? '#CFCFC8' : NOTE.line, 1.5);

  if (list.length === 0) {
    ctx.font = hand(400, 30);
    ctx.fillStyle = NOTE.soft;
    ctx.fillText('오늘은 아직 기록이 없어요', L + 4, top + listRowH * 0.66);
  }

  clover(ctx, TL - 70, B - 40, 18, 0.4);  // 아래쪽 클로버 낙서
}

// 손글씨 글꼴(Gaegu)에서 이미지에 쓸 글자들을 불러오기
// 글꼴이 글자 묶음별로 나뉘어 있어서, 쓸 글자를 알려 줘야 그 부분을 내려받음
function loadHandFont() {
  if (!document.fonts) return Promise.resolve();
  const sample = `0123456789:HMTOTAL시작끝월화수목금토일 ${records.map((r) => r.goal).join('')}잡생각은 적어 두고,공부업무는 계속했다!오늘은 아직 기록이 없어요목표 없음생각 기록 타이머`;
  return Promise.all([
    document.fonts.load(hand(400, 30), sample),
    document.fonts.load(hand(700, 30), sample),
  ]).catch(() => {});
}

// 공부 기록함 창의 미리보기 다시 그리기
function renderShare() {
  drawShareImage($('shareCanvas'));
  // 손글씨 글꼴을 다 불러오면 한 번 더 그림 (먼저 그리면 기본 글꼴로 그려짐)
  loadHandFont().then(() => drawShareImage($('shareCanvas')));
}

function shareFileName() {
  return `생각기록타이머_${dateKey(new Date())}.png`;
}

// 이미지 파일로 저장
function saveShareImage() {
  $('shareCanvas').toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = shareFileName();
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('shareToast', '저장했어요');
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
    label = '';                                 // 공부 이름은 위에 크게 보임
  }
  if (!timer.active) label = '';
  else if (!timer.running) label = '일시정지';

  $('phaseLabel').textContent = label;
  $('timeText').textContent = clock;
  $('studyTotal').textContent =
    isPomo && timer.active ? `누적 ${fmtClock(totalStudyMs())}` : '';
  $('timerSection').dataset.phase = timer.active ? timer.phase : 'idle';
  document.body.classList.toggle('studying', timer.active); // 공부 중이면 집중 모드 화면

  $('startBtn').disabled = timer.running;
  $('startBtn').textContent = timer.active && !timer.running ? '계속하기' : '시작'; // (예전 버전에서 일시정지해 둔 경우만 '계속하기')
  $('stopBtn').disabled = !timer.active;

  // 공부 중이면 박스들 위에 공부 이름을 크게 (뽀모도로 휴식 시간에는 '휴식 중')
  const onBreak = isPomo && timer.phase === 'break';
  $('studyBanner').hidden = !timer.active;
  $('bannerText').textContent = onBreak ? '휴식 중' : timer.goal;
  $('studyBanner').classList.toggle('break', onBreak);

  // 공부 중에는 시간 선택 · 이름 입력칸 · 공부 질문 버튼을 숨김 (이름은 끝난 뒤 사이드바에서 수정)
  $('pomoSettings').hidden = timer.active;
  $('goalInput').hidden = timer.active;
  $('openQuestions').hidden = timer.active;

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
  const btn = $('studyQBtn');
  btn.classList.toggle('active', studyQMode);
  btn.setAttribute('aria-pressed', studyQMode);
  $('memoInput').placeholder = studyQMode ? '질문 (Enter 저장)' : '떠오른 생각 (Enter 저장)';

  // 어느 카테고리로 들어갈지 짧게
  if (studyQMode) $('autoHint').textContent = `📌 ${STUDY_Q}`;
  else $('autoHint').textContent = text ? `✨ ${classifyMemo(text)}` : '';
}

// 📌 공부 질문 — 메모지 모양, 글을 눌러서 언제든 바로 고칠 수 있음 (동그라미 = 해결 → 삭제)
// 공부 중: 생각 적기 칸 아래 / 시작 전: '📌 공부 질문' 버튼을 누르면 뜨는 창
function stickyNote(m) {
  const li = el('li', 'sticky');
  const text = el('textarea', 'sticky-text');
  text.rows = 1;
  text.value = m.text;
  text.dataset.noteId = m.id;
  text.setAttribute('aria-label', '공부 질문 고치기');
  const check = el('button', 'pin-check', '');
  check.type = 'button';
  check.dataset.done = m.id;
  check.title = '해결 (지우기)';
  check.setAttribute('aria-label', `해결: ${m.text}`);
  li.append(text, check);
  return li;
}

// 메모지 높이를 글 길이에 맞추기
function fitNote(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function renderPinned() {
  const list = memos
    .filter((m) => m.category === STUDY_Q && !m.done)
    .sort((a, b) => a.createdAt - b.createdAt);
  $('qCount').textContent = list.length || '';
  $('qEmpty').hidden = list.length > 0;
  $('notesEmpty').hidden = list.length > 0;
  ['pinnedList', 'qList'].forEach((id) => {
    $(id).replaceChildren(...list.map(stickyNote));
  });
  requestAnimationFrame(() => document.querySelectorAll('.sticky-text').forEach(fitNote));
}

// 메모지 글 고치기 → 바로 저장 (다 지우고 나가면 그 질문은 삭제)
function editNote(textarea) {
  const m = memos.find((x) => x.id === textarea.dataset.noteId);
  if (!m) return;
  m.text = textarea.value;
  save(KEYS.memos, memos);
  fitNote(textarea);
}

function finishNote(textarea) {
  const m = memos.find((x) => x.id === textarea.dataset.noteId);
  if (!m) return;
  m.text = textarea.value.trim();
  if (m.text) {
    save(KEYS.memos, memos);   // 다시 그리지 않음 (바로 동그라미를 눌러도 잘 눌리게)
  } else {
    deleteMemo(m.id);
    renderPinned();
  }
  renderVault();
}

// 시작 전 화면의 '📌 공부 질문' 창
function openQuestions() {
  renderPinned();
  $('qModal').hidden = false;
  document.body.classList.add('no-scroll');
  $('qInput').focus();
}

function closeQuestions() {
  if ($('qModal').hidden) return;
  $('qModal').hidden = true;
  document.body.classList.remove('no-scroll');
}

// 메모 한 개 (withDelete: 보관함 창에서만 삭제 · 카테고리 바꾸기 버튼 표시)
function memoItem(m, { withDelete = false } = {}) {
  const li = el('li', 'memo-item');
  const meta = el('div', 'memo-meta');
  const d = new Date(m.createdAt);
  const when = fmtTime(m.createdAt);
  if (withDelete) {
    // 오른쪽 창에서는 카테고리 칩을 누르면 다른 카테고리로 바꿀 수 있음
    const chip = el('button', 'chip chip-btn', m.category);
    chip.type = 'button';
    chip.dataset.cycle = m.id;
    chip.title = '눌러서 카테고리 바꾸기';
    meta.append(chip, el('span', 'memo-time', when));
  } else {
    meta.append(el('span', 'chip', m.category), el('span', 'memo-time', when));
  }
  if (m.done) {
    li.classList.add('done');
    if (withDelete) {
      // 오른쪽 창에서 '해결함'을 다시 누르면 공부 질문 목록에 다시 띄움
      const tag = el('button', 'chip chip-btn done-tag', '해결함 ↺');
      tag.type = 'button';
      tag.dataset.undone = m.id;
      tag.title = '다시 띄우기';
      meta.append(tag);
    } else {
      meta.append(el('span', 'chip done-tag', '해결함'));
    }
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
//    공부 중(active)에는 사이드바 메뉴가 잠겨서 열 수 없음 (공부 질문만 메모 칸 아래에 보임)
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
    box.append(el('p', 'empty', '보관된 생각이 없어요.'));
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

// ④ 공부 기록 — 자세한 기록은 사이드바의 '공부 기록함' 창에서
function renderRecords() {
  if (openedDrawer === 'historyDrawer') renderHistory();
}

// 사이드바: 접기 / 펴기 + 오늘 한 공부 목록 (누르면 이어서 공부, 연필 = 이름 바꾸기)
function renderSidebar() {
  document.body.classList.toggle('side-closed', sideClosed);

  const today = dateKey(new Date());
  const todays = records
    .filter((r) => r.date === today)
    .sort((a, b) => b.endedAt - a.endedAt);

  const ul = $('todayList');
  ul.replaceChildren();
  if (todays.length === 0) ul.append(el('li', 'today-empty', '아직 없어요'));
  todays.forEach((r) => {
    const li = el('li', 'today-item');
    li.dataset.recordId = r.id;
    li.tabIndex = 0;
    li.title = '이어서 공부하기';
    const edit = el('button', 'today-edit', '✎');
    edit.type = 'button';
    edit.dataset.editId = r.id;
    edit.title = '이름 바꾸기';
    edit.setAttribute('aria-label', `${r.goal} 이름 바꾸기`);
    li.append(el('span', 'record-goal', r.goal || '목표 없음'), el('span', 'today-time', fmtHM(r.studyMs)), edit);
    ul.append(li);
  });
}

function setSidebar(closed) {
  sideClosed = closed;
  if (window.innerWidth > 760) save(KEYS.sidebar, closed); // 휴대폰에서 연 건 기억하지 않음
  renderSidebar();
}

// 휴대폰에서는 사이드바 메뉴를 누르면 사이드바를 닫음 (화면을 가리지 않게)
function closeSidebarOnMobile() {
  if (window.innerWidth <= 760) setSidebar(true);
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
  actions.append(edit);

  li.append(info, actions);
  return li;
}

// 기록의 공부 목표 고치기 — '수정'을 누르면 그 자리에 입력칸이 생김
// Enter 또는 다른 곳 클릭 = 저장, Esc = 취소
function startEditGoal(btn) {
  const li = btn.closest('.record-item, .today-item');
  const r = records.find((x) => x.id === btn.dataset.editId);
  if (!li || !r || li.querySelector('.record-goal-input')) return;

  const input = el('input', 'record-goal-input');
  input.type = 'text';
  input.maxLength = 40;
  input.placeholder = '공부 이름';
  input.value = r.goal;
  li.querySelector('.record-goal').replaceWith(input);
  if (btn.classList.contains('record-edit')) btn.textContent = '저장';
  input.focus();
  input.select();

  let finished = false;
  const finish = (keep) => {
    if (finished) return;
    finished = true;
    if (keep) {
      r.goal = input.value.trim() || r.goal;   // 비우면 원래 이름 그대로
      save(KEYS.records, records);
      mergeTodayRecords(); // 이름을 바꿔서 오늘 다른 기록과 같아지면 합침
    }
    renderRecords();
    renderSidebar();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.stopPropagation(); finish(false); } // Esc가 옆 창까지 닫지 않게
  });
  input.addEventListener('blur', () => finish(true));
}

// 주간 그래프 막대 위에 쓰는 짧은 시간 (예: 2:30)
function fmtShort(ms) {
  return fmtHM(ms);
}

// 그 주의 월요일 0시
function weekStart(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // 일요일(0)은 6일 전 월요일로
  return x;
}

// ④ 공부 기록함 — 주간(요일별 막대 7개) / 월간(일별 막대)
function renderHistory() {
  const sums = sumByDate();
  const now = new Date();
  const isWeek = historyView === 'week';
  const bars = [];                               // { key, label, title, ms, isNow }

  if (isWeek) {
    const start = weekStart(historyCursor);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    $('periodLabel').textContent = `${start.getMonth() + 1}/${start.getDate()} ~ ${end.getMonth() + 1}/${end.getDate()}`;
    ['월', '화', '수', '목', '금', '토', '일'].forEach((dayName, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = dateKey(d);
      bars.push({ key, label: dayName, title: `${d.getMonth() + 1}월 ${d.getDate()}일`, ms: sums[key] || 0, isNow: key === dateKey(now) });
    });
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
        isNow: key === dateKey(now),
      });
    }
  }

  // 요약: 총 시간 / 공부한 날 수 / 공부한 날 기준 하루 평균
  const keys = new Set(bars.map((b) => b.key));
  const total = bars.reduce((n, b) => n + b.ms, 0);
  const days = bars.filter((b) => b.ms > 0).length;
  $('statTotal').textContent = fmtDuration(total);
  $('statDays').textContent = `${days}일`;
  $('statAvg').textContent = days ? fmtDuration(total / days) : '-';
  $('historyEmpty').hidden = total > 0;

  // 이번 주(이번 달)보다 미래로는 못 넘어가게
  $('nextPeriod').disabled = keys.has(dateKey(now));

  document.querySelectorAll('.hist-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === historyView);
  });

  // 막대그래프
  const max = Math.max(1, ...bars.map((b) => b.ms));
  const chart = $('historyChart');
  chart.dataset.view = historyView;
  chart.replaceChildren();
  bars.forEach((b) => {
    const col = el('div', 'bar-col');
    if (b.isNow) col.classList.add('today');
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

  // 그 기간의 기록 목록 (최근 것부터, '수정'으로 이름 고치기)
  $('historyListTitle').textContent = isWeek ? '이 주의 기록' : '이 달의 기록';
  const list = $('historyList');
  list.replaceChildren();
  const periodRecords = records
    .filter((r) => keys.has(r.date))
    .sort((a, b) => b.endedAt - a.endedAt);
  if (periodRecords.length === 0) list.append(el('li', 'empty', '기록이 없어요'));
  periodRecords.forEach((r) => list.append(recordItem(r, { withDate: true })));
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
  historyCursor = new Date(); // 열 때마다 이번 주 / 이번 달부터
  renderHistory();
  openDrawer('historyDrawer', $('openHistory'));
}

// 오른쪽 창: 생각 보관함 전체 보기
// afterStudy: 공부를 마치고 자동으로 열린 경우 → 맨 위에 이번 공부 요약을 보여 줌
function openVault() {
  if (timer.active) return; // 공부 중에는 잠김
  renderVault();
  openDrawer('vaultDrawer', $('openVault'));
}

// step: -1 = 이전, +1 = 다음
function moveHistory(step) {
  const y = historyCursor.getFullYear();
  const mo = historyCursor.getMonth();
  if (historyView === 'week') {
    historyCursor = new Date(y, mo, historyCursor.getDate() + step * 7); // 일주일씩
  } else {
    historyCursor = new Date(y, mo + step, 1);   // 12월 + 1 → 다음 해 1월로 자동 계산됨
  }
  renderHistory();
}

// 집중 · 휴식 시간 선택 버튼 그리기 (휴식은 집중 시간을 골랐을 때만 보임)
function renderPomoSettings() {
  const makeChips = (boxId, list, current, kind) => {
    const box = $(boxId);
    box.replaceChildren();
    list.forEach((min) => {
      const btn = el('button', 'time-chip', min === 0 ? '제한 없음' : `${min}분`);
      btn.type = 'button';
      btn.dataset[kind] = min;
      btn.classList.toggle('active', min === current);
      btn.setAttribute('aria-pressed', min === current);
      box.append(btn);
    });
  };
  makeChips('focusChoices', FOCUS_CHOICES, pomoSetting.focus, 'focus');
  makeChips('breakChoices', BREAK_CHOICES, pomoSetting.break, 'break');
  $('breakRow').hidden = pomoSetting.focus === 0;
}

// 시간 선택 저장 (공부 중이 아닐 때만)
function setPomoSetting(phase, minutes) {
  if (timer.active) return;
  pomoSetting[phase] = minutes;
  save(KEYS.pomodoro, pomoSetting);
  timer.mode = modeFromSetting();
  timer.phase = 'focus';
  saveTimer();
  renderPomoSettings();
  renderTimer();
}

function renderAll() {
  renderSidebar();
  renderFilter();
  renderAutoHint();
  renderPinned();
  renderPomoSettings();
  renderTimer();
  renderVault();
  renderRecords();
}

/* ---------- 7-2. 화면 색상 ----------
   대표색 3가지 중 하나를 고르면, 배경 · 타이머 칸 색은 그 색을 연하게 해서 자동으로 맞춤
   style.css의 :root에 있는 색 변수(--bg, --primary 등)를 자바스크립트로 바꿔서 화면 전체 색을 바꿈 */

// 글자 · 카드 · 선 색 (테마와 상관없이 같음)
const BASE_COLORS = {
  card: '#FFFFFF', text: '#3A3A3A', muted: '#8A877D', line: '#EEEAE2',
  field: '#FCFAF7', border: '#E4E0D8', 'danger-bg': '#EBD9D3', 'danger-text': '#8A4B3E',
};

// 대표색 3가지 — 기본 베이지는 원래 쓰던 색을 그대로 씀
const THEMES = [
  { id: 'beige', name: '베이지', primary: '#8C8B79', bg: '#F5EEE8', cream: '#F5EDDA', sage: '#CFD1C7' },
  { id: 'sky',   name: '하늘',   primary: '#5D7FA3' },
  { id: 'peach', name: '복숭아', primary: '#BF7A62' },
];

let theme = load(KEYS.theme, { id: 'beige' }); // { id: 'sky' } 또는 직접 고른 색 { id: 'custom', primary: '#4a90e2' }
const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v || '');
if (!(theme.id === 'custom' && isHex(theme.primary)) && !THEMES.some((t) => t.id === theme.id)) {
  theme = { id: 'beige' }; // 예전에 고른 색이 목록에 없으면 기본색
}

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
  const t = theme.id === 'custom'
    ? { primary: theme.primary }                              // 직접 고른 색
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

// 사이드바 아래 대표색 동그라미 3개 + 무지개 동그라미(직접 고르기)
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

  // 무지개 동그라미: 직접 고른 색을 쓰는 중이면 그 색으로 보여 줌
  const custom = theme.id === 'custom';
  $('customColorBtn').classList.toggle('active', custom);
  $('customDot').classList.toggle('rainbow', !custom);
  $('customDot').style.background = custom ? theme.primary : '';
  if (document.activeElement !== $('colorMain')) $('colorMain').value = themeColors().primary.toLowerCase();
}


/* ---------- 8. 이벤트 연결 & 시작 ---------- */

// 타이머 버튼
$('startBtn').addEventListener('click', startTimer);
$('stopBtn').addEventListener('click', stopTimer);

// 집중 · 휴식 시간 선택
$('focusChoices').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-focus]');
  if (btn) setPomoSetting('focus', Number(btn.dataset.focus));
});
$('breakChoices').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-break]');
  if (btn) setPomoSetting('break', Number(btn.dataset.break));
});

// 메모 저장
$('memoForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('memoInput').value.trim();
  if (!text) return;

  // '📌 공부 질문' 버튼이 눌려 있으면 공부 질문으로, 아니면 자동 분류
  const category = studyQMode ? STUDY_Q : classifyMemo(text);
  addMemo(text, category);
  $('memoInput').value = '';
  studyQMode = false;   // 한 번 저장하면 다시 자동 분류로

  let msg;
  if (category === STUDY_Q) msg = `📌 ${STUDY_Q}에 저장`;
  else msg = `'${category}'에 보관`;
  showToast('memoToast', msg);

  renderAutoHint();
  renderPinned();
  renderVault();
  $('memoInput').focus();
});

// '📌 공부 질문' 버튼: 누르면 켜지고, 다시 누르면 꺼짐
$('studyQBtn').addEventListener('click', () => {
  studyQMode = !studyQMode;
  renderAutoHint();
  $('memoInput').focus();
});

// 입력하는 동안 자동 분류 결과 미리 보기
$('memoInput').addEventListener('input', renderAutoHint);

// 📌 공부 질문 메모지: 고치기 / 해결 → 지우기 (공부 중 메모지 / 시작 전 창 둘 다)
['pinnedList', 'qList'].forEach((id) => {
  $(id).addEventListener('input', (e) => {
    if (e.target.dataset.noteId) editNote(e.target);
  });
  $(id).addEventListener('focusout', (e) => {
    if (e.target.dataset.noteId) finishNote(e.target);
  });
  $(id).addEventListener('keydown', (e) => {
    // Enter = 다 고침 (Shift+Enter = 줄바꿈)
    if (e.target.dataset.noteId && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      e.target.blur();
    }
  });
  $(id).addEventListener('click', (e) => {
    const doneId = e.target.dataset.done;
    if (!doneId) return;
    deleteMemo(doneId);      // 해결한 질문은 보관함에서도 바로 지움
    renderPinned();
    renderVault();
  });
});

// 시작 전 '📌 공부 질문' 창: 열기 / 닫기 / 질문 추가
$('openQuestions').addEventListener('click', openQuestions);
$('qClose').addEventListener('click', closeQuestions);
$('qModal').addEventListener('click', (e) => { if (e.target === $('qModal')) closeQuestions(); });
$('qForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('qInput').value.trim();
  if (!text) return;
  addMemo(text, STUDY_Q);
  $('qInput').value = '';
  renderPinned();
  renderVault();
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

$('vaultList').addEventListener('click', (e) => {
  const undoneId = e.target.dataset.undone;
  if (undoneId) {
    toggleDone(undoneId);
    renderPinned();
    renderVault();
    return;
  }
  const cycleId = e.target.dataset.cycle;
  if (cycleId) {
    cycleCategory(cycleId);
    renderPinned();
    renderVault();
    return;
  }
  const id = e.target.dataset.id;
  if (!id) return;
  if (!confirm('이 생각을 삭제할까요? (처리 완료)')) return;
  deleteMemo(id);
  renderPinned();
  renderVault();
});

// 옆 창 열기 / 닫기 — × 버튼, 바깥 어두운 곳 클릭, Esc 키로 닫힘
$('openHistory').addEventListener('click', () => { closeSidebarOnMobile(); openHistory(); });
$('openVault').addEventListener('click', () => { closeSidebarOnMobile(); openVault(); });
$('closeHistory').addEventListener('click', () => closeDrawer());
$('closeVault').addEventListener('click', () => closeDrawer());
$('drawerBackdrop').addEventListener('click', () => closeDrawer());
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  closeReview();
  closeQuestions();
  closeDrawer();
});

// 공부를 마친 뒤 창: '확인 완료' → 원래 화면으로
$('reviewDone').addEventListener('click', closeReview);

// 공부를 마친 뒤 창: 카테고리 바꾸기 / 삭제
// 삭제는 실수로 지우지 않게 두 번 눌러야 함 (첫 번째: '한 번 더 누르면 삭제')
$('reviewList').addEventListener('click', (e) => {
  const t = e.target;
  if (t.dataset.cycle) {
    cycleCategory(t.dataset.cycle);
  } else if (t.dataset.undone) {
    toggleDone(t.dataset.undone);
  } else if (t.dataset.id) {
    if (!t.classList.contains('confirm')) {
      t.classList.add('confirm');
      t.textContent = '한 번 더 누르면 삭제';
      return;
    }
    deleteMemo(t.dataset.id);
  } else {
    return;
  }
  renderReviewList();
  renderPinned();
  renderVault();
});

// 공부 기록함 창: '수정' → 목표 고치기
$('historyList').addEventListener('click', (e) => {
  const edit = e.target.closest('[data-edit-id]');
  if (edit) startEditGoal(edit);
});

// 사이드바 오늘 목록: 누르면 이어서 공부 / 연필 = 이름 바꾸기
$('todayList').addEventListener('click', (e) => {
  const edit = e.target.closest('[data-edit-id]');
  if (edit) {
    startEditGoal(edit);
    return;
  }
  if (e.target.closest('input')) return;          // 이름 바꾸는 중
  const item = e.target.closest('[data-record-id]');
  if (item) {
    closeSidebarOnMobile();
    resumeRecord(item.dataset.recordId);
  }
});
$('todayList').addEventListener('keydown', (e) => {
  const item = e.target.closest('.today-item');
  if (e.key === 'Enter' && e.target === item) resumeRecord(item.dataset.recordId);
});

// 휴대폰: 사이드바 바깥을 누르면 사이드바 닫기
document.addEventListener('click', (e) => {
  if (window.innerWidth > 760 || sideClosed) return;
  if (e.target.closest('#sidebar, #sideOpen')) return;
  setSidebar(true);
});

// 사이드바 접기 / 펴기, 새 공부
$('sideClose').addEventListener('click', () => setSidebar(true));
$('sideOpen').addEventListener('click', () => setSidebar(false));
$('newStudy').addEventListener('click', () => {
  closeDrawer(false);
  closeSidebarOnMobile();
  $('goalInput').value = '';
  $('goalInput').focus();
});

// 공부 기록 창: 이전 / 다음 기간, 주간 / 월간 전환
$('prevPeriod').addEventListener('click', () => moveHistory(-1));
$('nextPeriod').addEventListener('click', () => moveHistory(1));
document.querySelectorAll('.hist-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    historyView = tab.dataset.view;
    historyCursor = new Date();   // 바꾸면 이번 주 / 이번 달부터
    renderHistory();
  });
});

// SNS용 이미지: 저장 / 공유
$('shareSave').addEventListener('click', saveShareImage);
$('shareSend').addEventListener('click', sendShareImage);
$('shareSend').hidden = !canShareImage();

// 화면 색상: 사이드바 아래 동그라미
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

   TODO 사용 후기 반영 — 불편한 점 수정
   (후보) 뽀모도로 전환 알림 소리, 메모 수정 기능, 자동 분류 단어 목록 늘리기
*/

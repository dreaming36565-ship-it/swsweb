// ★ 서버 전용. 클라이언트 컴포넌트에서 import 금지.
// Node 24 내장 node:sqlite 사용 — 네이티브 빌드 의존성이 없다.
//
// 스키마 버전(PRAGMA user_version)으로 마이그레이션한다.
// - 새 DB: SCHEMA 를 만들고 데모 데이터를 넣은 뒤 최신 버전으로 표시한다.
// - 기존 DB: SCHEMA(IF NOT EXISTS)로 새 테이블을 만들고, MIGRATIONS 중 아직 안 한 것만 차례로 실행한다.
// 스키마를 바꿀 때는 SCHEMA 를 고치고, 기존 DB용 단계를 MIGRATIONS 끝에 하나 더 붙인다. (데이터를 지우지 않는다)

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { seedDemo, importLocalRecords, rebuildSrSeats, upgradeHomeworkSlots, applyQ4Changes } from "./seed";

// 배포 서버(Railway)는 볼륨(서버를 다시 올려도 지워지지 않는 저장 공간)에 저장한다.
// 볼륨을 붙이면 Railway 가 RAILWAY_VOLUME_MOUNT_PATH 를 알려준다. 따로 정하려면 ACADEMY_DATA_DIR.
export const DATA_DIR = process.env.ACADEMY_DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(process.cwd(), "data");
/** 배포 서버인데 볼륨이 없으면 서버를 다시 올릴 때마다 자료가 지워진다 — 설정 화면에 경고 */
export const volumeMissing = process.env.NODE_ENV === "production" && !process.env.ACADEMY_DATA_DIR && !process.env.RAILWAY_VOLUME_MOUNT_PATH && !!process.env.RAILWAY_ENVIRONMENT;
const DB_PATH = path.join(DATA_DIR, "academy.db");

const SCHEMA = `
-- roles: 권한 목록 "ADMIN,TEACHER" (한 사람이 여러 권한을 가질 수 있다). role 은 대표 권한(첫 번째).
-- must_change_pw: 처음 비밀번호(1234)로 로그인하면 새 비밀번호를 정하게 한다.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  login_id TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  roles TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  must_change_pw INTEGER NOT NULL DEFAULT 0,
  -- 근무: FULL 정직원 / PART 알바. 알바는 work_days("1,3,5") 요일의 시간표 · SR만 본다
  employment TEXT NOT NULL DEFAULT 'FULL',
  work_days TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  order_no INTEGER NOT NULL,
  is_sr INTEGER NOT NULL DEFAULT 0,
  capacity INTEGER
);

-- level: 직접 입력한 학년일 때 학교급(초등·중등·고등) — SR 자리 규칙(고등↔초등 멀리)에 쓴다
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  department TEXT NOT NULL,
  teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
  grade TEXT,
  textbook TEXT,
  level TEXT,
  -- 🔗 합반: 같은 교실 · 같은 선생님과 같이 수업하는 반 (시작·끝 시간은 다를 수 있다). 양쪽에 서로 적는다
  hapban_with INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  -- 운영 시간표: 반레벨 변경(반이름 보라) · 교체 표시 직접 입력(NULL = 지난 분기 저장본과 자동 비교, N = 없음, T/H/B)
  level_changed INTEGER NOT NULL DEFAULT 0,
  change_kind TEXT,
  change_note TEXT
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  department TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

-- 학생 ↔ 반 (다대다). 한 학생이 정규반 + 개별반을 함께 다닌다.
CREATE TABLE IF NOT EXISTS student_classes (
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  PRIMARY KEY (student_id, class_id)
);

-- 한 줄 = 한 반의 한 요일. 수업 칸(start~end, room, teacher, label) + SR 칸(alpha_*).
-- 수업 없이 SR만 쓰는 반(누적오답·숙제반)은 수업 시간 = SR 시간, 강의실 = SR룸.
CREATE TABLE IF NOT EXISTS timetable_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_of_week INTEGER NOT NULL,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'REGULAR',
  label TEXT,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  alpha_start_min INTEGER,
  alpha_end_min INTEGER,
  room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
  alpha_room_id INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
  teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);

-- 교재 책장 = 과정(학교급 + 학년-학기) + 교재 이름. 예) 초등 5-1 심화
CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL,
  grade TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 수업 칸의 사용교재
CREATE TABLE IF NOT EXISTS session_books (
  session_id INTEGER NOT NULL REFERENCES timetable_sessions(id) ON DELETE CASCADE,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, book_id)
);

-- ⇄ 알파·수업 순서 바꾸기 중 "그날 하루만" — 그 날짜에만 수업 시간과 알파 시간을 맞바꾼다
CREATE TABLE IF NOT EXISTS session_swaps (
  session_id INTEGER NOT NULL REFERENCES timetable_sessions(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  PRIMARY KEY (session_id, date)
);

-- 교실별 경고(2개반 배정 · 인원초과) 확인 완료 — key = 요일|강의실|시작|반이름 (다음 주에도 유지)
CREATE TABLE IF NOT EXISTS room_alert_ok (
  key TEXT PRIMARY KEY,
  by_user INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

-- 교실배정 · 사용 표시 — 특정 날짜 하루만. 지난 날짜는 화면에 나오지 않는다.
CREATE TABLE IF NOT EXISTS room_bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  name TEXT NOT NULL,
  headcount INTEGER,
  teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- SR 주간 자리 — 학생은 그 반이 SR을 쓰는 모든 요일·시간에 같은 자리. manual = 사람이 옮긴 자리
CREATE TABLE IF NOT EXISTS sr_seats (
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  seat TEXT NOT NULL,
  manual INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (class_id, student_id)
);

-- 그날만 바뀐 자리 (선생님 「오늘만」 자리 요청 승인)
CREATE TABLE IF NOT EXISTS sr_seat_today (
  date TEXT NOT NULL,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  seat TEXT NOT NULL,
  PRIMARY KEY (date, class_id, student_id)
);

-- 임시 자리 — 보강 · 자습 · TEST · 신규TEST (그날 하루만)
CREATE TABLE IF NOT EXISTS sr_adhoc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  seat TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

-- 🏠 하원 (누적오답) — 그 시각부터 오늘 그 자리는 빈자리
CREATE TABLE IF NOT EXISTS sr_leave (
  date TEXT NOT NULL,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  at_min INTEGER NOT NULL,
  PRIMARY KEY (date, class_id, student_id)
);

-- 📄 미션지 — state: REQUESTED(선생님께 요청) / DONE(받음). done_by_kind: DESK(데스크가 받음) / TEACHER(선생님 전달완료)
CREATE TABLE IF NOT EXISTS sr_missions (
  date TEXT NOT NULL,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  requested_at INTEGER,
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  done_by_kind TEXT,
  done_at INTEGER,
  done_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (date, class_id)
);

-- 🙋 자리 요청 — scope: TODAY(오늘만) / ALWAYS(계속), state: WAIT / OK / NO
CREATE TABLE IF NOT EXISTS sr_seat_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  from_seat TEXT,
  to_seat TEXT NOT NULL,
  scope TEXT NOT NULL,
  reason TEXT,
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  at_min INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'WAIT',
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at TEXT
);

-- 📝 자리 변경 기록
CREATE TABLE IF NOT EXISTS sr_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  at_min INTEGER NOT NULL,
  text TEXT NOT NULL
);

-- 출결 1건 = 수업 1개의 그 날짜 출결.
-- checker: 1차 출석체크를 누가 하는가 (알파가 먼저 시작하면 DESK, 수업이 먼저면 TEACHER)
-- trigger_min: 출결이 시작되는 시각(수업·알파 중 이른 쪽). 같은 시각의 반들은 팝업 하나로 묶인다.
-- stage: CHECK(1차 출석체크) → CALL(데스크 출결전화) → DONE
CREATE TABLE IF NOT EXISTS attendance_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES timetable_sessions(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  checker TEXT NOT NULL,
  trigger_min INTEGER NOT NULL,
  stage TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(session_id, date)
);

-- status: UNCHECKED(아직 모름) / PRESENT / LATE / ABSENT / NO_CONTACT(학생·학부모 부재중, 카톡 남김)
-- 전화 기록: *_call 은 'OK'(통화됨) | 'MISS'(부재중), *_at 은 누른 시각(분)
-- eta_unknown: 지각인데 학부모도 도착시간을 모름 / absent_from: 결석으로 변경하기 전 상태(되돌리기용)
-- absent_cat: 결석 사유 빠른 선택으로 고른 구분 OK(인정) / PERSONAL(개인사유) — 없으면 판정 필요
CREATE TABLE IF NOT EXISTS attendance_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES attendance_events(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'UNCHECKED',
  pre_notified INTEGER NOT NULL DEFAULT 0,
  absent_reason TEXT,
  absent_cat TEXT,
  late_reason TEXT,
  eta_min INTEGER,
  eta_unknown INTEGER NOT NULL DEFAULT 0,
  absent_from TEXT,
  student_call TEXT,
  student_call_at INTEGER,
  parent_call TEXT,
  parent_call_at INTEGER,
  kakao_at INTEGER,
  call_result TEXT,
  arrived_at INTEGER,
  late_arrival INTEGER NOT NULL DEFAULT 0,
  UNIQUE(event_id, student_id)
);

-- 결석 1건 (보강 관리) — 출결에서 저절로 생기고, 미리 등록하거나 시트에서 옮겨 올 수도 있다.
-- 출결 기록이 지워져도 남도록 반 이름·담당을 함께 적어 둔다.
-- cat: OK(인정) / PERSONAL(개인사유) / NULL(판정 필요), notice: PRE(미리) / SAME_DAY(당일) / NONE(무연락)
CREATE TABLE IF NOT EXISTS absences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
  student_name TEXT NOT NULL,
  class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  class_name TEXT NOT NULL,
  teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  teacher_name TEXT,
  department TEXT NOT NULL DEFAULT 'ELEM',
  date TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  cat TEXT,
  notice TEXT,
  paid INTEGER NOT NULL DEFAULT 0,
  more INTEGER NOT NULL DEFAULT 0,
  dream INTEGER NOT NULL DEFAULT 0,
  memo TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  record_id INTEGER REFERENCES attendance_records(id) ON DELETE SET NULL,
  carry_req_reason TEXT,
  carry_req_by TEXT,
  carry_req_at TEXT,
  carried_reason TEXT,
  carried_by TEXT,
  carried_approved_by TEXT,
  carried_at TEXT,
  rejected_by TEXT,
  rejected_note TEXT,
  created_at TEXT NOT NULL
);

-- 보강 회차 — type: MAKEUP(보강) / TASK(과제로 대체), state: PLANNED / DONE / MISSED(보강 결석)
CREATE TABLE IF NOT EXISTS absence_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  absence_id INTEGER NOT NULL REFERENCES absences(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  date TEXT,
  start_min INTEGER,
  state TEXT NOT NULL DEFAULT 'PLANNED',
  created_at TEXT NOT NULL
);

-- 결석 1건의 변경 기록
CREATE TABLE IF NOT EXISTS absence_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  absence_id INTEGER NOT NULL REFERENCES absences(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 숙제검사 — mark: 숙제미흡 / 준비물 미지참 / 숙제+준비물 미흡 / 숙제불량 / 결석. 빈칸 = 숙제 완료
CREATE TABLE IF NOT EXISTS hw_marks (
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  mark TEXT NOT NULL,
  PRIMARY KEY (student_id, date)
);

-- 📷 사진 인증 확인 — state: OK(인증됨) / MISS(미인증)
CREATE TABLE IF NOT EXISTS hw_cert (
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  state TEXT NOT NULL,
  PRIMARY KEY (student_id, date)
);

-- 강제 숙제반 요일별 방법 — how: ATTEND(🏫 숙제반 참석, slot_class_id) / CERT(📷 사진 인증)
CREATE TABLE IF NOT EXISTS hw_plan (
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  day INTEGER NOT NULL,
  how TEXT NOT NULL,
  slot_class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
  PRIMARY KEY (student_id, day)
);

-- 강제 숙제반 칸을 직접 바꿨을 때 (없으면 저절로 정해진 칸)
CREATE TABLE IF NOT EXISTS hw_forced_slot (
  student_id INTEGER PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  slot_class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE
);

-- 🙋 신청 숙제반 — 한 달 단위 (month = YYYY-MM), 요일마다 1부 · 2부 중 하나 (day = 요일)
CREATE TABLE IF NOT EXISTS hw_apply (
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  slot_class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  day INTEGER NOT NULL,
  PRIMARY KEY (student_id, slot_class_id, month, day)
);

-- ⏰ 지각 3회 → 숙제반 1회 — lates: 지각한 날짜들(쉼표), date·slot: 다녀올 날과 숙제반 칸
CREATE TABLE IF NOT EXISTS hw_late (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  lates TEXT NOT NULL,
  date TEXT,
  slot_class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- 강제 숙제반 자동 등록 알림을 확인했음 (학생 · 시작 날짜)
CREATE TABLE IF NOT EXISTS hw_seen (
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  start TEXT NOT NULL,
  PRIMARY KEY (student_id, start)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assignee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  due_date TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT 'ALL',
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_day ON timetable_sessions(day_of_week);
CREATE INDEX IF NOT EXISTS idx_student_classes_class ON student_classes(class_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON room_bookings(date);
CREATE INDEX IF NOT EXISTS idx_adhoc_date ON sr_adhoc(date);
CREATE INDEX IF NOT EXISTS idx_absences_date ON absences(date);
CREATE INDEX IF NOT EXISTS idx_absences_student ON absences(student_id);
CREATE INDEX IF NOT EXISTS idx_rounds_absence ON absence_rounds(absence_id);
CREATE INDEX IF NOT EXISTS idx_rounds_date ON absence_rounds(date);
`;

/** 기존 테이블에 칸이 없으면 더한다 (마이그레이션용) */
function ensureColumn(db: DatabaseSync, table: string, column: string, def: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
}

/**
 * 기존 DB를 한 단계씩 올린다. 순서를 바꾸거나 지우지 말 것 — 끝에 새 단계만 붙인다.
 * 1: 권한 여러 개 · 시간표 업그레이드 · SR 주간 자리 · 결석보강 · 숙제 (2026-09-29)
 */
const MIGRATIONS: ((db: DatabaseSync) => void)[] = [
  (db) => {
    ensureColumn(db, "users", "roles", "TEXT NOT NULL DEFAULT ''");
    ensureColumn(db, "users", "must_change_pw", "INTEGER NOT NULL DEFAULT 0");
    ensureColumn(db, "rooms", "capacity", "INTEGER");
    ensureColumn(db, "classes", "level", "TEXT");
    ensureColumn(db, "timetable_sessions", "label", "TEXT");
    ensureColumn(db, "attendance_records", "absent_cat", "TEXT");
    db.exec("UPDATE users SET roles = role WHERE roles = ''");
    // 담당 반이 있는 관리자는 선생님 권한도 함께
    db.exec(`UPDATE users SET roles = 'ADMIN,TEACHER'
              WHERE roles = 'ADMIN' AND EXISTS (SELECT 1 FROM classes c WHERE c.teacher_id = users.id)`);
    db.exec(`UPDATE timetable_sessions SET label = CASE type WHEN 'INDIVIDUAL' THEN '개별' ELSE '수업' END
              WHERE label IS NULL`);
    db.exec("DROP TABLE IF EXISTS sr_assignments");
    db.exec("DROP TABLE IF EXISTS makeups");
    // 지금까지의 결석을 보강 관리로 옮긴다
    db.exec(`INSERT INTO absences (student_id, student_name, class_id, class_name, teacher_id, teacher_name, department,
                                   date, reason, notice, source, record_id, created_at)
             SELECT r.student_id, st.name, c.id, c.name, s.teacher_id, u.name, c.department, e.date,
                    COALESCE(r.absent_reason, ''), CASE WHEN r.absent_from IS NOT NULL THEN 'NONE' ELSE 'SAME_DAY' END,
                    '출결에서 자동 기록', r.id, datetime('now')
               FROM attendance_records r
               JOIN attendance_events e ON e.id = r.event_id
               JOIN timetable_sessions s ON s.id = e.session_id
               JOIN classes c ON c.id = s.class_id
               JOIN students st ON st.id = r.student_id
               LEFT JOIN users u ON u.id = s.teacher_id
              WHERE r.status = 'ABSENT'`);
    importLocalRecords(db);
    rebuildSrSeats(db);
  },
  // 2: 개별반 칸 이름 「개별」 → 「수업」 (2026-09-29)
  (db) => {
    db.exec("UPDATE timetable_sessions SET label = '수업' WHERE type = 'INDIVIDUAL' AND label = '개별'");
  },
  // 3: 🔗 합반 (2026-09-30)
  (db) => {
    ensureColumn(db, "classes", "hapban_with", "INTEGER REFERENCES classes(id) ON DELETE SET NULL");
  },
  // 4: 숙제반 = 월~목 1부(초등숙제반 시간) · 2부(중등숙제반 시간), 신청은 요일 단위 (2026-09-30)
  (db) => {
    upgradeHomeworkSlots(db);
  },
  // 5: 운영 시간표 — 알바 근무 요일 · 반레벨 변경 · 교체 표시 + 실제 직원(데스크 이예진) · 강의실 최대 인원 (2026-09-30)
  (db) => {
    ensureColumn(db, "users", "employment", "TEXT NOT NULL DEFAULT 'FULL'");
    ensureColumn(db, "users", "work_days", "TEXT NOT NULL DEFAULT ''");
    ensureColumn(db, "classes", "level_changed", "INTEGER NOT NULL DEFAULT 0");
    ensureColumn(db, "classes", "change_kind", "TEXT");
    ensureColumn(db, "classes", "change_note", "TEXT");
    db.exec(`UPDATE users SET name = '이예진', login_id = '이예진'
              WHERE login_id = '이수민' AND NOT EXISTS (SELECT 1 FROM users WHERE name = '이예진')`);
    db.exec(`UPDATE rooms SET capacity = CASE WHEN is_sr = 1 THEN 24 WHEN name = '대강의실' THEN 18 ELSE 10 END
              WHERE capacity IS NULL`);
    applyQ4Changes(db);
  },
];

const g = globalThis as unknown as { __academyDb?: DatabaseSync; __academyDbReady?: Promise<void> };

function open(): DatabaseSync {
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA foreign_keys = ON");
  const fresh = (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'users'").get() as {
    n: number;
  }).n === 0;
  if (fresh) {
    // 중간에 실패하면 반쯤 채워진 DB가 남지 않게 한 번에
    db.exec("BEGIN");
    try {
      db.exec(SCHEMA);
      seedDemo(db);
      db.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return db;
  }
  // 새 칸이 필요한 인덱스가 있으므로 칸을 먼저 더하고 SCHEMA 를 실행한다
  let version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  db.exec(SCHEMA.replace(/CREATE INDEX[^;]+;/g, ""));
  while (version < MIGRATIONS.length) {
    db.exec("BEGIN");
    try {
      MIGRATIONS[version](db);
      version += 1;
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  db.exec(SCHEMA);
  const users = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  if (users.n === 0) seedDemo(db);
  return db;
}

/**
 * 🔑 비상 비밀번호 초기화 — 관리자 비밀번호를 잊었을 때.
 * Railway › Variables 에 ACADEMY_RESET_PASSWORD=안예슬 을 넣으면(저절로 다시 배포됨) 서버가 켜질 때 그 계정이
 * 1234(로그인하면 새 비밀번호를 정함)로 돌아간다. 로그인한 뒤 변수를 꼭 지울 것 (남겨 두면 켜질 때마다 초기화).
 */
function emergencyReset(db: DatabaseSync): void {
  const name = process.env.ACADEMY_RESET_PASSWORD?.trim();
  if (!name) return;
  const r = db.prepare("UPDATE users SET password = '1234', must_change_pw = 1, active = 1 WHERE name = ? OR login_id = ?").run(name, name);
  console.warn(`[비상 초기화] ${name} 비밀번호를 1234로 되돌렸어요 (${r.changes}명). 로그인한 뒤 ACADEMY_RESET_PASSWORD 변수를 지우세요.`);
}

export function getDb(): DatabaseSync {
  if (!g.__academyDb) {
    g.__academyDb = open();
    emergencyReset(g.__academyDb);
  }
  return g.__academyDb;
}

export const dbPath = DB_PATH;

/** 백업 올리기(복원) 전에 연결을 닫는다 — 다음 getDb() 가 새 파일을 열고 마이그레이션한다 */
export function closeDb(): void {
  g.__academyDb?.close();
  g.__academyDb = undefined;
}
export const dbExists = () => existsSync(DB_PATH);

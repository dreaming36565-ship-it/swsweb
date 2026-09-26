// 데모 데이터 시드 + 요일별 SR 재계산.
// 반·시간은 실제 학원의 2026 4분기 시간표를 옮긴 것이고,
// 학생은 전부 가짜 이름이다 (실제 학생 정보를 코드에 남기지 않는다).

import type { DatabaseSync } from "node:sqlite";
import { toMin } from "./time";
import { autoAssignSeats, type AlphaBlock } from "./sr";

/** 한 요일 묶음의 수업 시간. sr 이 있으면 그 시간에 SR룸을 쓴다. */
type Slot = { days: number[]; start: string; end: string; sr?: [string, string] };

type ClassDef = {
  name: string;
  dept: "ELEM" | "HIGH";
  teacher: string;
  room: string;
  grade: string;
  textbook: string;
  type: "REGULAR" | "INDIVIDUAL";
  slots: Slot[];
  /** 가짜 학생 수 (개별반은 정규반 학생을 나눠 넣으므로 0) */
  size: number;
};

const MW = [1, 3]; // 월수
const TT = [2, 4]; // 화목

/** 정규반 — 4분기(9~11월) 시간표 기준. 시간은 "강의실 수업" 과 "SR 이용" 을 나눠 적었다. */
const REGULAR: ClassDef[] = [
  // 월수 — 초등
  { name: "5A1", dept: "ELEM", teacher: "nayoung", room: "2강", grade: "초5", textbook: "6-1 심화", type: "REGULAR", size: 5,
    slots: [{ days: MW, start: "14:40", end: "16:20", sr: ["16:20", "17:10"] }] },
  { name: "5P1", dept: "ELEM", teacher: "yeseul", room: "1강", grade: "초5", textbook: "6-1 응용", type: "REGULAR", size: 3,
    slots: [{ days: MW, start: "14:40", end: "16:20", sr: ["16:20", "17:10"] }] },
  { name: "6S1", dept: "ELEM", teacher: "nayoung", room: "2강", grade: "초6", textbook: "2-1 데메테르", type: "REGULAR", size: 4,
    slots: [{ days: MW, start: "16:20", end: "18:00", sr: ["15:30", "16:20"] }] },
  { name: "초6피팅", dept: "ELEM", teacher: "yeseul", room: "1강", grade: "초6", textbook: "6학년 발전(대수)", type: "REGULAR", size: 4,
    slots: [{ days: MW, start: "16:20", end: "18:00", sr: ["15:30", "16:20"] }] },
  // 월수 — 중등
  { name: "7S1", dept: "ELEM", teacher: "yeseul", room: "1강", grade: "중1", textbook: "공수1 입", type: "REGULAR", size: 5,
    slots: [{ days: MW, start: "18:00", end: "19:40", sr: ["17:10", "18:00"] }] },
  { name: "7A1", dept: "ELEM", teacher: "nayoung", room: "2강", grade: "중1", textbook: "3-1 아폴론", type: "REGULAR", size: 6,
    slots: [{ days: MW, start: "18:00", end: "19:40", sr: ["17:10", "18:00"] }] },
  { name: "8A1", dept: "ELEM", teacher: "yeseul", room: "1강", grade: "중2", textbook: "공통수학2(입)", type: "REGULAR", size: 6,
    slots: [{ days: MW, start: "19:40", end: "21:30", sr: ["19:00", "19:40"] }] },
  { name: "중등피팅", dept: "ELEM", teacher: "nayoung", room: "2강", grade: "중1", textbook: "3-1 아폴론", type: "REGULAR", size: 3,
    slots: [{ days: MW, start: "19:40", end: "21:30", sr: ["19:00", "19:40"] }] },
  { name: "9S1", dept: "ELEM", teacher: "field", room: "4강", grade: "중3", textbook: "대수 마플", type: "REGULAR", size: 4,
    slots: [{ days: MW, start: "16:20", end: "18:00", sr: ["18:00", "18:50"] }] },
  { name: "9A1", dept: "ELEM", teacher: "field", room: "4강", grade: "중3", textbook: "대수 쎈", type: "REGULAR", size: 4,
    slots: [{ days: MW, start: "18:00", end: "19:40", sr: ["17:10", "18:00"] }] },
  // 화목 — 초등
  { name: "4A2", dept: "ELEM", teacher: "nayoung", room: "2강", grade: "초4", textbook: "5-2 실력", type: "REGULAR", size: 4,
    slots: [{ days: TT, start: "14:40", end: "16:20", sr: ["16:20", "17:10"] }] },
  { name: "초등피팅", dept: "ELEM", teacher: "yeseul", room: "1강", grade: "초4", textbook: "개별 진도", type: "REGULAR", size: 3,
    slots: [{ days: TT, start: "14:40", end: "16:20", sr: ["16:20", "17:10"] }] },
  { name: "6A2", dept: "ELEM", teacher: "yeseul", room: "1강", grade: "초6", textbook: "1-1 데메테르", type: "REGULAR", size: 6,
    slots: [{ days: TT, start: "16:20", end: "18:00", sr: ["15:30", "16:20"] }] },
  { name: "6P2", dept: "ELEM", teacher: "nayoung", room: "2강", grade: "초6", textbook: "1-1 아폴론(상)", type: "REGULAR", size: 5,
    slots: [{ days: TT, start: "16:20", end: "18:00", sr: ["15:30", "16:20"] }] },
  // 화목 — 중등
  { name: "7A2", dept: "ELEM", teacher: "yeseul", room: "1강", grade: "중1", textbook: "2-2 아폴론", type: "REGULAR", size: 5,
    slots: [{ days: TT, start: "18:00", end: "19:40", sr: ["17:10", "18:00"] }] },
  { name: "7P2", dept: "ELEM", teacher: "nayoung", room: "2강", grade: "중1", textbook: "1-2 데메테르", type: "REGULAR", size: 4,
    slots: [{ days: TT, start: "18:00", end: "19:40", sr: ["17:10", "18:00"] }] },
  { name: "9A2", dept: "ELEM", teacher: "field", room: "4강", grade: "중3", textbook: "공수2 쎈", type: "REGULAR", size: 3,
    slots: [{ days: TT, start: "18:00", end: "19:40", sr: ["17:10", "18:00"] }] },
  // 고등부 — 대강의실 수업 + SR 자습을 번갈아 쓴다
  { name: "H1S", dept: "HIGH", teacher: "field", room: "대강의실", grade: "고1", textbook: "고쟁이 3step", type: "REGULAR", size: 7,
    slots: [
      { days: [2], start: "20:10", end: "22:00", sr: ["18:00", "19:50"] },
      { days: [5], start: "18:00", end: "19:50", sr: ["20:10", "22:00"] },
    ] },
  { name: "H3", dept: "HIGH", teacher: "field", room: "대강의실", grade: "고3", textbook: "미적분 · 모의고사", type: "REGULAR", size: 3,
    slots: [{ days: [1, 4], start: "20:10", end: "22:00", sr: ["18:00", "19:50"] }] },
  { name: "고등피팅", dept: "HIGH", teacher: "field", room: "대강의실", grade: "고1", textbook: "개별 진도", type: "REGULAR", size: 3,
    slots: [{ days: [3, 5], start: "20:10", end: "22:00", sr: ["18:00", "19:50"] }] },
];

/** 개별반 (금/토) — 정규반 학생들이 한 반씩 추가로 다닌다 */
const INDIVIDUAL: ClassDef[] = [
  ["개별 금1-2", "nayoung", "2강", 5, "14:40", "16:20", ["16:20", "17:10"]],
  ["개별 금2-1", "yeseul", "1강", 5, "16:20", "18:00", ["18:00", "18:50"]],
  ["개별 금2-2", "nayoung", "2강", 5, "16:20", "18:00", ["15:30", "16:20"]],
  ["개별 금3-1", "yeseul", "1강", 5, "18:00", "19:40", ["17:10", "18:00"]],
  ["개별 금3-2", "nayoung", "2강", 5, "18:00", "19:40", ["17:10", "18:00"]],
  ["개별 금4-1", "yeseul", "1강", 5, "19:40", "21:20", ["19:00", "19:40"]],
  ["개별 금4-2", "nayoung", "2강", 5, "19:40", "21:20", ["19:00", "19:40"]],
  ["개별 토1-1", "yeseul", "1강", 6, "10:00", "11:40", ["11:40", "12:30"]],
  ["개별 토1-2", "nayoung", "2강", 6, "10:00", "11:40", ["11:40", "12:30"]],
  ["개별 토2-1", "yeseul", "1강", 6, "11:40", "13:20", ["10:50", "11:40"]],
  ["개별 토2-2", "nayoung", "2강", 6, "11:40", "13:20", ["10:50", "11:40"]],
  ["개별 토3-1", "yeseul", "1강", 6, "13:20", "15:00", ["12:30", "13:20"]],
  ["개별 토3-2", "nayoung", "2강", 6, "13:20", "15:00", ["12:30", "13:20"]],
].map(([name, teacher, room, day, start, end, sr]) => ({
  name: name as string,
  dept: "ELEM" as const,
  teacher: teacher as string,
  room: room as string,
  grade: "개별",
  textbook: "개인별 진도",
  type: "INDIVIDUAL" as const,
  slots: [{ days: [day as number], start: start as string, end: end as string, sr: sr as [string, string] }],
  size: 0,
}));

const CLASSES: ClassDef[] = [...REGULAR, ...INDIVIDUAL];

// 가짜 학생 이름 — 성 × 이름 조합으로 겹치지 않게 만든다
const SURNAMES = "김이박최정강조윤장임한오서신권황안송류전홍고문양손배백허남심노하곽성차주우구민진나지엄채원천방공현함변염여추도소석선설마길연위표명기반".split("");
const GIVEN = [
  "서준", "하윤", "도현", "지우", "예은", "민준", "서아", "건우", "지호", "채원",
  "시우", "다은", "승우", "가온", "하람", "유진", "태윤", "시현", "아린", "준서",
  "로운", "세아", "하준", "민재", "우진", "나윤", "준영", "리아", "도윤", "서윤",
  "경민", "하늘", "소민", "지안", "윤호", "수아", "현우", "지유", "은호", "예린",
];
function fakeNames(count: number): string[] {
  const out = new Set<string>();
  for (let i = 0; out.size < count; i++) {
    const s = SURNAMES[i % SURNAMES.length];
    const g = GIVEN[(i * 7 + Math.floor(i / SURNAMES.length)) % GIVEN.length];
    out.add(s + g);
  }
  return [...out];
}

/** 해당 요일의 SR 좌석을 전부 지우고 자동배정으로 다시 계산한다. */
export function rebuildSrForDay(db: DatabaseSync, day: number): void {
  db.prepare("DELETE FROM sr_assignments WHERE day_of_week = ?").run(day);

  const sessions = db
    .prepare(
      `SELECT s.id, s.class_id, s.alpha_start_min, s.alpha_end_min, c.name AS class_name
         FROM timetable_sessions s
         JOIN classes c ON c.id = s.class_id
         JOIN rooms r ON r.id = s.alpha_room_id
        WHERE s.day_of_week = ?
          AND s.alpha_start_min IS NOT NULL
          AND s.alpha_end_min IS NOT NULL
          AND s.alpha_end_min > s.alpha_start_min
          AND r.is_sr = 1`,
    )
    .all(day) as unknown as {
    id: number;
    class_id: number;
    alpha_start_min: number;
    alpha_end_min: number;
    class_name: string;
  }[];

  if (sessions.length === 0) return;

  const studentsOf = db.prepare(
    `SELECT s.id FROM student_classes sc JOIN students s ON s.id = sc.student_id
      WHERE sc.class_id = ? AND s.active = 1 ORDER BY s.id`,
  );

  const blocks: AlphaBlock[] = sessions.map((s) => ({
    sessionId: s.id,
    classId: s.class_id,
    className: s.class_name,
    startMin: s.alpha_start_min,
    endMin: s.alpha_end_min,
    studentIds: (studentsOf.all(s.class_id) as unknown as { id: number }[]).map((r) => r.id),
  }));

  const insert = db.prepare(
    `INSERT INTO sr_assignments (session_id, student_id, day_of_week, seat, start_min, end_min, is_manual)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
  );
  for (const a of autoAssignSeats(blocks)) {
    insert.run(a.sessionId, a.studentId, day, a.seat, a.startMin, a.endMin);
  }
}

export function seedDemo(db: DatabaseSync): void {
  const now = new Date().toISOString();

  // 강의실 — 부서 공용. 순서 고정: SR룸 · 1강 · 2강 · 3강 · 4강 · 대강의실
  const roomInsert = db.prepare("INSERT INTO rooms (name, order_no, is_sr) VALUES (?, ?, ?)");
  const rooms: Record<string, number> = {};
  const roomDefs: [string, number][] = [
    ["SR룸", 1],
    ["1강", 0],
    ["2강", 0],
    ["3강", 0],
    ["4강", 0],
    ["대강의실", 0],
  ];
  roomDefs.forEach(([name, isSr], i) => {
    const r = roomInsert.run(name, i + 1, isSr);
    rooms[name] = Number(r.lastInsertRowid);
  });

  // 직원 — 비밀번호는 전부 1234
  const userInsert = db.prepare(
    "INSERT INTO users (login_id, password, name, role, department, active) VALUES (?, ?, ?, ?, ?, 1)",
  );
  const users: Record<string, number> = {};
  const userDefs: [string, string, string, string][] = [
    ["admin", "김도현", "ADMIN", "ELEM"],
    ["yeseul", "안예슬", "TEACHER", "ELEM"],
    ["nayoung", "최나영", "TEACHER", "ELEM"],
    ["field", "정필드", "TEACHER", "HIGH"],
    ["desk", "이수민", "DESK", "ELEM"],
  ];
  for (const [loginId, name, role, dept] of userDefs) {
    const r = userInsert.run(loginId, "1234", name, role, dept);
    users[loginId] = Number(r.lastInsertRowid);
  }

  // 반
  const classInsert = db.prepare(
    "INSERT INTO classes (name, department, teacher_id, room_id, grade, textbook) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const classes: Record<string, number> = {};
  for (const c of CLASSES) {
    const r = classInsert.run(c.name, c.dept, users[c.teacher], rooms[c.room], c.grade, c.textbook);
    classes[c.name] = Number(r.lastInsertRowid);
  }

  // 학생 — 정규반에 넣고, 초중등부 학생은 개별반(금/토)에도 하나씩 나눠 넣는다
  const studentInsert = db.prepare("INSERT INTO students (name, department, active) VALUES (?, ?, 1)");
  const memberInsert = db.prepare("INSERT INTO student_classes (student_id, class_id) VALUES (?, ?)");
  const names = fakeNames(REGULAR.reduce((n, c) => n + c.size, 0));
  let nameIdx = 0;
  let individualIdx = 0;
  for (const c of REGULAR) {
    for (let i = 0; i < c.size; i++) {
      const r = studentInsert.run(names[nameIdx++], c.dept);
      const studentId = Number(r.lastInsertRowid);
      memberInsert.run(studentId, classes[c.name]);
      if (c.dept === "ELEM") {
        const ind = INDIVIDUAL[individualIdx++ % INDIVIDUAL.length];
        memberInsert.run(studentId, classes[ind.name]);
      }
    }
  }

  // 주간 시간표
  const sessionInsert = db.prepare(
    `INSERT INTO timetable_sessions
      (day_of_week, class_id, type, start_min, end_min, alpha_start_min, alpha_end_min, room_id, alpha_room_id, teacher_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const c of CLASSES) {
    for (const slot of c.slots) {
      for (const day of slot.days) {
        sessionInsert.run(
          day,
          classes[c.name],
          c.type,
          toMin(slot.start),
          toMin(slot.end),
          slot.sr ? toMin(slot.sr[0]) : null,
          slot.sr ? toMin(slot.sr[1]) : null,
          rooms[c.room],
          slot.sr ? rooms["SR룸"] : null,
          users[c.teacher],
        );
      }
    }
  }

  for (let day = 0; day <= 6; day++) rebuildSrForDay(db, day);

  // 공지
  const noticeInsert = db.prepare(
    "INSERT INTO notices (title, body, department, author_id, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  noticeInsert.run(
    "이번 주 출결 전화 안내",
    "미체크 학생은 수업 시작 20분 이내에 전화 부탁드립니다. 지각 사유와 도착예정시간을 꼭 남겨주세요.",
    "ALL",
    users.admin,
    now,
  );
  noticeInsert.run(
    "SR룸 좌석 이용 수칙",
    "알파 시간 좌석은 자동배정을 기본으로 합니다. 자리 이동이 필요한 경우 SR 관리에서 변경해 주세요.",
    "ALL",
    users.admin,
    now,
  );
  noticeInsert.run(
    "고등부 정기 시험 대비 일정",
    "다음 주부터 고등부는 시험 대비 보강이 추가됩니다. 시간표를 확인해 주세요.",
    "HIGH",
    users.admin,
    now,
  );

  // 업무 지시
  const taskInsert = db.prepare(
    "INSERT INTO tasks (assignee_id, created_by, title, done, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const today = now.slice(0, 10);
  taskInsert.run(users.nayoung, users.admin, "학부모 상담 자료 준비", 0, today, now);
  taskInsert.run(users.nayoung, users.admin, "보강 학생 과제 확인", 0, today, now);
  taskInsert.run(users.nayoung, users.admin, "주간 학습 리포트 작성", 0, null, now);
  taskInsert.run(users.field, users.admin, "고1 모의고사 채점", 0, today, now);
  taskInsert.run(users.desk, users.admin, "결석 학생 학부모 안내 문자", 0, today, now);
  taskInsert.run(users.admin, users.admin, "다음 달 시간표 초안", 0, null, now);
}

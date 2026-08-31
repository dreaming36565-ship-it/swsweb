// 데모 데이터 시드 + 요일별 SR 재계산.
// 실제 학생 정보가 아니라 연습용 데이터다 (반 7개 / 학생 35명).

import type { DatabaseSync } from "node:sqlite";
import { toMin } from "./time";
import { autoAssignSeats, type AlphaBlock } from "./sr";

type Plan = [
  className: string,
  day: number,
  start: string,
  end: string,
  alphaStart: string,
  alphaEnd: string,
  room: string,
];

const MON: Plan[] = [
  ["5A1", 1, "14:40", "17:10", "17:10", "18:00", "1강"],
  ["5B2", 1, "14:40", "17:10", "17:10", "18:00", "2강"],
  ["중2A", 1, "17:20", "19:50", "16:20", "17:20", "4강"],
  ["고1수학A", 1, "18:30", "21:00", "17:30", "18:30", "대강의실"],
  ["고1영어A", 1, "18:30", "21:00", "17:30", "18:30", "3강"],
];

const TUE: Plan[] = [
  ["6A1", 2, "15:00", "17:30", "17:30", "18:20", "3강"],
  ["중2A", 2, "17:20", "19:50", "16:20", "17:20", "4강"],
  ["고2수학B", 2, "18:30", "21:00", "17:30", "18:30", "대강의실"],
];

const SAT: Plan[] = [
  ["6A1", 6, "10:00", "12:30", "12:30", "13:20", "3강"],
  ["고2수학B", 6, "14:00", "16:30", "13:00", "14:00", "대강의실"],
];

const shift = (plans: Plan[], day: number): Plan[] =>
  plans.map((p) => [p[0], day, p[2], p[3], p[4], p[5], p[6]] as Plan);

const WEEK: Plan[] = [
  ...MON,
  ...TUE,
  ...shift(MON, 3), // 수 = 월
  ...shift(TUE, 4), // 목 = 화
  ...shift(MON, 5), // 금 = 월
  ...SAT,
];

const CLASSES: {
  name: string;
  dept: "ELEM" | "HIGH";
  teacher: string;
  room: string;
  grade: string;
  textbook: string;
  students: string[];
}[] = [
  {
    name: "5A1",
    dept: "ELEM",
    teacher: "nayoung",
    room: "1강",
    grade: "초5",
    textbook: "개념원리 5-1",
    students: ["김서준", "이하윤", "박도현", "최지우", "정예은"],
  },
  {
    name: "5B2",
    dept: "ELEM",
    teacher: "jihoon",
    room: "2강",
    grade: "초5",
    textbook: "쎈 5-2",
    students: ["강민준", "윤서아", "임건우", "한지호", "오채원"],
  },
  {
    name: "6A1",
    dept: "ELEM",
    teacher: "nayoung",
    room: "3강",
    grade: "초6",
    textbook: "개념원리 6-1",
    students: ["서지훈", "남다은", "백승우", "문가온", "조하람"],
  },
  {
    name: "중2A",
    dept: "ELEM",
    teacher: "jihoon",
    room: "4강",
    grade: "중2",
    textbook: "RPM 중2-1",
    students: ["신유진", "권태윤", "황시현", "노아린", "배준서"],
  },
  {
    name: "고1수학A",
    dept: "HIGH",
    teacher: "field",
    room: "대강의실",
    grade: "고1",
    textbook: "수학의 정석 상",
    students: ["이로빈", "강지완", "홍세아", "유하람", "전민재"],
  },
  {
    name: "고1영어A",
    dept: "HIGH",
    teacher: "seoyeon",
    room: "3강",
    grade: "고1",
    textbook: "능률 고1 리딩",
    students: ["심우진", "곽나윤", "표준영", "성리아", "하도윤"],
  },
  {
    name: "고2수학B",
    dept: "HIGH",
    teacher: "field",
    room: "대강의실",
    grade: "고2",
    textbook: "쎈 수학2",
    students: ["진서윤", "도경민", "방하늘", "예소민", "라시우"],
  },
];

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
    "SELECT id FROM students WHERE class_id = ? AND active = 1 ORDER BY id",
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
    ["nayoung", "최나영", "TEACHER", "ELEM"],
    ["jihoon", "박지훈", "TEACHER", "ELEM"],
    ["field", "정필드", "TEACHER", "HIGH"],
    ["seoyeon", "한서연", "TEACHER", "HIGH"],
    ["desk", "이수민", "DESK", "ELEM"],
  ];
  for (const [loginId, name, role, dept] of userDefs) {
    const r = userInsert.run(loginId, "1234", name, role, dept);
    users[loginId] = Number(r.lastInsertRowid);
  }

  // 반 + 학생
  const classInsert = db.prepare(
    "INSERT INTO classes (name, department, teacher_id, room_id, grade, textbook) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const studentInsert = db.prepare(
    "INSERT INTO students (name, department, class_id, active) VALUES (?, ?, ?, 1)",
  );
  const classes: Record<string, number> = {};
  for (const c of CLASSES) {
    const r = classInsert.run(c.name, c.dept, users[c.teacher], rooms[c.room], c.grade, c.textbook);
    const classId = Number(r.lastInsertRowid);
    classes[c.name] = classId;
    for (const s of c.students) studentInsert.run(s, c.dept, classId);
  }

  // 주간 시간표
  const sessionInsert = db.prepare(
    `INSERT INTO timetable_sessions
      (day_of_week, class_id, type, start_min, end_min, alpha_start_min, alpha_end_min, room_id, alpha_room_id, teacher_id)
     VALUES (?, ?, 'REGULAR', ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const [className, day, start, end, aStart, aEnd, room] of WEEK) {
    const def = CLASSES.find((c) => c.name === className);
    if (!def) continue;
    sessionInsert.run(
      day,
      classes[className],
      toMin(start),
      toMin(end),
      toMin(aStart),
      toMin(aEnd),
      rooms[room],
      rooms["SR룸"],
      users[def.teacher],
    );
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

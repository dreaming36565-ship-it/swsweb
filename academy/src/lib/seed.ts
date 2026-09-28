// ★ 서버 전용. 데모 데이터 시드 + SR 주간 자리 계산 + 이 컴퓨터에만 있는 기록(시트) 가져오기.
// SR 자리 계산은 repo.ts 와 db.ts(마이그레이션)가 함께 쓴다 — DB 를 인자로 받는다.
// 반·시간은 실제 학원의 2026 4분기 시간표를 옮긴 것이다.
// 학생 이름은 코드에 남기지 않는다 — 이 컴퓨터의 data/roster.local.json(깃허브 제외)이 있으면
// 그 실제 명단을 쓰고, 없으면 가짜 이름을 만든다.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { dateKey, toMin } from "./time";
import { gradeLevel, planSeats, type Level, type SrBlock } from "./sr";
import { defaultForcedSlot, defaultPlan, isMark, quarterOf, timeline, type HwPlan, type HwSlot, type Mark } from "./homework";

/** 한 요일 묶음의 수업 시간. sr 이 있으면 그 시간에 SR룸을 쓴다. */
type Slot = { days: number[]; start: string; end: string; sr?: [string, string] };

type ClassDef = {
  name: string;
  dept: "ELEM" | "HIGH";
  /** 담당 선생님 아이디. 빈 문자열이면 담당 없음 */
  teacher: string;
  room: string;
  grade: string;
  textbook: string;
  /** REVIEW = 고등 누적오답, HOMEWORK = 숙제반 — 둘 다 수업 없이 SR만 쓴다 */
  type: "REGULAR" | "INDIVIDUAL" | "REVIEW" | "HOMEWORK";
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
  { name: "초6피팅", dept: "ELEM", teacher: "yeseul", room: "1강", grade: "초등피팅", textbook: "6학년 발전(대수)", type: "REGULAR", size: 4,
    slots: [{ days: MW, start: "16:20", end: "18:00", sr: ["15:30", "16:20"] }] },
  // 월수 — 중등
  { name: "7S1", dept: "ELEM", teacher: "yeseul", room: "1강", grade: "중1", textbook: "공수1 입", type: "REGULAR", size: 5,
    slots: [{ days: MW, start: "18:00", end: "19:40", sr: ["17:10", "18:00"] }] },
  { name: "7A1", dept: "ELEM", teacher: "nayoung", room: "2강", grade: "중1", textbook: "3-1 아폴론", type: "REGULAR", size: 6,
    slots: [{ days: MW, start: "18:00", end: "19:40", sr: ["17:10", "18:00"] }] },
  { name: "8A1", dept: "ELEM", teacher: "yeseul", room: "1강", grade: "중2", textbook: "공통수학2(입)", type: "REGULAR", size: 6,
    slots: [{ days: MW, start: "19:50", end: "21:30", sr: ["19:00", "19:50"] }] },
  { name: "중등피팅", dept: "ELEM", teacher: "nayoung", room: "2강", grade: "중등피팅", textbook: "3-1 아폴론", type: "REGULAR", size: 3,
    slots: [{ days: MW, start: "19:50", end: "21:30", sr: ["19:00", "19:50"] }] },
  { name: "9S1", dept: "ELEM", teacher: "field", room: "4강", grade: "중3", textbook: "대수 마플", type: "REGULAR", size: 4,
    slots: [{ days: MW, start: "16:20", end: "18:00", sr: ["18:00", "18:50"] }] },
  { name: "9A1", dept: "ELEM", teacher: "field", room: "4강", grade: "중3", textbook: "대수 쎈", type: "REGULAR", size: 4,
    slots: [{ days: MW, start: "18:00", end: "19:40", sr: ["17:10", "18:00"] }] },
  // 화목 — 초등
  { name: "4A2", dept: "ELEM", teacher: "nayoung", room: "2강", grade: "초4", textbook: "5-2 실력", type: "REGULAR", size: 4,
    slots: [{ days: TT, start: "14:40", end: "16:20", sr: ["16:20", "17:10"] }] },
  { name: "초등피팅", dept: "ELEM", teacher: "yeseul", room: "1강", grade: "초등피팅", textbook: "개별 진도", type: "REGULAR", size: 3,
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
  { name: "고등피팅", dept: "HIGH", teacher: "field", room: "대강의실", grade: "고등피팅", textbook: "개별 진도", type: "REGULAR", size: 3,
    slots: [{ days: [3, 5], start: "20:10", end: "22:00", sr: ["18:00", "19:50"] }] },
  // 토요일 오전 기하 — 수업 10:00~12:00(4강) 뒤 SR 12:00~1:00
  { name: "기하", dept: "HIGH", teacher: "field", room: "4강", grade: "고2", textbook: "고등 기하 쎈", type: "REGULAR", size: 3,
    slots: [{ days: [6], start: "10:00", end: "12:00", sr: ["12:00", "13:00"] }] },
];

/** 개별반 (금/토) — 정규반 학생들이 한 반씩 추가로 다닌다 */
const INDIVIDUAL: ClassDef[] = [
  ["개별 금1-2", "nayoung", "2강", 5, "14:40", "16:20", ["16:20", "17:10"]],
  ["개별 금2-1", "yeseul", "1강", 5, "16:20", "18:00", ["18:00", "18:50"]],
  ["개별 금2-2", "nayoung", "2강", 5, "16:20", "18:00", ["15:30", "16:20"]],
  ["개별 금3-1", "yeseul", "1강", 5, "18:00", "19:40", ["17:10", "18:00"]],
  ["개별 금3-2", "nayoung", "2강", 5, "18:00", "19:40", ["17:10", "18:00"]],
  ["개별 금4-1", "yeseul", "1강", 5, "19:50", "21:30", ["19:00", "19:50"]],
  ["개별 금4-2", "nayoung", "2강", 5, "19:50", "21:30", ["19:00", "19:50"]],
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

/** 수업 없이 SR만 쓰는 반 — 수업 시간 = SR 시간, 강의실 = SR룸 */
function srOnly(
  name: string,
  dept: "ELEM" | "HIGH",
  teacher: string,
  grade: string,
  textbook: string,
  type: "REVIEW" | "HOMEWORK",
  days: number[],
  start: string,
  end: string,
): ClassDef {
  return { name, dept, teacher, room: "SR룸", grade, textbook, type, size: 0, slots: [{ days, start, end, sr: [start, end] }] };
}

/** 고등 누적오답 — 요일마다 반 하나, SR 자기주도 오후 6:00 ~ 10:00 (다 마치면 하원) */
const REVIEW: ClassDef[] = ["월", "화", "수", "목", "금"].map((d, i) =>
  srOnly(`누적오답_${d}`, "HIGH", "field", "누적오답", "자기주도", "REVIEW", [i + 1], "18:00", "22:00"),
);

/** 숙제반 — 신청하거나 숙제 미흡으로 참여. 담당 선생님은 아직 정하지 않았다. */
const HOMEWORK: ClassDef[] = [
  srOnly("숙제반 월수 8시", "ELEM", "", "숙제반", "숙제", "HOMEWORK", MW, "20:00", "22:00"),
  srOnly("숙제반 화목 8시", "ELEM", "", "숙제반", "숙제", "HOMEWORK", TT, "20:00", "22:00"),
  srOnly("숙제반 화목 4시", "ELEM", "", "숙제반", "숙제", "HOMEWORK", TT, "16:00", "18:00"),
  srOnly("숙제반 월목 4시", "ELEM", "", "숙제반", "숙제", "HOMEWORK", [1, 4], "16:00", "18:00"),
];

const CLASSES: ClassDef[] = [...REGULAR, ...INDIVIDUAL, ...REVIEW, ...HOMEWORK];

/** 이 컴퓨터에만 있는 실제 명단 { classes: { 반이름: [학생이름…] } } — 없으면 null */
function loadLocalRoster(): Record<string, string[]> | null {
  const file = path.join(process.cwd(), "data", "roster.local.json");
  if (!existsSync(file)) return null;
  const json = JSON.parse(readFileSync(file, "utf8")) as { classes?: Record<string, string[]> };
  return json.classes ?? null;
}

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


/** 반의 사용교재(짧은 이름) → 교재 책장의 과정 + 교재 이름 */
const TEXTBOOK_MAP: Record<string, string> = {
  "6-1 심화": "초등 6-1 심화",
  "6-1 응용": "초등 6-1 응용",
  "5-2 실력": "초등 5-2 실력",
  "1-1 데메테르": "중등 1-1 데메테르",
  "1-2 데메테르": "중등 1-2 데메테르",
  "2-1 데메테르": "중등 2-1 데메테르",
  "1-1 아폴론(상)": "중등 1-1 아폴론(상)",
  "2-2 아폴론": "중등 2-2 아폴론",
  "3-1 아폴론": "중등 3-1 아폴론",
  "공수1 입": "고등 공통수학1 입",
  "공통수학2(입)": "고등 공통수학2 입",
  "공수2 쎈": "고등 공통수학2 쎈",
  "대수 쎈": "고등 대수 쎈",
  "대수 마플": "고등 대수 마플",
  "고등 기하 쎈": "고등 기하 쎈",
};

/** 이 컴퓨터에만 있는 JSON 파일 (data/*.local.json, git 제외) — 없으면 null */
function loadLocal<T>(file: string): T | null {
  const p = path.join(process.cwd(), "data", file);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

/* ------------------------------------------------------------ SR 주간 자리 */

type Q = { all: (...a: (string | number | null)[]) => unknown[]; get: (...a: (string | number | null)[]) => unknown };
const q = (db: DatabaseSync, sql: string) => db.prepare(sql) as unknown as Q;

type SessionRow = {
  id: number;
  class_id: number;
  type: string;
  day_of_week: number;
  start_min: number;
  end_min: number;
  alpha_start_min: number | null;
  alpha_end_min: number | null;
  alpha_is_sr: number;
};

function sessionRows(db: DatabaseSync): SessionRow[] {
  return q(
    db,
    `SELECT s.id, s.class_id, s.type, s.day_of_week, s.start_min, s.end_min, s.alpha_start_min, s.alpha_end_min,
            COALESCE(r.is_sr, 0) AS alpha_is_sr
       FROM timetable_sessions s LEFT JOIN rooms r ON r.id = s.alpha_room_id`,
  ).all() as SessionRow[];
}

/** 숙제반 칸 (반 관리의 숙제반) */
export function homeworkSlots(db: DatabaseSync): HwSlot[] {
  const classes = q(db, "SELECT id, name FROM classes WHERE grade = '숙제반' ORDER BY id").all() as { id: number; name: string }[];
  const sessions = sessionRows(db);
  return classes
    .map((c) => {
      const ss = sessions.filter((s) => s.class_id === c.id);
      return {
        id: c.id,
        name: c.name,
        days: [...new Set(ss.map((s) => s.day_of_week))].sort(),
        start: ss[0]?.start_min ?? 0,
        end: ss[0]?.end_min ?? 0,
      };
    })
    .filter((s) => s.days.length > 0)
    .sort((a, b) => a.start - b.start || a.days[0] - b.days[0]);
}

/** 숙제검사 대상 정보 — 학생마다 정규반(월수·화목 초중등 정규) · 개별반 요일, 다니는 시간 */
export type HwStudent = {
  id: number;
  name: string;
  regular: { id: number; name: string; days: number[]; teacherId: number | null } | null;
  individualDays: number[];
  busy: Record<number, [number, number][]>;
};

export function homeworkStudents(db: DatabaseSync): HwStudent[] {
  const sessions = sessionRows(db);
  const classes = q(db, "SELECT id, name, department, teacher_id FROM classes").all() as {
    id: number;
    name: string;
    department: string;
    teacher_id: number | null;
  }[];
  const cls = new Map(classes.map((c) => [c.id, c]));
  const daysOf = (id: number) => [...new Set(sessions.filter((s) => s.class_id === id).map((s) => s.day_of_week))].sort();
  const typeOf = (id: number) => sessions.find((s) => s.class_id === id)?.type;
  const members = q(
    db,
    `SELECT sc.student_id, sc.class_id, st.name FROM student_classes sc JOIN students st ON st.id = sc.student_id
      WHERE st.active = 1`,
  ).all() as { student_id: number; class_id: number; name: string }[];
  const by = new Map<number, { name: string; classIds: number[] }>();
  for (const m of members) {
    const cur = by.get(m.student_id) ?? { name: m.name, classIds: [] };
    cur.classIds.push(m.class_id);
    by.set(m.student_id, cur);
  }
  const out: HwStudent[] = [];
  for (const [id, s] of by) {
    const regularId = s.classIds.find((c) => {
      const days = daysOf(c).join(",");
      return typeOf(c) === "REGULAR" && cls.get(c)?.department === "ELEM" && (days === "1,3" || days === "2,4");
    });
    const busy: Record<number, [number, number][]> = {};
    for (const c of s.classIds) {
      for (const x of sessions.filter((y) => y.class_id === c && y.type !== "HOMEWORK")) {
        (busy[x.day_of_week] ??= []).push([
          Math.min(x.start_min, x.alpha_start_min ?? x.start_min),
          Math.max(x.end_min, x.alpha_end_min ?? x.end_min),
        ]);
      }
    }
    const individual = s.classIds.find((c) => typeOf(c) === "INDIVIDUAL");
    out.push({
      id,
      name: s.name,
      regular: regularId
        ? { id: regularId, name: cls.get(regularId)!.name, days: daysOf(regularId), teacherId: cls.get(regularId)!.teacher_id }
        : null,
      individualDays: individual ? daysOf(individual) : [],
      busy,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/** 그 학생이 SR에서 숙제검사를 받는 날 (정규반 요일 + 개별반 금/토) */
export function checkDatesOf(st: HwStudent, from: string, to: string): string[] {
  const days = new Set([...(st.regular?.days ?? []), ...st.individualDays]);
  const out: string[] = [];
  const d = new Date(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
  for (let k = dateKey(d); k <= to; d.setDate(d.getDate() + 1), k = dateKey(d)) if (days.has(d.getDay())) out.push(k);
  return out;
}

export function marksOf(db: DatabaseSync): Map<number, Map<string, Mark>> {
  const out = new Map<number, Map<string, Mark>>();
  for (const r of q(db, "SELECT student_id, date, mark FROM hw_marks").all() as { student_id: number; date: string; mark: string }[]) {
    if (!isMark(r.mark)) continue;
    const m = out.get(r.student_id) ?? new Map<string, Mark>();
    m.set(r.date, r.mark);
    out.set(r.student_id, m);
  }
  return out;
}

/** 강제 숙제반 학생의 칸 · 요일별 방법 (지금 진행 중인 회차가 있는 학생만) */
export function forcedPlans(db: DatabaseSync, today: string): Map<number, { slot: HwSlot | null; plan: HwPlan }> {
  const slots = homeworkSlots(db);
  const marks = marksOf(db);
  const { start } = quarterOf(today);
  const month = today.slice(0, 7);
  const forcedSlot = new Map(
    (q(db, "SELECT student_id, slot_class_id FROM hw_forced_slot").all() as { student_id: number; slot_class_id: number }[]).map((r) => [
      r.student_id,
      r.slot_class_id,
    ]),
  );
  const applying = new Map(
    (q(db, "SELECT student_id, slot_class_id FROM hw_apply WHERE month = ?").all(month) as { student_id: number; slot_class_id: number }[]).map(
      (r) => [r.student_id, r.slot_class_id],
    ),
  );
  const plans = new Map<number, HwPlan>();
  for (const r of q(db, "SELECT student_id, day, how, slot_class_id FROM hw_plan").all() as {
    student_id: number;
    day: number;
    how: string;
    slot_class_id: number | null;
  }[]) {
    const p = plans.get(r.student_id) ?? {};
    p[r.day] = r.how === "CERT" ? { how: "CERT" } : { how: "ATTEND", slotId: r.slot_class_id ?? 0 };
    plans.set(r.student_id, p);
  }
  const out = new Map<number, { slot: HwSlot | null; plan: HwPlan }>();
  for (const st of homeworkStudents(db)) {
    if (!st.regular) continue;
    const t = timeline(marks.get(st.id) ?? new Map(), checkDatesOf(st, start, today), start, today);
    if (!t.cur) continue;
    const fixed = forcedSlot.get(st.id);
    const slot =
      (fixed ? slots.find((s) => s.id === fixed) : null) ??
      defaultForcedSlot(slots, { applyingSlotId: applying.get(st.id) ?? null, regularDays: st.regular.days, busy: (d) => st.busy[d] ?? [] });
    out.set(st.id, { slot, plan: plans.get(st.id) ?? defaultPlan(slot) });
  }
  return out;
}

/**
 * SR을 쓰는 반과 학생. 숙제반은 반 명단 대신 「그 달 신청 학생 + 강제 숙제반 참석 학생」.
 * memberDays: 그 학생이 SR에 오는 요일이 반의 SR 요일과 다를 때 (강제 숙제반은 참석 요일만)
 */
export function srRoster(
  db: DatabaseSync,
  today = dateKey(new Date()),
): {
  classes: { id: number; name: string; level: Level; members: number[] }[];
  blocks: (SrBlock & { sessionId: number })[];
  memberDays: Map<string, number[]>;
} {
  const sessions = sessionRows(db).filter((s) => s.alpha_is_sr === 1 && s.alpha_start_min !== null && s.alpha_end_min !== null);
  const blocks = sessions.map((s) => ({ classId: s.class_id, day: s.day_of_week, start: s.alpha_start_min!, end: s.alpha_end_min!, sessionId: s.id }));
  const classRows = q(db, "SELECT id, name, grade, level FROM classes").all() as { id: number; name: string; grade: string | null; level: string | null }[];
  const membership = q(
    db,
    `SELECT sc.class_id, sc.student_id FROM student_classes sc JOIN students st ON st.id = sc.student_id WHERE st.active = 1
      ORDER BY sc.student_id`,
  ).all() as { class_id: number; student_id: number }[];
  const members = new Map<number, number[]>();
  for (const m of membership) members.set(m.class_id, [...(members.get(m.class_id) ?? []), m.student_id]);

  // 숙제반: 그 달 신청 + 강제 참석
  const memberDays = new Map<string, number[]>();
  const hwIds = new Set(classRows.filter((c) => c.grade === "숙제반").map((c) => c.id));
  for (const id of hwIds) members.set(id, []);
  for (const a of q(db, "SELECT student_id, slot_class_id FROM hw_apply WHERE month = ? ORDER BY student_id").all(today.slice(0, 7)) as {
    student_id: number;
    slot_class_id: number;
  }[]) {
    if (!hwIds.has(a.slot_class_id)) continue;
    const list = members.get(a.slot_class_id)!;
    if (!list.includes(a.student_id)) list.push(a.student_id);
  }
  for (const [studentId, { plan }] of forcedPlans(db, today)) {
    for (const [day, p] of Object.entries(plan)) {
      if (!p || p.how !== "ATTEND" || !hwIds.has(p.slotId)) continue;
      const list = members.get(p.slotId)!;
      const key = `${p.slotId}|${studentId}`;
      if (!list.includes(studentId)) {
        list.push(studentId);
        memberDays.set(key, []);
      }
      if (memberDays.has(key)) memberDays.get(key)!.push(Number(day));
    }
  }

  // 학교급 — 학년으로, 개별반·숙제반은 다니는 학생들의 다른 반 학교급 중 많은 쪽
  const lv = new Map<number, Level | null>(classRows.map((c) => [c.id, gradeLevel(c.grade, c.level)]));
  const byStudent = new Map<number, number[]>();
  for (const m of membership) byStudent.set(m.student_id, [...(byStudent.get(m.student_id) ?? []), m.class_id]);
  const levelOf = (id: number): Level => {
    const own = lv.get(id);
    if (own) return own;
    const count: Record<Level, number> = { E: 0, M: 0, H: 0 };
    for (const s of members.get(id) ?? []) {
      for (const other of byStudent.get(s) ?? []) {
        const l = lv.get(other);
        if (l) count[l] += 1;
      }
    }
    const top = (Object.entries(count) as [Level, number][]).sort((a, b) => b[1] - a[1])[0];
    return top[1] > 0 ? top[0] : "M";
  };
  const srClassIds = new Set(blocks.map((b) => b.classId));
  return {
    classes: classRows
      .filter((c) => srClassIds.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, level: levelOf(c.id), members: members.get(c.id) ?? [] })),
    blocks,
    memberDays,
  };
}

/**
 * SR 주간 자리를 다시 계산한다. 지금 자리는 그대로 두고 자리가 없는 학생만 앉힌다
 * (시간이 겹치게 됐거나 반에서 빠진 학생의 자리는 버린다). pack = 월초 정리.
 */
export function rebuildSrSeats(db: DatabaseSync, opts: { pack?: boolean } = {}): { overflow: number } {
  const { classes, blocks } = srRoster(db);
  const existing = (
    q(db, "SELECT class_id, student_id, seat, manual FROM sr_seats").all() as {
      class_id: number;
      student_id: number;
      seat: string;
      manual: number;
    }[]
  ).map((e) => ({ classId: e.class_id, studentId: e.student_id, seat: e.seat, manual: e.manual === 1 }));
  const plan = planSeats({ classes, blocks, existing, pack: opts.pack });
  db.exec("DELETE FROM sr_seats");
  const ins = db.prepare("INSERT INTO sr_seats (class_id, student_id, seat, manual) VALUES (?, ?, ?, ?)");
  for (const s of plan.seats.values()) ins.run(s.classId, s.studentId, s.seat, s.manual ? 1 : 0);
  return { overflow: plan.overflow.length };
}

/* ------------------------------------------------------------ 시트 기록 가져오기 */

/** "개별 토 1-2" → "개별 토1-2" (시트의 띄어쓰기가 제각각이라 맞춘다) */
const normClass = (s: string) => s.replace(/\s+/g, "").replace(/^개별(금|토)/, "개별 $1");

/**
 * 이 컴퓨터에만 있는 기록을 DB에 넣는다 (파일이 없으면 아무것도 안 한다).
 * - data/makeup.local.json: 구글 「결석보강 관리」 시트 — 2026-09-01 이후 · 보강 완료가 아닌 결석
 * - data/homework.local.json: 숙제검사 9월 기록 · 지각 숙제반 · 신청
 * - data/roster.local.json: 숙제반 9월 명단 (강제로만 온 학생 제외 → 9월 신청)
 */
export function importLocalRecords(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const today = dateKey(new Date());
  const studentId = (name: string) =>
    (q(db, "SELECT id FROM students WHERE name = ? ORDER BY id LIMIT 1").get(name) as { id: number } | undefined)?.id ?? null;
  const classByName = (name: string) =>
    q(
      db,
      "SELECT c.id, c.name, c.department, c.teacher_id, u.name AS teacher FROM classes c LEFT JOIN users u ON u.id = c.teacher_id WHERE c.name = ?",
    ).get(normClass(name)) as { id: number; name: string; department: string; teacher_id: number | null; teacher: string | null } | undefined;
  const userByShort = (short: string) =>
    q(db, "SELECT id, name FROM users WHERE name LIKE ? ORDER BY id LIMIT 1").get(`%${short.replace(/T$/, "")}`) as
      | { id: number; name: string }
      | undefined;

  // 결석보강 시트
  type SheetRow = { name: string; cls: string; teacher: string; reason: string; date: string; makeup: string; dream: boolean; memo: string; tab: string };
  const makeup = loadLocal<{ rows?: SheetRow[] }>("makeup.local.json");
  const insAbs = db.prepare(
    `INSERT INTO absences (student_id, student_name, class_id, class_name, teacher_id, teacher_name, department, date, reason,
                           cat, notice, dream, memo, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insRound = db.prepare(
    "INSERT INTO absence_rounds (absence_id, type, date, start_min, state, created_at) VALUES (?, ?, ?, ?, 'PLANNED', ?)",
  );
  for (const r of makeup?.rows ?? []) {
    const c = classByName(r.cls);
    const t = r.teacher ? userByShort(r.teacher) : undefined;
    // 목록에 있는 사유면 구분을 정하고, 애매하면 「판정 필요」 (관리자가 정한다)
    const cat = /병|진료|아파|가족|여행|경조사|결혼|제사|친척|장례|명절|학교/.test(r.reason) ? "OK" : null;
    const res = insAbs.run(
      studentId(r.name),
      r.name,
      c?.id ?? null,
      c?.name ?? normClass(r.cls),
      t?.id ?? c?.teacher_id ?? null,
      t?.name ?? c?.teacher ?? null,
      c?.department ?? "ELEM",
      r.date,
      r.reason,
      cat,
      r.date > today ? "PRE" : null,
      r.dream ? 1 : 0,
      r.memo ?? "",
      `시트에서 옮김 — ${r.tab} (보강 완료 아닌 줄만)`,
      now,
    );
    const absenceId = Number(res.lastInsertRowid);
    for (const round of parseRounds(r.makeup, r.date)) insRound.run(absenceId, round.type, round.date, round.min, now);
  }

  // 숙제 기록
  const hw = loadLocal<{
    marks?: { name: string; date: string; mark: string }[];
    late?: { name: string; lates: string[]; date: string | null; start: string | null; done: boolean }[];
    apply?: { name: string; slot: string; month: string }[];
  }>("homework.local.json");
  const insMark = db.prepare("INSERT OR REPLACE INTO hw_marks (student_id, date, mark) VALUES (?, ?, ?)");
  for (const m of hw?.marks ?? []) {
    const id = studentId(m.name);
    if (id && isMark(m.mark)) insMark.run(id, m.date, m.mark);
  }
  const slots = homeworkSlots(db);
  const insLate = db.prepare(
    "INSERT INTO hw_late (student_id, lates, date, slot_class_id, done, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  for (const l of hw?.late ?? []) {
    const id = studentId(l.name);
    if (!id) continue;
    const dow = l.date ? new Date(`${l.date}T00:00:00`).getDay() : null;
    const slot = l.start && dow !== null ? slots.find((s) => s.days.includes(dow) && s.start === toMin(l.start!)) : null;
    insLate.run(id, l.lates.join(","), l.date, slot?.id ?? null, l.done ? 1 : 0, now);
  }
  const insApply = db.prepare("INSERT OR IGNORE INTO hw_apply (student_id, slot_class_id, month) VALUES (?, ?, ?)");
  for (const a of hw?.apply ?? []) {
    const id = studentId(a.name);
    const slot = slots.find((s) => s.name === a.slot);
    if (id && slot) insApply.run(id, slot.id, a.month);
  }
  // 9월 숙제반 명단 — 강제로만 온 학생은 빼고 신청으로
  const roster = loadLocal<{ classes?: Record<string, string[]>; homeworkKind?: Record<string, string> }>("roster.local.json");
  for (const slot of slots) {
    for (const n of roster?.classes?.[slot.name] ?? []) {
      if (roster?.homeworkKind?.[n] === "강제") continue;
      const id = studentId(n);
      if (id) insApply.run(id, slot.id, "2026-09");
    }
  }
}

/** 시트의 보강일시 "9/22(화) 15시, 18시" · "과제로 대체 / 9/12(토) 10시" → 회차 목록 (연도는 결석일 기준) */
function parseRounds(text: string, absent: string): { type: "MAKEUP" | "TASK"; date: string | null; min: number | null }[] {
  const out: { type: "MAKEUP" | "TASK"; date: string | null; min: number | null }[] = [];
  let last: string | null = null;
  const pad = (n: number) => String(n).padStart(2, "0");
  for (const piece of String(text ?? "")
    .split(/\n|,|\s\/\s/)
    .map((p) => p.trim())
    .filter(Boolean)) {
    if (/과제/.test(piece)) {
      out.push({ type: "TASK", date: null, min: null });
      continue;
    }
    const dm = /(\d{1,2})\/(\d{1,2})/.exec(piece);
    if (dm) {
      let y = Number(absent.slice(0, 4));
      if (`${y}-${pad(+dm[1])}-${pad(+dm[2])}` < absent && +dm[1] < Number(absent.slice(5, 7)) - 2) y++;
      last = `${y}-${pad(+dm[1])}-${pad(+dm[2])}`;
    }
    const tm = /(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분)?/.exec(piece.replace(/\d{1,2}\/\d{1,2}/, ""));
    if (!last) continue;
    let h = tm ? Number(tm[1]) : 16;
    if (h < 9) h += 12;
    out.push({ type: "MAKEUP", date: last, min: h * 60 + (tm && tm[2] ? Number(tm[2]) : 0) });
  }
  return out;
}

/* ------------------------------------------------------------ 데모 데이터 */

export function seedDemo(db: DatabaseSync): void {
  const now = new Date().toISOString();

  // 강의실 — 부서 공용. 순서 고정: SR룸 · 1강 · 2강 · 3강 · 4강 · 대강의실 (최대 인원은 관리자가 넣는다)
  const roomInsert = db.prepare("INSERT INTO rooms (name, order_no, is_sr) VALUES (?, ?, ?)");
  const rooms: Record<string, number> = {};
  ["SR룸", "1강", "2강", "3강", "4강", "대강의실"].forEach((name, i) => {
    rooms[name] = Number(roomInsert.run(name, i + 1, name === "SR룸" ? 1 : 0).lastInsertRowid);
  });

  // 직원 — 아이디 = 한글 이름, 비밀번호는 전부 1234. 안예슬 = 관리자 + 선생님(담당 반 있음)
  const userInsert = db.prepare(
    "INSERT INTO users (login_id, password, name, role, roles, department, active, must_change_pw) VALUES (?, '1234', ?, ?, ?, ?, 1, 0)",
  );
  const users: Record<string, number> = {};
  const userDefs: [key: string, name: string, roles: string, dept: string][] = [
    ["yeseul", "안예슬", "ADMIN,TEACHER", "ELEM"],
    ["nayoung", "최나영", "TEACHER", "ELEM"],
    ["field", "정필드", "TEACHER", "HIGH"],
    ["desk", "이수민", "DESK", "ELEM"],
  ];
  for (const [key, name, roles, dept] of userDefs) {
    users[key] = Number(userInsert.run(name, name, roles.split(",")[0], roles, dept).lastInsertRowid);
  }

  // 교재 책장
  const bookInsert = db.prepare("INSERT INTO books (level, grade, name, created_at) VALUES (?, ?, ?, ?)");
  const books = new Map<string, number>();
  for (const full of new Set(Object.values(TEXTBOOK_MAP))) {
    const [level, grade, ...rest] = full.split(" ");
    books.set(full, Number(bookInsert.run(level, grade, rest.join(" "), now).lastInsertRowid));
  }

  // 반
  const classInsert = db.prepare(
    "INSERT INTO classes (name, department, teacher_id, room_id, grade, textbook) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const classes: Record<string, number> = {};
  for (const c of CLASSES) {
    classes[c.name] = Number(
      classInsert.run(c.name, c.dept, users[c.teacher] ?? null, rooms[c.room], c.grade, c.textbook).lastInsertRowid,
    );
  }

  // 학생 — 정규반에 넣고, 초중등부 학생은 개별반(금/토)에도 하나씩 나눠 넣는다
  const studentInsert = db.prepare("INSERT INTO students (name, department, active) VALUES (?, ?, 1)");
  const memberInsert = db.prepare("INSERT OR IGNORE INTO student_classes (student_id, class_id) VALUES (?, ?)");
  const roster = loadLocalRoster();
  const homeworkNames = new Set(HOMEWORK.map((c) => c.name));
  if (roster) {
    // 실제 명단 — 같은 이름은 한 학생 (동명이인은 명단에서 "홍길동(초4)" 처럼 구분해 둔다)
    const deptOf = new Map(CLASSES.map((c) => [c.name, c.dept]));
    const studentDept = new Map<string, "ELEM" | "HIGH">();
    for (const [className, members] of Object.entries(roster)) {
      const dept = deptOf.get(className);
      if (!dept) {
        console.warn(`명단의 반 「${className}」이 시간표에 없어 건너뜁니다.`);
        continue;
      }
      for (const n of members) if (studentDept.get(n) !== "HIGH") studentDept.set(n, dept);
    }
    const studentIds = new Map<string, number>();
    for (const [n, dept] of studentDept) studentIds.set(n, Number(studentInsert.run(n, dept).lastInsertRowid));
    for (const [className, members] of Object.entries(roster)) {
      // 숙제반은 반 명단 대신 달마다 신청(hw_apply)으로 관리한다
      if (!deptOf.has(className) || homeworkNames.has(className)) continue;
      for (const n of new Set(members)) memberInsert.run(studentIds.get(n)!, classes[className]);
    }
    console.log(`실제 명단: 학생 ${studentIds.size}명`);
  } else {
    const names = fakeNames(REGULAR.reduce((n, c) => n + c.size, 0));
    let nameIdx = 0;
    let individualIdx = 0;
    for (const c of REGULAR) {
      for (let i = 0; i < c.size; i++) {
        const studentId = Number(studentInsert.run(names[nameIdx++], c.dept).lastInsertRowid);
        memberInsert.run(studentId, classes[c.name]);
        if (c.dept === "ELEM") memberInsert.run(studentId, classes[INDIVIDUAL[individualIdx++ % INDIVIDUAL.length].name]);
      }
    }
  }

  // 주간 시간표 — 반의 사용교재가 책장에 있으면 수업 칸에 연결
  const sessionInsert = db.prepare(
    `INSERT INTO timetable_sessions
      (day_of_week, class_id, type, label, start_min, end_min, alpha_start_min, alpha_end_min, room_id, alpha_room_id, teacher_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const bookLink = db.prepare("INSERT OR IGNORE INTO session_books (session_id, book_id) VALUES (?, ?)");
  for (const c of CLASSES) {
    const bookId = books.get(TEXTBOOK_MAP[c.textbook] ?? "");
    for (const slot of c.slots) {
      for (const day of slot.days) {
        const id = Number(
          sessionInsert.run(
            day,
            classes[c.name],
            c.type,
            c.type === "INDIVIDUAL" ? "개별" : c.type === "REGULAR" ? "수업" : "SR 자기주도",
            toMin(slot.start),
            toMin(slot.end),
            slot.sr ? toMin(slot.sr[0]) : null,
            slot.sr ? toMin(slot.sr[1]) : null,
            rooms[c.room],
            slot.sr ? rooms["SR룸"] : null,
            users[c.teacher] ?? null,
          ).lastInsertRowid,
        );
        if (bookId) bookLink.run(id, bookId);
      }
    }
  }

  importLocalRecords(db);
  rebuildSrSeats(db);

  // 공지
  const noticeInsert = db.prepare("INSERT INTO notices (title, body, department, author_id, created_at) VALUES (?, ?, ?, ?, ?)");
  noticeInsert.run(
    "이번 주 출결 전화 안내",
    "미체크 학생은 수업 시작 20분 이내에 전화 부탁드립니다. 지각 사유와 도착예정시간을 꼭 남겨주세요.",
    "ALL",
    users.yeseul,
    now,
  );
  noticeInsert.run(
    "SR룸 좌석 이용 수칙",
    "학생은 매주 같은 자리에 앉습니다. 자리 변경은 SR 관리에서 데스크가 합니다 (선생님은 🙋 자리 요청).",
    "ALL",
    users.yeseul,
    now,
  );
  noticeInsert.run("고등부 정기 시험 대비 일정", "다음 주부터 고등부는 시험 대비 보강이 추가됩니다. 시간표를 확인해 주세요.", "HIGH", users.yeseul, now);

  // 업무 지시
  const taskInsert = db.prepare(
    "INSERT INTO tasks (assignee_id, created_by, title, done, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const today = now.slice(0, 10);
  taskInsert.run(users.nayoung, users.yeseul, "학부모 상담 자료 준비", 0, today, now);
  taskInsert.run(users.nayoung, users.yeseul, "보강 학생 과제 확인", 0, today, now);
  taskInsert.run(users.field, users.yeseul, "고1 모의고사 채점", 0, today, now);
  taskInsert.run(users.desk, users.yeseul, "결석 학생 학부모 안내 문자", 0, today, now);
}

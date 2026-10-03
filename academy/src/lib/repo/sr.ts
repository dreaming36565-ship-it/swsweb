// ★ 서버 전용. SR 자리 — 주간 자리 · 실시간 현황 · 자리 바꾸기/요청 · 임시 자리 · 하원 · 미션지 · 월초 정리.

import { getDb } from "../db";
import { parseDays, parseRoles } from "../auth";
import { assert } from "../errors";
import { planSrSeats, rebuildSrSeats, srRoster } from "../seed";
import { SEATS, SEAT_ROWS, classMoveOptions, movableSeatsFor, keyBlocks, seatBlocker, studentSwapCheck, seatCol, seatRow, srRulesFor, type Level, type SeatUse, type SrBlock } from "../sr";
import { DAY_LABELS, addDaysKey, clockLabel, fmtTime, monthDay, parseDateKey, rangeLabel } from "../time";
import { teacherLabel, type MissionRequest, type SessionType, type SessionUser } from "../types";
import { can } from "../perm";
import { getSetting, notify, nowIso, nowMin, row, rows, setSetting, today, transaction, userIdsWithRole } from "./base";
import { listAllSessions, listSessions } from "./timetable";
import { absentOn } from "./absence";

export type SrClass = {
  id: number;
  name: string;
  type: SessionType;
  level: Level;
  teacherId: number | null;
  teacherName: string | null;
  /** 미션지가 꼭 있어야 하는 SR — 금·토 개별반과 숙제반을 뺀 모든 SR (누적오답 포함) */
  needsMission: boolean;
  /** days = 숙제반처럼 그 학생이 오는 요일 (없으면 반의 SR 요일 모두) · early = 📌 일찍 오기 { 요일: 시작 시각 } */
  members: { id: number; name: string; days?: number[]; early?: Record<number, number> }[];
};

export type SrMission = {
  classId: number;
  state: "REQUESTED" | "DONE";
  requestedAt: number | null;
  doneByKind: "DESK" | "TEACHER" | null;
  doneAt: number | null;
};

export type SrSeatRequest = {
  id: number;
  date: string;
  classId: number;
  className: string;
  studentId: number;
  studentName: string;
  fromSeat: string | null;
  toSeat: string;
  scope: "TODAY" | "ALWAYS";
  reason: string | null;
  requestedBy: number | null;
  requestedByName: string | null;
  atMin: number;
  state: "WAIT" | "OK" | "NO";
  decidedByName: string | null;
};

export type SrAdhoc = { id: number; date: string; name: string; studentId: number | null; kind: string; start: number; end: number; seat: string };

/** 🙋 SR 자리 요청 (선생님 → 데스크) — 오늘만. 배정하면 임시 자리가 된다 */
export type SrAdhocRequest = {
  id: number;
  date: string;
  name: string;
  kind: string;
  start: number;
  end: number;
  memo: string | null;
  requestedBy: number | null;
  requestedByName: string | null;
  atMin: number;
  state: "WAIT" | "OK" | "NO" | "CANCEL";
  seat: string | null;
  decidedByName: string | null;
};

export type SrSnapshot = {
  date: string;
  day: number;
  nowMin: number;
  classes: SrClass[];
  /** 반의 SR 칸 (요일별, 원래 시간) */
  blocks: SrBlock[];
  /** 그 날짜의 SR 칸 (⇄ 하루만 바꾼 순서 반영) */
  dayBlocks: SrBlock[];
  seats: { classId: number; studentId: number; seat: string; manual: boolean }[];
  /** 주간 자리 사용 (요일별) — 자리 바꾸기 판단용 */
  weekUses: SeatUse[];
  /** 그 날짜 자리 사용 — 오늘만 바뀐 자리 · 임시 자리 · 하원 반영 */
  dayUses: SeatUse[];
  adhoc: SrAdhoc[];
  leave: { classId: number; studentId: number; atMin: number }[];
  /** 그 날짜 결석 — 자리는 빈자리로 (임시 자리로 쓸 수 있다) */
  absent: { classId: number; studentId: number; reason: string }[];
  missions: SrMission[];
  requests: SrSeatRequest[];
  /** 🙋 오늘 SR 자리 요청 (임시 자리) */
  adhocRequests: SrAdhocRequest[];
  /** 최근 7일 SR 자리 요청 전부 (관리자 🗑 지우기용) */
  adhocRecent: SrAdhocRequest[];
  log:{ date: string; atMin: number; text: string }[];
  overflow: { classId: number; studentId: number }[];
  /** 요일마다 수업이 있는 모든 반 — 반 색을 시간표와 똑같이 맞추려고 */
  dayClassIds: Record<number, number[]>;
  /** 📅 다음 달 자리 미리보기일 때 — 계산 결과 (📌 확정했으면 확정한 자리) */
  preview?: { month: string; changed: number; confirmed: { at: string; by: string } | null };
};

const dayOf = (date: string) => parseDateKey(date).getDay();

function srClasses(rosterDate = today()): { list: SrClass[]; memberDays: Map<string, number[]>; blocks: SrBlock[] } {
  const db = getDb();
  const roster = srRoster(db, rosterDate);
  const info = rows<{ id: number; type: string | null; teacher_id: number | null; teacher_name: string | null }>(
    db
      .prepare(
        `SELECT c.id, (SELECT type FROM timetable_sessions WHERE class_id = c.id LIMIT 1) AS type, c.teacher_id, u.name AS teacher_name
           FROM classes c LEFT JOIN users u ON u.id = c.teacher_id`,
      )
      .all(),
  );
  const names = new Map(rows<{ id: number; name: string }>(db.prepare("SELECT id, name FROM students").all()).map((s) => [s.id, s.name]));
  const earlyOf = (classId: number, studentId: number) => {
    let out: Record<number, number> | undefined;
    for (const [k, start] of roster.early) {
      const [c, st, d] = k.split("|").map(Number);
      if (c === classId && st === studentId) (out ??= {})[d] = start;
    }
    return out;
  };
  const list = roster.classes.map((c) => {
    const i = info.find((x) => x.id === c.id);
    const type = (i?.type ?? "REGULAR") as SessionType;
    return {
      id: c.id,
      name: c.name,
      type,
      level: c.level,
      teacherId: i?.teacher_id ?? null,
      teacherName: i?.teacher_name ?? null,
      needsMission: type !== "INDIVIDUAL" && type !== "HOMEWORK",
      members: c.members.map((id) => ({ id, name: names.get(id) ?? "", days: roster.memberDays.get(`${c.id}|${id}`), early: earlyOf(c.id, id) })).sort((a, b) => a.name.localeCompare(b.name, "ko")),
    };
  });
  return { list, memberDays: roster.memberDays, blocks: roster.blocks.map(({ classId, day, start, end }) => ({ classId, day, start, end })) };
}

function seatRows() {
  return rows<{ classId: number; studentId: number; seat: string; manual: number }>(
    getDb().prepare("SELECT class_id AS classId, student_id AS studentId, seat, manual FROM sr_seats").all(),
  ).map((s) => ({ ...s, manual: s.manual === 1 }));
}

/** 주간 자리 사용 — blocks 는 요일별 SR 칸 */
function usesFrom(
  classes: SrClass[],
  blocks: SrBlock[],
  seatOf: (classId: number, studentId: number) => string | null,
  memberDays: Map<string, number[]>,
): SeatUse[] {
  const out: SeatUse[] = [];
  for (const b of blocks) {
    const c = classes.find((x) => x.id === b.classId);
    if (!c) continue;
    for (const m of c.members) {
      const days = memberDays.get(`${c.id}|${m.id}`);
      if (days && !days.includes(b.day)) continue;
      const seat = seatOf(c.id, m.id);
      if (!seat) continue;
      // 📌 일찍 오기 — 그 요일은 더 일찍부터 같은 자리
      const e = m.early?.[b.day];
      const start = e !== undefined && e < b.start ? e : b.start;
      out.push({ key: `${c.id}|${m.id}`, seat, day: b.day, start, end: b.end, name: m.name, label: c.name, classId: c.id, studentId: m.id });
    }
  }
  return out;
}

/** 다음 달 1일 (YYYY-MM-01) */
export function nextMonthFirst(): string {
  const d = parseDateKey(today());
  const n = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-01`;
}

/** 계산한 자리를 화면용 목록으로 */
const planRows = (plan: ReturnType<typeof planSrSeats>) => [...plan.seats.values()].map((x) => ({ ...x }));

/**
 * 📅 다음 달 자리 미리보기 — 지금 명단(다음 달 숙제반 신청 포함) · 다음 달 규칙으로 처음부터 앉혀 본 모습. 저장 안 함.
 * date 는 보고 싶은 요일을 고르는 데만 쓴다 (임시 자리 · 하원 · 결석은 없음).
 */
/* ------------------------------------------------------------ 📌 다음 달 자리 확정 */

type SrConfirmed = { month: string; at: string; by: string; seats: { classId: number; studentId: number; seat: string }[] };
const CONFIRM_KEY = "sr_confirmed_next";

function confirmedFor(month: string): SrConfirmed | null {
  const raw = getSetting(CONFIRM_KEY);
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as SrConfirmed;
    return c.month === month ? c : null;
  } catch {
    return null;
  }
}

/**
 * 📌 다음 달 자리 확정 (관리자) — 지금 미리보기 자리를 저장. 1일 자동 정리는 새로 계산하지 않고 이 자리를 쓴다
 * (그 사이 새로 온 학생만 빈자리에, 빠진 학생 자리는 비움). undo = 확정 풀기.
 */
export function srConfirmNext(user: SessionUser, undo = false): void {
  assert(can(user, "sr.pack"), "자리 확정은 관리자만 할 수 있어요.");
  const first = nextMonthFirst();
  const month = first.slice(0, 7);
  if (undo) {
    setSetting(CONFIRM_KEY, null);
    addLog(today(), `${who(user)} · 📌 ${Number(month.slice(5))}월 자리 확정 풀기`);
    return;
  }
  const conf = confirmedFor(month);
  const plan = planSrSeats(getDb(), conf ? { base: conf.seats, date: first } : { fresh: true, date: first });
  const seats = [...plan.seats.values()].map(({ classId, studentId, seat }) => ({ classId, studentId, seat }));
  const at = `${monthDay(today())} ${fmtTime(nowMin())}`;
  setSetting(CONFIRM_KEY, JSON.stringify({ month, at, by: who(user), seats } satisfies SrConfirmed));
  addLog(today(), `${who(user)} · 📌 ${Number(month.slice(5))}월 자리 확정 (${seats.length}명)`);
}

/** 📅 다음 달 자리 — 확정했으면 확정 자리 기준, 아니면 새 규칙으로 처음부터 */
function nextPlan() {
  const first = nextMonthFirst();
  const month = first.slice(0, 7);
  const { list: classes, memberDays, blocks } = srClasses(first);
  const conf = confirmedFor(month);
  const plan = planSrSeats(getDb(), conf ? { base: conf.seats, date: first } : { fresh: true, date: first });
  const seats = planRows(plan);
  const weekly = new Map(seats.map((x) => [`${x.classId}|${x.studentId}`, x.seat]));
  const weekUses = usesFrom(classes, blocks, (c, st) => weekly.get(`${c}|${st}`) ?? null, memberDays);
  return { month, classes, blocks, conf, overflow: plan.overflow, seats, weekUses };
}

/** 📅 다음 달 자리를 고친 뒤 저장 — 확정 자리가 된다 (확정 전이었으면 이때 확정) */
function saveNext(user: SessionUser, month: string, seats: { classId: number; studentId: number; seat: string }[], text: string): void {
  const at = `${monthDay(today())} ${fmtTime(nowMin())}`;
  const list = seats.map(({ classId, studentId, seat }) => ({ classId, studentId, seat }));
  setSetting(CONFIRM_KEY, JSON.stringify({ month, at, by: who(user), seats: list } satisfies SrConfirmed));
  addLog(today(), `${who(user)} · 📅 ${Number(month.slice(5))}월 자리 · ${text}`);
}

function srPreviewSnapshot(date: string): SrSnapshot {
  const day = dayOf(date);
  const { month, classes, blocks, conf, overflow, seats, weekUses } = nextPlan();
  const now = new Map(seatRows().map((x) => [`${x.classId}|${x.studentId}`, x.seat]));
  const changed = new Set(seats.filter((x) => now.get(`${x.classId}|${x.studentId}`) !== x.seat).map((x) => x.studentId)).size;
  const dayClassIds: Record<number, number[]> = {};
  for (const x of listAllSessions()) (dayClassIds[x.dayOfWeek] ??= []).push(x.classId);
  return {
    date, day, nowMin: nowMin(), classes, blocks, dayBlocks: blocks.filter((b) => b.day === day), seats, weekUses,
    dayUses: weekUses.filter((u) => u.day === day), adhoc: [], leave: [], absent: [], missions: [], requests: [], adhocRequests: [], adhocRecent: [],
    log: [], overflow, dayClassIds, preview: { month, changed, confirmed: conf ? { at: conf.at, by: conf.by } : null },
  };
}

/** 📅 다음 달 자리 — 학생 옮기기(빈자리) · 맞바꾸기(한 명이 앉은 자리). 데스크·관리자 */
export function srNextMove(user: SessionUser, classId: number, studentId: number, seat: string): void {
  assert(can(user, "sr.move"), "자리 바꾸기는 데스크·관리자만 할 수 있어요.");
  assert(SEATS.includes(seat), "없는 자리입니다.");
  const { month, blocks, seats, weekUses } = nextPlan();
  const key = `${classId}|${studentId}`;
  const own = blocks.filter((b) => b.classId === classId);
  assert(own.length > 0, "이 반은 SR을 쓰지 않아요.");
  const mine = seats.find((x) => x.classId === classId && x.studentId === studentId);
  assert(mine, "이 학생은 다음 달 자리가 없어요.");
  assert(mine.seat !== seat, "지금 자리예요.");
  const from = mine.seat;
  if (!movableSeatsFor(weekUses, keyBlocks(weekUses, key, own), key).get(seat)) {
    mine.seat = seat;
    saveNext(user, month, seats, `${className(classId)} ${studentName(studentId)} ${from} → ${seat}`);
    return;
  }
  const chk = studentSwapCheck(weekUses, (id) => blocks.filter((b) => b.classId === id), key, seat);
  if (!chk.ok) assert(false, `${seat}(으)로 옮길 수 없어요 — ${chk.reason}`);
  const o = chk.other;
  const theirs = seats.find((x) => x.classId === o.classId && x.studentId === o.studentId);
  assert(theirs, "맞바꿀 학생을 찾을 수 없어요.");
  mine.seat = seat;
  theirs.seat = from;
  saveNext(user, month, seats, `⇄ ${className(classId)} ${studentName(studentId)} ${from} ↔ ${o.label} ${o.name} ${seat}`);
}

/** 📅 다음 달 자리 — ↔ 반 통째로 옮기기 · 맞바꾸기. 데스크·관리자 */
export function srNextMoveClass(user: SessionUser, classId: number, col: string): void {
  assert(can(user, "sr.move"), "반 옮기기는 데스크·관리자만 할 수 있어요.");
  const { month, blocks, seats, weekUses } = nextPlan();
  const { updates, text } = classMovePlan(seats, weekUses, blocks, classId, col);
  for (const u of updates) {
    const x = seats.find((y) => y.classId === u.classId && y.studentId === u.studentId);
    if (x) x.seat = u.seat;
  }
  saveNext(user, month, seats, text);
}

export function srSnapshot(date: string, opts: { preview?: boolean } = {}): SrSnapshot {
  if (opts.preview) return srPreviewSnapshot(date);
  const db = getDb();
  const day = dayOf(date);
  const { list: classes, memberDays, blocks } = srClasses();
  const seats = seatRows();
  const weekly = new Map(seats.map((s) => [`${s.classId}|${s.studentId}`, s.seat]));
  const weekUses = usesFrom(classes, blocks, (c, s) => weekly.get(`${c}|${s}`) ?? null, memberDays);

  // 그 날짜: ⇄ 하루만 바꾼 순서, 오늘만 바뀐 자리, 하원, 임시 자리
  const srRoomIds = new Set(rows<{ id: number }>(db.prepare("SELECT id FROM rooms WHERE is_sr = 1").all()).map((r) => r.id));
  // 📅 옮겨 온 수업은 주간 자리가 없다 — SR은 ＋ 임시 자리로
  const dayBlocks: SrBlock[] = listSessions(day, "ALL", date)
    .filter((s) => !s.moved && s.alphaStartMin !== null && s.alphaEndMin !== null && s.alphaRoomId !== null && srRoomIds.has(s.alphaRoomId))
    .map((s) => ({ classId: s.classId, day, start: s.alphaStartMin!, end: s.alphaEndMin! }));
  const todaySeats = new Map(
    rows<{ class_id: number; student_id: number; seat: string }>(
      db.prepare("SELECT class_id, student_id, seat FROM sr_seat_today WHERE date = ?").all(date),
    ).map((r) => [`${r.class_id}|${r.student_id}`, r.seat]),
  );
  const leave = rows<{ classId: number; studentId: number; atMin: number }>(
    db.prepare("SELECT class_id AS classId, student_id AS studentId, at_min AS atMin FROM sr_leave WHERE date = ?").all(date),
  );
  const adhoc = rows<SrAdhoc>(
    db
      .prepare(
        "SELECT id, date, name, student_id AS studentId, kind, start_min AS start, end_min AS end, seat FROM sr_adhoc WHERE date = ? ORDER BY start_min",
      )
      .all(date),
  );
  const absentList = absentOn(date);
  const absent: SrSnapshot["absent"] = [];
  for (const c of classes)
    for (const m of c.members) {
      if (m.days && !m.days.includes(day)) continue;
      const a = absentList.find((x) => x.studentId === m.id && (x.classId === null || x.classId === c.id));
      if (a) absent.push({ classId: c.id, studentId: m.id, reason: a.reason });
    }
  const isAbsent = (key: string) => absent.some((a) => `${a.classId}|${a.studentId}` === key);
  const dayUses = usesFrom(classes, dayBlocks, (c, s) => todaySeats.get(`${c}|${s}`) ?? weekly.get(`${c}|${s}`) ?? null, memberDays)
    .map((u) => {
      const l = leave.find((x) => `${x.classId}|${x.studentId}` === u.key);
      return l ? { ...u, end: Math.max(u.start, Math.min(u.end, l.atMin)) } : u;
    })
    .filter((u) => u.end > u.start && !isAbsent(u.key));
  for (const a of adhoc) {
    dayUses.push({ key: `adhoc:${a.id}`, seat: a.seat, day, start: a.start, end: a.end, name: a.name, label: a.kind, classId: null, studentId: a.studentId, adhocId: a.id });
  }

  const missions = rows<SrMission>(
    db
      .prepare(
        "SELECT class_id AS classId, state, requested_at AS requestedAt, done_by_kind AS doneByKind, done_at AS doneAt FROM sr_missions WHERE date = ?",
      )
      .all(date),
  );
  const requests = rows<SrSeatRequest>(
    db
      .prepare(
        `SELECT q.id, q.date, q.class_id AS classId, c.name AS className, q.student_id AS studentId, st.name AS studentName,
                q.from_seat AS fromSeat, q.to_seat AS toSeat, q.scope, q.reason, q.requested_by AS requestedBy, u.name AS requestedByName,
                q.at_min AS atMin, q.state, d.name AS decidedByName
           FROM sr_seat_requests q
           JOIN classes c ON c.id = q.class_id JOIN students st ON st.id = q.student_id
           LEFT JOIN users u ON u.id = q.requested_by LEFT JOIN users d ON d.id = q.decided_by
          WHERE q.state = 'WAIT' OR q.date >= ?
          ORDER BY q.id DESC LIMIT 50`,
      )
      .all(today()),
  );
  const log = rows<{ date: string; atMin: number; text: string }>(
    db.prepare("SELECT date, at_min AS atMin, text FROM sr_log ORDER BY id DESC LIMIT 40").all(),
  );
  // 자리가 모자라 못 앉은 학생
  const overflow: { classId: number; studentId: number }[] = [];
  for (const c of classes) for (const m of c.members) if (!weekly.has(`${c.id}|${m.id}`)) overflow.push({ classId: c.id, studentId: m.id });

  const dayClassIds: Record<number, number[]> = {};
  for (const s of listAllSessions()) (dayClassIds[s.dayOfWeek] ??= []).push(s.classId);
  const adhocRequests = adhocRequestsOn(today());
  const adhocRecent = rows<SrAdhocRequest>(db.prepare(`${ADHOC_REQ_SELECT} WHERE q.date >= ? ORDER BY q.id DESC LIMIT 30`).all(addDaysKey(today(), -7)));
  return { date, day, nowMin: nowMin(), classes, blocks, dayBlocks, seats, weekUses, dayUses, adhoc, leave, absent, missions, requests, adhocRequests, adhocRecent, log, overflow, dayClassIds };
}

function addLog(date: string, text: string): void {
  getDb().prepare("INSERT INTO sr_log (date, at_min, text) VALUES (?, ?, ?)").run(date, nowMin(), text);
}

const who = (u: SessionUser) => (u.roles.includes("TEACHER") ? teacherLabel(u.name) : u.name);

function studentName(id: number): string {
  return row<{ name: string }>(getDb().prepare("SELECT name FROM students WHERE id = ?").get(id))?.name ?? "학생";
}
function className(id: number): string {
  return row<{ name: string }>(getDb().prepare("SELECT name FROM classes WHERE id = ?").get(id))?.name ?? "반";
}

/** 주간 자리를 옮길 수 있는가 — 그 반이 SR을 쓰는 모든 요일·시간 동안 비어 있어야 한다 */
function assertMovable(classId: number, studentId: number, seat: string): void {
  assert(SEATS.includes(seat), "없는 자리입니다.");
  const snap = srSnapshot(today());
  const key = `${classId}|${studentId}`;
  const own = snap.blocks.filter((b) => b.classId === classId);
  assert(own.length > 0, "이 반은 SR을 쓰지 않아요.");
  const blocker = movableSeatsFor(snap.weekUses, keyBlocks(snap.weekUses, key, own), key).get(seat);
  assert(!blocker, `${seat}에 이미 ${blocker?.name ?? ""}(${blocker?.label ?? ""} ${DAY_LABELS[blocker?.day ?? 0]}) — 다른 자리로 골라 주세요.`);
}

/** ↔ 자리 바꾸기 (데스크·관리자) — 모든 요일 같은 자리로, 사람이 옮긴 자리로 남는다 */
export function srMove(user: SessionUser, classId: number, studentId: number, seat: string): void {
  assert(can(user, "sr.move"), "자리 바꾸기는 데스크·관리자만 할 수 있어요. 🙋 자리 요청을 보내 주세요.");
  const cur = row<{ seat: string }>(getDb().prepare("SELECT seat FROM sr_seats WHERE class_id = ? AND student_id = ?").get(classId, studentId));
  assertMovable(classId, studentId, seat);
  getDb()
    .prepare(
      "INSERT INTO sr_seats (class_id, student_id, seat, manual) VALUES (?, ?, ?, 1) ON CONFLICT(class_id, student_id) DO UPDATE SET seat = excluded.seat, manual = 1",
    )
    .run(classId, studentId, seat);
  addLog(today(), `${who(user)} · ${className(classId)} ${studentName(studentId)} ${cur?.seat ?? "—"} → ${seat}`);
}

/**
 * 📌 SR 일찍 오기 (데스크·관리자) — 그 요일은 start 부터 그 반 SR 끝까지 같은 자리. start = null 이면 없앰.
 * 지금 자리가 그 시간에 비어 있지 않으면 그 시간 내내 빈 자리로 옮긴다(같은 열 먼저). 빈 자리가 없으면 거절.
 * 돌려주는 값 = 옮긴 자리 (안 옮겼으면 null)
 */
export function srSetEarly(user: SessionUser, classId: number, studentId: number, day: number, start: number | null): { movedTo: string | null } {
  assert(can(user, "sr.move"), "일찍 오기는 데스크·관리자만 정할 수 있어요.");
  const db = getDb();
  const block = srClasses().blocks.find((b) => b.classId === classId && b.day === day);
  assert(block, `${DAY_LABELS[day]}요일에는 이 반 SR이 없어요.`);
  const label = `${className(classId)} ${studentName(studentId)} ${DAY_LABELS[day]}`;
  if (start === null) {
    db.prepare("DELETE FROM sr_early WHERE class_id = ? AND student_id = ? AND day = ?").run(classId, studentId, day);
    addLog(today(), `${who(user)} · 📌 일찍 오기 없앰 · ${label}`);
    return { movedTo: null };
  }
  assert(Number.isInteger(start) && start % 10 === 0 && start >= 6 * 60, "시각을 다시 골라 주세요.");
  assert(start < block.start, `SR 시작(${fmtTime(block.start)})보다 이른 시각으로 골라 주세요.`);
  return transaction(() => {
    db.prepare(
      "INSERT INTO sr_early (class_id, student_id, day, start_min) VALUES (?, ?, ?, ?) ON CONFLICT(class_id, student_id, day) DO UPDATE SET start_min = excluded.start_min",
    ).run(classId, studentId, day, start);
    const snap = srSnapshot(today());
    const key = `${classId}|${studentId}`;
    const mine = snap.seats.find((x) => x.classId === classId && x.studentId === studentId);
    const own = keyBlocks(snap.weekUses, key, snap.blocks.filter((b) => b.classId === classId));
    const movable = movableSeatsFor(snap.weekUses, own, key);
    let movedTo: string | null = null;
    if (!mine || movable.get(mine.seat)) {
      const free = SEATS.filter((x) => !movable.get(x));
      const col = mine ? seatCol(mine.seat) : "";
      const pick = free.find((x) => seatCol(x) === col) ?? free[0];
      const who2 = mine ? movable.get(mine.seat) : null;
      assert(pick, `${fmtTime(start)}부터 앉을 빈자리가 없어요${who2 ? ` — ${mine?.seat}은(는) ${who2.name}(${who2.label})이(가) 써요` : ""}.`);
      db.prepare(
        "INSERT INTO sr_seats (class_id, student_id, seat, manual) VALUES (?, ?, ?, 1) ON CONFLICT(class_id, student_id) DO UPDATE SET seat = excluded.seat, manual = 1",
      ).run(classId, studentId, pick);
      movedTo = pick;
    }
    addLog(today(), `${who(user)} · 📌 일찍 오기 · ${label} ${fmtTime(start)}부터${movedTo ? ` (${mine?.seat ?? "—"} → ${movedTo})` : ""}`);
    return { movedTo };
  });
}

/** 🙋 자리 요청 (선생님) — 데스크·관리자가 승인하면 반영 */
export function srRequest(
  user: SessionUser,
  input: { classId: number; studentId: number; seat: string; scope: "TODAY" | "ALWAYS"; reason?: string | null },
): void {
  assert(can(user, "sr.request") || can(user, "sr.move"), "자리 요청을 보낼 수 없어요.");
  assert(SEATS.includes(input.seat), "없는 자리입니다.");
  const db = getDb();
  const cur = row<{ seat: string }>(db.prepare("SELECT seat FROM sr_seats WHERE class_id = ? AND student_id = ?").get(input.classId, input.studentId));
  db.prepare(
    `INSERT INTO sr_seat_requests (date, class_id, student_id, from_seat, to_seat, scope, reason, requested_by, created_at, at_min, state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'WAIT')`,
  ).run(today(), input.classId, input.studentId, cur?.seat ?? null, input.seat, input.scope === "TODAY" ? "TODAY" : "ALWAYS", input.reason?.trim() || null, user.id, nowIso(), nowMin());
  const body = `${className(input.classId)} ${studentName(input.studentId)} ${cur?.seat ?? "—"} → ${input.seat} · ${input.scope === "TODAY" ? "오늘만" : "계속"}`;
  for (const id of new Set([...userIdsWithRole("DESK"), ...userIdsWithRole("ADMIN")])) {
    if (id !== user.id) notify(id, "SR_SEAT_REQUEST", `🙋 ${teacherLabel(user.name)} 자리 요청`, body, "/sr");
  }
}

/** 요청 승인 / 거절 — 그 사이 다른 사람이 앉았으면 승인할 수 없다 */
export function srAnswer(user: SessionUser, id: number, ok: boolean): void {
  assert(can(user, "sr.move"), "승인은 데스크·관리자만 할 수 있어요.");
  const db = getDb();
  const r = row<{ id: number; date: string; class_id: number; student_id: number; from_seat: string | null; to_seat: string; scope: string; state: string; requested_by: number | null }>(
    db.prepare("SELECT * FROM sr_seat_requests WHERE id = ?").get(id),
  );
  assert(r, "요청을 찾을 수 없습니다.");
  assert(r.state === "WAIT", "이미 처리한 요청이에요.");
  const req = rows<{ name: string }>(db.prepare("SELECT name FROM users WHERE id = ?").all(r.requested_by ?? 0))[0];
  const what = `${className(r.class_id)} ${studentName(r.student_id)} ${r.from_seat ?? "—"} → ${r.to_seat}`;
  transaction(() => {
    if (ok) {
      if (r.scope === "TODAY") {
        const snap = srSnapshot(today());
        const key = `${r.class_id}|${r.student_id}`;
        for (const b of snap.dayBlocks.filter((x) => x.classId === r.class_id)) {
          const blocker = seatBlocker(snap.dayUses, b.day, r.to_seat, b.start, b.end, key);
          assert(!blocker, `${r.to_seat}에 오늘 ${blocker?.name ?? ""} — 거절하거나 다른 자리로 옮겨 주세요.`);
        }
        db.prepare("INSERT OR REPLACE INTO sr_seat_today (date, class_id, student_id, seat) VALUES (?, ?, ?, ?)").run(today(), r.class_id, r.student_id, r.to_seat);
      } else {
        assertMovable(r.class_id, r.student_id, r.to_seat);
        db.prepare(
          "INSERT INTO sr_seats (class_id, student_id, seat, manual) VALUES (?, ?, ?, 1) ON CONFLICT(class_id, student_id) DO UPDATE SET seat = excluded.seat, manual = 1",
        ).run(r.class_id, r.student_id, r.to_seat);
      }
    }
    db.prepare("UPDATE sr_seat_requests SET state = ?, decided_by = ?, decided_at = ? WHERE id = ?").run(ok ? "OK" : "NO", user.id, nowIso(), id);
    addLog(today(), `${who(user)} ${ok ? "승인" : "거절"} · ${teacherLabel(req?.name)} 요청 · ${what}${r.scope === "TODAY" ? " (오늘만)" : ""}`);
  });
  if (r.requested_by) notify(r.requested_by, "SR_SEAT_ANSWER", ok ? "✅ 자리 요청 승인" : "❌ 자리 요청 거절", what, "/sr");
}

/** ＋ 임시 자리 — 그날 하루만, 그 시간 내내 비어 있는 자리만 */
export function srAddAdhoc(
  user: SessionUser,
  input: { date: string; name: string; kind: string; start: number; end: number; seat: string },
): void {
  assert(can(user, "sr.desk"), "임시 자리는 데스크·관리자만 잡을 수 있어요.");
  const name = input.name.trim();
  assert(name, "학생 이름을 입력해 주세요.");
  assert(input.end > input.start, "끝 시간이 시작보다 늦어야 해요.");
  assert(SEATS.includes(input.seat), "없는 자리입니다.");
  assert(input.date >= today(), "지난 날짜에는 잡을 수 없어요.");
  const snap = srSnapshot(input.date);
  const blocker = seatBlocker(snap.dayUses, snap.day, input.seat, input.start, input.end);
  assert(!blocker, `${input.seat}은(는) ${blocker?.name ?? ""}(${blocker?.label ?? ""})이(가) 써요.`);
  const sid = row<{ id: number }>(getDb().prepare("SELECT id FROM students WHERE name = ? AND active = 1 LIMIT 1").get(name))?.id ?? null;
  getDb()
    .prepare("INSERT INTO sr_adhoc (date, name, student_id, kind, start_min, end_min, seat, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(input.date, name, sid, input.kind, input.start, input.end, input.seat, user.id, nowIso());
  addLog(input.date, `${who(user)} · 📌 ${name} ${input.kind} ${input.seat}`);
}

export function srDeleteAdhoc(user: SessionUser, id: number): void {
  assert(can(user, "sr.desk"), "임시 자리는 데스크·관리자만 지울 수 있어요.");
  getDb().prepare("DELETE FROM sr_adhoc WHERE id = ?").run(id);
}

/* ------------------------------------------------------------ 🙋 SR 자리 요청 (임시 자리) */

const ADHOC_REQ_SELECT = `SELECT q.id, q.date, q.name, q.kind, q.start_min AS start, q.end_min AS end, q.memo, q.requested_by AS requestedBy,
                u.name AS requestedByName, q.at_min AS atMin, q.state, q.seat, d.name AS decidedByName
           FROM sr_adhoc_requests q LEFT JOIN users u ON u.id = q.requested_by LEFT JOIN users d ON d.id = q.decided_by`;

function adhocRequestsOn(date: string): SrAdhocRequest[] {
  return rows<SrAdhocRequest>(getDb().prepare(`${ADHOC_REQ_SELECT} WHERE q.date = ? ORDER BY q.id DESC`).all(date));
}

const adhocWhat = (r: { name: string; kind: string; start_min: number; end_min: number }) => `${r.name} ${r.kind} · ${rangeLabel(r.start_min, r.end_min)}`;

/** 🙋 SR 자리 요청 (선생님) — 학생 · 종류 · 시간만. 자리는 데스크가 정한다 (오늘만) */
export function srAdhocRequest(user: SessionUser, input: { name: string; kind: string; start: number; end: number; memo?: string | null }): void {
  assert(can(user, "sr.request"), "SR 자리 요청을 보낼 수 없어요.");
  const name = input.name?.trim();
  assert(name, "학생 이름을 입력해 주세요.");
  assert(Number.isInteger(input.start) && Number.isInteger(input.end) && input.end > input.start, "끝 시간이 시작보다 늦어야 해요.");
  assert(input.end > nowMin(), "이미 지난 시간이에요. 시간을 다시 골라 주세요.");
  const db = getDb();
  const sid = row<{ id: number }>(db.prepare("SELECT id FROM students WHERE name = ? AND active = 1 LIMIT 1").get(name))?.id ?? null;
  db.prepare(
    `INSERT INTO sr_adhoc_requests (date, name, student_id, kind, start_min, end_min, memo, requested_by, created_at, at_min, state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'WAIT')`,
  ).run(today(), name, sid, input.kind?.trim() || "보강", input.start, input.end, input.memo?.trim() || null, user.id, nowIso(), nowMin());
}

/** 요청 취소 (보낸 선생님 · 배정 전에만) */
export function srAdhocCancel(user: SessionUser, id: number): void {
  const r = row<{ requested_by: number | null; state: string }>(getDb().prepare("SELECT requested_by, state FROM sr_adhoc_requests WHERE id = ?").get(id));
  assert(r, "요청을 찾을 수 없어요.");
  assert(r.requested_by === user.id, "내가 보낸 요청만 취소할 수 있어요.");
  assert(r.state === "WAIT", "이미 처리된 요청이에요.");
  getDb().prepare("UPDATE sr_adhoc_requests SET state = 'CANCEL', decided_at = ? WHERE id = ?").run(nowIso(), id);
}

/** 배정 / 거절 (데스크 · 관리자) — 배정하면 그 자리가 오늘 임시 자리로. 결과는 선생님 알림함으로 */
export function srAdhocAnswer(user: SessionUser, id: number, ok: boolean, seat?: string | null): void {
  assert(can(user, "sr.desk"), "SR 자리 배정은 데스크·관리자만 해요.");
  const db = getDb();
  const r = row<{ id: number; date: string; name: string; student_id: number | null; kind: string; start_min: number; end_min: number; state: string; requested_by: number | null }>(
    db.prepare("SELECT * FROM sr_adhoc_requests WHERE id = ?").get(id),
  );
  assert(r, "요청을 찾을 수 없어요.");
  assert(r.state === "WAIT", r.state === "CANCEL" ? "선생님이 취소한 요청이에요." : "이미 처리된 요청이에요.");
  const req = row<{ name: string }>(db.prepare("SELECT name FROM users WHERE id = ?").get(r.requested_by ?? 0));
  transaction(() => {
    if (ok) {
      assert(seat && SEATS.includes(seat), "자리를 골라 주세요.");
      const snap = srSnapshot(r.date);
      const blocker = seatBlocker(snap.dayUses, snap.day, seat, r.start_min, r.end_min);
      assert(!blocker, `${seat}은(는) ${blocker?.name ?? ""}(${blocker?.label ?? ""} ${rangeLabel(blocker?.start ?? 0, blocker?.end ?? 0)})이(가) 써요. 다른 자리를 골라 주세요.`);
      db.prepare("INSERT INTO sr_adhoc (date, name, student_id, kind, start_min, end_min, seat, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        r.date, r.name, r.student_id, r.kind, r.start_min, r.end_min, seat, user.id, nowIso(),
      );
    }
    db.prepare("UPDATE sr_adhoc_requests SET state = ?, seat = ?, decided_by = ?, decided_at = ? WHERE id = ?").run(ok ? "OK" : "NO", ok ? seat! : null, user.id, nowIso(), id);
    addLog(r.date, `${who(user)} ${ok ? `배정 · 📌 ${r.name} ${r.kind} ${seat}` : `거절 · ${r.name} ${r.kind}`} (${teacherLabel(req?.name)} 요청)`);
  });
  if (r.requested_by)
    notify(
      r.requested_by,
      "SR_ADHOC_ANSWER",
      ok ? "✅ SR 자리 배정" : "❌ SR 자리 요청 거절",
      ok ? `${r.name} ${seat} · ${rangeLabel(r.start_min, r.end_min)} · ${r.kind}` : adhocWhat(r),
      "/sr",
    );
}

/**
 * 🗑 요청 기록 지우기 (관리자) — 베타테스트처럼 남기면 안 되는 요청을 흔적 없이 지운다.
 * 요청 + 배정된 임시 자리 + 📝 기록 줄 + 선생님 알림을 한 번에.
 */
export function srAdhocPurge(user: SessionUser, id: number): void {
  assert(can(user, "sr.purge"), "요청 기록은 관리자만 지울 수 있어요.");
  const db = getDb();
  const r = row<{ id: number; date: string; name: string; kind: string; start_min: number; end_min: number; state: string; seat: string | null; requested_by: number | null }>(
    db.prepare("SELECT * FROM sr_adhoc_requests WHERE id = ?").get(id),
  );
  assert(r, "요청을 찾을 수 없어요. 이미 지워졌을 수 있어요.");
  const req = row<{ name: string }>(db.prepare("SELECT name FROM users WHERE id = ?").get(r.requested_by ?? 0));
  const tail = `(${teacherLabel(req?.name)} 요청)`;
  // srAdhocAnswer 가 남긴 기록 줄 · 알림 문구와 똑같이 맞춰 찾는다
  const logEnds = [`배정 · 📌 ${r.name} ${r.kind} ${r.seat ?? ""} ${tail}`, `거절 · ${r.name} ${r.kind} ${tail}`];
  const bodies = [`${r.name} ${r.seat ?? ""} · ${rangeLabel(r.start_min, r.end_min)} · ${r.kind}`, adhocWhat(r)];
  transaction(() => {
    if (r.state === "OK" && r.seat)
      db.prepare(
        "DELETE FROM sr_adhoc WHERE id = (SELECT id FROM sr_adhoc WHERE date = ? AND name = ? AND kind = ? AND start_min = ? AND end_min = ? AND seat = ? ORDER BY id LIMIT 1)",
      ).run(r.date, r.name, r.kind, r.start_min, r.end_min, r.seat);
    for (const end of logEnds) db.prepare("DELETE FROM sr_log WHERE date = ? AND substr(text, -length(?)) = ?").run(r.date, end, end);
    if (r.requested_by)
      for (const body of bodies) db.prepare("DELETE FROM notifications WHERE user_id = ? AND kind = 'SR_ADHOC_ANSWER' AND body = ?").run(r.requested_by, body);
    db.prepare("DELETE FROM sr_adhoc_requests WHERE id = ?").run(id);
  });
}

/**
 * 팝업으로 받을 사람 — 오늘 근무하는 데스크. 오늘 근무하는 데스크가 없으면 관리자.
 * 받는 사람이 아니어도 데스크·관리자는 SR 관리 위쪽 줄에서 배정할 수 있다.
 */
export function adhocRequestsForPopup(user: SessionUser): SrAdhocRequest[] {
  if (!can(user, "sr.desk")) return [];
  const day = new Date().getDay();
  const deskToday = rows<{ id: number; role: string; roles: string; employment: string; work_days: string }>(
    getDb().prepare("SELECT id, role, roles, employment, work_days FROM users WHERE active = 1").all(),
  ).filter((u) => parseRoles(u.roles, u.role).includes("DESK") && (u.employment !== "PART" || parseDays(u.work_days).includes(day)));
  const mine = deskToday.length ? deskToday.some((u) => u.id === user.id) : user.roles.includes("ADMIN");
  if (!mine) return [];
  const now = nowMin();
  return adhocRequestsOn(today())
    .filter((r) => r.state === "WAIT" && r.end > now)
    .reverse();
}

/** 🏠 하원 (누적오답) — 다시 누르면 취소 */
export function srToggleLeave(user: SessionUser, classId: number, studentId: number): void {
  assert(can(user, "sr.desk"), "하원은 데스크·관리자만 처리해요.");
  const db = getDb();
  const date = today();
  const cur = row(db.prepare("SELECT 1 AS x FROM sr_leave WHERE date = ? AND class_id = ? AND student_id = ?").get(date, classId, studentId));
  if (cur) db.prepare("DELETE FROM sr_leave WHERE date = ? AND class_id = ? AND student_id = ?").run(date, classId, studentId);
  else db.prepare("INSERT INTO sr_leave (date, class_id, student_id, at_min) VALUES (?, ?, ?, ?)").run(date, classId, studentId, nowMin());
}

/* ------------------------------------------------------------------ 📄 미션지 */

/** 오늘 그 반의 SR 담당 선생님 (그 요일 수업 담당, 없으면 반 담당) */
function missionTeacher(classId: number, date: string): { id: number | null; name: string | null; start: number; end: number } {
  const s = listSessions(dayOf(date), "ALL", date).find((x) => x.classId === classId);
  const c = row<{ teacher_id: number | null; name: string | null }>(
    getDb().prepare("SELECT c.teacher_id, u.name FROM classes c LEFT JOIN users u ON u.id = c.teacher_id WHERE c.id = ?").get(classId),
  );
  return {
    id: s?.teacherId ?? c?.teacher_id ?? null,
    name: s?.teacherName ?? c?.name ?? null,
    start: s?.alphaStartMin ?? s?.startMin ?? 0,
    end: s?.alphaEndMin ?? s?.endMin ?? 0,
  };
}

/** action: RECEIVE(✅ 받음) · CANCEL(받음 취소) · REQUEST(📣 선생님께 요청) · DONE(선생님 전달완료) */
export function srMission(user: SessionUser, classId: number, action: "RECEIVE" | "CANCEL" | "REQUEST" | "DONE"): void {
  const db = getDb();
  const date = today();
  const t = missionTeacher(classId, date);
  const cname = className(classId);
  if (action === "DONE") {
    assert(t.id === user.id || user.roles.includes("ADMIN"), "담당 선생님만 전달완료를 누를 수 있어요.");
    db.prepare(
      `INSERT INTO sr_missions (date, class_id, state, done_by_kind, done_at, done_by) VALUES (?, ?, 'DONE', 'TEACHER', ?, ?)
       ON CONFLICT(date, class_id) DO UPDATE SET state = 'DONE', done_by_kind = 'TEACHER', done_at = excluded.done_at, done_by = excluded.done_by`,
    ).run(date, classId, nowMin(), user.id);
    notify(user.id, "MISSION", "미션지 요청", `${cname} · ✅ 전달완료 (${clockLabel(nowMin())})`, "/sr");
    return;
  }
  assert(can(user, "sr.desk"), "미션지는 데스크·관리자가 처리해요.");
  if (action === "CANCEL") {
    db.prepare("DELETE FROM sr_missions WHERE date = ? AND class_id = ?").run(date, classId);
    return;
  }
  if (action === "RECEIVE") {
    db.prepare(
      `INSERT INTO sr_missions (date, class_id, state, done_by_kind, done_at, done_by) VALUES (?, ?, 'DONE', 'DESK', ?, ?)
       ON CONFLICT(date, class_id) DO UPDATE SET state = 'DONE', done_by_kind = 'DESK', done_at = excluded.done_at, done_by = excluded.done_by`,
    ).run(date, classId, nowMin(), user.id);
    return;
  }
  assert(t.id, `${cname}은(는) 담당 선생님이 없어 요청할 수 없어요.`);
  const cur = row<{ state: string }>(db.prepare("SELECT state FROM sr_missions WHERE date = ? AND class_id = ?").get(date, classId));
  if (cur) return; // 이미 요청했거나 받음
  db.prepare("INSERT INTO sr_missions (date, class_id, state, requested_at, requested_by) VALUES (?, ?, 'REQUESTED', ?, ?)").run(
    date,
    classId,
    nowMin(),
    user.id,
  );
  notify(t.id, "MISSION", "미션지 요청", `${cname} 미션지 없습니다. 준비해서 SR로 가져다주세요. (${fmtTime(nowMin())})`, "/dashboard");
}

/** 📄 미션지 확인 (데스크) — 약속 장소에 있는 반은 받음, 없는 반은 담당T에게 한 번에 요청 */
export function srMissionCheck(user: SessionUser, have: number[], missing: number[]): void {
  assert(can(user, "sr.desk"), "미션지는 데스크·관리자가 처리해요.");
  assert(have.length + missing.length > 0, "확인할 반이 없어요.");
  transaction(() => {
    for (const id of have) srMission(user, id, "RECEIVE");
    for (const id of missing) srMission(user, id, "REQUEST");
  });
}

/** 선생님 화면에 띄울 미션지 요청 — 내 반 · 오늘 · 아직 전달 안 함 */
export function missionsForTeacher(user: SessionUser): MissionRequest[] {
  if (!user.roles.includes("TEACHER")) return [];
  const date = today();
  const list = rows<{ class_id: number; requested_at: number }>(
    getDb().prepare("SELECT class_id, requested_at FROM sr_missions WHERE date = ? AND state = 'REQUESTED' ORDER BY requested_at").all(date),
  );
  const out: MissionRequest[] = [];
  for (const m of list) {
    const t = missionTeacher(m.class_id, date);
    if (t.id !== user.id) continue;
    out.push({ classId: m.class_id, className: className(m.class_id), date, start: t.start, end: t.end, requestedAt: m.requested_at });
  }
  return out;
}

/* ------------------------------------------------------------------ 🧹 월초 정리 */

/** 퇴원 등으로 생긴 빈자리를 없애고, 반마다 쓰던 열 안에서 앞자리부터 다시 채운다 (사람이 옮긴 자리는 그대로) */
/**
 * 🧹 자리 정리 — PACK = 반마다 쓰던 열 안에서 앞으로 당기기 (사람이 옮긴 자리는 그대로)
 *              RESET = 처음부터 다시 앉히기 (사람이 옮긴 자리까지 초기화)
 * 매달 1일 자동: 새 규칙 달(2026-10~)부터는 RESET.
 */
export type SrPackMode = "PACK" | "RESET";

export function srPack(user: SessionUser | null, mode: SrPackMode = "PACK"): void {
  if (user) assert(can(user, "sr.pack"), "자리 정리는 관리자만 할 수 있어요.");
  // 매달 1일 자동: 📌 확정한 자리가 있으면 그 자리로 (새로 온 학생만 빈자리에)
  const conf = user ? null : confirmedFor(today().slice(0, 7));
  rebuildSrSeats(getDb(), conf ? { base: conf.seats } : mode === "RESET" ? { fresh: true } : { pack: true });
  if (conf) {
    setSetting(CONFIRM_KEY, null);
    addLog(today(), `📌 ${Number(conf.month.slice(5))}월 확정 자리로 바꿈 (매달 1일 자동 · ${conf.by} 확정)`);
  }
  setSetting("sr_packed_month", today().slice(0, 7));
  const what = mode === "RESET" ? "처음부터 다시 앉히기" : "앞으로 당기기";
  addLog(today(), user ? `${who(user)} · 🧹 자리 정리 (${what})` : `🧹 월초 자리 정리 · ${what} (매달 1일 자동)`);
}

/** 🧹 누르기 전에 — 바뀌는 학생 */
export function srPackDiff(user: SessionUser, mode: SrPackMode): { name: string; className: string; from: string | null; to: string | null }[] {
  assert(can(user, "sr.pack"), "자리 정리는 관리자만 할 수 있어요.");
  const plan = planSrSeats(getDb(), mode === "RESET" ? { fresh: true } : { pack: true });
  const now = new Map(seatRows().map((x) => [`${x.classId}|${x.studentId}`, x.seat]));
  const out: { name: string; className: string; from: string | null; to: string | null }[] = [];
  for (const x of plan.seats.values()) {
    const from = now.get(`${x.classId}|${x.studentId}`) ?? null;
    if (from !== x.seat) out.push({ name: studentName(x.studentId), className: className(x.classId), from, to: x.seat });
  }
  for (const o of plan.overflow) out.push({ name: studentName(o.studentId), className: className(o.classId), from: now.get(`${o.classId}|${o.studentId}`) ?? null, to: null });
  return out.sort((a, b) => a.className.localeCompare(b.className, "ko") || a.name.localeCompare(b.name, "ko"));
}

/**
 * ↔ 반 통째로 옮기기 (데스크·관리자) — 빈 열로 옮기거나, 그 열에 앉은 반과 맞바꾼다.
 * 주간 자리라 그 반이 SR을 쓰는 모든 요일에 적용. 앞자리 순서는 그대로.
 */
export function srMoveClass(user: SessionUser, classId: number, col: string): void {
  assert(can(user, "sr.move"), "반 옮기기는 데스크·관리자만 할 수 있어요.");
  const { list: classes, memberDays, blocks } = srClasses();
  const seats = seatRows();
  const weekly = new Map(seats.map((x) => [`${x.classId}|${x.studentId}`, x.seat]));
  const uses = usesFrom(classes, blocks, (c, st) => weekly.get(`${c}|${st}`) ?? null, memberDays);
  const { updates, text } = classMovePlan(seats, uses, blocks, classId, col);
  const set = getDb().prepare("UPDATE sr_seats SET seat = ?, manual = 1 WHERE class_id = ? AND student_id = ?");
  transaction(() => {
    for (const u of updates) set.run(u.seat, u.classId, u.studentId);
  });
  addLog(today(), `${who(user)} · ${text}`);
}

/** ↔ 반 통째로 옮기기 — 바뀌는 자리 목록 (지금 자리 · 📅 다음 달 자리 둘 다 씀) */
function classMovePlan(
  seats: { classId: number; studentId: number; seat: string }[],
  uses: SeatUse[],
  blocks: SrBlock[],
  classId: number,
  col: string,
): { updates: { classId: number; studentId: number; seat: string }[]; text: string } {
  const opt = classMoveOptions(uses, (id) => blocks.filter((b) => b.classId === id), classId).get(col);
  assert(opt, "없는 열입니다.");
  assert(opt.kind !== "self", "지금 앉은 열이에요.");
  if (opt.kind === "no") assert(false, `${col}열로 옮길 수 없어요 — ${opt.reason}`);
  const byRow = (id: number) => seats.filter((x) => x.classId === id).sort((a, b) => seatRow(a.seat) - seatRow(b.seat) || a.seat.localeCompare(b.seat));
  const mine = byRow(classId);
  const fromCol = seatCol(mine[0]?.seat ?? "A");
  const updates = mine.map((x, i) => ({ classId: x.classId, studentId: x.studentId, seat: `${col}${i + 1}` }));
  if (opt.kind === "swap")
    byRow(opt.classId)
      .slice(0, SEAT_ROWS)
      .forEach((x, i) => updates.push({ classId: x.classId, studentId: x.studentId, seat: `${fromCol}${i + 1}` }));
  return { updates, text: opt.kind === "swap" ? `⇄ ${className(classId)} ${fromCol}열 ↔ ${opt.label} ${col}열 맞바꿈` : `↔ ${className(classId)} → ${col}열` };
}

/** 매달 1일에 저절로 — 누군가 앱을 켜 두면 폴링 때 한 번 */
export function srAutoPack(): void {
  const month = today().slice(0, 7);
  const done = getSetting("sr_packed_month");
  if (done === null) {
    setSetting("sr_packed_month", month); // 처음 쓰는 달은 정리하지 않는다
    return;
  }
  if (done !== month) srPack(null, srRulesFor(month) === 2 ? "RESET" : "PACK");
}

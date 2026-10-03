// ★ 서버 전용. 📅 월간 스케줄 — 휴강일 · 보충/옮김 · 행사 · 반별 횟수 · 안내문(카톡용).
// 규칙(횟수 · 안내 글 · 막대)은 lib/schedule.ts 순수 함수. 휴강을 읽는 쪽(시간표 · 출결 · SR · 숙제)은 repo/closures.ts.

import { getDb } from "../db";
import { assert } from "../errors";
import { can } from "../perm";
import { bookShort } from "../books";
import { rangeLabel } from "../time";
import {
  DEFAULT_FIXED,
  feeOf,
  monthOf,
  sameDayIn,
  shiftMonth,
  targetOf,
  type Brand,
  type Closures,
  type ExamStart,
  type SchedCarry,
  type SchedClass,
  type SchedEvent,
  type SchedSticker,
} from "../schedule";
import type { SessionUser } from "../types";
import { getSetting, notify, nowIso, row, rows, setSetting, today, transaction, userIdsWithRole } from "./base";
import { closuresBetween, noLessonOn } from "./closures";
import { removeAbsenceForRecord } from "./absence";

const monthRange = (ym: string) => ({ from: `${ym}-01`, to: `${ym}-31` });
const isYm = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}$/.test(v);
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** 반 목록의 종류 — 휴강 고르기 패널(이 날 수업 반)에 씀 */
export type SchedAnyClass = {
  id: number;
  name: string;
  brand: Brand;
  level: "초등" | "중등" | "고등" | null;
  kind: "REG" | "IND" | "HW" | "REVIEW";
  days: number[];
};

export type ScheduleData = {
  month: string;
  today: string;
  /** 횟수 · 안내문 대상 반 (정규 수업이 있는 반) */
  classes: SchedClass[];
  /** 모든 반 (휴강 고르기) */
  allClasses: SchedAnyClass[];
  /** 지난달 ~ 다음 달 휴강 · 옮김 */
  closures: Closures;
  carries: SchedCarry[];
  /** 이 달에 걸친 행사 (두 학원 모두) + 지난달 행사 수 (복사 버튼) */
  events: SchedEvent[];
  prevEventCount: Record<Brand, number>;
  stickers: SchedSticker[];
  posters: { brand: Brand; pkey: string; note: string | null; html: string | null }[];
  fixed: Record<Brand, string>;
  exams: ExamStart[];
};

type SessRow = { class_id: number; day_of_week: number; type: string; start_min: number; end_min: number; alpha_start_min: number | null; alpha_end_min: number | null; id: number };

function classLists(): { classes: SchedClass[]; all: SchedAnyClass[] } {
  const db = getDb();
  const cls = rows<{ id: number; name: string; department: string; grade: string | null; textbook: string | null }>(
    db.prepare("SELECT id, name, department, grade, textbook FROM classes ORDER BY name").all(),
  );
  const sess = rows<SessRow>(
    db.prepare("SELECT id, class_id, day_of_week, type, start_min, end_min, alpha_start_min, alpha_end_min FROM timetable_sessions ORDER BY day_of_week, start_min").all(),
  );
  const books = rows<{ session_id: number; level: string; grade: string; name: string }>(
    db.prepare("SELECT sb.session_id, b.level, b.grade, b.name FROM session_books sb JOIN books b ON b.id = sb.book_id ORDER BY b.id").all(),
  );
  const members = new Map<number, Set<number>>();
  for (const m of rows<{ class_id: number; student_id: number }>(
    db.prepare("SELECT sc.class_id, sc.student_id FROM student_classes sc JOIN students s ON s.id = sc.student_id WHERE s.active = 1").all(),
  )) {
    members.set(m.class_id, (members.get(m.class_id) ?? new Set()).add(m.student_id));
  }
  const levelOf = (dept: string, grade: string | null): SchedAnyClass["level"] =>
    dept === "HIGH" ? "고등" : grade?.startsWith("초") ? "초등" : grade?.startsWith("중") ? "중등" : grade?.startsWith("고") ? "고등" : null;
  const all: SchedAnyClass[] = [];
  const out: SchedClass[] = [];
  const reviews = cls.filter((c) => sess.some((s) => s.class_id === c.id && s.type === "REVIEW"));
  for (const c of cls) {
    const ss = sess.filter((s) => s.class_id === c.id);
    if (!ss.length) continue;
    const brand: Brand = c.department === "HIGH" ? "S" : "U";
    const t = ss[0].type;
    const kind: SchedAnyClass["kind"] = t === "INDIVIDUAL" ? "IND" : t === "HOMEWORK" ? "HW" : t === "REVIEW" ? "REVIEW" : "REG";
    const days = [...new Set(ss.map((s) => s.day_of_week))].sort();
    all.push({ id: c.id, name: c.name, brand, level: levelOf(c.department, c.grade), kind, days });
    if (kind !== "REG") continue;
    const target = targetOf(brand, c.grade, c.name);
    // 고등 누적오답 — 이 반 학생들이 다니는 누적오답 반 요일
    const mine = members.get(c.id) ?? new Set<number>();
    const freeDays =
      brand === "S"
        ? reviews
            .filter((r) => [...(members.get(r.id) ?? [])].some((s) => mine.has(s)))
            .flatMap((r) => sess.filter((s) => s.class_id === r.id).map((s) => ({ day: s.day_of_week, label: "누적 오답" })))
            .filter((f, i, a) => a.findIndex((x) => x.day === f.day) === i && !days.includes(f.day))
        : [];
    const first = ss[0];
    const startMin = Math.min(first.start_min, first.alpha_start_min ?? first.start_min);
    const endMin = Math.max(first.end_min, first.alpha_end_min ?? first.end_min);
    const bk = books.filter((b) => ss.some((s) => s.id === b.session_id)).map(bookShort);
    out.push({
      id: c.id,
      name: c.name,
      brand,
      grade: c.grade,
      regDays: days,
      indDays: brand === "U" && target === 12 ? [5, 6] : [],
      freeDays,
      target,
      fee: brand === "S" ? feeOf(c.grade, c.name) : null,
      label: /기하/.test(`${c.grade} ${c.name}`) ? "선택 수업" : "정규 수업",
      time: rangeLabel(startMin, endMin),
      book: [...new Set(bk)].join(" · ") || c.textbook || "",
    });
  }
  return { classes: out, all };
}

const EVENT_SELECT = `SELECT id, brand, title, start_date AS start, end_date AS "end", color, emoji, dy, ex, ey, es, class_id AS classId,
                             in_note AS inNote, order_no AS orderNo FROM sched_events`;
const eventRows = (sql: string, ...args: (string | number)[]) =>
  rows<Omit<SchedEvent, "inNote"> & { inNote: number }>(getDb().prepare(`${EVENT_SELECT} ${sql}`).all(...args)).map((e): SchedEvent => ({ ...e, inNote: e.inNote === 1 }));

export function scheduleData(month: string): ScheduleData {
  assert(isYm(month), "달을 확인해 주세요.");
  const db = getDb();
  const { classes, all } = classLists();
  const { from, to } = monthRange(month);
  const wide = { from: `${shiftMonth(month, -1)}-01`, to: `${shiftMonth(month, 1)}-31` };
  const prev = monthRange(shiftMonth(month, -1));
  const prevEvents = eventRows("WHERE start_date BETWEEN ? AND ?", prev.from, prev.to);
  const fixed = { U: getSetting("sched_fixed_U") ?? DEFAULT_FIXED.U, S: getSetting("sched_fixed_S") ?? DEFAULT_FIXED.S };
  return {
    month,
    today: today(),
    classes,
    allClasses: all,
    closures: closuresBetween(wide.from, wide.to),
    carries: rows(db.prepare("SELECT class_id AS classId, month, delta FROM sched_carry WHERE month BETWEEN ? AND ?").all(shiftMonth(month, -1), month)),
    events: eventRows("WHERE start_date <= ? AND end_date >= ? ORDER BY order_no, start_date, id", to, from),
    prevEventCount: { U: prevEvents.filter((e) => e.brand === "U").length, S: prevEvents.filter((e) => e.brand === "S").length },
    stickers: rows(db.prepare("SELECT id, brand, month, emoji, x, y, size FROM sched_stickers WHERE month = ? ORDER BY id").all(month)),
    posters: rows(db.prepare("SELECT brand, pkey, note, html FROM sched_posters WHERE month = ?").all(month)),
    fixed,
    exams: rows<ExamStart>(
      db
        .prepare(
          `SELECT e.start_date AS date, s.name AS school, s.level FROM school_events e JOIN schools s ON s.id = e.school_id
            WHERE (e.kind LIKE '%중간%' OR e.kind LIKE '%기말%') AND e.start_date BETWEEN ? AND ? ORDER BY e.start_date, s.order_no, s.name`,
        )
        .all(from, to),
    ),
  };
}

const writer = (user: SessionUser) => assert(can(user, "schedule.write"), "월간 스케줄은 관리자 · 데스크가 정해요.");

/* ---------------------------------------------------------------- 휴강 */

/**
 * 휴강이 된 날 — 이미 열린(끝나지 않은) 출결을 닫고, 그 날 그 반에 미리 등록된 결석(보강 전)을 지운다.
 * (그 날 수업이 없으니 출결 · 보강도 없다)
 */
function clearClosed(date: string): void {
  const db = getDb();
  const off = noLessonOn(date);
  const closed = (classId: number | null) => classId !== null && (off.all || off.ids.has(classId));
  const events = rows<{ id: number; class_id: number }>(
    db.prepare("SELECT e.id, s.class_id FROM attendance_events e JOIN timetable_sessions s ON s.id = e.session_id WHERE e.date = ? AND e.stage <> 'DONE'").all(date),
  );
  for (const e of events.filter((x) => closed(x.class_id))) {
    for (const r of rows<{ id: number }>(db.prepare("SELECT id FROM attendance_records WHERE event_id = ?").all(e.id))) removeAbsenceForRecord(r.id);
    db.prepare("DELETE FROM attendance_events WHERE id = ?").run(e.id);
  }
  const pre = rows<{ id: number; class_id: number | null }>(
    db
      .prepare(
        `SELECT a.id, a.class_id FROM absences a WHERE a.date = ? AND a.record_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM absence_rounds r WHERE r.absence_id = a.id)`,
      )
      .all(date),
  );
  for (const a of pre.filter((x) => closed(x.class_id))) db.prepare("DELETE FROM absences WHERE id = ?").run(a.id);
}

/** 그 날 전체 — 전체 휴강 · 정상수업(공휴일) · 이름 */
export function setSchedDay(user: SessionUser, date: string, input: { off: boolean; open: boolean; memo: string | null }): void {
  writer(user);
  assert(isDate(date), "날짜를 확인해 주세요.");
  const memo = input.memo?.trim() || null;
  transaction(() => {
    if (!input.off && !input.open && !memo) getDb().prepare("DELETE FROM sched_days WHERE date = ?").run(date);
    else
      getDb()
        .prepare(
          `INSERT INTO sched_days (date, off, open, memo, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(date) DO UPDATE SET off = excluded.off, open = excluded.open, memo = excluded.memo, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        )
        .run(date, input.off ? 1 : 0, input.open && !input.off ? 1 : 0, memo, user.name, nowIso());
    clearClosed(date);
  });
}

/** 그 날 반만 휴강 — 고른 반 목록으로 통째로 바꾼다 */
export function setClassOff(user: SessionUser, date: string, classIds: number[], memo: string | null): void {
  writer(user);
  assert(isDate(date), "날짜를 확인해 주세요.");
  const db = getDb();
  transaction(() => {
    db.prepare("DELETE FROM sched_class_off WHERE date = ?").run(date);
    const ins = db.prepare("INSERT OR IGNORE INTO sched_class_off (date, class_id, memo) VALUES (?, ?, ?)");
    for (const id of new Set(classIds)) ins.run(date, id, memo?.trim() || null);
    clearClosed(date);
  });
}

/* ---------------------------------------------------------------- 보충 · 옮김 · 다음 달로 넘김 */

export function addMove(
  user: SessionUser,
  input: { classIds: number[]; kind: "MOVE" | "EXTRA"; fromDate: string | null; toDate: string; countMonth: string | null },
): void {
  writer(user);
  assert(input.classIds.length > 0, "반을 골라 주세요.");
  assert(isDate(input.toDate), "수업할 날짜를 골라 주세요.");
  if (input.kind === "MOVE") {
    assert(isDate(input.fromDate), "원래 수업 날짜를 골라 주세요.");
    assert(input.fromDate !== input.toDate, "원래 날짜와 옮길 날짜가 같아요.");
  }
  const countMonth = input.kind === "MOVE" ? monthOf(input.fromDate!) : input.countMonth;
  assert(isYm(countMonth), "몇 월 횟수인지 골라 주세요.");
  const db = getDb();
  transaction(() => {
    const ins = db.prepare("INSERT INTO sched_moves (class_id, kind, from_date, to_date, count_month, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const id of new Set(input.classIds)) {
      if (input.kind === "MOVE") {
        const dup = row(db.prepare("SELECT 1 AS x FROM sched_moves WHERE kind = 'MOVE' AND class_id = ? AND from_date = ?").get(id, input.fromDate));
        assert(!dup, "그 날 수업은 이미 다른 날로 옮겼어요.");
      }
      ins.run(id, input.kind, input.kind === "MOVE" ? input.fromDate : null, input.toDate, countMonth, user.name, nowIso());
    }
    if (input.fromDate) clearClosed(input.fromDate);
  });
}

export function deleteMove(user: SessionUser, id: number): void {
  writer(user);
  getDb().prepare("DELETE FROM sched_moves WHERE id = ?").run(id);
}

export function setCarry(user: SessionUser, classId: number, month: string, delta: number): void {
  writer(user);
  assert(isYm(month), "달을 확인해 주세요.");
  if (!delta) getDb().prepare("DELETE FROM sched_carry WHERE class_id = ? AND month = ?").run(classId, month);
  else
    getDb()
      .prepare("INSERT INTO sched_carry (class_id, month, delta) VALUES (?, ?, ?) ON CONFLICT(class_id, month) DO UPDATE SET delta = excluded.delta")
      .run(classId, month, Math.trunc(delta));
}

/* ---------------------------------------------------------------- 행사 */

export type EventInput = Omit<SchedEvent, "id" | "orderNo"> & { id?: number | null };

export function saveEvent(user: SessionUser, input: EventInput): number {
  writer(user);
  const title = input.title.trim();
  assert(title, "행사 이름을 입력해 주세요.");
  assert(isDate(input.start) && isDate(input.end), "날짜를 골라 주세요.");
  assert(input.start <= input.end, "끝 날짜가 시작 날짜보다 빨라요.");
  assert(input.brand === "U" || input.brand === "S", "학원을 골라 주세요.");
  const db = getDb();
  const vals = [
    input.brand,
    title,
    input.start,
    input.end,
    input.color || "#fde68a",
    input.emoji || null,
    Math.round(input.dy || 0),
    Math.round(input.ex || 0),
    Math.round(input.ey || 0),
    Math.max(12, Math.min(90, Math.round(input.es || 30))),
    input.classId ?? null,
    input.inNote ? 1 : 0,
  ];
  if (input.id) {
    db.prepare(
      `UPDATE sched_events SET brand = ?, title = ?, start_date = ?, end_date = ?, color = ?, emoji = ?, dy = ?, ex = ?, ey = ?, es = ?, class_id = ?, in_note = ?
        WHERE id = ?`,
    ).run(...vals, input.id);
    return input.id;
  }
  const order = row<{ n: number }>(db.prepare("SELECT COALESCE(MAX(order_no), 0) + 1 AS n FROM sched_events").get())?.n ?? 1;
  return Number(
    db
      .prepare(
        `INSERT INTO sched_events (brand, title, start_date, end_date, color, emoji, dy, ex, ey, es, class_id, in_note, order_no)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(...vals, order).lastInsertRowid,
  );
}

export function deleteEvent(user: SessionUser, id: number): void {
  writer(user);
  getDb().prepare("DELETE FROM sched_events WHERE id = ?").run(id);
}

/** 📋 지난달 행사 복사 — 지난달에 시작한 행사를 같은 날짜(일)로 이 달에. 이미 같은 이름 · 날짜가 있으면 건너뜀 */
export function copyPrevEvents(user: SessionUser, brand: Brand, month: string): number {
  writer(user);
  assert(isYm(month), "달을 확인해 주세요.");
  const prev = monthRange(shiftMonth(month, -1));
  const list = eventRows("WHERE brand = ? AND start_date BETWEEN ? AND ? ORDER BY order_no, id", brand, prev.from, prev.to);
  let n = 0;
  transaction(() => {
    for (const e of list) {
      const start = sameDayIn(e.start, month);
      const end = sameDayIn(e.end, shiftMonth(monthOf(e.end), 1));
      const dup = row(getDb().prepare("SELECT 1 AS x FROM sched_events WHERE brand = ? AND title = ? AND start_date = ?").get(brand, e.title, start));
      if (dup) continue;
      saveEvent(user, { ...e, id: null, start, end: end < start ? start : end });
      n += 1;
    }
  });
  return n;
}

/* ---------------------------------------------------------------- 안내문 */

export function addSticker(user: SessionUser, input: { brand: Brand; month: string; emoji: string; x: number; y: number; size: number }): number {
  writer(user);
  assert(input.emoji.trim(), "이모지를 골라 주세요.");
  assert(isYm(input.month), "달을 확인해 주세요.");
  return Number(
    getDb()
      .prepare("INSERT INTO sched_stickers (brand, month, emoji, x, y, size) VALUES (?, ?, ?, ?, ?, ?)")
      .run(input.brand, input.month, input.emoji.trim().slice(0, 16), Math.round(input.x), Math.round(input.y), Math.round(input.size)).lastInsertRowid,
  );
}

export function saveSticker(user: SessionUser, id: number, input: { x: number; y: number; size: number }): void {
  writer(user);
  getDb()
    .prepare("UPDATE sched_stickers SET x = ?, y = ?, size = ? WHERE id = ?")
    .run(Math.round(input.x), Math.round(input.y), Math.max(12, Math.min(90, Math.round(input.size))), id);
}

export function deleteSticker(user: SessionUser, id: number): void {
  writer(user);
  getDb().prepare("DELETE FROM sched_stickers WHERE id = ?").run(id);
}

/** 안내문 한 장 — note(「이 달 안내」) · html(✏️ 직접 고친 그림). undefined = 그대로, null = 자동으로 되돌림 */
export function savePoster(user: SessionUser, input: { brand: Brand; month: string; pkey: string; note?: string | null; html?: string | null }): void {
  writer(user);
  assert(isYm(input.month) && input.pkey, "안내문을 찾을 수 없어요.");
  const db = getDb();
  const cur = row<{ note: string | null; html: string | null }>(
    db.prepare("SELECT note, html FROM sched_posters WHERE brand = ? AND month = ? AND pkey = ?").get(input.brand, input.month, input.pkey),
  );
  const note = input.note === undefined ? (cur?.note ?? null) : input.note;
  const html = input.html === undefined ? (cur?.html ?? null) : input.html;
  assert(!html || html.length < 1_500_000, "안내문 그림이 너무 커요.");
  if (note === null && html === null) {
    db.prepare("DELETE FROM sched_posters WHERE brand = ? AND month = ? AND pkey = ?").run(input.brand, input.month, input.pkey);
    return;
  }
  db.prepare(
    `INSERT INTO sched_posters (brand, month, pkey, note, html, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(brand, month, pkey) DO UPDATE SET note = excluded.note, html = excluded.html, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).run(input.brand, input.month, input.pkey, note, html, user.name, nowIso());
}

/** 매달 같은 아래 글 (유투엠 보강 안내 · 스킬 학원 스케줄 안내) */
export function setFixedText(user: SessionUser, brand: Brand, text: string | null): void {
  writer(user);
  setSetting(`sched_fixed_${brand}`, text?.trim() ? text : null);
}

/* ---------------------------------------------------------------- 알림 · 대시보드 */

/** 매달 15일(그 뒤 처음 앱을 켰을 때) 한 번 — 관리자 · 데스크에게 「다음 달 스케줄 정해주세요」 */
export function remindSchedule(): void {
  const t = today();
  const ym = monthOf(t);
  if (Number(t.slice(8)) < 15 || getSetting("sched_remind") === ym) return;
  setSetting("sched_remind", ym);
  const next = shiftMonth(ym, 1);
  const ids = new Set([...userIdsWithRole("ADMIN"), ...userIdsWithRole("DESK")]);
  for (const id of ids) {
    notify(id, "SCHEDULE", "📅 다음 달 스케줄 정해주세요", `${Number(next.slice(5))}월 휴강일 · 행사 · 횟수 → 20일쯤 카톡 안내문`, `/timetable?view=schedule&month=${next}`);
  }
}

/** 오늘 휴강 — 대시보드 띠 */
export function closureToday(date: string): { all: boolean; name: string | null; classes: string[] } | null {
  const db = getDb();
  const day = row<{ off: number; memo: string | null }>(db.prepare("SELECT off, memo FROM sched_days WHERE date = ?").get(date));
  if (day?.off === 1) return { all: true, name: day.memo, classes: [] };
  const names = rows<{ name: string }>(
    db
      .prepare(
        `SELECT c.name FROM classes c WHERE c.id IN (SELECT class_id FROM sched_class_off WHERE date = ?)
            OR c.id IN (SELECT class_id FROM sched_moves WHERE kind = 'MOVE' AND from_date = ?) ORDER BY c.name`,
      )
      .all(date, date),
  ).map((r) => r.name);
  return names.length ? { all: false, name: null, classes: names } : null;
}

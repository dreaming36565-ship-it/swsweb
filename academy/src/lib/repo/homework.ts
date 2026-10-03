// ★ 서버 전용. 숙제검사 · 숙제반(강제 · 신청 · 지각 3회).
// 규칙 계산(카운트 · 강제 숙제반 · 졸업 · 인증 문제)은 lib/homework.ts 순수 함수 — 화면도 같은 함수를 쓴다.

import { getDb } from "../db";
import { AppError, assert } from "../errors";
import { can } from "../perm";
import { checkDatesOf, closuresOf, forcedPlans, homeworkSlots, homeworkStudents, hwExempts, hwSkip, hwStartsOf, marksOf, type HwStudent } from "../seed";
import { addDays, certUnchecked, clashOn, isMark, md, parseApplyText, quarterOf, timeline, type HwPlan, type HwSlot, type Mark } from "../homework";
import { SEATS, seatBlocker } from "../sr";
import { monthDayWeek, rangeLabel } from "../time";
import type { SessionUser } from "../types";
import type { Closures } from "../schedule";
import { getSetting, notify, nowIso, row, rows, setSetting, today, transaction, userIdsWithRole } from "./base";
import { latesSince } from "./attendance";
import { refreshSr } from "./timetable";
import { srSnapshot } from "./sr";

export type HomeworkData = {
  today: string;
  /** exempt = 강제 숙제반 면제 사유 (면제가 아니면 null) */
  students: (HwStudent & { teacherName: string | null; textbook: string | null; exempt: string | null })[];
  /** 정규반 (숙제검사 표 묶음) */
  classes: { id: number; name: string; group: "월수" | "화목"; grade: string | null; textbook: string | null; teacherId: number | null; teacherName: string | null }[];
  marks: { studentId: number; date: string; mark: Mark }[];
  cert: { studentId: number; date: string; state: "OK" | "MISS" }[];
  plans: { studentId: number; day: number; how: "ATTEND" | "CERT"; slotId: number | null }[];
  /** 신청 — 요일마다 1부 · 2부 중 하나 */
  apply: { studentId: number; slotId: number; month: string; day: number }[];
  late: { id: number; studentId: number; lates: string[]; date: string | null; slotId: number | null; done: boolean }[];
  seen: { studentId: number; start: string }[];
  /** 강제 숙제반 시작일을 바꾼 것 (카운트 2가 된 날 → 시작일) */
  starts: { studentId: number; trigger: string; start: string }[];
  slots: HwSlot[];
  formUrl: string | null;
  /** 📅 휴강 · 옮김 (숙제검사 칸 · 카운트 · 인증에서 뺀다) */
  closures: Closures;
};

/** 지각 3회 → 숙제반 1회 — 분기 안 지각을 세어 3회가 모일 때마다 한 건씩 (이미 쓴 지각은 빼고) */
function syncLates(): void {
  const db = getDb();
  const q = quarterOf(today());
  const used = new Set<string>();
  for (const l of rows<{ student_id: number; lates: string }>(db.prepare("SELECT student_id, lates FROM hw_late").all())) {
    for (const d of l.lates.split(",")) used.add(`${l.student_id}|${d}`);
  }
  const ins = db.prepare("INSERT INTO hw_late (student_id, lates, date, slot_class_id, done, created_at) VALUES (?, ?, NULL, NULL, 0, ?)");
  for (const [sid, dates] of latesSince(q.start, today())) {
    const fresh = dates.filter((d) => !used.has(`${sid}|${d}`));
    for (let i = 0; i + 3 <= fresh.length; i += 3) ins.run(sid, fresh.slice(i, i + 3).join(","), nowIso());
  }
}

export function homeworkData(): HomeworkData {
  syncLates();
  const db = getDb();
  const all = homeworkStudents(db);
  const classInfo = rows<{ id: number; name: string; grade: string | null; textbook: string | null; teacher_id: number | null; teacher_name: string | null }>(
    db.prepare("SELECT c.id, c.name, c.grade, c.textbook, c.teacher_id, u.name AS teacher_name FROM classes c LEFT JOIN users u ON u.id = c.teacher_id").all(),
  );
  const regularIds = new Map<number, "월수" | "화목">();
  for (const s of all) if (s.regular) regularIds.set(s.regular.id, s.regular.days.join(",") === "1,3" ? "월수" : "화목");
  const classes = [...regularIds].map(([id, group]) => {
    const c = classInfo.find((x) => x.id === id)!;
    return { id, name: c.name, group, grade: c.grade, textbook: c.textbook, teacherId: c.teacher_id, teacherName: c.teacher_name };
  });
  const exempt = hwExempts(db);
  return {
    today: today(),
    students: all.map((s) => {
      const c = s.regular ? classInfo.find((x) => x.id === s.regular!.id) : null;
      return { ...s, teacherName: c?.teacher_name ?? null, textbook: c?.textbook ?? null, exempt: exempt.get(s.id) ?? null };
    }),
    classes,
    marks: rows<{ studentId: number; date: string; mark: string }>(db.prepare("SELECT student_id AS studentId, date, mark FROM hw_marks").all()).filter(
      (m): m is { studentId: number; date: string; mark: Mark } => isMark(m.mark),
    ),
    cert: rows(db.prepare("SELECT student_id AS studentId, date, state FROM hw_cert").all()),
    plans: rows(db.prepare("SELECT student_id AS studentId, day, how, slot_class_id AS slotId FROM hw_plan").all()),
    apply: rows(db.prepare("SELECT student_id AS studentId, slot_class_id AS slotId, month, day FROM hw_apply ORDER BY day").all()),
    late: rows<{ id: number; studentId: number; lates: string; date: string | null; slotId: number | null; done: number }>(
      db.prepare("SELECT id, student_id AS studentId, lates, date, slot_class_id AS slotId, done FROM hw_late ORDER BY id").all(),
    ).map((l) => ({ ...l, lates: l.lates.split(",").filter(Boolean), done: l.done === 1 })),
    seen: rows(db.prepare("SELECT student_id AS studentId, start FROM hw_seen").all()),
    starts: rows(db.prepare("SELECT student_id AS studentId, trigger_date AS trigger, start_date AS start FROM hw_start").all()),
    slots: homeworkSlots(db),
    formUrl: getSetting("hw_form_csv_url"),
    closures: closuresOf(db, addDays(today(), -200), addDays(today(), 70)),
  };
}

function studentOf(id: number): HwStudent {
  const st = homeworkStudents(getDb()).find((s) => s.id === id);
  assert(st, "학생을 찾을 수 없습니다.");
  return st;
}

/** 숙제검사 기입 — 선생님은 내가 가르치는 학생(정규반 담임 · 개별반 · 수업 칸 담당)만. 앞날은 안 된다 */
export function setMark(user: SessionUser, studentId: number, date: string, mark: string | null): { started: boolean; graduated: boolean } {
  assert(can(user, "homework.check"), "숙제검사를 기입할 권한이 없어요.");
  assert(date <= today(), "아직 오지 않은 날은 기입할 수 없어요.");
  assert(mark === null || mark === "" || isMark(mark), "없는 표시예요.");
  const db = getDb();
  const st = studentOf(studentId);
  if (!user.roles.includes("ADMIN") && !user.roles.includes("DESK")) {
    assert(st.teacherIds.includes(user.id), "선생님은 내가 가르치는 학생만 기입할 수 있어요.");
  }
  const q = quarterOf(today());
  const starts = hwStartsOf(db).get(studentId);
  const skip = hwSkip(db, st, q.start, today());
  const before = timeline(marksOf(db).get(studentId) ?? new Map(), checkDatesOf(st, q.start, today(), db), q.start, today(), starts, skip);
  if (mark) db.prepare("INSERT OR REPLACE INTO hw_marks (student_id, date, mark) VALUES (?, ?, ?)").run(studentId, date, mark);
  else db.prepare("DELETE FROM hw_marks WHERE student_id = ? AND date = ?").run(studentId, date);
  const after = timeline(marksOf(db).get(studentId) ?? new Map(), checkDatesOf(st, q.start, today(), db), q.start, today(), starts, skip);
  const started = !before.cur && !!after.cur;
  const graduated = !!before.cur && !after.cur && !!after.cycles.at(-1)?.gradAt;
  if (started || graduated) refreshSr();
  // 강제 숙제반 면제 학생은 명단에만 「면제」로 — 알림 없음
  if (started && !hwExempts(db).has(studentId)) {
    // 담당T 알림 (정규반 담당) + 숙제반 관리하는 데스크
    const targets = new Set<number>([...(st.regular?.teacherId ? [st.regular.teacherId] : []), ...userIdsWithRole("DESK")]);
    for (const id of targets) {
      notify(id, "HOMEWORK_FORCED", "⚠ 강제 숙제반 자동 등록", `${st.name}(${st.regular?.name ?? ""}) 카운트 ${after.count} — ${monthDayWeek(date)}부터 숙제반`, "/homework?view=class");
    }
  }
  return { started, graduated };
}

/** 📷 숙제인증 확인 — 담당T(내가 가르치는 학생) · 관리자 · 데스크 */
export function setCert(user: SessionUser, studentId: number, date: string, state: "OK" | "MISS" | null): void {
  assert(can(user, "homework.cert"), "숙제인증을 확인할 권한이 없어요.");
  assert(date <= today(), "아직 오지 않은 날은 기록할 수 없어요.");
  if (!user.roles.includes("ADMIN") && !user.roles.includes("DESK")) {
    assert(studentOf(studentId).teacherIds.includes(user.id), "선생님은 내가 가르치는 학생만 확인할 수 있어요.");
  }
  if (state) getDb().prepare("INSERT OR REPLACE INTO hw_cert (student_id, date, state) VALUES (?, ?, ?)").run(studentId, date, state);
  else getDb().prepare("DELETE FROM hw_cert WHERE student_id = ? AND date = ?").run(studentId, date);
}

/** 요일별 방법 저장 — 참석 요일은 SR 자리도 함께 */
export function savePlan(user: SessionUser, studentId: number, plan: HwPlan): void {
  assert(can(user, "homework.class"), "숙제반 관리 권한이 없어요.");
  const st = studentOf(studentId);
  const slots = homeworkSlots(getDb());
  const db = getDb();
  transaction(() => {
    db.prepare("DELETE FROM hw_plan WHERE student_id = ?").run(studentId);
    const ins = db.prepare("INSERT INTO hw_plan (student_id, day, how, slot_class_id) VALUES (?, ?, ?, ?)");
    for (const [d, p] of Object.entries(plan)) {
      if (!p) continue;
      if (p.how === "ATTEND") {
        const slot = slots.find((s) => s.id === p.slotId);
        assert(slot && slot.days.includes(Number(d)), "그 요일에 없는 숙제반이에요.");
        const clash = (st.busy[Number(d)] ?? []).some(([a, b]) => a < slot.end && slot.start < b);
        assert(!clash, `${"일월화수목금토"[Number(d)]}요일 숙제반이 수업·SR과 겹쳐요.`);
        ins.run(studentId, Number(d), "ATTEND", slot.id);
      } else ins.run(studentId, Number(d), "CERT", null);
    }
  });
  refreshSr();
}

/** 🚫 강제 숙제반 면제 (예: 어머니 요청) — 카운트는 그대로 세고, 강제 숙제반이 되어도 인증 · 참석 · SR 자리 · 알림 없음 */
export function setExempt(user: SessionUser, studentId: number, on: boolean, note: string | null): void {
  assert(can(user, "homework.class"), "숙제반 관리 권한이 없어요.");
  const st = studentOf(studentId);
  const memo = note?.trim() || null;
  if (on) assert(memo, "면제 사유를 적어 주세요. (예: 어머니 요청)");
  getDb().prepare("UPDATE students SET hw_exempt = ?, hw_exempt_note = ? WHERE id = ?").run(on ? 1 : 0, on ? memo : null, st.id);
  refreshSr();
}

/**
 * 강제 숙제반 시작일 바꾸기 — 기본은 카운트 2가 된 당일. 그 뒤 날짜로만 미룰 수 있다(같은 분기 안).
 * start = null 이면 원래대로(당일). 졸업은 시작일 다음 SR 검사부터 센다(이미 졸업했어도 다시 계산).
 */
export function setForcedStart(user: SessionUser, studentId: number, trigger: string, start: string | null): void {
  assert(can(user, "homework.class"), "숙제반 관리 권한이 없어요.");
  const st = studentOf(studentId);
  const db = getDb();
  const q = quarterOf(trigger);
  const tl = timeline(marksOf(db).get(st.id) ?? new Map(), checkDatesOf(st, q.start, today(), db), q.start, today(), hwStartsOf(db).get(st.id), hwSkip(db, st, q.start, today()));
  const c = tl.cycles.find((x) => x.trigger === trigger);
  assert(c, "그 강제 숙제반을 찾을 수 없어요. 화면을 새로고침해 주세요.");
  // 이미 시작했거나 졸업한 것도 바꿀 수 있다 — 졸업(4번 연속)은 새 시작일 기준으로 다시 센다
  if (!start || start === trigger) {
    db.prepare("DELETE FROM hw_start WHERE student_id = ? AND trigger_date = ?").run(st.id, trigger);
  } else {
    assert(/^\d{4}-\d{2}-\d{2}$/.test(start), "날짜를 골라 주세요.");
    assert(start > trigger, `시작일은 카운트 2가 된 날(${md(trigger)}) 뒤로만 바꿀 수 있어요.`);
    assert(start <= q.end, `시작일은 이번 분기(~${md(q.end)}) 안에서 골라 주세요.`);
    assert(start <= addDays(trigger, 31), "시작일은 카운트 2가 된 날부터 한 달 안에서 골라 주세요.");
    db.prepare("INSERT OR REPLACE INTO hw_start (student_id, trigger_date, start_date) VALUES (?, ?, ?)").run(st.id, trigger, start);
  }
  refreshSr();
}

export function markSeen(studentId: number, start: string): void {
  getDb().prepare("INSERT OR IGNORE INTO hw_seen (student_id, start) VALUES (?, ?)").run(studentId, start);
}

/** 한 달 신청 저장 — 요일마다 1부 · 2부 중 하나 (그 달 그 학생의 신청을 통째로 바꾼다) */
export function saveApply(user: SessionUser, studentId: number, month: string, picks: { day: number; slotId: number }[]): void {
  assert(can(user, "homework.class"), "숙제반 관리 권한이 없어요.");
  assert(/^\d{4}-\d{2}$/.test(month), "달을 골라 주세요.");
  const st = studentOf(studentId);
  const slots = homeworkSlots(getDb());
  assert(new Set(picks.map((p) => p.day)).size === picks.length, "한 요일에는 1부 · 2부 중 하나만 고를 수 있어요.");
  for (const p of picks) {
    const slot = slots.find((s) => s.id === p.slotId);
    assert(slot && slot.days.includes(p.day), "그 요일에 없는 숙제반이에요.");
    assert(!clashOn(slot, p.day, (d) => st.busy[d] ?? []), `${"일월화수목금토"[p.day]}요일 ${rangeLabel(slot.start, slot.end)}은 수업·SR과 겹쳐요.`);
  }
  const db = getDb();
  transaction(() => {
    db.prepare("DELETE FROM hw_apply WHERE student_id = ? AND month = ?").run(studentId, month);
    const ins = db.prepare("INSERT INTO hw_apply (student_id, slot_class_id, month, day) VALUES (?, ?, ?, ?)");
    for (const p of picks) ins.run(studentId, p.slotId, month, p.day);
  });
  refreshSr();
}

/** 지각 숙제반 날짜 정하기 — 그날만 SR 임시 자리를 자동으로 잡는다 */
export function setLateDate(user: SessionUser, lateId: number, date: string, slotId: number): void {
  assert(can(user, "homework.class"), "숙제반 관리 권한이 없어요.");
  assert(date >= today(), "지난 날짜는 고를 수 없어요.");
  const db = getDb();
  const l = row<{ student_id: number; date: string | null }>(db.prepare("SELECT student_id, date FROM hw_late WHERE id = ?").get(lateId));
  assert(l, "지각 기록을 찾을 수 없습니다.");
  const st = studentOf(l.student_id);
  const slot = homeworkSlots(db).find((s) => s.id === slotId);
  const dow = new Date(`${date}T00:00:00`).getDay();
  assert(slot && slot.days.includes(dow), "그 요일에 없는 숙제반이에요.");
  assert(!(st.busy[dow] ?? []).some(([a, b]) => a < slot.end && slot.start < b), "수업과 겹쳐요.");
  // 그날 SR 임시 자리 — 그 시간 내내 비어 있는 첫 자리
  const snap = srSnapshot(date);
  const seat = SEATS.find((s) => !seatBlocker(snap.dayUses, dow, s, slot.start, slot.end));
  transaction(() => {
    db.prepare("DELETE FROM sr_adhoc WHERE kind = '지각 숙제반' AND student_id = ? AND date = ?").run(st.id, l.date ?? "");
    db.prepare("UPDATE hw_late SET date = ?, slot_class_id = ? WHERE id = ?").run(date, slotId, lateId);
    if (seat) {
      db.prepare(
        "INSERT INTO sr_adhoc (date, name, student_id, kind, start_min, end_min, seat, created_by, created_at) VALUES (?, ?, ?, '지각 숙제반', ?, ?, ?, ?, ?)",
      ).run(date, st.name, st.id, slot.start, slot.end, seat, user.id, nowIso());
    }
  });
  assert(seat, `날짜는 정했지만 ${rangeLabel(slot.start, slot.end)}에 SR 빈자리가 없어요. SR 관리에서 임시 자리를 잡아 주세요.`);
}

export function setLateDone(user: SessionUser, lateId: number, done: boolean): void {
  assert(can(user, "homework.class"), "숙제반 관리 권한이 없어요.");
  getDb().prepare("UPDATE hw_late SET done = ? WHERE id = ?").run(done ? 1 : 0, lateId);
}

/* ------------------------------------------------ 🔄 설문 응답 불러오기 (구글 설문 → CSV 게시) */

export function setFormUrl(user: SessionUser, url: string | null): void {
  assert(user.roles.includes("ADMIN"), "관리자만 바꿀 수 있어요.");
  const v = url?.trim() || null;
  assert(!v || /^https:\/\/docs\.google\.com\//.test(v), "구글 시트의 「웹에 게시 → CSV」 주소를 넣어 주세요 (https://docs.google.com/… 로 시작).");
  setSetting("hw_form_csv_url", v);
}

/** 따옴표를 지원하는 간단한 CSV 읽기 */
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let rowv: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      rowv.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      rowv.push(cell);
      out.push(rowv);
      rowv = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || rowv.length) {
    rowv.push(cell);
    out.push(rowv);
  }
  return out.filter((r) => r.some((c) => c.trim()));
}

export type FormRow = {
  name: string;
  className: string;
  dayText: string;
  studentId: number | null;
  /** 요일마다 1부 · 2부 */
  picks: { day: number; slotId: number }[] | null;
  already: boolean;
  note: string;
};

/** 설문 응답(이름 · 반 · 요일)을 읽어 학생 · 요일별 숙제반을 맞춰 본다. 연락처는 읽지도 저장하지도 않는다 */
export async function readFormResponses(month: string): Promise<FormRow[]> {
  const url = getSetting("hw_form_csv_url");
  assert(url, "설정에서 설문 응답 시트 주소(웹에 게시 → CSV)를 먼저 넣어 주세요.");
  let text: string;
  try {
    const res = await fetch(url, { cache: "no-store" });
    assert(res.ok, `설문 응답을 불러오지 못했어요 (${res.status}). 시트가 「웹에 게시」되어 있는지 확인해 주세요.`);
    text = await res.text();
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("설문 응답 주소에 연결하지 못했어요.");
  }
  const table = parseCsv(text);
  assert(table.length > 1, "설문 응답이 비어 있어요.");
  const head = table[0].map((h) => h.trim());
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const ni = col(/이름|성명/);
  const ci = col(/반/);
  const di = col(/요일|시간|숙제반/);
  assert(ni >= 0 && di >= 0, "설문 응답에 「이름」과 「요일」 질문이 있어야 해요.");
  const db = getDb();
  const students = homeworkStudents(db);
  const slots = homeworkSlots(db);
  const applied = new Set(
    rows<{ student_id: number; slot_class_id: number; day: number }>(db.prepare("SELECT student_id, slot_class_id, day FROM hw_apply WHERE month = ?").all(month)).map(
      (r) => `${r.student_id}|${r.slot_class_id}|${r.day}`,
    ),
  );
  const out: FormRow[] = [];
  for (const r of table.slice(1)) {
    const name = (r[ni] ?? "").trim();
    if (!name) continue;
    const className = ci >= 0 ? (r[ci] ?? "").trim() : "";
    const dayText = (r[di] ?? "").trim();
    const cands = students.filter((s) => s.name === name || s.name.startsWith(`${name}(`));
    const st = cands.length === 1 ? cands[0] : cands.find((s) => className && s.regular?.name === className) ?? null;
    // 「월 8-10시, 목 4-6시」 · 「월수 8시」 · 「화 1부」
    const picks = parseApplyText(dayText, slots);
    const clash = st && picks ? picks.find((p) => clashOn(slots.find((s) => s.id === p.slotId)!, p.day, (d) => st.busy[d] ?? [])) : undefined;
    out.push({
      name,
      className,
      dayText,
      studentId: st?.id ?? null,
      picks,
      already: !!st && !!picks && picks.every((p) => applied.has(`${st.id}|${p.slotId}|${p.day}`)),
      note: !st
        ? cands.length > 1
          ? "같은 이름이 여러 명 — 반을 확인해 주세요"
          : "학생을 못 찾았어요"
        : !picks
          ? "요일·시간을 못 알아봤어요"
          : clash
            ? `${"일월화수목금토"[clash.day]}요일 수업·SR과 겹쳐요`
            : "",
    });
  }
  return out;
}

/** 설문 응답 넣기 — 그 달 그 학생의 신청을 응답대로 바꾼다 */
export function applyFormRows(user: SessionUser, month: string, list: { studentId: number; picks: { day: number; slotId: number }[] }[]): number {
  assert(can(user, "homework.class"), "숙제반 관리 권한이 없어요.");
  transaction(() => {
    for (const x of list) saveApply(user, x.studentId, month, x.picks);
  });
  return list.length;
}

/**
 * 📷 숙제인증 확인 알림 — 하루 한 번, 인증 요일이 지났는데 확인(인증됨/미인증)이 없으면 담당T에게.
 * 오픈채팅은 앱이 읽을 수 없어(카카오가 읽기 기능을 열어 주지 않음) 담당T가 확인해서 누른다.
 */
export function remindCerts(): void {
  const t = today();
  if (getSetting("hw_cert_remind") === t) return;
  setSetting("hw_cert_remind", t);
  const db = getDb();
  const q = quarterOf(t);
  const marks = marksOf(db);
  const cert = new Map<number, Map<string, "OK" | "MISS">>();
  for (const c of rows<{ student_id: number; date: string; state: "OK" | "MISS" }>(db.prepare("SELECT student_id, date, state FROM hw_cert").all())) {
    cert.set(c.student_id, (cert.get(c.student_id) ?? new Map()).set(c.date, c.state));
  }
  const plans = forcedPlans(db, t);
  const starts = hwStartsOf(db);
  const byTeacher = new Map<number, string[]>();
  for (const st of homeworkStudents(db)) {
    const p = plans.get(st.id);
    const teacher = st.regular?.teacherId;
    if (!p || !teacher) continue;
    const skip = hwSkip(db, st, q.start, t);
    const tl = timeline(marks.get(st.id) ?? new Map(), checkDatesOf(st, q.start, t, db), q.start, t, starts.get(st.id), skip);
    if (!tl.cur) continue;
    const miss = certUnchecked(p.plan, tl.cur, cert.get(st.id) ?? new Map(), t, skip);
    if (miss.length) byTeacher.set(teacher, [...(byTeacher.get(teacher) ?? []), `${st.name} ${miss.map(md).join(", ")}`]);
  }
  for (const [id, list] of byTeacher) notify(id, "HOMEWORK_CERT", "📷 숙제인증 확인해주세요", list.join(" · "), "/homework?view=class");
}

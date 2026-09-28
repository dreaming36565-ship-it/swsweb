// ★ 서버 전용. 결석보강 — 결석 1건마다 보강이 이루어졌는지 추적한다 (횟수제 수강료).
// 결석은 출결에서 저절로 생긴다. 데스크·관리자 = 사유·알린 때·유료 보강, 관리자 = 인정/개인사유 판정·이월 승인,
// 보강 일정·완료·과제로 대체·드림플러스·이월 요청 = 그 반 담당T만.

import { getDb } from "../db";
import { assert } from "../errors";
import { can } from "../perm";
import { CAT_LABEL, NOTICE_LABEL, catOfReason, statusOf, verdictOf } from "../makeup";
import { fmtTime, monthDay, monthDayWeek, parseDateKey } from "../time";
import { teacherLabel, type Absence, type AbsenceCat, type AbsenceNotice, type RoundState, type SessionUser } from "../types";
import { notify, nowIso, row, rows, today, transaction, userIdsWithRole } from "./base";

type AbsRow = {
  id: number;
  student_id: number | null;
  student_name: string;
  class_id: number | null;
  class_name: string;
  teacher_id: number | null;
  teacher_name: string | null;
  department: string;
  date: string;
  reason: string;
  cat: string | null;
  notice: string | null;
  paid: number;
  more: number;
  dream: number;
  memo: string;
  source: string;
  carry_req_reason: string | null;
  carry_req_by: string | null;
  carry_req_at: string | null;
  carried_reason: string | null;
  carried_by: string | null;
  carried_approved_by: string | null;
  carried_at: string | null;
  rejected_by: string | null;
  rejected_note: string | null;
};

function toAbsence(r: AbsRow, rounds: Absence["rounds"], log: Absence["log"]): Absence {
  return {
    id: r.id,
    studentId: r.student_id,
    studentName: r.student_name,
    classId: r.class_id,
    className: r.class_name,
    teacherId: r.teacher_id,
    teacherName: r.teacher_name,
    department: r.department === "HIGH" ? "HIGH" : "ELEM",
    date: r.date,
    reason: r.reason,
    cat: (r.cat as AbsenceCat | null) ?? null,
    notice: (r.notice as AbsenceNotice | null) ?? null,
    paid: r.paid === 1,
    more: r.more === 1,
    dream: r.dream === 1,
    memo: r.memo,
    source: r.source,
    carryReq: r.carry_req_reason ? { reason: r.carry_req_reason, by: r.carry_req_by ?? "", at: r.carry_req_at ?? "" } : null,
    carried: r.carried_reason
      ? { reason: r.carried_reason, by: r.carried_by ?? "", approvedBy: r.carried_approved_by ?? "", at: r.carried_at ?? "" }
      : null,
    rejected: r.rejected_by ? { by: r.rejected_by, note: r.rejected_note ?? "" } : null,
    rounds,
    log,
  };
}

/** 결석 목록 (전체 · 작다) — 회차와 변경 기록 포함 */
export function listAbsences(opts: { ids?: number[]; studentId?: number } = {}): Absence[] {
  const db = getDb();
  let sql = "SELECT * FROM absences WHERE 1 = 1";
  const args: number[] = [];
  if (opts.ids) {
    if (opts.ids.length === 0) return [];
    sql += ` AND id IN (${opts.ids.map(() => "?").join(",")})`;
    args.push(...opts.ids);
  }
  if (opts.studentId) {
    sql += " AND student_id = ?";
    args.push(opts.studentId);
  }
  sql += " ORDER BY date, student_name, id";
  const list = rows<AbsRow>(db.prepare(sql).all(...args));
  const rounds = new Map<number, Absence["rounds"]>();
  for (const r of rows<{ absence_id: number; id: number; type: string; date: string | null; start_min: number | null; state: string }>(
    db.prepare("SELECT absence_id, id, type, date, start_min, state FROM absence_rounds ORDER BY id").all(),
  )) {
    rounds.set(r.absence_id, [
      ...(rounds.get(r.absence_id) ?? []),
      { id: r.id, type: r.type === "TASK" ? "TASK" : "MAKEUP", date: r.date, startMin: r.start_min, state: r.state as RoundState },
    ]);
  }
  const logs = new Map<number, Absence["log"]>();
  for (const l of rows<{ absence_id: number; text: string; created_at: string }>(
    db.prepare("SELECT absence_id, text, created_at FROM absence_log ORDER BY id").all(),
  )) {
    logs.set(l.absence_id, [...(logs.get(l.absence_id) ?? []), { text: l.text, at: l.created_at }]);
  }
  return list.map((r) => toAbsence(r, rounds.get(r.id) ?? [], logs.get(r.id) ?? []));
}

function getAbsence(id: number): Absence {
  const a = listAbsences({ ids: [id] })[0];
  assert(a, "결석 기록을 찾을 수 없습니다.");
  return a;
}

const who = (u: SessionUser) => (u.roles.includes("TEACHER") ? teacherLabel(u.name) : u.name);

function stamp(absenceId: number, user: SessionUser | null, what: string): void {
  getDb()
    .prepare("INSERT INTO absence_log (absence_id, text, created_at) VALUES (?, ?, ?)")
    .run(absenceId, `${monthDay(today())} ${user ? who(user) : "자동"} — ${what}`, nowIso());
}

/* ---------------------------------------------------------- 출결 → 결석 자동 기록 */

/**
 * 출결 기록이 결석이 되면 결석 1건을 만든다 (이미 있으면 연결만).
 * 미리 등록한 결석이 있으면 그걸 쓴다.
 */
export function ensureAbsenceFromRecord(recordId: number, notice: AbsenceNotice, source: string): void {
  const db = getDb();
  const r = row<{
    student_id: number;
    student_name: string;
    class_id: number;
    class_name: string;
    department: string;
    teacher_id: number | null;
    teacher_name: string | null;
    date: string;
    reason: string | null;
    cat: string | null;
  }>(
    db
      .prepare(
        `SELECT r.student_id, st.name AS student_name, c.id AS class_id, c.name AS class_name, c.department,
                s.teacher_id, u.name AS teacher_name, e.date, r.absent_reason AS reason, r.absent_cat AS cat
           FROM attendance_records r
           JOIN attendance_events e ON e.id = r.event_id
           JOIN timetable_sessions s ON s.id = e.session_id
           JOIN classes c ON c.id = s.class_id
           JOIN students st ON st.id = r.student_id
           LEFT JOIN users u ON u.id = s.teacher_id
          WHERE r.id = ?`,
      )
      .get(recordId),
  );
  if (!r) return;
  const found = row<{ id: number }>(
    db
      .prepare("SELECT id FROM absences WHERE record_id = ? OR (student_id = ? AND class_id = ? AND date = ?) ORDER BY id LIMIT 1")
      .get(recordId, r.student_id, r.class_id, r.date),
  );
  if (found) {
    db.prepare("UPDATE absences SET record_id = ? WHERE id = ?").run(recordId, found.id);
    return;
  }
  const reason = r.reason ?? "";
  const cat = (r.cat as AbsenceCat | null) ?? catOfReason(reason);
  const id = Number(
    db
      .prepare(
        `INSERT INTO absences (student_id, student_name, class_id, class_name, teacher_id, teacher_name, department, date, reason, cat, notice,
                               source, record_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(r.student_id, r.student_name, r.class_id, r.class_name, r.teacher_id, r.teacher_name, r.department, r.date, reason, cat, notice, source, recordId, nowIso())
      .lastInsertRowid,
  );
  void id;
}

/** 결석으로 변경 되돌리기 — 보강을 이미 잡았으면 안 된다 */
export function removeAbsenceForRecord(recordId: number): void {
  const db = getDb();
  const a = row<{ id: number; notice: string | null }>(db.prepare("SELECT id, notice FROM absences WHERE record_id = ?").get(recordId));
  if (!a) return;
  const n = row<{ n: number }>(db.prepare("SELECT COUNT(*) AS n FROM absence_rounds WHERE absence_id = ?").get(a.id));
  assert((n?.n ?? 0) === 0, "이미 보강이 잡혀 있어 되돌릴 수 없습니다. 보강 관리에서 먼저 회차를 지워 주세요.");
  if (a.notice === "PRE") db.prepare("UPDATE absences SET record_id = NULL WHERE id = ?").run(a.id);
  else db.prepare("DELETE FROM absences WHERE id = ?").run(a.id);
}

/** 미리 등록된 결석 — 출석체크 팝업에 「결석 연락」으로 미리 표시 */
export function preRegisteredOn(date: string, classId: number): Map<number, { reason: string; cat: AbsenceCat | null }> {
  return new Map(
    rows<{ student_id: number; reason: string; cat: string | null }>(
      getDb().prepare("SELECT student_id, reason, cat FROM absences WHERE date = ? AND class_id = ? AND student_id IS NOT NULL").all(date, classId),
    ).map((r) => [r.student_id, { reason: r.reason, cat: (r.cat as AbsenceCat | null) ?? null }]),
  );
}

/** 결석관리 "9/23 보강완료" — 출결 기록 id → 보강 끝난 날 */
export function makeupDoneByRecord(recordIds: number[]): Map<number, string> {
  if (!recordIds.length) return new Map();
  const db = getDb();
  const list = rows<{ id: number; record_id: number }>(
    db.prepare(`SELECT id, record_id FROM absences WHERE record_id IN (${recordIds.map(() => "?").join(",")})`).all(...recordIds),
  );
  const out = new Map<number, string>();
  for (const a of listAbsences({ ids: list.map((x) => x.id) })) {
    if (statusOf(a) !== "보강 완료") continue;
    const rec = list.find((x) => x.id === a.id)!.record_id;
    const d = a.rounds.filter((r) => r.state === "DONE" && r.date).map((r) => r.date!).sort().at(-1);
    out.set(rec, d ?? a.date);
  }
  return out;
}

/* ---------------------------------------------------------------- 결석 고치기 */

export type AbsencePatch = {
  reason?: string;
  cat?: AbsenceCat | null;
  notice?: AbsenceNotice | null;
  paid?: boolean;
  more?: boolean;
  dream?: boolean;
  memo?: string;
};

/** 그 반 담당T (보강 일정 입력은 담당T만 — 관리자도 자기 반만) */
const isOwner = (user: SessionUser, a: Absence) => user.roles.includes("TEACHER") && a.teacherId === user.id;

export function updateAbsence(user: SessionUser, id: number, patch: AbsencePatch): void {
  const a = getAbsence(id);
  const db = getDb();
  const fix = can(user, "absence.fix");
  const judge = can(user, "absence.judge");
  transaction(() => {
    if (patch.reason !== undefined && patch.reason.trim() !== a.reason) {
      assert(fix, "결석 사유는 데스크·관리자가 고쳐요.");
      const reason = patch.reason.trim();
      assert(reason, "사유를 적어 주세요.");
      // 목록에 있는 사유면 구분이 저절로 정해진다. 목록에 없는 사유는 관리자가 아니면 「판정 필요」
      const auto = catOfReason(reason);
      const cat = auto ?? (judge ? (patch.cat !== undefined ? patch.cat : a.cat) : null);
      db.prepare("UPDATE absences SET reason = ?, cat = ? WHERE id = ?").run(reason, cat, id);
      stamp(id, user, `사유: ${reason}${cat ? ` (${CAT_LABEL[cat]})` : " (판정 필요)"}`);
    } else if (patch.cat !== undefined && patch.cat !== a.cat) {
      assert(judge, "인정 / 개인사유 판정은 관리자만 할 수 있어요.");
      db.prepare("UPDATE absences SET cat = ? WHERE id = ?").run(patch.cat, id);
      stamp(id, user, `구분: ${patch.cat ? CAT_LABEL[patch.cat] : "판정 필요"}`);
    }
    if (patch.notice !== undefined && patch.notice !== a.notice) {
      assert(fix, "알린 때는 데스크·관리자가 고쳐요.");
      db.prepare("UPDATE absences SET notice = ? WHERE id = ?").run(patch.notice, id);
      stamp(id, user, `알린 때: ${patch.notice ? NOTICE_LABEL[patch.notice] : "—"}`);
    }
    if (patch.paid !== undefined && patch.paid !== a.paid) {
      assert(fix, "유료 보강은 데스크·관리자가 정해요.");
      db.prepare("UPDATE absences SET paid = ? WHERE id = ?").run(patch.paid ? 1 : 0, id);
      stamp(id, user, patch.paid ? "💰 유료 보강 진행 (콩알 차감)" : "유료 보강 취소");
    }
    if (patch.more !== undefined && patch.more !== a.more) {
      assert(isOwner(user, a), `보강은 ${teacherLabel(a.teacherName)}만 입력해요.`);
      db.prepare("UPDATE absences SET more = ? WHERE id = ?").run(patch.more ? 1 : 0, id);
      stamp(id, user, patch.more ? "남은 보강 있음" : "남은 보강 없음");
    }
    if (patch.dream !== undefined && patch.dream !== a.dream) {
      assert(isOwner(user, a), `드림플러스 기록은 ${teacherLabel(a.teacherName)}이 체크해요.`);
      db.prepare("UPDATE absences SET dream = ? WHERE id = ?").run(patch.dream ? 1 : 0, id);
      stamp(id, user, patch.dream ? "드림플러스 기록함" : "드림플러스 기록 취소");
    }
    if (patch.memo !== undefined && patch.memo !== a.memo) {
      assert(fix || isOwner(user, a) || judge, "메모를 고칠 수 없어요.");
      db.prepare("UPDATE absences SET memo = ? WHERE id = ?").run(patch.memo, id);
    }
    // 인정 결석이 되면 유료 표시는 필요 없다
    const after = getAbsence(id);
    if (after.paid && verdictOf(after) === "인정") db.prepare("UPDATE absences SET paid = 0 WHERE id = ?").run(id);
  });
}

/* ---------------------------------------------------------------- 보강 회차 */

function assertCanMakeup(user: SessionUser, a: Absence): void {
  assert(isOwner(user, a), `보강은 ${teacherLabel(a.teacherName)}만 입력해요.`);
  assert(!a.carried, "이월이 확정된 결석이에요.");
  assert(!a.carryReq, "이월 결재 대기 중이에요. 요청을 취소한 뒤 입력해 주세요.");
  assert(!(verdictOf(a) === "무단" && !a.paid), "무단 결석 — 무료 보강 없음. 데스크가 「💰 유료 보강 진행」을 누르면 일정을 넣을 수 있어요.");
}

export function addRound(user: SessionUser, absenceId: number, input: { type: "MAKEUP" | "TASK"; date?: string | null; startMin?: number | null }): void {
  const a = getAbsence(absenceId);
  assertCanMakeup(user, a);
  if (input.type === "MAKEUP") {
    assert(input.date, "날짜를 골라 주세요.");
    assert(input.startMin !== null && input.startMin !== undefined, "시간을 골라 주세요.");
  }
  getDb()
    .prepare("INSERT INTO absence_rounds (absence_id, type, date, start_min, state, created_at) VALUES (?, ?, ?, ?, 'PLANNED', ?)")
    .run(absenceId, input.type, input.type === "MAKEUP" ? input.date ?? null : null, input.type === "MAKEUP" ? input.startMin ?? null : null, nowIso());
  stamp(absenceId, user, input.type === "TASK" ? "과제로 대체" : `보강 추가 ${monthDayWeek(input.date!)} ${fmtTime(input.startMin!)}`);
}

export function setRoundState(user: SessionUser, roundId: number, state: RoundState): void {
  const db = getDb();
  const r = row<{ absence_id: number; type: string; date: string | null }>(db.prepare("SELECT absence_id, type, date FROM absence_rounds WHERE id = ?").get(roundId));
  assert(r, "보강 회차를 찾을 수 없습니다.");
  const a = getAbsence(r.absence_id);
  assertCanMakeup(user, a);
  assert(state !== "MISSED" || r.type === "MAKEUP", "과제는 보강 결석으로 바꿀 수 없어요.");
  db.prepare("UPDATE absence_rounds SET state = ? WHERE id = ?").run(state, roundId);
  const n = a.rounds.findIndex((x) => x.id === roundId) + 1;
  stamp(a.id, user, `${n}차 ${r.type === "TASK" ? "과제" : r.date ? monthDayWeek(r.date) : ""} → ${{ PLANNED: "예정", DONE: "완료", MISSED: "보강 결석" }[state]}`);
}

export function deleteRound(user: SessionUser, roundId: number): void {
  const db = getDb();
  const r = row<{ absence_id: number }>(db.prepare("SELECT absence_id FROM absence_rounds WHERE id = ?").get(roundId));
  assert(r, "보강 회차를 찾을 수 없습니다.");
  const a = getAbsence(r.absence_id);
  assertCanMakeup(user, a);
  const n = a.rounds.findIndex((x) => x.id === roundId) + 1;
  db.prepare("DELETE FROM absence_rounds WHERE id = ?").run(roundId);
  stamp(a.id, user, `${n}차 삭제`);
}

/* ---------------------------------------------------------------- 이월 */

export function requestCarry(user: SessionUser, absenceId: number, reason: string): void {
  const a = getAbsence(absenceId);
  assert(isOwner(user, a), `이월 요청은 ${teacherLabel(a.teacherName)}이 해요.`);
  assert(!a.carried && !a.carryReq, "이미 이월 요청이 있어요.");
  assert(statusOf(a) !== "보강 완료", "보강이 끝난 결석이에요.");
  assert(verdictOf(a) !== "무단", "무단 결석은 이월하지 않아요.");
  const r = reason.trim();
  assert(r, "이월 사유를 적어 주세요.");
  getDb()
    .prepare("UPDATE absences SET carry_req_reason = ?, carry_req_by = ?, carry_req_at = ?, rejected_by = NULL, rejected_note = NULL WHERE id = ?")
    .run(r, who(user), today(), absenceId);
  stamp(absenceId, user, `이월 요청 (${r})`);
  for (const id of userIdsWithRole("ADMIN")) {
    if (id !== user.id) notify(id, "CARRY_REQUEST", "🖊 이월 결재 요청", `${a.studentName} · ${a.className} · ${monthDayWeek(a.date)} 결석 — ${r} (${who(user)})`, "/makeup");
  }
}

export function cancelCarry(user: SessionUser, absenceId: number): void {
  const a = getAbsence(absenceId);
  assert(isOwner(user, a) || can(user, "absence.judge"), "요청한 담당T만 취소할 수 있어요.");
  getDb().prepare("UPDATE absences SET carry_req_reason = NULL, carry_req_by = NULL, carry_req_at = NULL WHERE id = ?").run(absenceId);
  stamp(absenceId, user, "이월 요청 취소");
}

export function decideCarry(user: SessionUser, absenceId: number, ok: boolean, note?: string | null): void {
  assert(can(user, "absence.judge"), "이월 결재는 관리자만 해요.");
  const a = getAbsence(absenceId);
  assert(a.carryReq, "결재 대기 중인 이월 요청이 없어요.");
  const db = getDb();
  if (ok) {
    db.prepare(
      `UPDATE absences SET carried_reason = carry_req_reason, carried_by = carry_req_by, carried_approved_by = ?, carried_at = ?,
              carry_req_reason = NULL, carry_req_by = NULL, carry_req_at = NULL WHERE id = ?`,
    ).run(who(user), today(), absenceId);
    stamp(absenceId, user, "이월 승인");
  } else {
    db.prepare(
      "UPDATE absences SET rejected_by = ?, rejected_note = ?, carry_req_reason = NULL, carry_req_by = NULL, carry_req_at = NULL WHERE id = ?",
    ).run(who(user), note?.trim() ?? "", absenceId);
    stamp(absenceId, user, `이월 반려${note?.trim() ? ` (${note.trim()})` : ""}`);
  }
  if (a.teacherId) {
    notify(
      a.teacherId,
      "CARRY_ANSWER",
      ok ? "✅ 이월 승인" : "❌ 이월 반려",
      `${a.studentName} · ${monthDayWeek(a.date)} 결석${ok ? " — 다음 달로 이월" : ` — ${note?.trim() || "보강을 진행해 주세요"}`}`,
      "/makeup",
    );
  }
}

/* ---------------------------------------------------------------- 결석 미리 등록 */

/** 기간 안의 그 학생 수업 날짜 (다니는 모든 반) */
export function preRegisterDates(studentId: number, from: string, to: string) {
  const db = getDb();
  assert(from && to && from <= to, "기간을 확인해 주세요.");
  const classes = rows<{ id: number; name: string; department: string; teacher_id: number | null; teacher_name: string | null }>(
    db
      .prepare(
        `SELECT c.id, c.name, c.department, c.teacher_id, u.name AS teacher_name
           FROM student_classes sc JOIN classes c ON c.id = sc.class_id LEFT JOIN users u ON u.id = c.teacher_id
          WHERE sc.student_id = ? AND c.grade <> '숙제반'`,
      )
      .all(studentId),
  );
  const out: { date: string; classId: number; className: string; department: string; teacherId: number | null; teacherName: string | null }[] = [];
  const sessions = rows<{ class_id: number; day_of_week: number; teacher_id: number | null; teacher_name: string | null }>(
    db
      .prepare("SELECT s.class_id, s.day_of_week, s.teacher_id, u.name AS teacher_name FROM timetable_sessions s LEFT JOIN users u ON u.id = s.teacher_id")
      .all(),
  );
  for (let d = parseDateKey(from); ; d.setDate(d.getDate() + 1)) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (key > to) break;
    for (const c of classes) {
      const s = sessions.find((x) => x.class_id === c.id && x.day_of_week === d.getDay());
      if (!s) continue;
      out.push({
        date: key,
        classId: c.id,
        className: c.name,
        department: c.department,
        teacherId: s.teacher_id ?? c.teacher_id,
        teacherName: s.teacher_name ?? c.teacher_name,
      });
    }
    if (out.length > 200) break;
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.className.localeCompare(b.className));
}

export function preRegister(user: SessionUser, input: { studentId: number; from: string; to: string; reason: string }): number {
  assert(can(user, "absence.fix"), "결석 미리 등록은 데스크·관리자가 해요.");
  const reason = input.reason.trim();
  assert(reason, "사유를 골라 주세요.");
  const db = getDb();
  const st = row<{ name: string }>(db.prepare("SELECT name FROM students WHERE id = ?").get(input.studentId));
  assert(st, "학생을 찾을 수 없습니다.");
  const list = preRegisterDates(input.studentId, input.from, input.to);
  assert(list.length > 0, "그 기간에 수업이 없어요.");
  const cat = catOfReason(reason);
  let added = 0;
  const teachers = new Map<number, string[]>();
  transaction(() => {
    for (const r of list) {
      const dup = row(db.prepare("SELECT 1 AS x FROM absences WHERE student_id = ? AND class_id = ? AND date = ?").get(input.studentId, r.classId, r.date));
      if (dup) continue;
      const id = Number(
        db
          .prepare(
            `INSERT INTO absences (student_id, student_name, class_id, class_name, teacher_id, teacher_name, department, date, reason, cat, notice, source, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PRE', ?, ?)`,
          )
          .run(input.studentId, st.name, r.classId, r.className, r.teacherId, r.teacherName, r.department, r.date, reason, cat, `${monthDay(today())} 미리 등록 — ${who(user)}`, nowIso())
          .lastInsertRowid,
      );
      void id;
      added += 1;
      if (r.teacherId) teachers.set(r.teacherId, [...(teachers.get(r.teacherId) ?? []), monthDayWeek(r.date)]);
    }
  });
  assert(added > 0, "이미 모두 등록된 결석이에요.");
  for (const [tid, dates] of teachers) {
    notify(tid, "ABSENCE_PRE", "📅 결석 미리 등록", `${st.name} · ${reason} · ${dates.join(", ")}`, "/makeup");
  }
  return added;
}

/** 미리 등록한 결석 지우기 (아직 오지 않은 날, 보강이 없을 때만) */
export function deleteAbsence(user: SessionUser, id: number): void {
  assert(can(user, "absence.fix"), "데스크·관리자만 지울 수 있어요.");
  const a = getAbsence(id);
  assert(a.notice === "PRE" && a.date > today(), "미리 등록한 결석(아직 오지 않은 날)만 지울 수 있어요.");
  assert(a.rounds.length === 0, "보강이 잡혀 있어 지울 수 없어요.");
  getDb().prepare("DELETE FROM absences WHERE id = ?").run(id);
}

/* ---------------------------------------------------------------- 오늘의 보강 (대시보드) */

export function roundsOn(date: string): { absenceId: number; studentName: string; className: string; teacherId: number | null; startMin: number }[] {
  return rows<{ absenceId: number; studentName: string; className: string; teacherId: number | null; startMin: number }>(
    getDb()
      .prepare(
        `SELECT a.id AS absenceId, a.student_name AS studentName, a.class_name AS className, a.teacher_id AS teacherId, r.start_min AS startMin
           FROM absence_rounds r JOIN absences a ON a.id = r.absence_id
          WHERE r.date = ? AND r.type = 'MAKEUP' AND r.state = 'PLANNED' ORDER BY r.start_min`,
      )
      .all(date),
  );
}

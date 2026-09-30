// ★ 서버 전용. 🗑 실수·테스트 기록 지우기 (관리자) — 각 화면 줄 끝 🗑 · 설정 › 기록 정리(이름 · 기간으로 찾기).
// 학생 명단(students)은 지우지 않는다. 기록만 지우고, 딸린 기록(보강 회차 · 변경 기록 · 임시 자리 등)을 같이 지운다.

import { getDb } from "../db";
import { assert } from "../errors";
import { can } from "../perm";
import { addDaysKey, dateKey, monthDay, monthDayWeek, rangeLabel, DAY_LABELS } from "../time";
import { STATUS_LABEL, teacherLabel, type AttStatus, type SessionUser } from "../types";
import { row, rows, today, transaction } from "./base";
import { refreshSr } from "./timetable";
import { srAdhocPurge, srDeleteAdhoc } from "./sr";

/** 지울 기록 한 건을 가리키는 열쇠 */
export type PurgeKind = "ATT" | "ABS" | "HW_MARK" | "HW_CERT" | "HW_APPLY" | "HW_LATE" | "SR_REQ" | "SR_ADHOC" | "NOTIF";
export type PurgeKey = { kind: PurgeKind; id?: number; studentId?: number; date?: string; month?: string };
export type PurgeGroup = "ATT" | "ABS" | "HW" | "SR" | "NOTIF";
export type PurgeRange = "TODAY" | "WEEK" | "MONTH" | "ALL";

export type PurgeItem = PurgeKey & {
  /** 화면에서 체크 상자 구분용 */
  key: string;
  group: PurgeGroup;
  /** 날짜 (정렬용) */
  date: string;
  label: string;
  /** 같이 지워지는 것 */
  extra: string[];
  /** 참고 (지워지지 않는 것 등) */
  note?: string;
};

const keyOf = (k: PurgeKey) => [k.kind, k.id ?? "", k.studentId ?? "", k.date ?? "", k.month ?? ""].join("|");
const nameWhere = (col: string) => `(${col} = ? OR ${col} LIKE ?)`;
const nameArgs = (name: string) => [name, `${name}(%`];
const localDate = (iso: string) => dateKey(new Date(iso));

function assertPurge(user: SessionUser): void {
  assert(can(user, "records.purge"), "기록 지우기는 관리자만 할 수 있어요.");
}

function fromOf(range: PurgeRange): string | null {
  const t = today();
  if (range === "TODAY") return t;
  if (range === "WEEK") return addDaysKey(t, -6);
  if (range === "MONTH") return addDaysKey(t, -30);
  return null;
}

/* ---------------------------------------------------------------- 설명 (라벨 · 같이 지워지는 것) */

type AttRow = {
  id: number;
  event_id: number;
  student_id: number;
  status: AttStatus;
  absent_reason: string | null;
  late_reason: string | null;
  student: string;
  date: string;
  class_name: string;
};

const ATT_SELECT = `SELECT r.id, r.event_id, r.student_id, r.status, r.absent_reason, r.late_reason, st.name AS student, e.date, c.name AS class_name
   FROM attendance_records r
   JOIN attendance_events e ON e.id = r.event_id
   JOIN timetable_sessions s ON s.id = e.session_id
   JOIN classes c ON c.id = s.class_id
   JOIN students st ON st.id = r.student_id`;

/** 지각 출결 1건에 딸린 (아직 안 다녀온) 지각 숙제반 */
function latesWith(studentId: number, date: string): { id: number; date: string | null }[] {
  return rows<{ id: number; date: string | null }>(
    getDb()
      .prepare("SELECT id, date FROM hw_late WHERE student_id = ? AND done = 0 AND (',' || lates || ',') LIKE ?")
      .all(studentId, `%,${date},%`),
  );
}

function linkedAbsences(recordId: number): { id: number; rounds: number }[] {
  return rows<{ id: number; rounds: number }>(
    getDb()
      .prepare(
        `SELECT a.id, (SELECT COUNT(*) FROM absence_rounds r WHERE r.absence_id = a.id) AS rounds
           FROM absences a WHERE a.record_id = ? AND COALESCE(a.notice, '') <> 'PRE'`,
      )
      .all(recordId),
  );
}

function describeAtt(r: AttRow): PurgeItem {
  const reason = r.absent_reason || r.late_reason || "";
  const extra: string[] = [];
  const abs = linkedAbsences(r.id);
  if (abs.length) extra.push(`결석 기록 ${abs.length}건`);
  const rounds = abs.reduce((n, a) => n + a.rounds, 0);
  if (rounds) extra.push(`보강 회차 ${rounds}건`);
  if (r.status === "LATE" && latesWith(r.student_id, r.date).length) extra.push("지각 숙제반 1건");
  const k: PurgeKey = { kind: "ATT", id: r.id };
  return {
    ...k,
    key: keyOf(k),
    group: "ATT",
    date: r.date,
    label: `${r.student} · ${monthDayWeek(r.date)} ${r.class_name} · ${STATUS_LABEL[r.status] ?? r.status}${reason ? ` · ${reason}` : ""}`,
    extra,
  };
}

type AbsRow = { id: number; student_name: string; class_name: string; date: string; reason: string; record_id: number | null; rounds: number; logs: number };
const ABS_SELECT = `SELECT a.id, a.student_name, a.class_name, a.date, a.reason, a.record_id,
        (SELECT COUNT(*) FROM absence_rounds r WHERE r.absence_id = a.id) AS rounds,
        (SELECT COUNT(*) FROM absence_log l WHERE l.absence_id = a.id) AS logs
   FROM absences a`;

function describeAbs(a: AbsRow): PurgeItem {
  const extra: string[] = [];
  if (a.rounds) extra.push(`보강 회차 ${a.rounds}건`);
  if (a.logs) extra.push("변경 기록");
  const k: PurgeKey = { kind: "ABS", id: a.id };
  return {
    ...k,
    key: keyOf(k),
    group: "ABS",
    date: a.date,
    label: `${a.student_name} · ${monthDayWeek(a.date)} ${a.class_name} 결석${a.reason ? ` · ${a.reason}` : ""}`,
    extra,
    note: a.record_id ? "결석관리 출결 기록은 남아요" : undefined,
  };
}

function describeMark(m: { student_id: number; date: string; mark: string; student: string }): PurgeItem {
  const k: PurgeKey = { kind: "HW_MARK", studentId: m.student_id, date: m.date };
  return { ...k, key: keyOf(k), group: "HW", date: m.date, label: `${m.student} · ${monthDayWeek(m.date)} 숙제 표시 · ${m.mark}`, extra: [] };
}

function describeCert(c: { student_id: number; date: string; state: string; student: string }): PurgeItem {
  const k: PurgeKey = { kind: "HW_CERT", studentId: c.student_id, date: c.date };
  return {
    ...k,
    key: keyOf(k),
    group: "HW",
    date: c.date,
    label: `${c.student} · ${monthDayWeek(c.date)} 📷 사진 인증 · ${c.state === "OK" ? "인증됨" : "미인증"}`,
    extra: [],
  };
}

function describeApply(a: { student_id: number; month: string; days: string; student: string }): PurgeItem {
  const k: PurgeKey = { kind: "HW_APPLY", studentId: a.student_id, month: a.month };
  const days = [...new Set(a.days.split(",").map(Number))].sort().map((d) => DAY_LABELS[d]).join("");
  return { ...k, key: keyOf(k), group: "HW", date: `${a.month}-01`, label: `${a.student} · ${Number(a.month.slice(5))}월 숙제반 신청 · ${days}`, extra: [] };
}

function describeLate(l: { id: number; student_id: number; lates: string; date: string | null; created_at: string; student: string }): PurgeItem {
  const k: PurgeKey = { kind: "HW_LATE", id: l.id };
  const lates = l.lates.split(",").filter(Boolean);
  const extra: string[] = [];
  if (l.date && row(getDb().prepare("SELECT 1 AS x FROM sr_adhoc WHERE kind = '지각 숙제반' AND student_id = ? AND date = ?").get(l.student_id, l.date)))
    extra.push("SR 임시 자리");
  const still = lates.length
    ? row<{ n: number }>(
        getDb()
          .prepare(
            `SELECT COUNT(*) AS n FROM attendance_records r JOIN attendance_events e ON e.id = r.event_id
              WHERE r.student_id = ? AND r.status = 'LATE' AND e.date IN (${lates.map(() => "?").join(",")})`,
          )
          .get(l.student_id, ...lates),
      )?.n ?? 0
    : 0;
  return {
    ...k,
    key: keyOf(k),
    group: "HW",
    date: l.date ?? lates.at(-1) ?? localDate(l.created_at),
    label: `${l.student} · 지각 숙제반 (지각 ${lates.map(monthDay).join(", ")})${l.date ? ` · ${monthDayWeek(l.date)}` : ""}`,
    extra,
    note: still ? `지각 출결 ${still}건이 남아 있으면 다시 생겨요 (출결도 같이 지우기)` : undefined,
  };
}

type ReqRow = { id: number; date: string; name: string; kind: string; start_min: number; end_min: number; state: string; seat: string | null };
const REQ_STATE: Record<string, string> = { WAIT: "대기", OK: "배정", NO: "거절", CANCEL: "취소" };

function describeReq(r: ReqRow): PurgeItem {
  const k: PurgeKey = { kind: "SR_REQ", id: r.id };
  return {
    ...k,
    key: keyOf(k),
    group: "SR",
    date: r.date,
    label: `${r.name} · ${monthDayWeek(r.date)} 🙋 자리 요청 · ${r.kind}${r.seat ? ` ${r.seat}` : ""} · ${rangeLabel(r.start_min, r.end_min)} (${REQ_STATE[r.state] ?? r.state})`,
    extra: [...(r.state === "OK" && r.seat ? ["임시 자리"] : []), "📝 기록 줄", "선생님 알림"],
  };
}

type AdhocRow = { id: number; date: string; name: string; kind: string; start_min: number; end_min: number; seat: string };

function describeAdhoc(a: AdhocRow): PurgeItem {
  const k: PurgeKey = { kind: "SR_ADHOC", id: a.id };
  return {
    ...k,
    key: keyOf(k),
    group: "SR",
    date: a.date,
    label: `${a.name} · ${monthDayWeek(a.date)} 📌 임시 자리 · ${a.kind} ${a.seat} · ${rangeLabel(a.start_min, a.end_min)}`,
    extra: [],
  };
}

type NotifRow = { id: number; title: string; body: string | null; created_at: string; user_name: string | null; roles: string | null };

function describeNotif(n: NotifRow): PurgeItem {
  const k: PurgeKey = { kind: "NOTIF", id: n.id };
  const d = localDate(n.created_at);
  const owner = n.user_name ? ((n.roles ?? "").includes("TEACHER") ? teacherLabel(n.user_name) : n.user_name) : "";
  return {
    ...k,
    key: keyOf(k),
    group: "NOTIF",
    date: d,
    label: `${monthDay(d)} ${n.title}${n.body ? ` · ${n.body}` : ""}${owner ? ` (${owner} 알림함)` : ""}`,
    extra: [],
  };
}

const NOTIF_SELECT = `SELECT n.id, n.title, n.body, n.created_at, u.name AS user_name, u.roles FROM notifications n LEFT JOIN users u ON u.id = n.user_id`;

/** 열쇠 한 개 → 설명 (없으면 null) */
function describeOne(k: PurgeKey): PurgeItem | null {
  const db = getDb();
  switch (k.kind) {
    case "ATT": {
      const r = row<AttRow>(db.prepare(`${ATT_SELECT} WHERE r.id = ?`).get(k.id ?? 0));
      return r ? describeAtt(r) : null;
    }
    case "ABS": {
      const a = row<AbsRow>(db.prepare(`${ABS_SELECT} WHERE a.id = ?`).get(k.id ?? 0));
      return a ? describeAbs(a) : null;
    }
    case "HW_MARK": {
      const m = row<{ student_id: number; date: string; mark: string; student: string }>(
        db.prepare("SELECT m.student_id, m.date, m.mark, st.name AS student FROM hw_marks m JOIN students st ON st.id = m.student_id WHERE m.student_id = ? AND m.date = ?").get(k.studentId ?? 0, k.date ?? ""),
      );
      return m ? describeMark(m) : null;
    }
    case "HW_CERT": {
      const c = row<{ student_id: number; date: string; state: string; student: string }>(
        db.prepare("SELECT c.student_id, c.date, c.state, st.name AS student FROM hw_cert c JOIN students st ON st.id = c.student_id WHERE c.student_id = ? AND c.date = ?").get(k.studentId ?? 0, k.date ?? ""),
      );
      return c ? describeCert(c) : null;
    }
    case "HW_APPLY": {
      const a = row<{ student_id: number; month: string; days: string | null; student: string }>(
        db
          .prepare(
            `SELECT a.student_id, a.month, GROUP_CONCAT(a.day) AS days, st.name AS student FROM hw_apply a JOIN students st ON st.id = a.student_id
              WHERE a.student_id = ? AND a.month = ? GROUP BY a.student_id, a.month`,
          )
          .get(k.studentId ?? 0, k.month ?? ""),
      );
      return a && a.days ? describeApply({ ...a, days: a.days }) : null;
    }
    case "HW_LATE": {
      const l = row<{ id: number; student_id: number; lates: string; date: string | null; created_at: string; student: string }>(
        db.prepare("SELECT l.id, l.student_id, l.lates, l.date, l.created_at, st.name AS student FROM hw_late l JOIN students st ON st.id = l.student_id WHERE l.id = ?").get(k.id ?? 0),
      );
      return l ? describeLate(l) : null;
    }
    case "SR_REQ": {
      const r = row<ReqRow>(db.prepare("SELECT id, date, name, kind, start_min, end_min, state, seat FROM sr_adhoc_requests WHERE id = ?").get(k.id ?? 0));
      return r ? describeReq(r) : null;
    }
    case "SR_ADHOC": {
      const a = row<AdhocRow>(db.prepare("SELECT id, date, name, kind, start_min, end_min, seat FROM sr_adhoc WHERE id = ?").get(k.id ?? 0));
      return a ? describeAdhoc(a) : null;
    }
    case "NOTIF": {
      const n = row<NotifRow>(db.prepare(`${NOTIF_SELECT} WHERE n.id = ?`).get(k.id ?? 0));
      return n ? describeNotif(n) : null;
    }
    default:
      return null;
  }
}

/** 🗑 누르기 전 — 무엇이 지워지는지 (확인창에 보여 준다) */
export function purgeDescribe(user: SessionUser, keys: PurgeKey[]): PurgeItem[] {
  assertPurge(user);
  assert(Array.isArray(keys) && keys.length > 0, "지울 기록을 골라 주세요.");
  return keys.map(describeOne).filter((x): x is PurgeItem => x !== null);
}

/* ---------------------------------------------------------------- 이름 · 기간으로 찾기 */

export function purgeFind(user: SessionUser, nameInput: string, range: PurgeRange): PurgeItem[] {
  assertPurge(user);
  const name = (nameInput ?? "").trim();
  assert(name, "학생 이름을 입력해 주세요.");
  const db = getDb();
  const from = fromOf(range);
  const d = (col: string) => (from ? ` AND ${col} >= ?` : "");
  const fa = from ? [from] : [];
  const fromIso = from ? new Date(`${from}T00:00:00`).toISOString() : null;
  const out: PurgeItem[] = [];

  for (const r of rows<AttRow>(db.prepare(`${ATT_SELECT} WHERE ${nameWhere("st.name")}${d("e.date")} ORDER BY e.date, c.name`).all(...nameArgs(name), ...fa)))
    out.push(describeAtt(r));

  for (const a of rows<AbsRow>(db.prepare(`${ABS_SELECT} WHERE ${nameWhere("a.student_name")}${d("a.date")} ORDER BY a.date, a.id`).all(...nameArgs(name), ...fa)))
    out.push(describeAbs(a));

  for (const m of rows<{ student_id: number; date: string; mark: string; student: string }>(
    db
      .prepare(`SELECT m.student_id, m.date, m.mark, st.name AS student FROM hw_marks m JOIN students st ON st.id = m.student_id WHERE ${nameWhere("st.name")}${d("m.date")} ORDER BY m.date`)
      .all(...nameArgs(name), ...fa),
  ))
    out.push(describeMark(m));

  for (const c of rows<{ student_id: number; date: string; state: string; student: string }>(
    db
      .prepare(`SELECT c.student_id, c.date, c.state, st.name AS student FROM hw_cert c JOIN students st ON st.id = c.student_id WHERE ${nameWhere("st.name")}${d("c.date")} ORDER BY c.date`)
      .all(...nameArgs(name), ...fa),
  ))
    out.push(describeCert(c));

  for (const a of rows<{ student_id: number; month: string; days: string; student: string }>(
    db
      .prepare(
        `SELECT a.student_id, a.month, GROUP_CONCAT(a.day) AS days, st.name AS student FROM hw_apply a JOIN students st ON st.id = a.student_id
          WHERE ${nameWhere("st.name")}${from ? " AND a.month >= ?" : ""} GROUP BY a.student_id, a.month ORDER BY a.month`,
      )
      .all(...nameArgs(name), ...(from ? [from.slice(0, 7)] : [])),
  ))
    out.push(describeApply(a));

  for (const l of rows<{ id: number; student_id: number; lates: string; date: string | null; created_at: string; student: string }>(
    db
      .prepare(
        `SELECT l.id, l.student_id, l.lates, l.date, l.created_at, st.name AS student FROM hw_late l JOIN students st ON st.id = l.student_id
          WHERE ${nameWhere("st.name")}${from ? " AND (l.created_at >= ? OR l.date >= ?)" : ""} ORDER BY l.id`,
      )
      .all(...nameArgs(name), ...(from && fromIso ? [fromIso, from] : [])),
  ))
    out.push(describeLate(l));

  const reqs = rows<ReqRow>(
    db
      .prepare(`SELECT id, date, name, kind, start_min, end_min, state, seat FROM sr_adhoc_requests WHERE ${nameWhere("name")}${d("date")} ORDER BY date, id`)
      .all(...nameArgs(name), ...fa),
  );
  for (const r of reqs) out.push(describeReq(r));
  // 요청으로 배정된 임시 자리는 요청과 같이 지워지므로 따로 보여 주지 않는다
  const fromReq = new Set(reqs.filter((r) => r.state === "OK" && r.seat).map((r) => `${r.date}|${r.name}|${r.kind}|${r.start_min}|${r.end_min}|${r.seat}`));
  for (const a of rows<AdhocRow>(
    db.prepare(`SELECT id, date, name, kind, start_min, end_min, seat FROM sr_adhoc WHERE ${nameWhere("name")}${d("date")} ORDER BY date, id`).all(...nameArgs(name), ...fa),
  )) {
    if (fromReq.has(`${a.date}|${a.name}|${a.kind}|${a.start_min}|${a.end_min}|${a.seat}`)) continue;
    out.push(describeAdhoc(a));
  }

  for (const n of rows<NotifRow>(
    db
      .prepare(`${NOTIF_SELECT} WHERE (n.body LIKE ? OR n.title LIKE ?)${fromIso ? " AND n.created_at >= ?" : ""} ORDER BY n.id`)
      .all(`%${name}%`, `%${name}%`, ...(fromIso ? [fromIso] : [])),
  ))
    out.push(describeNotif(n));

  return out;
}

/* ---------------------------------------------------------------- 지우기 */

function deleteLate(id: number): void {
  const db = getDb();
  const l = row<{ student_id: number; date: string | null }>(db.prepare("SELECT student_id, date FROM hw_late WHERE id = ?").get(id));
  if (!l) return;
  if (l.date) db.prepare("DELETE FROM sr_adhoc WHERE kind = '지각 숙제반' AND student_id = ? AND date = ?").run(l.student_id, l.date);
  db.prepare("DELETE FROM hw_late WHERE id = ?").run(id);
}

function deleteAbsenceRow(id: number): void {
  const db = getDb();
  db.prepare("DELETE FROM absence_rounds WHERE absence_id = ?").run(id);
  db.prepare("DELETE FROM absence_log WHERE absence_id = ?").run(id);
  db.prepare("DELETE FROM absences WHERE id = ?").run(id);
}

/** 한 건 지우기 — 지웠으면 true */
function deleteOne(user: SessionUser, k: PurgeKey): boolean {
  const db = getDb();
  switch (k.kind) {
    case "ATT": {
      const r = row<AttRow>(db.prepare(`${ATT_SELECT} WHERE r.id = ?`).get(k.id ?? 0));
      if (!r) return false;
      // 이 출결에서 저절로 생긴 결석(미리 등록한 결석은 남긴다) · 지각 숙제반
      for (const a of linkedAbsences(r.id)) deleteAbsenceRow(a.id);
      if (r.status === "LATE") for (const l of latesWith(r.student_id, r.date)) deleteLate(l.id);
      db.prepare("DELETE FROM attendance_records WHERE id = ?").run(r.id);
      // 남은 학생이 없으면 팝업이 다시 뜨지 않게 출결을 끝낸다
      const left = row<{ n: number }>(db.prepare("SELECT COUNT(*) AS n FROM attendance_records WHERE event_id = ?").get(r.event_id))?.n ?? 0;
      if (left === 0) db.prepare("UPDATE attendance_events SET stage = 'DONE', updated_at = ? WHERE id = ?").run(new Date().toISOString(), r.event_id);
      return true;
    }
    case "ABS": {
      if (!row(db.prepare("SELECT 1 AS x FROM absences WHERE id = ?").get(k.id ?? 0))) return false;
      deleteAbsenceRow(k.id!);
      return true;
    }
    case "HW_MARK":
      return Number(db.prepare("DELETE FROM hw_marks WHERE student_id = ? AND date = ?").run(k.studentId ?? 0, k.date ?? "").changes) > 0;
    case "HW_CERT":
      return Number(db.prepare("DELETE FROM hw_cert WHERE student_id = ? AND date = ?").run(k.studentId ?? 0, k.date ?? "").changes) > 0;
    case "HW_APPLY":
      return Number(db.prepare("DELETE FROM hw_apply WHERE student_id = ? AND month = ?").run(k.studentId ?? 0, k.month ?? "").changes) > 0;
    case "HW_LATE": {
      if (!row(db.prepare("SELECT 1 AS x FROM hw_late WHERE id = ?").get(k.id ?? 0))) return false;
      deleteLate(k.id!);
      return true;
    }
    case "SR_REQ": {
      if (!row(db.prepare("SELECT 1 AS x FROM sr_adhoc_requests WHERE id = ?").get(k.id ?? 0))) return false;
      srAdhocPurge(user, k.id!);
      return true;
    }
    case "SR_ADHOC": {
      if (!row(db.prepare("SELECT 1 AS x FROM sr_adhoc WHERE id = ?").get(k.id ?? 0))) return false;
      srDeleteAdhoc(user, k.id!);
      return true;
    }
    case "NOTIF":
      return Number(db.prepare("DELETE FROM notifications WHERE id = ?").run(k.id ?? 0).changes) > 0;
    default:
      return false;
  }
}

const KINDS = new Set<PurgeKind>(["ATT", "ABS", "HW_MARK", "HW_CERT", "HW_APPLY", "HW_LATE", "SR_REQ", "SR_ADHOC", "NOTIF"]);

/** 고른 기록을 한 번에 지운다 (하나라도 실패하면 전부 되돌린다). 지운 건수 */
export function purgeDelete(user: SessionUser, keys: PurgeKey[]): number {
  assertPurge(user);
  assert(Array.isArray(keys) && keys.length > 0, "지울 기록을 골라 주세요.");
  assert(keys.length <= 2000, "한 번에 너무 많아요. 나눠서 지워 주세요.");
  for (const k of keys) assert(k && KINDS.has(k.kind), "알 수 없는 기록이에요.");
  // 출결을 먼저 지워야 지각 숙제반이 다시 생기지 않는다
  const order: PurgeKind[] = ["ATT", "ABS", "HW_LATE", "HW_MARK", "HW_CERT", "HW_APPLY", "SR_REQ", "SR_ADHOC", "NOTIF"];
  const sorted = [...keys].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  let n = 0;
  transaction(() => {
    for (const k of sorted) if (deleteOne(user, k)) n += 1;
  });
  assert(n > 0, "지울 기록이 없어요. 이미 지워졌을 수 있어요.");
  // 숙제 · 출결이 바뀌면 SR 자리(강제 · 신청 숙제반)도 다시 계산
  if (sorted.some((k) => k.kind.startsWith("HW_") || k.kind === "ATT")) refreshSr();
  return n;
}

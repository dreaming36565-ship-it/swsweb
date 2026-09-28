// ★ 서버 전용. 출결 — 출석체크 → 데스크 출결전화 → 결과는 알림함. 결석은 보강 관리로 자동 등록.

import { getDb } from "../db";
import { assert } from "../errors";
import { callStateOf, canMarkAbsent, finalStatus, isRemaining, needsInfo, normalizeCall, triggerOf } from "../attendance";
import { catOfReason } from "../makeup";
import { dateKey, fmtTime } from "../time";
import type {
  AbsenceCat,
  AttendanceEvent,
  AttendanceGroup,
  AttendanceRecord,
  AttStatus,
  CallState,
  Checker,
  SessionUser,
  Stage,
  TimetableSession,
} from "../types";
import { deptWhere, isRole, notify, nowIso, nowMin, row, rows, transaction, userIdsWithRole, type DeptFilter } from "./base";
import { listSessions, sessionOn } from "./timetable";
import { ensureAbsenceFromRecord, makeupDoneByRecord, preRegisteredOn, removeAbsenceForRecord } from "./absence";

// 출결 시각은 그 날짜의 실제 순서(⇄ 하루만 바꾼 순서 포함)를 따른다 — 시작하면 이벤트에 적어 둔다.
const ATT_EVENT_SELECT = `SELECT e.id, e.session_id AS sessionId, e.date, e.stage, e.checker,
        e.trigger_min AS triggerMin, c.id AS classId,
        c.name AS className, c.department, s.teacher_id AS teacherId, u.name AS teacherName,
        r.name AS roomName, s.day_of_week AS dayOfWeek, s.start_min AS startMin, s.end_min AS endMin,
        s.alpha_start_min AS alphaStartMin, s.alpha_end_min AS alphaEndMin
   FROM attendance_events e
   JOIN timetable_sessions s ON s.id = e.session_id
   JOIN classes c ON c.id = s.class_id
   LEFT JOIN rooms r ON r.id = s.room_id
   LEFT JOIN users u ON u.id = s.teacher_id`;

type EventHead = Omit<AttendanceEvent, "records">;

/** 이벤트의 수업·알파 시간을 그 날짜 기준으로 (⇄ 하루만 바꾼 경우) */
function withDayTimes(h: EventHead): EventHead {
  const s = sessionOn(h.sessionId, h.date);
  if (!s?.swapped) return h;
  return { ...h, startMin: s.startMin, endMin: s.endMin, alphaStartMin: s.alphaStartMin, alphaEndMin: s.alphaEndMin };
}

function attachRecords(heads: EventHead[]): AttendanceEvent[] {
  if (heads.length === 0) return [];
  const stmt = getDb().prepare(
    `SELECT r.id, r.student_id AS studentId, st.name AS studentName, r.status,
            r.pre_notified AS preNotified, r.absent_reason AS absentReason, r.absent_cat AS absentCat, r.late_reason AS lateReason,
            r.eta_min AS etaMin, r.eta_unknown AS etaUnknown, r.absent_from AS absentFrom,
            r.student_call AS studentCall, r.student_call_at AS studentCallAt,
            r.parent_call AS parentCall, r.parent_call_at AS parentCallAt, r.kakao_at AS kakaoAt,
            r.call_result AS callResult, r.arrived_at AS arrivedAt, r.late_arrival AS lateArrival
       FROM attendance_records r
       JOIN students st ON st.id = r.student_id
      WHERE r.event_id = ?
      ORDER BY st.name, st.id`,
  );
  const events = heads.map((h) => ({ ...withDayTimes(h), records: rows<AttendanceRecord>(stmt.all(h.id)) }));
  const done = makeupDoneByRecord(events.flatMap((e) => e.records.filter((r) => r.status === "ABSENT").map((r) => r.id)));
  for (const e of events) for (const r of e.records) r.makeupDoneDate = done.get(r.id) ?? null;
  return events;
}

type Opened = { checker: Checker; triggerMin: number; teacherId: number | null; className: string };

function openEvent(sessionId: number, date: string): Opened | null {
  const db = getDb();
  if (row(db.prepare("SELECT id FROM attendance_events WHERE session_id = ? AND date = ?").get(sessionId, date))) return null;
  const s = sessionOn(sessionId, date);
  if (!s) return null;
  const { triggerMin, checker } = triggerOf(s);
  const now = nowIso();
  const eventId = Number(
    db
      .prepare(
        `INSERT INTO attendance_events (session_id, date, checker, trigger_min, stage, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'CHECK', ?, ?)`,
      )
      .run(sessionId, date, checker, triggerMin, now, now).lastInsertRowid,
  );
  const students = rows<{ id: number }>(
    db
      .prepare(
        `SELECT s.id FROM student_classes sc JOIN students s ON s.id = sc.student_id
          WHERE sc.class_id = ? AND s.active = 1 ORDER BY s.id`,
      )
      .all(s.classId),
  );
  // 미리 등록된 결석은 「결석 연락」으로 미리 표시해 둔다
  const pre = preRegisteredOn(date, s.classId);
  const ins = db.prepare(
    "INSERT INTO attendance_records (event_id, student_id, status, pre_notified, absent_reason, absent_cat) VALUES (?, ?, 'UNCHECKED', ?, ?, ?)",
  );
  for (const st of students) {
    const p = pre.get(st.id);
    ins.run(eventId, st.id, p ? 1 : 0, p?.reason ?? null, p?.cat ?? null);
  }
  return { checker, triggerMin, teacherId: s.teacherId, className: s.className };
}

/**
 * 1차 출석체크 알림 — 알파가 먼저면 데스크 전원, 수업이 먼저면 담당 선생님.
 * 같은 시각에 함께 열린 반들은 팝업처럼 알림도 한 건으로 묶는다.
 */
function notifyOpened(opened: Opened[]): void {
  const byTarget = new Map<string, { ids: number[]; triggerMin: number; desk: boolean; classes: string[] }>();
  for (const o of opened) {
    const ids = o.checker === "DESK" ? userIdsWithRole("DESK") : o.teacherId ? [o.teacherId] : [];
    if (ids.length === 0) continue;
    const key = `${o.checker}-${o.triggerMin}-${o.checker === "DESK" ? "desk" : o.teacherId}`;
    const g = byTarget.get(key) ?? { ids, triggerMin: o.triggerMin, desk: o.checker === "DESK", classes: [] };
    g.classes.push(o.className);
    byTarget.set(key, g);
  }
  for (const g of byTarget.values()) {
    const body = `${g.classes.join(", ")} · ${fmtTime(g.triggerMin)} ${g.desk ? "알파" : "수업"} 시작`;
    for (const id of g.ids) notify(id, "ATTENDANCE_CHECK", "출석체크해주세요.", body, "/attendance");
  }
}

/** 그 날짜 출결 시작 시각 (수업·알파 중 이른 쪽) */
const triggerMinOf = (s: TimetableSession) => triggerOf(s).triggerMin;

/**
 * 폴링 시점 tick — 수업·알파 중 먼저 시작하는 쪽 +2분이 지난 수업의 출결을 연다.
 * 아무도 앱을 켜두지 않으면 그 시간 이벤트가 안 열린다(알려진 한계).
 */
export function tickAttendance(date: string, dayOfWeek: number, now: number): void {
  const db = getDb();
  const opened: Opened[] = [];
  for (const s of listSessions(dayOfWeek, "ALL", date)) {
    if (triggerMinOf(s) + 2 > now || Math.max(s.endMin, s.alphaEndMin ?? 0) <= now - 120) continue;
    if (row(db.prepare("SELECT 1 AS x FROM attendance_events WHERE session_id = ? AND date = ?").get(s.id, date))) continue;
    const o = openEvent(s.id, date);
    if (o) opened.push(o);
  }
  notifyOpened(opened);
}

/** 결석관리의 "지금 열기" — 시작 +2분을 기다리지 않고 즉시 시작. 같은 시각 반들을 한 번에 연다. */
export function triggerAttendance(sessionIds: number[], date: string): void {
  assert(sessionIds.length > 0, "열 수업을 선택해 주세요.");
  // 실제 시간이 되어야 열 수 있다 — 오늘이면 출결 시작 시각(수업·알파 중 이른 쪽)이 지나야 하고, 앞날은 안 된다
  const todayKey = dateKey(new Date());
  assert(date <= todayKey, "아직 오지 않은 날짜의 출결은 열 수 없습니다.");
  if (date === todayKey) {
    for (const id of sessionIds) {
      const s = sessionOn(id, date);
      assert(s, "수업을 찾을 수 없습니다.");
      assert(nowMin() >= triggerMinOf(s), `${fmtTime(triggerMinOf(s))}부터 열 수 있습니다.`);
    }
  }
  const opened: Opened[] = [];
  for (const id of sessionIds) {
    const o = openEvent(id, date);
    if (o) opened.push(o);
  }
  assert(opened.length > 0, "이미 열려 있는 출결입니다.");
  notifyOpened(opened);
}

/**
 * 내가 지금 처리해야 할 출결 팝업 — 같은 시각에 시작한 반들은 한 장으로 묶는다.
 * - 1차 출석체크: checker 가 TEACHER 면 담당 선생님, DESK 면 데스크 전원
 * - 출결전화: 데스크 전원 (초중고 구분 없음)
 * 관리자만인 사람은 팝업을 받지 않는다 — 결과는 알림함으로만 받는다. (관리자 + 선생님이면 담당 반 팝업은 받는다)
 */
export function pendingGroupsForUser(user: SessionUser, date: string): AttendanceGroup[] {
  const parts: string[] = [];
  const args: (string | number)[] = [date];
  if (isRole(user, "TEACHER")) {
    parts.push("(e.stage = 'CHECK' AND e.checker = 'TEACHER' AND s.teacher_id = ?)");
    args.push(user.id);
  }
  if (isRole(user, "DESK")) parts.push("(e.stage = 'CALL' OR (e.stage = 'CHECK' AND e.checker = 'DESK'))");
  if (parts.length === 0) return [];
  const sql = `${ATT_EVENT_SELECT} WHERE e.date = ? AND (${parts.join(" OR ")}) ORDER BY e.trigger_min, c.name`;
  const events = attachRecords(rows<EventHead>(getDb().prepare(sql).all(...args)));

  const groups = new Map<string, AttendanceGroup>();
  for (const e of events) {
    const kind = e.stage === "CALL" ? "CALL" : "CHECK";
    // 데스크 출석체크와 선생님 출석체크는 따로 (같은 사람이 둘 다일 때)
    const key = `${kind}-${e.triggerMin}${kind === "CHECK" ? `-${e.checker}` : ""}`;
    const g = groups.get(key) ?? { key, kind, triggerMin: e.triggerMin, events: [] };
    g.events.push(e);
    groups.set(key, g);
  }
  // 1차 출석체크를 먼저, 그 다음 출결전화 — 각각 이른 시각부터
  return [...groups.values()].sort((a, b) => (a.kind === b.kind ? a.triggerMin - b.triggerMin : a.kind === "CHECK" ? -1 : 1));
}

export function listAttendanceByIds(ids: number[]): AttendanceEvent[] {
  if (ids.length === 0) return [];
  return attachRecords(
    rows<EventHead>(
      getDb()
        .prepare(`${ATT_EVENT_SELECT} WHERE e.id IN (${ids.map(() => "?").join(",")}) ORDER BY e.trigger_min, c.name`)
        .all(...ids),
    ),
  );
}

export function listAttendance(date: string, dept: DeptFilter = "ALL"): AttendanceEvent[] {
  const w = deptWhere("c.department", dept);
  return attachRecords(
    rows<EventHead>(getDb().prepare(`${ATT_EVENT_SELECT} WHERE e.date = ?${w.sql} ORDER BY e.trigger_min, c.name`).all(date, ...w.args)),
  );
}

/** 아직 열리지 않은 그 날의 수업 (결석관리의 "지금 열기" 후보) — 그 날짜의 실제 순서로 */
export function notOpenedSessions(date: string, dayOfWeek: number, dept: DeptFilter = "ALL"): TimetableSession[] {
  const opened = new Set(
    rows<{ session_id: number }>(getDb().prepare("SELECT session_id FROM attendance_events WHERE date = ?").all(date)).map((r) => r.session_id),
  );
  return listSessions(dayOfWeek, dept, date)
    .filter((s) => !opened.has(s.id))
    .sort((a, b) => triggerMinOf(a) - triggerMinOf(b));
}

type EventRow = { id: number; stage: Stage; checker: Checker; teacher_id: number | null; class_name: string };

function eventRow(eventId: number): EventRow {
  const ev = row<EventRow>(
    getDb()
      .prepare(
        `SELECT e.id, e.stage, e.checker, s.teacher_id, c.name AS class_name
           FROM attendance_events e
           JOIN timetable_sessions s ON s.id = e.session_id
           JOIN classes c ON c.id = s.class_id
          WHERE e.id = ?`,
      )
      .get(eventId),
  );
  assert(ev, "출결 정보를 찾을 수 없습니다.");
  return ev;
}

const setStage = (eventId: number, stage: Stage) =>
  getDb().prepare("UPDATE attendance_events SET stage = ?, updated_at = ? WHERE id = ?").run(stage, nowIso(), eventId);

const deskOk = (u: SessionUser) => isRole(u, "ADMIN") || isRole(u, "DESK");

export type CheckInput = {
  eventId: number;
  records: { studentId: number; present: boolean; preNotified: boolean; absentReason?: string | null; absentCat?: AbsenceCat | null }[];
};

/**
 * ① 1차 출석체크 제출 — "왔음" 체크 = 출석, "결석 연락 받음" = 바로 결석(사유 필수).
 * 나머지(아직 안 온 학생)는 데스크 출결전화로 넘어간다. 다 왔으면 바로 끝난다.
 */
export function submitCheck(user: SessionUser, items: CheckInput[]): void {
  assert(items.length > 0, "제출할 출석체크가 없습니다.");
  const db = getDb();
  const toCall: string[] = [];
  const finished: number[] = [];

  // 여러 반을 한 번에 제출하므로, 하나라도 문제가 있으면 아무것도 저장하지 않는다 (먼저 전부 검사)
  const evs = new Map<number, EventRow>();
  for (const item of items) {
    const ev = eventRow(item.eventId);
    assert(ev.stage === "CHECK", `${ev.class_name} 출석체크는 이미 제출되었습니다.`);
    if (ev.checker === "TEACHER") {
      assert(isRole(user, "ADMIN") || (isRole(user, "TEACHER") && ev.teacher_id === user.id), "담당 선생님만 출석체크를 제출할 수 있습니다.");
    } else {
      assert(deskOk(user), "이 출석체크는 데스크가 제출합니다.");
    }
    for (const r of item.records) {
      assert(!r.preNotified || (r.absentReason ?? "").trim(), "결석 연락 받은 학생의 결석 사유를 입력해 주세요.");
    }
    evs.set(item.eventId, ev);
  }

  const stmt = db.prepare(
    `UPDATE attendance_records SET status = ?, pre_notified = ?, absent_reason = ?, absent_cat = ?
      WHERE event_id = ? AND student_id = ?`,
  );
  const recId = db.prepare("SELECT id, pre_notified FROM attendance_records WHERE event_id = ? AND student_id = ?");
  transaction(() => {
    for (const item of items) {
      const ev = evs.get(item.eventId)!;
      let waiting = 0;
      for (const r of item.records) {
        if (r.present) stmt.run("PRESENT", 0, null, null, item.eventId, r.studentId);
        else if (r.preNotified) {
          const reason = (r.absentReason ?? "").trim();
          const before = row<{ id: number; pre_notified: number }>(recId.get(item.eventId, r.studentId));
          stmt.run("ABSENT", 1, reason, r.absentCat ?? catOfReason(reason), item.eventId, r.studentId);
          // 미리 등록된 결석이면 그 결석에 연결, 아니면 당일 알림으로 새로
          if (before) ensureAbsenceFromRecord(before.id, "SAME_DAY", `${fmtTime(nowMin())} 출석체크 — 결석 연락 (${ev.class_name})`);
        } else {
          stmt.run("UNCHECKED", 0, null, null, item.eventId, r.studentId);
          waiting += 1;
        }
      }
      if (waiting > 0) {
        setStage(item.eventId, "CALL");
        toCall.push(`${ev.class_name} ${waiting}명`);
      } else {
        setStage(item.eventId, "DONE");
        finished.push(item.eventId);
      }
    }
  });

  if (toCall.length > 0) {
    for (const id of userIdsWithRole("DESK")) notify(id, "ATTENDANCE_CALL", "출결전화 돌려주세요.", toCall.join(" · "), "/attendance");
  }
  sendAttendanceResults(finished);
}

/**
 * ② 출결전화 — 버튼을 누를 때마다 학생 한 명의 진행 상태를 저장한다.
 * 같은 버튼을 다시 누르면 취소(클라이언트가 null 로 보낸다). 순서가 꼬이지 않게 normalizeCall 로 정리한다.
 */
export function updateCall(user: SessionUser, recordId: number, input: CallState): AttendanceRecord {
  assert(deskOk(user), "데스크만 출결전화를 기록할 수 있습니다.");
  const db = getDb();
  const cur = row<{ event_id: number; status: AttStatus; stage: Stage } & Record<string, unknown>>(
    db.prepare("SELECT r.*, e.stage FROM attendance_records r JOIN attendance_events e ON e.id = r.event_id WHERE r.id = ?").get(recordId),
  );
  assert(cur, "학생 출결 정보를 찾을 수 없습니다.");
  assert(cur.stage === "CALL" && cur.status === "UNCHECKED", "이미 저장된 출결전화입니다.");

  const next = normalizeCall(input);
  const t = nowMin();
  // 값이 새로 생긴 칸만 지금 시각을 찍고, 그대로면 원래 시각을 유지, 지워지면 비운다
  const stamp = (prev: unknown, prevAt: unknown, value: unknown) =>
    value === null || value === false ? null : prev === value ? ((prevAt as number | null) ?? t) : t;

  db.prepare(
    `UPDATE attendance_records
        SET student_call = ?, student_call_at = ?, parent_call = ?, parent_call_at = ?,
            kakao_at = ?, arrived_at = ?, call_result = ?, late_reason = ?, absent_reason = ?, absent_cat = ?, eta_min = ?,
            eta_unknown = ?
      WHERE id = ?`,
  ).run(
    next.studentCall,
    stamp(cur.student_call, cur.student_call_at, next.studentCall),
    next.parentCall,
    stamp(cur.parent_call, cur.parent_call_at, next.parentCall),
    next.kakao ? ((cur.kakao_at as number | null) ?? t) : null,
    next.arrived ? ((cur.arrived_at as number | null) ?? t) : null,
    next.callResult,
    next.callResult === "LATE" ? next.reason.trim() || null : null,
    next.callResult === "ABSENT" ? next.reason.trim() || null : null,
    next.callResult === "ABSENT" ? next.absentCat ?? catOfReason(next.reason) : null,
    next.etaMin,
    next.etaUnknown ? 1 : 0,
    recordId,
  );
  return attachRecords([{ id: cur.event_id, sessionId: 0, date: "" } as EventHead])[0].records.find((r) => r.id === recordId)!;
}

/** ② 출결전화 저장 — 남은 인원이 0명이고 통화된 학생의 정보가 다 채워져야 저장된다 */
export function completeCall(user: SessionUser, eventIds: number[]): void {
  assert(deskOk(user), "데스크만 출결전화를 저장할 수 있습니다.");
  const events = listAttendanceByIds(eventIds);
  assert(events.length > 0, "저장할 출결전화가 없습니다.");

  let remaining = 0;
  let missingInfo = 0;
  for (const e of events) {
    assert(e.stage === "CALL", `${e.className} 출결전화는 이미 저장되었습니다.`);
    for (const r of e.records.filter((r) => r.status === "UNCHECKED")) {
      const c = callStateOf(r);
      if (isRemaining(c)) remaining += 1;
      else if (needsInfo(c)) missingInfo += 1;
    }
  }
  assert(remaining === 0, `아직 연락이 닿지 않은 학생이 ${remaining}명 있습니다.`);
  assert(missingInfo === 0, `지각·결석 사유(도착예정시간)를 입력하지 않은 학생이 ${missingInfo}명 있습니다.`);

  const stmt = getDb().prepare("UPDATE attendance_records SET status = ? WHERE id = ?");
  transaction(() => {
    for (const e of events) {
      for (const r of e.records.filter((r) => r.status === "UNCHECKED")) {
        const status = finalStatus(callStateOf(r));
        stmt.run(status, r.id);
        if (status === "ABSENT") {
          const by = r.parentCall === "OK" ? "학부모 통화" : "학생 통화";
          ensureAbsenceFromRecord(r.id, "SAME_DAY", `${fmtTime(nowMin())} 출결전화 — ${by} (데스크)`);
        }
      }
      setStage(e.id, "DONE");
    }
  });
  sendAttendanceResults(events.map((e) => e.id));
}

function recordById(recordId: number): AttendanceRecord & { eventId: number } {
  const r = row<{ event_id: number }>(getDb().prepare("SELECT event_id FROM attendance_records WHERE id = ?").get(recordId));
  assert(r, "학생 출결 정보를 찾을 수 없습니다.");
  const rec = attachRecords([{ id: r.event_id, sessionId: 0, date: "" } as EventHead])[0].records.find((x) => x.id === recordId);
  assert(rec, "학생 출결 정보를 찾을 수 없습니다.");
  return { ...rec, eventId: r.event_id };
}

/**
 * ④ 나중 도착 — 데스크가 결석관리에서 [도착] 을 누른다. 선생님께 따로 알림은 보내지 않는다.
 * - 연락 안 됨 → 지각 명단으로 옮기고 도착 시각 기록
 * - 도착시간 모름 지각 → 실제 도착 시각만 기록
 * 다시 누르면(도착 취소) 원래대로 되돌린다.
 */
export function toggleLateArrival(user: SessionUser, recordId: number): void {
  assert(deskOk(user), "데스크만 도착 처리를 할 수 있습니다.");
  const db = getDb();
  const r = recordById(recordId);
  if (r.lateArrival) {
    db.prepare("UPDATE attendance_records SET status = 'NO_CONTACT', late_arrival = 0, arrived_at = NULL WHERE id = ?").run(recordId);
  } else if (r.status === "NO_CONTACT") {
    db.prepare("UPDATE attendance_records SET status = 'LATE', late_arrival = 1, arrived_at = ? WHERE id = ?").run(nowMin(), recordId);
  } else if (r.status === "LATE" && r.etaUnknown) {
    db.prepare("UPDATE attendance_records SET arrived_at = ? WHERE id = ?").run(r.arrivedAt === null ? nowMin() : null, recordId);
  } else {
    assert(false, "연락 안 됨 학생이나 도착시간을 모르는 지각 학생만 도착 처리할 수 있습니다.");
  }
}

/**
 * [결석으로 변경] — 연락 안 됨, 또는 도착시간을 모르는 지각 학생이 끝내 오지 않았을 때 (사유 필수).
 * 결석이 되면 보강 관리에 자동으로 올라간다(연락 안 됨이었으면 알린 때 = 무연락). 알림은 보내지 않는다.
 */
export function markAbsent(user: SessionUser, recordId: number, reason: string, cat?: AbsenceCat | null): void {
  assert(deskOk(user), "데스크만 결석으로 변경할 수 있습니다.");
  assert(reason.trim(), "결석 사유를 입력해 주세요.");
  const r = recordById(recordId);
  assert(canMarkAbsent(r), "연락 안 됨 학생이나 도착시간을 모르는 지각 학생만 결석으로 변경할 수 있습니다.");
  transaction(() => {
    getDb()
      .prepare("UPDATE attendance_records SET status = 'ABSENT', absent_from = ?, absent_reason = ?, absent_cat = ? WHERE id = ?")
      .run(r.status, reason.trim(), cat ?? catOfReason(reason), recordId);
    ensureAbsenceFromRecord(recordId, r.status === "NO_CONTACT" ? "NONE" : "SAME_DAY", `${fmtTime(nowMin())} 결석관리 — 결석으로 변경`);
  });
}

/** [결석으로 변경] 되돌리기 — 이미 보강을 잡았으면 되돌릴 수 없다 */
export function undoMarkAbsent(user: SessionUser, recordId: number): void {
  assert(deskOk(user), "데스크만 되돌릴 수 있습니다.");
  const r = recordById(recordId);
  assert(r.status === "ABSENT" && r.absentFrom, "결석으로 변경한 기록이 아닙니다.");
  transaction(() => {
    removeAbsenceForRecord(recordId);
    // 지각이었다면 사유는 late_reason 에 그대로 남아 있다
    getDb()
      .prepare("UPDATE attendance_records SET status = ?, absent_from = NULL, absent_reason = NULL, absent_cat = NULL WHERE id = ?")
      .run(r.absentFrom, recordId);
  });
}

/**
 * ③ 출결 결과 — 팝업 없이 알림함에만 넣는다.
 * 담당 선생님은 본인 반만, 관리자는 이번에 끝난 모든 반을 한 번에 받는다. 지각·결석·연락 안 됨이 없으면 보내지 않는다.
 */
function sendAttendanceResults(eventIds: number[]): void {
  const events = listAttendanceByIds(eventIds);
  const withIssues = events.filter((e) => e.records.some((r) => ISSUE.has(r.status)));
  if (withIssues.length === 0) return;

  const date = withIssues[0].date;
  const admins = new Set(userIdsWithRole("ADMIN"));
  for (const e of withIssues) {
    if (!e.teacherId || admins.has(e.teacherId)) continue; // 관리자는 아래에서 전체로 받는다
    notify(e.teacherId, "ATTENDANCE_RESULT", "출결사항 확인해주세요.", `${e.className} · ${issueSummary([e])}`, `/attendance?date=${date}&events=${e.id}`);
  }
  const ids = withIssues.map((e) => e.id).join(",");
  const title = `${fmtTime(Math.min(...withIssues.map((e) => e.triggerMin)))} 출결 · ${withIssues.map((e) => e.className).join(", ")}`;
  for (const a of admins) {
    notify(a, "ATTENDANCE_RESULT", "출결사항 확인해주세요.", `${title} · ${issueSummary(withIssues)}`, `/attendance?date=${date}&events=${ids}`);
  }
}

const ISSUE = new Set<AttStatus>(["LATE", "ABSENT", "NO_CONTACT"]);

function issueSummary(events: AttendanceEvent[]): string {
  const all = events.flatMap((e) => e.records);
  const n = (s: AttStatus) => all.filter((r) => r.status === s).length;
  return (
    [
      ["지각", n("LATE")],
      ["결석", n("ABSENT")],
      ["연락 안 됨", n("NO_CONTACT")],
    ] as const
  )
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");
}

export function attendanceSummary(date: string, dept: DeptFilter = "ALL") {
  const events = listAttendance(date, dept);
  const byStage: Record<Stage, number> = { CHECK: 0, CALL: 0, DONE: 0 };
  const count: Record<AttStatus, number> = { UNCHECKED: 0, PRESENT: 0, ABSENT: 0, LATE: 0, NO_CONTACT: 0 };
  for (const e of events) {
    byStage[e.stage] += 1;
    for (const r of e.records) count[r.status] += 1;
  }
  return {
    total: events.length,
    byStage,
    present: count.PRESENT,
    absent: count.ABSENT,
    late: count.LATE,
    noContact: count.NO_CONTACT,
    unchecked: count.UNCHECKED,
  };
}

/** 분기 안에서 학생별 지각 날짜 (숙제반 지각 3회 규칙) */
export function latesSince(from: string, to: string): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const r of rows<{ student_id: number; date: string }>(
    getDb()
      .prepare(
        `SELECT DISTINCT r.student_id, e.date FROM attendance_records r JOIN attendance_events e ON e.id = r.event_id
          WHERE r.status = 'LATE' AND e.date BETWEEN ? AND ? ORDER BY e.date`,
      )
      .all(from, to),
  )) {
    out.set(r.student_id, [...(out.get(r.student_id) ?? []), r.date]);
  }
  return out;
}

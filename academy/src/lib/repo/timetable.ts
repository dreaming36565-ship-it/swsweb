// ★ 서버 전용. 반 · 학생 · 시간표(반 + 칸) · 알파·수업 순서 바꾸기 · 교실배정 · 교실 경고.

import { getDb } from "../db";
import { assert } from "../errors";
import { rebuildSrSeats, srRoster } from "../seed";
import { bookShort } from "../books";
import { detectConflicts, type ConflictSession } from "../conflicts";
import { rangeLabel, weekDateOf } from "../time";
import type {
  Book,
  ChangeKind,
  ClassModel,
  ClassPart,
  ClassRow,
  Conflict,
  Department,
  RoomBooking,
  SessionType,
  Student,
  TempSwap,
  TimetableSession,
} from "../types";
import { deptWhere, getSetting, nowIso, row, rows, setSetting, today, transaction, type DeptFilter } from "./base";
import { listBooks, listRooms } from "./staff";

/** 반·학생·시간이 바뀌면 SR 주간 자리를 다시 맞춘다 (지금 자리는 그대로, 새 학생만 앉힘) */
export const refreshSr = () => rebuildSrSeats(getDb());

/* ---------------------------------------------------------------------- 반 */

export function listClasses(dept: DeptFilter = "ALL"): ClassRow[] {
  const w = deptWhere("c.department", dept);
  return rows<ClassRow>(
    getDb()
      .prepare(
        `SELECT c.id, c.name, c.department, c.teacher_id AS teacherId, u.name AS teacherName,
                c.room_id AS roomId, r.name AS roomName, c.grade, c.textbook, c.level, c.hapban_with AS hapbanWith,
                (SELECT COUNT(*) FROM student_classes sc JOIN students s ON s.id = sc.student_id
                  WHERE sc.class_id = c.id AND s.active = 1) AS studentCount
           FROM classes c
           LEFT JOIN users u ON u.id = c.teacher_id
           LEFT JOIN rooms r ON r.id = c.room_id
          WHERE 1 = 1${w.sql}
          ORDER BY c.department, c.name`,
      )
      .all(...w.args),
  );
}

export function deleteClass(id: number): void {
  getDb().prepare("DELETE FROM classes WHERE id = ?").run(id);
  refreshSr();
}

/* -------------------------------------------------------------------- 학생 */

export function listStudents(dept: DeptFilter = "ALL", classId?: number | null): Student[] {
  const db = getDb();
  const w = deptWhere("s.department", dept);
  const args: (string | number)[] = [...w.args];
  let sql = `SELECT s.id, s.name, s.department, s.active FROM students s WHERE s.active = 1${w.sql}`;
  if (classId) {
    sql += " AND EXISTS (SELECT 1 FROM student_classes sc WHERE sc.student_id = s.id AND sc.class_id = ?)";
    args.push(classId);
  }
  sql += " ORDER BY s.name, s.id";
  const list = rows<Omit<Student, "classIds" | "classNames">>(db.prepare(sql).all(...args));
  const memberships = rows<{ student_id: number; class_id: number; class_name: string }>(
    db
      .prepare(
        `SELECT sc.student_id, sc.class_id, c.name AS class_name
           FROM student_classes sc JOIN classes c ON c.id = sc.class_id ORDER BY c.name`,
      )
      .all(),
  );
  const byStudent = new Map<number, { ids: number[]; names: string[] }>();
  for (const m of memberships) {
    const cur = byStudent.get(m.student_id) ?? { ids: [], names: [] };
    cur.ids.push(m.class_id);
    cur.names.push(m.class_name);
    byStudent.set(m.student_id, cur);
  }
  return list.map((s) => ({ ...s, classIds: byStudent.get(s.id)?.ids ?? [], classNames: byStudent.get(s.id)?.names ?? [] }));
}

export function updateStudent(id: number, input: { name?: string; department?: string }): void {
  const db = getDb();
  assert(row(db.prepare("SELECT id FROM students WHERE id = ?").get(id)), "학생을 찾을 수 없습니다.");
  if (input.name !== undefined) {
    assert(input.name.trim(), "학생 이름을 입력해 주세요.");
    db.prepare("UPDATE students SET name = ? WHERE id = ?").run(input.name.trim(), id);
  }
  if (input.department !== undefined) db.prepare("UPDATE students SET department = ? WHERE id = ?").run(input.department, id);
}

export function deleteStudent(id: number): void {
  getDb().prepare("DELETE FROM students WHERE id = ?").run(id);
  refreshSr();
}

/** 이름으로 학생 찾기 (없으면 새로 등록) — 같은 이름이면 그 학생 */
function studentIdByName(name: string, department: string): number {
  const db = getDb();
  const found = row<{ id: number }>(db.prepare("SELECT id FROM students WHERE name = ? AND active = 1 ORDER BY id LIMIT 1").get(name));
  if (found) return found.id;
  return Number(db.prepare("INSERT INTO students (name, department, active) VALUES (?, ?, 1)").run(name, department).lastInsertRowid);
}

/**
 * 반 학생 명단을 이 이름들로 맞춘다. 같은 이름의 학생이 있으면 그 학생이 이 반에도 들어간다.
 * 빠진 학생은 이 반에서만 빠진다 (다른 반 소속은 그대로).
 */
export function syncRoster(classId: number, names: string[]): void {
  const db = getDb();
  const cls = row<{ department: string }>(db.prepare("SELECT department FROM classes WHERE id = ?").get(classId));
  assert(cls, "반을 찾을 수 없습니다.");
  const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  transaction(() => {
    const ids = clean.map((n) => studentIdByName(n, cls.department));
    db.prepare(`DELETE FROM student_classes WHERE class_id = ?${ids.length ? ` AND student_id NOT IN (${ids.map(() => "?").join(",")})` : ""}`).run(
      classId,
      ...ids,
    );
    const ins = db.prepare("INSERT OR IGNORE INTO student_classes (student_id, class_id) VALUES (?, ?)");
    for (const id of ids) ins.run(id, classId);
  });
  refreshSr();
}

/** 명단 엑셀 올리기 — 이미 있는 반에 새 학생만 더한다 (빼지는 않는다). 없는 반은 건너뛴다 */
export function rosterUpload(lines: { className: string; studentName: string }[], apply: boolean) {
  const db = getDb();
  const classes = listClasses("ALL");
  const byClass = new Map<string, { className: string; classId: number | null; names: string[]; add: string[] }>();
  for (const l of lines) {
    const cn = l.className.trim();
    const sn = l.studentName.trim();
    if (!cn || !sn) continue;
    const cls = classes.find((c) => c.name.toLowerCase() === cn.toLowerCase());
    const key = cls ? String(cls.id) : `x:${cn}`;
    const cur = byClass.get(key) ?? { className: cls?.name ?? cn, classId: cls?.id ?? null, names: [], add: [] };
    if (!cur.names.includes(sn)) cur.names.push(sn);
    byClass.set(key, cur);
  }
  for (const g of byClass.values()) {
    if (!g.classId) continue;
    const have = new Set(listStudents("ALL", g.classId).map((s) => s.name));
    g.add = g.names.filter((n) => !have.has(n));
  }
  let added = 0;
  if (apply) {
    transaction(() => {
      const ins = db.prepare("INSERT OR IGNORE INTO student_classes (student_id, class_id) VALUES (?, ?)");
      for (const g of byClass.values()) {
        if (!g.classId) continue;
        const dept = classes.find((c) => c.id === g.classId)!.department;
        for (const n of g.add) {
          ins.run(studentIdByName(n, dept), g.classId);
          added += 1;
        }
      }
    });
    refreshSr();
  }
  return { groups: [...byClass.values()], added };
}

/* ------------------------------------------------------------------ 시간표 */

const SESSION_SELECT = `SELECT s.id, s.day_of_week AS dayOfWeek, s.class_id AS classId, c.name AS className,
                 c.department, s.type, s.label, s.start_min AS startMin, s.end_min AS endMin,
                 s.alpha_start_min AS alphaStartMin, s.alpha_end_min AS alphaEndMin,
                 s.room_id AS roomId, r.name AS roomName,
                 s.alpha_room_id AS alphaRoomId, ar.name AS alphaRoomName, COALESCE(ar.is_sr, 1) AS alphaIsSr,
                 s.teacher_id AS teacherId, u.name AS teacherName,
                 (SELECT COUNT(*) FROM student_classes sc JOIN students st ON st.id = sc.student_id
                   WHERE sc.class_id = c.id AND st.active = 1) AS studentCount
            FROM timetable_sessions s
            JOIN classes c ON c.id = s.class_id
            LEFT JOIN rooms r ON r.id = s.room_id
            LEFT JOIN rooms ar ON ar.id = s.alpha_room_id
            LEFT JOIN users u ON u.id = s.teacher_id`;

/** 그 날짜만 순서를 바꾼 수업이면 수업 시간과 알파 시간을 맞바꿔 보여준다 */
export function applySwap(s: TimetableSession): TimetableSession {
  if (s.alphaStartMin === null || s.alphaEndMin === null) return s;
  return { ...s, startMin: s.alphaStartMin, endMin: s.alphaEndMin, alphaStartMin: s.startMin, alphaEndMin: s.endMin, swapped: true };
}

/** 그 날짜에 "하루만" 바꾼 수업 id */
function swappedOn(date: string): Set<number> {
  return new Set(rows<{ session_id: number }>(getDb().prepare("SELECT session_id FROM session_swaps WHERE date = ?").all(date)).map((r) => r.session_id));
}

/**
 * 요일의 수업. date 를 주면 그 날짜의 ⇄ 하루만 바꾼 순서를 반영한다
 * (출결 시작 시각 · SR 실시간 · 대시보드가 이걸 쓴다).
 */
export function listSessions(day: number, dept: DeptFilter = "ALL", date?: string | null): TimetableSession[] {
  const w = deptWhere("c.department", dept);
  const list = rows<TimetableSession>(
    getDb().prepare(`${SESSION_SELECT} WHERE s.day_of_week = ?${w.sql} ORDER BY s.start_min, s.id`).all(day, ...w.args),
  );
  if (!date) return list;
  const sw = swappedOn(date);
  return list.map((s) => (sw.has(s.id) ? applySwap(s) : s));
}

export function listAllSessions(): TimetableSession[] {
  return rows<TimetableSession>(getDb().prepare(`${SESSION_SELECT} ORDER BY s.day_of_week, s.start_min, s.id`).all());
}

/** 수업 한 건을 그 날짜 기준으로 */
export function sessionOn(sessionId: number, date: string): TimetableSession | undefined {
  const s = row<TimetableSession>(getDb().prepare(`${SESSION_SELECT} WHERE s.id = ?`).get(sessionId));
  if (!s) return undefined;
  return swappedOn(date).has(s.id) ? applySwap(s) : s;
}

function studentIdsByClass(): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const s of rows<{ id: number; class_id: number }>(
    getDb().prepare("SELECT s.id, sc.class_id FROM student_classes sc JOIN students s ON s.id = sc.student_id WHERE s.active = 1").all(),
  )) {
    map.set(s.class_id, [...(map.get(s.class_id) ?? []), s.id]);
  }
  return map;
}

export function conflictsForDay(day: number, date?: string): Conflict[] {
  const sessions = listSessions(day, "ALL", date);
  const byClass = studentIdsByClass();
  const srRoomIds = new Set(listRooms().filter((r) => r.isSr === 1).map((r) => r.id));
  // 수업 없이 SR만 쓰는 반(누적오답 · 숙제반)은 선생님이 가르치는 시간이 아니다
  const input: ConflictSession[] = sessions.map((s) => ({
    ...s,
    teacherId: isSrOnly(s, srRoomIds) ? null : s.teacherId,
    studentIds: byClass.get(s.classId) ?? [],
  }));
  // 🔗 합반끼리는 같은 교실 · 같은 선생님이어도 겹침이 아니다
  const hapban = new Map(listClasses("ALL").map((c) => [c.id, c.hapbanWith]));
  return detectConflicts(input, srRoomIds, (a, b) => hapban.get(a) === b);
}

const isSrOnly = (s: TimetableSession, srRooms: Set<number>) =>
  s.roomId !== null && srRooms.has(s.roomId) && s.alphaStartMin === s.startMin && s.alphaEndMin === s.endMin;

/** 시간표 화면용 — 반마다 칸(수업 · SR)으로 묶는다. 칸이 같으면(시간·강의실·담당·교재) 요일을 합친다 */
export function listClassModels(): ClassModel[] {
  const db = getDb();
  const srRooms = new Set(listRooms().filter((r) => r.isSr === 1).map((r) => r.id));
  const sessions = listAllSessions();
  const books = new Map<number, number[]>();
  for (const b of rows<{ session_id: number; book_id: number }>(db.prepare("SELECT session_id, book_id FROM session_books ORDER BY book_id").all())) {
    books.set(b.session_id, [...(books.get(b.session_id) ?? []), b.book_id]);
  }
  const members = rows<{ class_id: number; id: number; name: string }>(
    db
      .prepare(
        `SELECT sc.class_id, s.id, s.name FROM student_classes sc JOIN students s ON s.id = sc.student_id
          WHERE s.active = 1 ORDER BY s.name, s.id`,
      )
      .all(),
  );
  // 숙제반은 반 명단 대신 이번 달 신청 + 강제 참석 학생
  const roster = srRoster(db);
  const hwMembers = new Map(roster.classes.map((c) => [c.id, c.members]));
  const names = new Map(rows<{ id: number; name: string }>(db.prepare("SELECT id, name FROM students").all()).map((x) => [x.id, x.name]));
  const ops = new Map(
    rows<{ id: number; level_changed: number; change_kind: string | null; change_note: string | null }>(
      db.prepare("SELECT id, level_changed, change_kind, change_note FROM classes").all(),
    ).map((x) => [x.id, x]),
  );
  const snapshot = getSnapshot();
  const out: ClassModel[] = [];
  for (const c of listClasses("ALL")) {
    const ss = sessions.filter((s) => s.classId === c.id);
    const parts: ClassPart[] = [];
    const add = (p: Omit<ClassPart, "days">, day: number) => {
      const same = parts.find(
        (x) =>
          x.kind === p.kind &&
          x.label === p.label &&
          x.start === p.start &&
          x.end === p.end &&
          x.roomId === p.roomId &&
          x.teacherId === p.teacherId &&
          x.bookIds.join(",") === p.bookIds.join(","),
      );
      if (same) {
        if (!same.days.includes(day)) same.days.push(day);
      } else parts.push({ ...p, days: [day] });
    };
    const srOnly = ss.length > 0 && ss.every((s) => isSrOnly(s, srRooms));
    for (const s of ss) {
      if (isSrOnly(s, srRooms)) {
        add({ kind: "SR", label: s.label || "SR 자기주도", start: s.startMin, end: s.endMin, roomId: s.roomId, roomName: s.roomName, teacherId: null, teacherName: null, bookIds: [] }, s.dayOfWeek);
        continue;
      }
      add(
        {
          kind: "CLASS",
          label: s.label || "수업",
          start: s.startMin,
          end: s.endMin,
          roomId: s.roomId,
          roomName: s.roomName,
          teacherId: s.teacherId,
          teacherName: s.teacherName,
          bookIds: books.get(s.id) ?? [],
        },
        s.dayOfWeek,
      );
      // 알파 칸이 교실이면 두 번째 수업 (수업+수업)
      if (s.alphaStartMin !== null && s.alphaEndMin !== null && s.alphaRoomId !== null && !srRooms.has(s.alphaRoomId)) {
        add(
          { kind: "CLASS", label: "수업", start: s.alphaStartMin, end: s.alphaEndMin, roomId: s.alphaRoomId, roomName: s.alphaRoomName, teacherId: s.teacherId, teacherName: s.teacherName, bookIds: [] },
          s.dayOfWeek,
        );
      } else if (s.alphaStartMin !== null && s.alphaEndMin !== null) {
        add(
          { kind: "SR", label: "SR", start: s.alphaStartMin, end: s.alphaEndMin, roomId: s.alphaRoomId, roomName: s.alphaRoomName, teacherId: null, teacherName: null, bookIds: [] },
          s.dayOfWeek,
        );
      }
    }
    for (const p of parts) p.days.sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    parts.sort((a, b) => a.start - b.start);
    out.push({
      id: c.id,
      name: c.name,
      department: c.department,
      type: (ss[0]?.type as SessionType) ?? "REGULAR",
      grade: c.grade,
      level: c.level,
      textbook: c.textbook,
      teacherId: c.teacherId,
      teacherName: c.teacherName,
      students:
        c.grade === "숙제반"
          ? (hwMembers.get(c.id) ?? []).map((id) => ({ id, name: names.get(id) ?? "", days: roster.memberDays.get(`${c.id}|${id}`) ?? [] })).sort((a, b) => a.name.localeCompare(b.name, "ko"))
          : members.filter((m) => m.class_id === c.id).map((m) => ({ id: m.id, name: m.name })),
      days: [...new Set(ss.map((s) => s.dayOfWeek))].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)),
      parts,
      srOnly,
      hapbanWith: c.hapbanWith,
      levelChanged: ops.get(c.id)?.level_changed === 1,
      changeKind: (ops.get(c.id)?.change_kind as ChangeKind | "N" | null) ?? null,
      changeNote: ops.get(c.id)?.change_note ?? null,
      change: null,
    });
  }
  for (const m of out) m.change = changeOf(m, snapshot);
  return out;
}

/* ------------------------------------------------------------ 교체 (지난 분기 저장본과 비교) */

/** 분기 마감 저장본 — 반 이름 → 담당 · 수업 시간. 다음 분기 시간표와 반 이름으로 비교한다 */
export type TermSnapshot = { label: string; savedAt: string; classes: Record<string, { teacher: string | null; sched: string }> };

const SNAPSHOT_KEY = "tt_snapshot";

export function getSnapshot(): TermSnapshot | null {
  const raw = getSetting(SNAPSHOT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TermSnapshot;
  } catch {
    return null;
  }
}

/** 수업 칸의 담당 (없으면 반 담당) */
const mainTeacherName = (c: ClassModel) => c.parts.find((p) => p.kind === "CLASS")?.teacherName ?? c.teacherName;

/** 수업 시간 모양 — "135@880-980;6@600-700" (수업 칸만, SR만 쓰는 반은 SR 칸) */
function schedKey(c: ClassModel): string {
  const main = c.parts.filter((p) => p.kind === "CLASS");
  return (main.length ? main : c.parts)
    .map((p) => `${[...p.days].sort().join("")}@${p.start}-${p.end}`)
    .sort()
    .join(";");
}

/** 보여줄 교체 — 직접 입력이 먼저(N = 없음), 없으면 저장본과 비교: 담당이 바뀌면 담임교체, 시간이 바뀌면 시간교체 */
function changeOf(c: ClassModel, snap: TermSnapshot | null): ClassModel["change"] {
  if (c.changeKind === "N") return null;
  if (c.changeKind) return { kind: c.changeKind, note: c.changeNote ?? "" };
  const prev = snap?.classes[c.name];
  if (!snap || !prev) return null;
  const teacher = (prev.teacher ?? null) !== (mainTeacherName(c) ?? null);
  const time = prev.sched !== schedKey(c);
  if (!teacher && !time) return null;
  return {
    kind: teacher && time ? "B" : teacher ? "T" : "H",
    note: teacher && prev.teacher ? `${snap.label} ${prev.teacher}T` : "",
  };
}

/**
 * 📸 분기 마감 저장 — 지금 시간표를 「지난 분기」로 저장해 두고, 직접 넣은 교체 표시 · 반레벨 변경을 지운다.
 * 다음 분기 시간표를 고치면 반 이름으로 비교해 담임교체 · 시간교체가 저절로 붙는다.
 */
export function saveSnapshot(label: string): void {
  const name = label.trim();
  assert(name, "저장본 이름을 넣어 주세요. 예) 4분기");
  const classes: TermSnapshot["classes"] = {};
  for (const c of listClassModels()) classes[c.name] = { teacher: mainTeacherName(c) ?? null, sched: schedKey(c) };
  transaction(() => {
    setSetting(SNAPSHOT_KEY, JSON.stringify({ label: name, savedAt: nowIso(), classes } satisfies TermSnapshot));
    getDb().exec("UPDATE classes SET change_kind = NULL, change_note = NULL, level_changed = 0");
  });
}

export type ClassInput = {
  id: number | null;
  name: string;
  department: string;
  grade: string;
  level: string | null;
  teacherId: number | null;
  days: number[];
  parts: { kind: "CLASS" | "SR"; label: string; start: number; end: number; roomId: number | null; teacherId: number | null; days: number[]; bookIds: number[] }[];
  students: string[];
  /** 🔗 합반 상대 반 (없으면 null) */
  hapbanWith?: number | null;
  /** 반레벨 변경 · 교체 표시 직접 입력 (null = 자동, N = 없음) */
  levelChanged?: boolean;
  changeKind?: string | null;
  changeNote?: string | null;
};

const typeForGrade = (grade: string): SessionType =>
  grade === "개별" ? "INDIVIDUAL" : grade === "누적오답" ? "REVIEW" : grade === "숙제반" ? "HOMEWORK" : "REGULAR";

/**
 * 반 저장 — 반 정보 + 칸들 + 학생. 칸은 요일마다 「수업 칸 1개 + SR 칸 1개」까지 (출결·SR 자리가 요일마다 한 번이라서).
 * 수업은 요일마다 한 줄로 저장한다. 이미 있는 요일의 줄은 그대로 고쳐서 출결 기록을 지키고, 빠진 요일만 지운다.
 */
export function saveClass(input: ClassInput): number {
  const db = getDb();
  const name = input.name.trim();
  assert(name, "반 이름을 입력해 주세요.");
  const dup = listClasses("ALL").find((c) => c.id !== input.id && c.name.toLowerCase() === name.toLowerCase());
  assert(!dup, "같은 이름의 반이 이미 있어요.");
  const grade = (input.grade ?? "").trim();
  assert(grade, "학년을 입력해 주세요.");
  const custom = !/^(초|중|고)/.test(grade) && !["누적오답", "숙제반", "개별"].includes(grade);
  assert(!custom || input.level, "직접 입력한 학년은 학교급(초등·중등·고등)을 골라 주세요.");
  assert(input.days.length > 0, "수업 요일을 하나 이상 골라 주세요.");
  assert(input.parts.length > 0, "칸을 하나 이상 넣어 주세요.");
  const rooms = listRooms();
  const srRoom = rooms.find((r) => r.isSr === 1);
  for (const p of input.parts) {
    const label = p.label.trim() || (p.kind === "SR" ? "SR" : "수업");
    assert(p.end > p.start, `「${label}」 칸의 끝 시간이 시작보다 늦어야 해요.`);
    assert(p.days.length > 0, `「${label}」 칸의 요일이 비어 있어요.`);
    assert(p.roomId, `「${label}」 칸의 강의실을 골라 주세요.`);
  }
  for (const d of input.days) {
    const on = input.parts.filter((p) => p.days.includes(d));
    assert(on.length > 0, `${"일월화수목금토"[d]}요일에 칸이 없어요. 요일을 빼거나 칸의 요일에 넣어 주세요.`);
    const dn = "일월화수목금토"[d];
    const cls = on.filter((p) => p.kind === "CLASS").sort((a, b) => a.start - b.start);
    const srs = on.filter((p) => p.kind === "SR");
    assert(srs.length <= 1, `${dn}요일에 SR 칸이 두 개예요. 한 요일에는 SR 칸 1개까지 넣을 수 있어요.`);
    assert(cls.length <= 2, `${dn}요일에 수업 칸이 세 개예요. 한 요일에는 수업 2개(수업+수업) 또는 수업 1개 + SR 1개까지예요.`);
    if (cls.length === 2) {
      // 수업+수업 — 두 번째 수업은 알파 자리에 저장한다 (SR 칸과 같이 쓸 수 없음)
      assert(srs.length === 0, `${dn}요일은 수업 2개 + SR 은 넣을 수 없어요. 수업+수업 또는 수업+SR 중 하나로 해 주세요.`);
      assert(cls[1].start >= cls[0].end, `${dn}요일 두 수업 칸의 시간이 겹쳐요.`);
      assert(cls[0].teacherId === cls[1].teacherId, `${dn}요일 두 수업 칸의 담당 선생님이 달라요. 수업+수업은 같은 선생님만 돼요.`);
      assert(!srRoom || cls[1].roomId !== srRoom.id, `${dn}요일 두 번째 수업 칸의 강의실이 SR룸이에요. SR이면 칸 종류를 SR로 바꿔 주세요.`);
    }
  }

  const department = input.department === "HIGH" ? "HIGH" : "ELEM";
  const allBooks = listBooks();
  const bookText = [...new Set(input.parts.flatMap((p) => p.bookIds))]
    .map((id) => allBooks.find((b) => b.id === id))
    .filter((b): b is Book => !!b)
    .map(bookShort)
    .join(", ");

  return transaction(() => {
    let classId = input.id;
    let type: SessionType;
    if (classId) {
      const cur = row<{ type: string | null }>(
        db.prepare("SELECT (SELECT type FROM timetable_sessions WHERE class_id = c.id LIMIT 1) AS type FROM classes c WHERE c.id = ?").get(classId),
      );
      assert(cur, "반을 찾을 수 없습니다.");
      type = (cur.type as SessionType) ?? typeForGrade(grade);
      db.prepare(
        "UPDATE classes SET name = ?, department = ?, grade = ?, level = ?, teacher_id = ?, textbook = COALESCE(NULLIF(?, ''), textbook) WHERE id = ?",
      ).run(name, department, grade, custom ? input.level : null, input.teacherId, bookText, classId);
    } else {
      type = typeForGrade(grade);
      classId = Number(
        db
          .prepare("INSERT INTO classes (name, department, teacher_id, room_id, grade, textbook, level) VALUES (?, ?, ?, ?, ?, ?, ?)")
          .run(name, department, input.teacherId, input.parts.find((p) => p.kind === "CLASS")?.roomId ?? null, grade, bookText || null, custom ? input.level : null)
          .lastInsertRowid,
      );
    }

    const existing = rows<{ id: number; day_of_week: number }>(
      db.prepare("SELECT id, day_of_week FROM timetable_sessions WHERE class_id = ? ORDER BY id").all(classId),
    );
    const update = db.prepare(
      `UPDATE timetable_sessions SET type = ?, label = ?, start_min = ?, end_min = ?, alpha_start_min = ?, alpha_end_min = ?,
              room_id = ?, alpha_room_id = ?, teacher_id = ? WHERE id = ?`,
    );
    const insert = db.prepare(
      `INSERT INTO timetable_sessions (day_of_week, class_id, type, label, start_min, end_min, alpha_start_min, alpha_end_min, room_id, alpha_room_id, teacher_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const del = db.prepare("DELETE FROM timetable_sessions WHERE id = ?");
    const clearBooks = db.prepare("DELETE FROM session_books WHERE session_id = ?");
    const addBook = db.prepare("INSERT OR IGNORE INTO session_books (session_id, book_id) VALUES (?, ?)");
    const used = new Set<number>();
    for (const d of input.days) {
      const mains = input.parts.filter((p) => p.kind === "CLASS" && p.days.includes(d)).sort((a, b) => a.start - b.start);
      const main = mains[0];
      // 수업+수업이면 두 번째 수업이 알파 자리 (강의실 = 교실)
      const sr = mains[1] ?? input.parts.find((p) => p.kind === "SR" && p.days.includes(d));
      // 수업 없이 SR만 — 수업 시간 = SR 시간, 강의실 = SR 칸의 강의실, 담당 = 반 담당
      const v = main
        ? {
            label: main.label.trim() || "수업",
            start: main.start,
            end: main.end,
            aStart: sr?.start ?? null,
            aEnd: sr?.end ?? null,
            room: main.roomId,
            aRoom: sr ? sr.roomId ?? srRoom?.id ?? null : null,
            teacher: main.teacherId,
            books: [...new Set(mains.flatMap((p) => p.bookIds))],
          }
        : {
            label: sr!.label.trim() || "SR 자기주도",
            start: sr!.start,
            end: sr!.end,
            aStart: sr!.start,
            aEnd: sr!.end,
            room: sr!.roomId,
            aRoom: sr!.roomId,
            teacher: input.teacherId,
            books: [] as number[],
          };
      const cur = existing.find((e) => e.day_of_week === d && !used.has(e.id));
      let sessionId: number;
      if (cur) {
        used.add(cur.id);
        sessionId = cur.id;
        update.run(type, v.label, v.start, v.end, v.aStart, v.aEnd, v.room, v.aRoom, v.teacher, cur.id);
      } else {
        sessionId = Number(insert.run(d, classId, type, v.label, v.start, v.end, v.aStart, v.aEnd, v.room, v.aRoom, v.teacher).lastInsertRowid);
      }
      clearBooks.run(sessionId);
      for (const b of v.books) addBook.run(sessionId, b);
    }
    for (const e of existing) if (!used.has(e.id)) del.run(e.id);
    syncRosterNoRefresh(classId, input.students, department);
    if (input.hapbanWith !== undefined) setHapban(classId, input.hapbanWith ?? null);
    if (input.levelChanged !== undefined) db.prepare("UPDATE classes SET level_changed = ? WHERE id = ?").run(input.levelChanged ? 1 : 0, classId);
    if (input.changeKind !== undefined) {
      const kind = ["N", "T", "H", "B"].includes(input.changeKind ?? "") ? input.changeKind : null;
      const note = kind && kind !== "N" ? (input.changeNote ?? "").trim() || null : null;
      db.prepare("UPDATE classes SET change_kind = ?, change_note = ? WHERE id = ?").run(kind, note, classId);
    }
    refreshSr();
    return classId;
  });
}

/**
 * 🔗 합반 — 양쪽 반에 서로 적는다 (예전 짝은 풀린다).
 * 같은 요일에 같은 강의실 · 같은 선생님으로 수업 시간이 겹치는 반만 묶을 수 있다.
 * 짝이 바뀌면 두 반의 SR 자리(사람이 옮긴 자리 빼고)를 다시 잡는다 — 같은 열에 이어서 앉히려고.
 */
function setHapban(classId: number, partner: number | null): void {
  const db = getDb();
  const cur = row<{ hapban_with: number | null }>(db.prepare("SELECT hapban_with FROM classes WHERE id = ?").get(classId))?.hapban_with ?? null;
  if (cur === partner) return;
  if (partner !== null) {
    assert(partner !== classId, "자기 반과는 합반할 수 없어요.");
    const p = row<{ name: string }>(db.prepare("SELECT name FROM classes WHERE id = ?").get(partner));
    assert(p, "합반할 반을 찾을 수 없습니다.");
    const mine = listAllSessions().filter((s) => s.classId === classId);
    const theirs = listAllSessions().filter((s) => s.classId === partner);
    const ok = mine.some((a) =>
      theirs.some((b) => a.dayOfWeek === b.dayOfWeek && a.roomId === b.roomId && a.teacherId === b.teacherId && a.startMin < b.endMin && b.startMin < a.endMin),
    );
    assert(ok, `${p.name}과(와) 같은 요일 · 같은 강의실 · 같은 선생님으로 겹치는 수업이 없어 합반할 수 없어요.`);
  }
  const touched = [classId, cur, partner].filter((x): x is number => x !== null);
  // 얽혀 있던 짝을 모두 풀고 새로 묶는다
  const place = touched.map(() => "?").join(",");
  db.prepare(`UPDATE classes SET hapban_with = NULL WHERE id IN (${place}) OR hapban_with IN (${place})`).run(...touched, ...touched);
  if (partner !== null) {
    db.prepare("UPDATE classes SET hapban_with = ? WHERE id = ?").run(partner, classId);
    db.prepare("UPDATE classes SET hapban_with = ? WHERE id = ?").run(classId, partner);
  }
  db.prepare(`DELETE FROM sr_seats WHERE manual = 0 AND class_id IN (${place})`).run(...touched);
}

function syncRosterNoRefresh(classId: number, names: string[], department: string): void {
  const db = getDb();
  const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const ids = clean.map((n) => studentIdByName(n, department));
  db.prepare(`DELETE FROM student_classes WHERE class_id = ?${ids.length ? ` AND student_id NOT IN (${ids.map(() => "?").join(",")})` : ""}`).run(
    classId,
    ...ids,
  );
  const ins = db.prepare("INSERT OR IGNORE INTO student_classes (student_id, class_id) VALUES (?, ?)");
  for (const id of ids) ins.run(id, classId);
}

/** 사용교재 입력 — 그 칸의 모든 요일(수업 줄)에 같은 교재 */
export function setPartBooks(classId: number, days: number[], bookIds: number[]): void {
  const db = getDb();
  const sessions = rows<{ id: number }>(
    db
      .prepare(`SELECT id FROM timetable_sessions WHERE class_id = ? AND day_of_week IN (${days.map(() => "?").join(",") || "NULL"})`)
      .all(classId, ...days),
  );
  assert(sessions.length > 0, "칸을 찾을 수 없습니다.");
  transaction(() => {
    for (const s of sessions) {
      db.prepare("DELETE FROM session_books WHERE session_id = ?").run(s.id);
      for (const b of bookIds) db.prepare("INSERT OR IGNORE INTO session_books (session_id, book_id) VALUES (?, ?)").run(s.id, b);
    }
    const all = listBooks();
    const names = rows<{ book_id: number }>(
      db.prepare("SELECT DISTINCT sb.book_id FROM session_books sb JOIN timetable_sessions s ON s.id = sb.session_id WHERE s.class_id = ?").all(classId),
    )
      .map((r) => all.find((b) => b.id === r.book_id))
      .filter((b): b is Book => !!b)
      .map(bookShort);
    if (names.length) db.prepare("UPDATE classes SET textbook = ? WHERE id = ?").run(names.join(", "), classId);
  });
}

/* ------------------------------------------------- ⇄ 알파·수업 순서 바꾸기 */

/** 이번 주 하루만 바꾼 반 (이번 주 월~일) */
export function listTempSwaps(): TempSwap[] {
  const from = weekDateOf(1);
  const to = weekDateOf(0);
  return rows<TempSwap>(
    getDb()
      .prepare(
        `SELECT s.class_id AS classId, s.day_of_week AS day, w.date, w.session_id AS sessionId
           FROM session_swaps w JOIN timetable_sessions s ON s.id = w.session_id
          WHERE w.date BETWEEN ? AND ?`,
      )
      .all(from, to),
  );
}

function sessionFor(classId: number, day: number) {
  return row<{ id: number; start_min: number; end_min: number; alpha_start_min: number | null; alpha_end_min: number | null }>(
    getDb()
      .prepare("SELECT id, start_min, end_min, alpha_start_min, alpha_end_min FROM timetable_sessions WHERE class_id = ? AND day_of_week = ?")
      .get(classId, day),
  );
}

function swapPermanently(sessionId: number): void {
  getDb()
    .prepare(
      `UPDATE timetable_sessions SET start_min = alpha_start_min, end_min = alpha_end_min, alpha_start_min = start_min, alpha_end_min = end_min
        WHERE id = ? AND alpha_start_min IS NOT NULL`,
    )
    .run(sessionId);
}

/**
 * 고른 반들의 그 요일 알파 시간과 수업 시간을 맞바꾼다.
 * keep=false → 이번 주 그 날짜 하루만 (다음 주엔 저절로 원래대로), keep=true → 다시 바꿀 때까지 매주.
 * 이번 주만 바꿔 둔 반을 다시 바꾸면 원래대로 돌아온다.
 */
export function swapOrder(day: number, classIds: number[], keep: boolean): void {
  assert(classIds.length > 0, "바꿀 반을 골라 주세요.");
  const date = weekDateOf(day);
  const db = getDb();
  transaction(() => {
    for (const id of classIds) {
      const s = sessionFor(id, day);
      assert(s && s.alpha_start_min !== null, "알파와 수업이 함께 있는 반만 바꿀 수 있어요.");
      const temp = row(db.prepare("SELECT 1 AS x FROM session_swaps WHERE session_id = ? AND date = ?").get(s.id, date));
      if (temp) db.prepare("DELETE FROM session_swaps WHERE session_id = ? AND date = ?").run(s.id, date);
      else if (keep) swapPermanently(s.id);
      else db.prepare("INSERT INTO session_swaps (session_id, date) VALUES (?, ?)").run(s.id, date);
    }
  });
  refreshSr();
}

/** 이번 주만 바꾼 반 → 원래대로 / 계속 적용으로 */
export function resolveTempSwap(classId: number, day: number, action: "UNDO" | "KEEP"): void {
  const s = sessionFor(classId, day);
  assert(s, "수업을 찾을 수 없습니다.");
  const date = weekDateOf(day);
  transaction(() => {
    getDb().prepare("DELETE FROM session_swaps WHERE session_id = ? AND date = ?").run(s.id, date);
    if (action === "KEEP") swapPermanently(s.id);
  });
  refreshSr();
}

/* ------------------------------------------------------ 교실배정 · 교실 경고 */

export function listBookings(from: string, to: string): RoomBooking[] {
  return rows<RoomBooking>(
    getDb()
      .prepare(
        `SELECT b.id, b.date, b.room_id AS roomId, r.name AS roomName, b.start_min AS start, b.end_min AS end, b.name,
                b.headcount, b.teacher_id AS teacherId, u.name AS teacherName
           FROM room_bookings b JOIN rooms r ON r.id = b.room_id LEFT JOIN users u ON u.id = b.teacher_id
          WHERE b.date BETWEEN ? AND ? ORDER BY b.date, b.start_min`,
      )
      .all(from, to),
  );
}

/** 교실배정 — 그 날짜 하루만. 수업·다른 배정과 겹치면 막는다 */
export function createBooking(
  userId: number,
  input: { date: string; roomId: number; start: number; end: number; name: string; headcount?: number | null; teacherId?: number | null },
): number {
  const name = input.name.trim();
  assert(name, "무엇에 쓰는지 입력해 주세요.");
  assert(input.end > input.start, "끝 시간이 시작보다 늦어야 해요.");
  assert(input.date >= today(), "지난 날짜에는 잡을 수 없어요.");
  const day = new Date(`${input.date}T00:00:00`).getDay();
  const room = listRooms().find((r) => r.id === input.roomId);
  assert(room, "강의실을 찾을 수 없습니다.");
  const clash = listSessions(day, "ALL", input.date).find(
    (s) =>
      (s.roomId === room.id && s.startMin < input.end && input.start < s.endMin) ||
      (s.alphaRoomId === room.id && s.alphaStartMin !== null && s.alphaStartMin < input.end && input.start < (s.alphaEndMin ?? 0)),
  );
  assert(room.isSr === 1 || !clash, `${room.name}은(는) ${clash ? `${clash.className} 수업이 있어요` : ""}`);
  const other = listBookings(input.date, input.date).find((b) => b.roomId === room.id && b.start < input.end && input.start < b.end);
  assert(!other, `${room.name}은(는) ${rangeLabel(other?.start ?? 0, other?.end ?? 0)} 「${other?.name ?? ""}」로 이미 잡혀 있어요.`);
  return Number(
    getDb()
      .prepare(
        "INSERT INTO room_bookings (date, room_id, start_min, end_min, name, headcount, teacher_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(input.date, room.id, input.start, input.end, name, input.headcount ?? null, input.teacherId ?? null, userId, nowIso()).lastInsertRowid,
  );
}

export function deleteBooking(id: number): void {
  getDb().prepare("DELETE FROM room_bookings WHERE id = ?").run(id);
}

export function listAlertOk(): string[] {
  return rows<{ key: string }>(getDb().prepare("SELECT key FROM room_alert_ok").all()).map((r) => r.key);
}

export function setAlertOk(userId: number, key: string, on: boolean): void {
  assert(key, "경고를 찾을 수 없습니다.");
  if (on) getDb().prepare("INSERT OR IGNORE INTO room_alert_ok (key, by_user, created_at) VALUES (?, ?, ?)").run(key, userId, nowIso());
  else getDb().prepare("DELETE FROM room_alert_ok WHERE key = ?").run(key);
}

export type { Department };

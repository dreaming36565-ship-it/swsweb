// ★ 서버 전용. 알림 · 공지 · 업무 지시 · 대시보드.

import { getDb } from "../db";
import { assert } from "../errors";
import type { Notice, Notification, SessionUser, Task } from "../types";
import { notify, nowIso, row, rows, type DeptFilter } from "./base";
import { listSessions } from "./timetable";
import { roundsOn } from "./absence";

/* -------------------------------------------------------------- 알림/공지/업무 */

export function listNotifications(userId: number, limit = 30): Notification[] {
  return rows<Notification>(
    getDb()
      .prepare(
        `SELECT id, kind, title, body, link, read_at AS readAt, created_at AS createdAt
           FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(userId, limit),
  );
}

export function unreadCount(userId: number): number {
  return (
    row<{ n: number }>(
      getDb()
        .prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL")
        .get(userId),
    )?.n ?? 0
  );
}

export function markNotificationsRead(userId: number): void {
  getDb()
    .prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL")
    .run(nowIso(), userId);
}

export function listNotices(dept: DeptFilter = "ALL", limit = 50): Notice[] {
  const db = getDb();
  const args: (string | number)[] = [];
  let sql = `SELECT n.id, n.title, n.body, n.department, n.author_id AS authorId, u.name AS authorName,
                    n.created_at AS createdAt
               FROM notices n LEFT JOIN users u ON u.id = n.author_id WHERE 1 = 1`;
  if (dept && dept !== "ALL") {
    sql += " AND (n.department = ? OR n.department = 'ALL')";
    args.push(dept);
  }
  sql += " ORDER BY n.id DESC LIMIT ?";
  args.push(limit);
  return rows<Notice>(db.prepare(sql).all(...args));
}

export function createNotice(input: {
  title: string;
  body: string;
  department: string;
  authorId: number;
}): number {
  assert(input.title.trim(), "공지 제목을 입력해 주세요.");
  assert(input.body.trim(), "공지 내용을 입력해 주세요.");
  const db = getDb();
  const r = db
    .prepare(
      "INSERT INTO notices (title, body, department, author_id, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(input.title.trim(), input.body.trim(), input.department, input.authorId, nowIso());

  const targets =
    input.department === "ALL"
      ? rows<{ id: number }>(db.prepare("SELECT id FROM users WHERE active = 1").all())
      : rows<{ id: number }>(
          db.prepare("SELECT id FROM users WHERE active = 1 AND department = ?").all(input.department),
        );
  for (const t of targets) notify(t.id, "NOTICE", "새 공지가 등록되었습니다.", input.title.trim(), "/notices");
  return Number(r.lastInsertRowid);
}

export function listTasks(opts: { assigneeId?: number; all?: boolean }): Task[] {
  const db = getDb();
  const args: (string | number)[] = [];
  let sql = `SELECT t.id, t.assignee_id AS assigneeId, a.name AS assigneeName, t.created_by AS createdBy,
                    b.name AS createdByName, t.title, t.done, t.due_date AS dueDate, t.created_at AS createdAt
               FROM tasks t
               JOIN users a ON a.id = t.assignee_id
               LEFT JOIN users b ON b.id = t.created_by
              WHERE 1 = 1`;
  if (!opts.all && opts.assigneeId) {
    sql += " AND t.assignee_id = ?";
    args.push(opts.assigneeId);
  }
  sql += " ORDER BY t.done, t.id DESC";
  return rows<Task>(db.prepare(sql).all(...args));
}

export function createTask(input: {
  assigneeId: number;
  createdBy: number;
  title: string;
  dueDate?: string | null;
}): number {
  assert(input.title.trim(), "업무 내용을 입력해 주세요.");
  assert(input.assigneeId, "담당자를 선택해 주세요.");
  const db = getDb();
  const r = db
    .prepare(
      "INSERT INTO tasks (assignee_id, created_by, title, done, due_date, created_at) VALUES (?, ?, ?, 0, ?, ?)",
    )
    .run(input.assigneeId, input.createdBy, input.title.trim(), input.dueDate || null, nowIso());
  notify(input.assigneeId, "TASK", "새 업무가 지시되었습니다.", input.title.trim(), "/tasks");
  return Number(r.lastInsertRowid);
}

export function setTaskDone(id: number, done: boolean, user: SessionUser): void {
  const db = getDb();
  const t = row<{ assignee_id: number }>(db.prepare("SELECT assignee_id FROM tasks WHERE id = ?").get(id));
  assert(t, "업무를 찾을 수 없습니다.");
  assert(user.roles.includes("ADMIN") || t.assignee_id === user.id, "내 업무만 체크할 수 있습니다.");
  db.prepare("UPDATE tasks SET done = ? WHERE id = ?").run(done ? 1 : 0, id);
}

export function deleteTask(id: number): void {
  getDb().prepare("DELETE FROM tasks WHERE id = ?").run(id);
}

/* ---------------------------------------------------------------- 대시보드 */

export type ScheduleItem = { startMin: number; endMin: number; title: string; subtitle: string };

/** 오늘의 일정 — 선생님 권한이 있으면 담당 수업, 아니면(관리자·데스크) 전체. 그날의 ⇄ 순서 · 보강 포함 */
export function todaySchedule(user: SessionUser, dayOfWeek: number, date: string): ScheduleItem[] {
  const sessions = listSessions(dayOfWeek, "ALL", date);
  const teacher = user.roles.includes("TEACHER");
  const mine = teacher ? sessions.filter((s) => s.teacherId === user.id) : sessions;
  const items: ScheduleItem[] = [];
  for (const s of mine) {
    const srOnly = s.alphaStartMin === s.startMin && s.alphaEndMin === s.endMin;
    if (!srOnly) {
      items.push({
        startMin: s.startMin,
        endMin: s.endMin,
        title: `${s.className} ${s.label ?? "수업"}${s.swapped ? " (⇄ 오늘만)" : ""}`,
        subtitle: [s.roomName, s.teacherName ? `${s.teacherName}T` : null].filter(Boolean).join(" · "),
      });
    }
    if (s.alphaStartMin !== null && s.alphaEndMin !== null) {
      const mission = s.type !== "INDIVIDUAL" && s.type !== "HOMEWORK";
      items.push({
        startMin: s.alphaStartMin,
        endMin: s.alphaEndMin,
        title: `${s.className} SR`,
        subtitle: [s.alphaRoomName ?? "SR룸", mission ? "📄 미션지 필요" : null].filter(Boolean).join(" · "),
      });
    }
  }
  // 보강도 담당 선생님 일정에 함께 뜬다
  for (const r of roundsOn(date)) {
    if (teacher && r.teacherId !== user.id) continue;
    items.push({ startMin: r.startMin, endMin: r.startMin + 50, title: `${r.studentName} 보강`, subtitle: r.className });
  }
  return items.sort((a, b) => a.startMin - b.startMin || a.title.localeCompare(b.title));
}

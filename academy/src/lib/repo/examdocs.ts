// ★ 서버 전용. 📄 기출분석 — 리포트 · 블로그 원고 문장 고치기.
// 직원이 고친 것 = 확인 대기(PENDING) → 원장님 반영(APPROVED) / 거절(REJECTED). 관리자가 고친 것은 바로 반영.
// 반영된 것은 학원 컴퓨터(sync_edits.py)가 받아 가서 PDF를 다시 만들고, 새 문서를 올린 뒤 synced_at 을 찍는다.
// 문서 HTML 은 DATA_DIR/examdocs/<id>.html (DB 밖, 볼륨 안).

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, getDb } from "../db";
import { assert } from "../errors";
import type { SessionUser } from "../types";
import { getSetting, nowIso, row, rows, setSetting } from "./base";

export type ExamDocKind = "REPORT" | "BLOG";
export type ExamEditStatus = "PENDING" | "APPROVED" | "REJECTED";

export type ExamDoc = { id: string; grp: string; name: string; kind: ExamDocKind; orderNo: number; updatedAt: string; pending: number };
/** 문서 위에 덮어 보여줄 문장 — pending = 「확인 중」 표시 */
export type ExamOverlay = { path: string; html: string; pending: boolean };
export type ExamEdit = {
  id: number;
  docId: string;
  docName: string;
  path: string;
  label: string;
  before: string;
  after: string;
  /** 선생님이면 「이름T」 */
  userName: string;
  createdAt: string;
  status: ExamEditStatus;
  decidedAt: string | null;
  decidedBy: string | null;
  syncedAt: string | null;
};
export type ExamDocUser = { id: number; name: string; roles: string; on: boolean };

const DOC_DIR = path.join(DATA_DIR, "examdocs");
const validId = (id: string) => /^[a-z0-9_]{1,60}$/.test(id);
export const examDocFile = (id: string) => path.join(DOC_DIR, `${id}.html`);

export function listExamDocs(): ExamDoc[] {
  return rows<ExamDoc>(
    getDb()
      .prepare(
        `SELECT d.id, d.grp, d.name, d.kind, d.order_no AS orderNo, d.updated_at AS updatedAt,
                (SELECT COUNT(*) FROM exam_doc_edits e WHERE e.doc_id = d.id AND e.status = 'PENDING') AS pending
         FROM exam_docs d ORDER BY d.order_no, d.id`,
      )
      .all(),
  );
}

export function readExamDocHtml(id: string): string | null {
  if (!validId(id) || !existsSync(examDocFile(id))) return null;
  return readFileSync(examDocFile(id), "utf-8");
}

/** 문서에 덮어 보여줄 문장 — 아직 PDF에 안 들어간 반영 + 확인 대기 (같은 곳은 나중 것) */
export function examDocOverlay(docId: string): ExamOverlay[] {
  const list = rows<{ path: string; after: string; status: ExamEditStatus }>(
    getDb()
      .prepare(
        `SELECT path, after, status FROM exam_doc_edits
         WHERE doc_id = ? AND (status = 'PENDING' OR (status = 'APPROVED' AND synced_at IS NULL)) ORDER BY id`,
      )
      .all(docId),
  );
  const byPath = new Map<string, ExamOverlay>();
  for (const e of list) byPath.set(e.path, { path: e.path, html: e.after, pending: e.status === "PENDING" });
  return [...byPath.values()];
}

export function submitExamEdits(
  user: SessionUser,
  admin: boolean,
  docId: string,
  items: { path?: string; label?: string; before?: string; after?: string }[],
): number {
  assert(validId(docId) && row(getDb().prepare("SELECT 1 AS x FROM exam_docs WHERE id = ?").get(docId)), "문서를 찾을 수 없습니다.");
  const clean = items.filter((it) => typeof it.path === "string" && it.path && typeof it.after === "string").slice(0, 200);
  assert(clean.length, "바뀐 문장이 없습니다.");
  const now = nowIso();
  const ins = getDb().prepare(
    `INSERT INTO exam_doc_edits (doc_id, path, label, before, after, user_id, user_name, created_at, status, decided_at, decided_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const it of clean) {
    ins.run(
      docId,
      it.path!.slice(0, 200),
      (it.label ?? "").slice(0, 120),
      (it.before ?? "").slice(0, 20000),
      it.after!.slice(0, 20000),
      user.id,
      user.name,
      now,
      admin ? "APPROVED" : "PENDING",
      admin ? now : null,
      admin ? user.name : null,
    );
  }
  return clean.length;
}

const EDIT_COLS = `e.id, e.doc_id AS docId, COALESCE(d.name, e.doc_id) AS docName, e.path, e.label, e.before, e.after,
  CASE WHEN (',' || COALESCE(NULLIF(u.roles, ''), u.role, '') || ',') LIKE '%,TEACHER,%' THEN e.user_name || 'T' ELSE e.user_name END AS userName, e.created_at AS createdAt, e.status, e.decided_at AS decidedAt, e.decided_by AS decidedBy, e.synced_at AS syncedAt`;

export function listExamEdits(status: ExamEditStatus | null): ExamEdit[] {
  const where = status ? "WHERE e.status = ?" : "";
  return rows<ExamEdit>(
    getDb()
      .prepare(`SELECT ${EDIT_COLS} FROM exam_doc_edits e LEFT JOIN exam_docs d ON d.id = e.doc_id LEFT JOIN users u ON u.id = e.user_id ${where} ORDER BY e.id DESC LIMIT 2000`)
      .all(...(status ? [status] : [])),
  );
}

export function decideExamEdits(user: SessionUser, ids: number[], status: "APPROVED" | "REJECTED"): number {
  const up = getDb().prepare("UPDATE exam_doc_edits SET status = ?, decided_at = ?, decided_by = ? WHERE id = ? AND status = 'PENDING'");
  const now = nowIso();
  let n = 0;
  for (const id of ids) n += Number(up.run(status, now, user.name, id).changes);
  assert(n, "이미 처리된 수정입니다.");
  return n;
}

/** 메뉴를 보여 줄 수 있는 직원 (관리자 · 알바 제외) */
export function listExamDocUsers(): ExamDocUser[] {
  return rows<{ id: number; name: string; roles: string; role: string; exam_docs: number }>(
    getDb().prepare("SELECT id, name, roles, role, exam_docs FROM users WHERE active = 1 AND employment != 'PART' ORDER BY name").all(),
  )
    .filter((u) => !(u.roles || u.role).split(",").includes("ADMIN"))
    .map((u) => ({ id: u.id, name: u.name, roles: u.roles || u.role, on: u.exam_docs === 1 }));
}

export function setExamDocUser(id: number, on: boolean): void {
  getDb().prepare("UPDATE users SET exam_docs = ? WHERE id = ?").run(on ? 1 : 0, id);
}

// ---------- 학원 컴퓨터(sync_edits.py) 연결 ----------

/** 학원 컴퓨터가 쓰는 연결 열쇠 — 처음 볼 때 만든다 */
export function examSyncKey(): string {
  let key = getSetting("examdocs_sync_key");
  if (!key) {
    key = randomBytes(18).toString("base64url");
    setSetting("examdocs_sync_key", key);
  }
  return key;
}

export function newExamSyncKey(): string {
  setSetting("examdocs_sync_key", null);
  return examSyncKey();
}

export function checkExamSyncKey(got: string | null): boolean {
  const key = getSetting("examdocs_sync_key");
  return !!key && !!got && got === key;
}

export function putExamDoc(meta: { id: string; grp: string; name: string; kind: string; orderNo: number }, html: string): void {
  assert(validId(meta.id), "문서 이름이 올바르지 않습니다.");
  assert(meta.kind === "REPORT" || meta.kind === "BLOG", "문서 종류가 올바르지 않습니다.");
  mkdirSync(DOC_DIR, { recursive: true });
  writeFileSync(examDocFile(meta.id), html, "utf-8");
  getDb()
    .prepare(
      `INSERT INTO exam_docs (id, grp, name, kind, order_no, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET grp = excluded.grp, name = excluded.name, kind = excluded.kind, order_no = excluded.order_no, updated_at = excluded.updated_at`,
    )
    .run(meta.id, meta.grp.slice(0, 80), meta.name.slice(0, 80), meta.kind, meta.orderNo, nowIso());
}

/** 반영됐지만 아직 PDF에 안 들어간 수정 (오래된 것부터 — 같은 곳은 나중 것이 이긴다) */
export function examUnsynced(): ExamEdit[] {
  return rows<ExamEdit>(
    getDb()
      .prepare(`SELECT ${EDIT_COLS} FROM exam_doc_edits e LEFT JOIN exam_docs d ON d.id = e.doc_id LEFT JOIN users u ON u.id = e.user_id WHERE e.status = 'APPROVED' AND e.synced_at IS NULL ORDER BY e.id`)
      .all(),
  );
}

export function markExamSynced(ids: number[]): number {
  const up = getDb().prepare("UPDATE exam_doc_edits SET synced_at = ? WHERE id = ? AND status = 'APPROVED'");
  const now = nowIso();
  let n = 0;
  for (const id of ids) n += Number(up.run(now, id).changes);
  return n;
}

export function lastExamSync(): string | null {
  return row<{ t: string | null }>(getDb().prepare("SELECT MAX(synced_at) AS t FROM exam_doc_edits").get())?.t ?? null;
}

// ★ 서버 전용. 백업 — 지금 백업 받기 · 하루 한 번 자동 백업(14개 보관) · 백업 올리기(복원).
// 백업 파일 = DB 파일 한 개(.db). 실제 학생 이름이 들어 있으니 관리자만 받는다.

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, closeDb, dbPath, getDb } from "./db";
import { resetSecret } from "./auth";
import { AppError, assert } from "./errors";
import { dateKey } from "./time";

const BACKUP_DIR = path.join(DATA_DIR, "backups");
const KEEP = 14;
const NAME = /^academy-\d{4}-\d{2}-\d{2}\.db$/;

function ensureDir() {
  mkdirSync(BACKUP_DIR, { recursive: true });
}

/** 지금 DB를 파일 하나로 복사 (쓰는 중이어도 안전하게 — VACUUM INTO) */
function snapshotTo(file: string): void {
  if (existsSync(file)) unlinkSync(file);
  getDb().prepare("VACUUM INTO ?").run(file);
}

/** 💾 지금 백업 받기 */
export function backupNow(): Buffer {
  ensureDir();
  const tmp = path.join(BACKUP_DIR, `tmp-${Date.now()}.db`);
  snapshotTo(tmp);
  try {
    return readFileSync(tmp);
  } finally {
    unlinkSync(tmp);
  }
}

let lastDaily = "";
/** 하루 한 번 자동 백업 — 4초 폴링에서 부른다. 최근 14개만 남긴다 */
export function dailyBackup(): void {
  const today = dateKey(new Date());
  if (lastDaily === today) return;
  lastDaily = today;
  try {
    ensureDir();
    const file = path.join(BACKUP_DIR, `academy-${today}.db`);
    if (!existsSync(file)) snapshotTo(file);
    const all = readdirSync(BACKUP_DIR).filter((f) => NAME.test(f)).sort();
    for (const old of all.slice(0, Math.max(0, all.length - KEEP))) unlinkSync(path.join(BACKUP_DIR, old));
  } catch (e) {
    // 백업 실패가 출결 폴링을 막지 않게 — 서버 기록에만 남기고 내일 다시
    console.error("자동 백업 실패", e);
  }
}

export function listBackups(): { name: string; size: number }[] {
  if (!existsSync(BACKUP_DIR)) return [];
  return readdirSync(BACKUP_DIR)
    .filter((f) => NAME.test(f) || /^before-restore-.+\.db$/.test(f))
    .sort()
    .reverse()
    .map((name) => ({ name, size: statSync(path.join(BACKUP_DIR, name)).size }));
}

export function readBackup(name: string): Buffer {
  assert(NAME.test(name) || /^before-restore-[\w-]+\.db$/.test(name), "백업 파일 이름이 올바르지 않아요.");
  const file = path.join(BACKUP_DIR, name);
  assert(existsSync(file), "백업 파일을 찾을 수 없어요.");
  return readFileSync(file);
}

/**
 * 📤 백업 올리기(복원) — 올린 파일이 이 앱의 DB가 맞는지 확인한 뒤 통째로 바꾼다.
 * 바꾸기 전 지금 DB는 backups/before-restore-… 로 남긴다. 바꾼 뒤에는 모두 다시 로그인해야 한다.
 */
export function restoreFrom(buf: Buffer): void {
  assert(buf.length > 100 && buf.subarray(0, 16).toString("latin1") === "SQLite format 3\u0000", "학원 앱 백업 파일(.db)이 아니에요.");
  ensureDir();
  const tmp = path.join(BACKUP_DIR, `upload-${Date.now()}.db`);
  writeFileSync(tmp, buf);
  try {
    const check = new DatabaseSync(tmp, { readOnly: true });
    try {
      const ok = (check.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
      assert(ok === "ok", "백업 파일이 손상됐어요.");
      const tables = new Set((check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name));
      assert(["users", "classes", "students", "timetable_sessions"].every((t) => tables.has(t)), "학원 앱 백업 파일이 아니에요.");
      const admins = (check.prepare("SELECT COUNT(*) AS n FROM users WHERE active = 1 AND (roles LIKE '%ADMIN%' OR role = 'ADMIN')").get() as { n: number }).n;
      assert(admins > 0, "이 백업에는 관리자 계정이 없어서 올릴 수 없어요.");
    } finally {
      check.close();
    }
  } catch (e) {
    unlinkSync(tmp);
    if (e instanceof AppError) throw e;
    throw new AppError("백업 파일을 열 수 없어요. 학원 앱에서 받은 .db 파일인지 확인해 주세요.");
  }
  // 지금 DB를 남겨 두고 바꾼다
  const now = new Date();
  const stamp = `${dateKey(now)}-${[now.getHours(), now.getMinutes(), now.getSeconds()].map((n) => String(n).padStart(2, "0")).join("")}`;
  snapshotTo(path.join(BACKUP_DIR, `before-restore-${stamp}.db`));
  closeDb();
  renameSync(tmp, dbPath);
  resetSecret();
  getDb(); // 새 파일을 열고 마이그레이션
}

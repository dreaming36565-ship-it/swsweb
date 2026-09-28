import { numParam, readJson, requirePermission, strParam, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import {
  addRound,
  cancelCarry,
  decideCarry,
  deleteAbsence,
  deleteRound,
  listAbsences,
  listStudents,
  preRegister,
  preRegisterDates,
  requestCarry,
  setRoundState,
  today,
  updateAbsence,
  type AbsencePatch,
} from "@/lib/repo";
import type { RoundState } from "@/lib/types";

/** 보강 관리 — 결석 전체(회차·기록 포함) + 학생 목록. ?preview=학생id&from=&to= 이면 미리 등록할 수업 날짜 */
export const GET = withUser(({ user, req }) => {
  requirePermission(user, "makeups.read");
  const pid = numParam(req, "preview");
  if (pid) return { dates: preRegisterDates(pid, strParam(req, "from") ?? "", strParam(req, "to") ?? "") };
  return {
    today: today(),
    absences: listAbsences(),
    students: listStudents("ALL").map((s) => ({ id: s.id, name: s.name, classNames: s.classNames })),
  };
});

type Body =
  | ({ action: "UPDATE"; id: number } & AbsencePatch)
  | { action: "ADD_ROUND"; id: number; type: "MAKEUP" | "TASK"; date?: string; startMin?: number }
  | { action: "ROUND_STATE"; roundId: number; state: RoundState }
  | { action: "ROUND_DELETE"; roundId: number }
  | { action: "CARRY_REQUEST"; id: number; reason: string }
  | { action: "CARRY_CANCEL"; id: number }
  | { action: "CARRY_DECIDE"; id: number; ok: boolean; note?: string }
  | { action: "PRE_REGISTER"; studentId: number; from: string; to: string; reason: string }
  | { action: "DELETE"; id: number };

export const POST = withUser(async ({ user, req }) => {
  const b = await readJson<Body>(req);
  switch (b.action) {
    case "UPDATE": {
      const { id, ...patch } = b;
      delete (patch as { action?: string }).action;
      updateAbsence(user, id, patch);
      return null;
    }
    case "ADD_ROUND":
      addRound(user, b.id, { type: b.type, date: b.date ?? null, startMin: b.startMin ?? null });
      return null;
    case "ROUND_STATE":
      setRoundState(user, b.roundId, b.state);
      return null;
    case "ROUND_DELETE":
      deleteRound(user, b.roundId);
      return null;
    case "CARRY_REQUEST":
      requestCarry(user, b.id, b.reason ?? "");
      return null;
    case "CARRY_CANCEL":
      cancelCarry(user, b.id);
      return null;
    case "CARRY_DECIDE":
      decideCarry(user, b.id, b.ok === true, b.note ?? null);
      return null;
    case "PRE_REGISTER":
      return { added: preRegister(user, b) };
    case "DELETE":
      deleteAbsence(user, b.id);
      return null;
    default:
      assert(false, "할 일이 지정되지 않았습니다.");
  }
});

import { readJson, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import { srAddAdhoc, srAdhocAnswer, srAdhocCancel, srAdhocPurge, srAdhocRequest, srAnswer, srConfirmNext, srDeleteAdhoc, srMission, srMissionCheck, srMove, srMoveClass, srNextMove, srNextMoveClass, srPack, srRequest, srToggleLeave } from "@/lib/repo";

type Body =
  /** ↔ 자리 바꾸기 (데스크·관리자) */
  | { action: "MOVE"; classId: number; studentId: number; seat: string }
  /** 🙋 자리 요청 (선생님) */
  | { action: "REQUEST"; classId: number; studentId: number; seat: string; scope: "TODAY" | "ALWAYS"; reason?: string }
  /** 요청 승인 / 거절 */
  | { action: "ANSWER"; id: number; ok: boolean }
  /** ＋ 임시 자리 / 지우기 */
  | { action: "ADHOC"; date: string; name: string; kind: string; start: number; end: number; seat: string }
  | { action: "ADHOC_DEL"; id: number }
  /** 🙋 SR 자리 요청 (선생님) · 취소 · 배정/거절 (데스크) */
  | { action: "ADHOC_REQUEST"; name: string; kind: string; start: number; end: number; memo?: string }
  | { action: "ADHOC_CANCEL"; id: number }
  | { action: "ADHOC_ANSWER"; id: number; ok: boolean; seat?: string }
  /** 🗑 요청 기록 지우기 (관리자) */
  | { action: "ADHOC_PURGE"; id: number }
  /** 🏠 하원 (다시 누르면 취소) */
  | { action: "LEAVE"; classId: number; studentId: number }
  /** 📄 미션지 */
  | { action: "MISSION"; classId: number; kind: "RECEIVE" | "CANCEL" | "REQUEST" | "DONE" }
  /** 📄 미션지 확인 — 있는 반 받음 + 없는 반 요청을 한 번에 */
  | { action: "MISSION_CHECK"; have: number[]; missing: number[] }
  /** 🧹 자리 정리 — PACK 앞으로 당기기 / RESET 처음부터 다시 앉히기 */
  | { action: "PACK"; mode?: "PACK" | "RESET" }
  /** ↔ 반 통째로 옮기기 · 맞바꾸기 (데스크·관리자) */
  | { action: "MOVE_CLASS"; classId: number; col: string }
  /** 📌 다음 달 자리 확정 / 확정 풀기 (관리자) */
  | { action: "CONFIRM_NEXT"; undo?: boolean }
  /** 📅 다음 달 자리 고치기 — 학생 옮기기·맞바꾸기 / 반 통째로 (데스크·관리자, 고치면 확정) */
  | { action: "NEXT_MOVE"; classId: number; studentId: number; seat: string }
  | { action: "NEXT_MOVE_CLASS"; classId: number; col: string };

export const POST = withUser(async ({ user, req }) => {
  const b = await readJson<Body>(req);
  switch (b.action) {
    case "MOVE":
      srMove(user, b.classId, b.studentId, b.seat);
      break;
    case "REQUEST":
      srRequest(user, b);
      break;
    case "ANSWER":
      srAnswer(user, b.id, b.ok);
      break;
    case "ADHOC":
      srAddAdhoc(user, b);
      break;
    case "ADHOC_DEL":
      srDeleteAdhoc(user, b.id);
      break;
    case "ADHOC_REQUEST":
      srAdhocRequest(user, b);
      break;
    case "ADHOC_CANCEL":
      srAdhocCancel(user, b.id);
      break;
    case "ADHOC_ANSWER":
      srAdhocAnswer(user, b.id, b.ok, b.seat);
      break;
    case "ADHOC_PURGE":
      srAdhocPurge(user, b.id);
      break;
    case "LEAVE":
      srToggleLeave(user, b.classId, b.studentId);
      break;
    case "MISSION":
      srMission(user, b.classId, b.kind);
      break;
    case "MISSION_CHECK":
      srMissionCheck(user, b.have ?? [], b.missing ?? []);
      break;
    case "PACK":
      srPack(user, b.mode === "RESET" ? "RESET" : "PACK");
      break;
    case "CONFIRM_NEXT":
      srConfirmNext(user, b.undo === true);
      break;
    case "NEXT_MOVE":
      srNextMove(user, b.classId, b.studentId, b.seat);
      break;
    case "NEXT_MOVE_CLASS":
      srNextMoveClass(user, b.classId, b.col);
      break;
    case "MOVE_CLASS":
      srMoveClass(user, b.classId, b.col);
      break;
    default:
      assert(false, "할 일이 지정되지 않았습니다.");
  }
  return null;
});

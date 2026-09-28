import { readJson, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import { srAddAdhoc, srAnswer, srDeleteAdhoc, srMission, srMove, srPack, srRequest, srToggleLeave } from "@/lib/repo";

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
  /** 🏠 하원 (다시 누르면 취소) */
  | { action: "LEAVE"; classId: number; studentId: number }
  /** 📄 미션지 */
  | { action: "MISSION"; classId: number; kind: "RECEIVE" | "CANCEL" | "REQUEST" | "DONE" }
  /** 🧹 월초 자리 정리 */
  | { action: "PACK" };

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
    case "LEAVE":
      srToggleLeave(user, b.classId, b.studentId);
      break;
    case "MISSION":
      srMission(user, b.classId, b.kind);
      break;
    case "PACK":
      srPack(user);
      break;
    default:
      assert(false, "할 일이 지정되지 않았습니다.");
  }
  return null;
});

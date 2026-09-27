import { readJson, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import {
  completeCall,
  markAbsent,
  submitCheck,
  toggleLateArrival,
  undoMarkAbsent,
  updateCall,
  type CheckInput,
} from "@/lib/repo";
import type { CallState } from "@/lib/types";

type Body =
  /** ① 1차 출석체크 제출 */
  | { step: "CHECK"; items: CheckInput[] }
  /** ② 출결전화 — 학생 한 명의 진행 상태 저장 (버튼 누를 때마다) */
  | { step: "CALL"; recordId: number; state: CallState }
  /** ② 출결전화 저장 완료 */
  | { step: "CALL_DONE"; eventIds: number[] }
  /** ④ 나중 도착 — 연락 안 됨 / 도착시간 모름 지각 (다시 누르면 취소) */
  | { step: "ARRIVE"; recordId: number }
  /** 결석으로 변경 (사유 필수) / 되돌리기 */
  | { step: "TO_ABSENT"; recordId: number; reason: string }
  | { step: "UNDO_ABSENT"; recordId: number };

export const POST = withUser(async ({ user, req }) => {
  const body = await readJson<Body>(req);
  switch (body.step) {
    case "CHECK":
      submitCheck(user, body.items ?? []);
      return null;
    case "CALL":
      assert(body.recordId && body.state, "학생 출결 정보를 찾을 수 없습니다.");
      return { record: updateCall(user, body.recordId, body.state) };
    case "CALL_DONE":
      completeCall(user, body.eventIds ?? []);
      return null;
    case "ARRIVE":
      assert(body.recordId, "학생 출결 정보를 찾을 수 없습니다.");
      toggleLateArrival(user, body.recordId);
      return null;
    case "TO_ABSENT":
      assert(body.recordId, "학생 출결 정보를 찾을 수 없습니다.");
      markAbsent(user, body.recordId, body.reason ?? "");
      return null;
    case "UNDO_ABSENT":
      assert(body.recordId, "학생 출결 정보를 찾을 수 없습니다.");
      undoMarkAbsent(user, body.recordId);
      return null;
    default:
      assert(false, "처리 단계가 지정되지 않았습니다.");
  }
});

import { readJson, strParam, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import {
  addApply,
  applyFormRows,
  homeworkData,
  markSeen,
  readFormResponses,
  removeApply,
  savePlan,
  setCert,
  setForcedSlot,
  setFormUrl,
  setLateDate,
  setLateDone,
  setMark,
} from "@/lib/repo";
import type { HwPlan } from "@/lib/homework";

/** 숙제 관리 — 숙제검사 기록 · 숙제반 (규칙 계산은 화면이 lib/homework.ts 로). ?form=YYYY-MM 이면 설문 응답 읽기 */
export const GET = withUser(async ({ req }) => {
  const form = strParam(req, "form");
  if (form) return { rows: await readFormResponses(form) };
  return homeworkData();
});

type Body =
  | { action: "MARK"; studentId: number; date: string; mark: string | null }
  | { action: "CERT"; studentId: number; date: string; state: "OK" | "MISS" | null }
  | { action: "PLAN"; studentId: number; plan: HwPlan }
  | { action: "FORCED_SLOT"; studentId: number; slotId: number }
  | { action: "SEEN"; studentId: number; start: string }
  | { action: "APPLY"; studentId: number; slotId: number; month: string }
  | { action: "UNAPPLY"; studentId: number; slotId: number; month: string }
  | { action: "LATE_DATE"; id: number; date: string; slotId: number }
  | { action: "LATE_DONE"; id: number; done: boolean }
  | { action: "FORM_URL"; url: string | null }
  | { action: "FORM_APPLY"; month: string; rows: { studentId: number; slotId: number }[] };

export const POST = withUser(async ({ user, req }) => {
  const b = await readJson<Body>(req);
  switch (b.action) {
    case "MARK":
      return setMark(user, b.studentId, b.date, b.mark);
    case "CERT":
      setCert(user, b.studentId, b.date, b.state);
      return null;
    case "PLAN":
      savePlan(user, b.studentId, b.plan ?? {});
      return null;
    case "FORCED_SLOT":
      setForcedSlot(user, b.studentId, b.slotId);
      return null;
    case "SEEN":
      markSeen(b.studentId, b.start);
      return null;
    case "APPLY":
      addApply(user, b.studentId, b.slotId, b.month);
      return null;
    case "UNAPPLY":
      removeApply(user, b.studentId, b.slotId, b.month);
      return null;
    case "LATE_DATE":
      setLateDate(user, b.id, b.date, b.slotId);
      return null;
    case "LATE_DONE":
      setLateDone(user, b.id, b.done === true);
      return null;
    case "FORM_URL":
      setFormUrl(user, b.url);
      return null;
    case "FORM_APPLY":
      return { added: applyFormRows(user, b.month, b.rows ?? []) };
    default:
      assert(false, "할 일이 지정되지 않았습니다.");
  }
});

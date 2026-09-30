import { readJson, strParam, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import {
  applyFormRows,
  homeworkData,
  markSeen,
  readFormResponses,
  saveApply,
  savePlan,
  setCert,
  setFormUrl,
  setLateDate,
  setLateDone,
  setExempt,
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
  | { action: "SEEN"; studentId: number; start: string }
  | { action: "EXEMPT"; studentId: number; on: boolean; note?: string | null }
  | { action: "APPLY"; studentId: number; month: string; picks: { day: number; slotId: number }[] }
  | { action: "LATE_DATE"; id: number; date: string; slotId: number }
  | { action: "LATE_DONE"; id: number; done: boolean }
  | { action: "FORM_URL"; url: string | null }
  | { action: "FORM_APPLY"; month: string; rows: { studentId: number; picks: { day: number; slotId: number }[] }[] };

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
    case "EXEMPT":
      setExempt(user, b.studentId, b.on === true, b.note ?? null);
      return null;
    case "SEEN":
      markSeen(b.studentId, b.start);
      return null;
    case "APPLY":
      saveApply(user, b.studentId, b.month, b.picks ?? []);
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

import { strParam, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import { dayLimit } from "@/lib/perm";
import { srSnapshot, today } from "@/lib/repo";
import { DAY_LABELS, parseDateKey } from "@/lib/time";

/** SR 화면 — 그 날짜의 자리 현황 (기본 오늘). 알바 데스크는 근무 요일만. preview=1 → 📅 다음 달 자리 미리보기 */
export const GET = withUser(({ user, req }) => {
  const date = strParam(req, "date") ?? today();
  const limit = dayLimit(user);
  if (limit) {
    const day = parseDateKey(date).getDay();
    assert(limit.includes(day), `근무 요일(${limit.map((d) => DAY_LABELS[d]).join("·") || "없음"})만 볼 수 있어요.`);
  }
  return srSnapshot(date, { preview: strParam(req, "preview") === "1" });
});

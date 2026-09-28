import { strParam, withUser } from "@/lib/api";
import { srSnapshot, today } from "@/lib/repo";

/** SR 화면 — 그 날짜의 자리 현황 (기본 오늘) */
export const GET = withUser(({ req }) => srSnapshot(strParam(req, "date") ?? today()));

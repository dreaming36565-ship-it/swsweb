import { strParam, withUser } from "@/lib/api";
import { srPackDiff } from "@/lib/repo";

/** 🧹 자리 정리 누르기 전에 — 바뀌는 학생 (mode=PACK|RESET) */
export const GET = withUser(({ user, req }) => srPackDiff(user, strParam(req, "mode") === "RESET" ? "RESET" : "PACK"));

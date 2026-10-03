import { readJson, requirePermission, strParam, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import {
  addMove,
  addSticker,
  copyPrevEvents,
  deleteEvent,
  deleteMove,
  deleteSticker,
  saveEvent,
  savePoster,
  saveSticker,
  scheduleData,
  setCarry,
  setClassOff,
  setFixedText,
  setSchedDay,
  type EventInput,
} from "@/lib/repo";
import { dateKey } from "@/lib/time";
import type { Brand } from "@/lib/schedule";

/** 📅 월간 스케줄 — 관리자 · 데스크 (보기 · 고치기 모두) */
export const GET = withUser(({ user, req }) => {
  requirePermission(user, "schedule.write");
  return scheduleData(strParam(req, "month") ?? dateKey(new Date()).slice(0, 7));
});

type Body =
  | { action: "DAY"; date: string; off: boolean; open: boolean; memo: string | null }
  | { action: "CLASS_OFF"; date: string; classIds: number[]; memo: string | null }
  | { action: "MOVE_ADD"; classIds: number[]; kind: "MOVE" | "EXTRA"; fromDate: string | null; toDate: string; countMonth: string | null }
  | { action: "MOVE_DEL"; id: number }
  | { action: "CARRY"; classId: number; month: string; delta: number }
  | { action: "EVENT_SAVE"; event: EventInput }
  | { action: "EVENT_DEL"; id: number }
  | { action: "EVENT_COPY"; brand: Brand; month: string }
  | { action: "STICKER_ADD"; brand: Brand; month: string; emoji: string; x: number; y: number; size: number }
  | { action: "STICKER_SAVE"; id: number; x: number; y: number; size: number }
  | { action: "STICKER_DEL"; id: number }
  | { action: "POSTER"; brand: Brand; month: string; pkey: string; note?: string | null; html?: string | null }
  | { action: "FIXED"; brand: Brand; text: string | null };

export const POST = withUser(async ({ user, req }) => {
  requirePermission(user, "schedule.write");
  const b = await readJson<Body>(req);
  switch (b.action) {
    case "DAY":
      return setSchedDay(user, b.date, b);
    case "CLASS_OFF":
      return setClassOff(user, b.date, b.classIds ?? [], b.memo);
    case "MOVE_ADD":
      return addMove(user, b);
    case "MOVE_DEL":
      return deleteMove(user, b.id);
    case "CARRY":
      return setCarry(user, b.classId, b.month, b.delta);
    case "EVENT_SAVE":
      return saveEvent(user, b.event);
    case "EVENT_DEL":
      return deleteEvent(user, b.id);
    case "EVENT_COPY":
      return copyPrevEvents(user, b.brand, b.month);
    case "STICKER_ADD":
      return addSticker(user, b);
    case "STICKER_SAVE":
      return saveSticker(user, b.id, b);
    case "STICKER_DEL":
      return deleteSticker(user, b.id);
    case "POSTER":
      return savePoster(user, b);
    case "FIXED":
      return setFixedText(user, b.brand, b.text);
    default:
      assert(false, "할 일이 지정되지 않았습니다.");
  }
});

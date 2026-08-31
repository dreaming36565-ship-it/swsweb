import { readJson, requirePermission, withUser } from "@/lib/api";
import { AppError, assert } from "@/lib/errors";
import {
  createRoom,
  createSession,
  deleteSession,
  findOrCreateClass,
  listRooms,
  updateSession,
  type SessionInput,
} from "@/lib/repo";
import type { Department, SessionType } from "@/lib/types";

type Body = {
  id?: number;
  dayOfWeek: number;
  /** 같은 수업을 여러 요일에 한 번에 넣을 때 (월·수·금 등). 없으면 dayOfWeek 하나만 */
  days?: number[];
  /** 기존 반이면 classId, 직접 입력이면 className + department */
  classId?: number | null;
  className?: string | null;
  department?: Department;
  type?: SessionType;
  startMin: number;
  endMin: number;
  alphaStartMin?: number | null;
  alphaEndMin?: number | null;
  /** 기존 강의실이면 roomId, 직접 입력이면 roomName */
  roomId?: number | null;
  roomName?: string | null;
  alphaRoomId?: number | null;
  alphaRoomName?: string | null;
  teacherId?: number | null;
};

function resolveRoom(id: number | null | undefined, name: string | null | undefined): number | null {
  if (id) return id;
  const trimmed = name?.trim();
  if (!trimmed) return null;
  const found = listRooms().find((r) => r.name === trimmed);
  return found ? found.id : createRoom(trimmed);
}

function toInput(body: Body): SessionInput {
  const classId = body.classId
    ? body.classId
    : findOrCreateClass(body.className ?? "", body.department ?? "ELEM");
  return {
    dayOfWeek: body.dayOfWeek,
    classId,
    type: body.type ?? "REGULAR",
    startMin: body.startMin,
    endMin: body.endMin,
    alphaStartMin: body.alphaStartMin ?? null,
    alphaEndMin: body.alphaEndMin ?? null,
    roomId: resolveRoom(body.roomId, body.roomName),
    alphaRoomId: resolveRoom(body.alphaRoomId, body.alphaRoomName),
    teacherId: body.teacherId ?? null,
  };
}

export const POST = withUser(async ({ user, req }) => {
  requirePermission(user, "timetable.write");
  const body = await readJson<Body>(req);

  const days = (body.days?.length ? body.days : [body.dayOfWeek]).filter(
    (d, i, arr) => Number.isSafeInteger(d) && d >= 0 && d <= 6 && arr.indexOf(d) === i,
  );
  assert(days.length > 0, "요일을 하나 이상 선택해 주세요.");

  // 반·강의실 "직접 입력(신규 생성)"이 요일마다 중복 생성되지 않도록 한 번만 해석한다
  const base = toInput({ ...body, dayOfWeek: days[0] });
  const ids = days.map((day) => createSession({ ...base, dayOfWeek: day }));
  return { ids, count: ids.length };
});

export const PATCH = withUser(async ({ user, req }) => {
  requirePermission(user, "timetable.write");
  const body = await readJson<Body>(req);
  assert(body.id, "수정할 수업을 찾을 수 없습니다.");
  updateSession(body.id, toInput(body));
  return null;
});

export const DELETE = withUser(async ({ user, req }) => {
  requirePermission(user, "timetable.write");
  const body = await readJson<{ id?: number }>(req);
  if (!body.id) throw new AppError("삭제할 수업을 찾을 수 없습니다.");
  deleteSession(body.id);
  return null;
});

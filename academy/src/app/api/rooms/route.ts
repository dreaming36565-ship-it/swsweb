import { readJson, requirePermission, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import { createRoom, deleteRoom, listRooms, moveRoom, updateRoom } from "@/lib/repo";

export const GET = withUser(() => ({ rooms: listRooms() }));

export const POST = withUser(async ({ user, req }) => {
  requirePermission(user, "rooms.write");
  const body = await readJson<{ name?: string }>(req);
  return { id: createRoom(body.name ?? "") };
});

export const PATCH = withUser(async ({ user, req }) => {
  requirePermission(user, "rooms.write");
  const body = await readJson<{ id?: number; name?: string; move?: -1 | 1 }>(req);
  assert(body.id, "강의실을 찾을 수 없습니다.");
  if (body.move === -1 || body.move === 1) moveRoom(body.id, body.move);
  else updateRoom(body.id, body.name ?? "");
  return null;
});

export const DELETE = withUser(async ({ user, req }) => {
  requirePermission(user, "rooms.write");
  const body = await readJson<{ id?: number }>(req);
  assert(body.id, "강의실을 찾을 수 없습니다.");
  deleteRoom(body.id);
  return null;
});

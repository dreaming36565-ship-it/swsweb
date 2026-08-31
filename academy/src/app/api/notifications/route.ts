import { readJson, withUser } from "@/lib/api";
import { listNotifications, markNotificationsRead, unreadCount } from "@/lib/repo";

export const GET = withUser(({ user }) => ({
  items: listNotifications(user.id),
  unread: unreadCount(user.id),
}));

export const POST = withUser(async ({ user, req }) => {
  const body = await readJson<{ action?: string }>(req);
  if (body.action === "readAll") markNotificationsRead(user.id);
  return null;
});

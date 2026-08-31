import { withUser } from "@/lib/api";

export const GET = withUser(({ user }) => user);

import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import AttendanceClient from "@/components/attendance/AttendanceClient";

export default async function Page() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <AttendanceClient user={user} />;
}

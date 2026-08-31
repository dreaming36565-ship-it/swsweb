import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import TimetableClient from "@/components/timetable/TimetableClient";

export default async function Page() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <TimetableClient user={user} />;
}

import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import TimetableClient from "@/components/timetable/TimetableClient";

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string; month?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { view, month } = await searchParams;
  return <TimetableClient user={user} initialView={view} initialMonth={month} />;
}

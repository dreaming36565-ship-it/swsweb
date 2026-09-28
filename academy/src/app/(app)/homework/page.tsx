import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import HomeworkClient from "@/components/homework/HomeworkClient";

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { view } = await searchParams;
  return <HomeworkClient user={user} initialView={view} />;
}

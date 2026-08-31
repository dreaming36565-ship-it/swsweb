import { getSessionUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import TasksClient from "@/components/TasksClient";

export default async function Page() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <TasksClient user={user} />;
}

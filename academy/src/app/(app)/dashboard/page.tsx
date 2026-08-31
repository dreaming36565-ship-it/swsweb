import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { attendanceSummary, listNotices, listTasks, todaySchedule } from "@/lib/repo";
import { dateKey, rangeLabel } from "@/lib/time";
import LiveClock from "@/components/LiveClock";
import DashboardTasks from "@/components/DashboardTasks";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const now = new Date();
  const today = dateKey(now);
  const schedule = todaySchedule(user, now.getDay(), today);
  const tasks = listTasks({ assigneeId: user.id });
  const summary = attendanceSummary(today, "ALL");
  const notices = listNotices(user.department, 3);
  const honorific = user.role === "DESK" ? "님" : " 선생님";

  return (
    <div className="w-full space-y-6">
      {/* 인사 문구 + 우측 큰 실시간 시계 */}
      <div className="card flex items-center justify-between gap-6 px-7 py-6">
        <h1 className="text-3xl font-bold tracking-tight text-navy-900">
          {user.name}
          {honorific}, 안녕하세요.
        </h1>
        <LiveClock />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* 오늘의 일정 */}
        <section className="card p-6">
          <h2 className="text-base font-bold text-ink">오늘의 일정</h2>
          <div className="mt-4 space-y-3">
            {schedule.length === 0 ? (
              <p className="text-sm text-muted">오늘 예정된 일정이 없습니다.</p>
            ) : (
              schedule.map((s, i) => (
                <div key={`${s.title}-${i}`} className="flex gap-4 border-b border-line pb-3 last:border-b-0 last:pb-0">
                  <div className="w-28 shrink-0 text-sm font-semibold tabular-nums text-navy-700">
                    {rangeLabel(s.startMin, s.endMin)}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-ink">{s.title}</div>
                    {s.subtitle ? <div className="truncate text-xs text-muted">{s.subtitle}</div> : null}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* 오늘의 할 일 */}
        <section className="card p-6">
          <h2 className="text-base font-bold text-ink">오늘의 할 일</h2>
          <DashboardTasks initial={tasks} />
        </section>

        {/* 오늘 출결 처리 현황 */}
        <section className="card p-6">
          <h2 className="text-base font-bold text-ink">오늘 출결 처리 현황</h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {[
              { label: "출석체크 대기", value: summary.byStage.TEACHER_PENDING, tone: "text-navy-800" },
              { label: "출결전화 대기", value: summary.byStage.DESK_PENDING, tone: "text-late" },
              { label: "최종확인 대기", value: summary.byStage.TEACHER_CONFIRM, tone: "text-present" },
              { label: "완료", value: summary.byStage.DONE, tone: "text-muted" },
            ].map((s) => (
              <div key={s.label} className="rounded-lg border border-line px-4 py-3">
                <div className="text-xs text-muted">{s.label}</div>
                <div className={`mt-1 text-2xl font-bold tabular-nums ${s.tone}`}>{s.value}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-3 text-sm">
            <span className="text-present">출석 {summary.present}</span>
            <span className="text-alert">결석 {summary.absent}</span>
            <span className="text-late">지각 {summary.late}</span>
            <span className="text-muted">미체크 {summary.unchecked}</span>
          </div>
        </section>
      </div>

      {/* 최근 공지 3열 */}
      <section>
        <h2 className="mb-3 text-base font-bold text-ink">최근 공지</h2>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          {notices.length === 0 ? (
            <p className="text-sm text-muted">등록된 공지가 없습니다.</p>
          ) : (
            notices.map((n) => (
              <article key={n.id} className="card p-5">
                <div className="text-sm font-bold text-ink">{n.title}</div>
                <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted">{n.body}</p>
                <div className="mt-3 text-xs text-muted">
                  {n.authorName ?? "관리자"} · {new Date(n.createdAt).toLocaleDateString("ko-KR")}
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

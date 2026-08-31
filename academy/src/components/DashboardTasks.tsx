"use client";

import { useState } from "react";
import { apiPatch, errorMessage } from "@/lib/http";
import type { Task } from "@/lib/types";

/** 대시보드 "오늘의 할 일" — 체크리스트 */
export default function DashboardTasks({ initial }: { initial: Task[] }) {
  const [tasks, setTasks] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (task: Task) => {
    const next = task.done === 1 ? 0 : 1;
    setError(null);
    setTasks((list) => list.map((t) => (t.id === task.id ? { ...t, done: next as 0 | 1 } : t)));
    try {
      await apiPatch("/api/tasks", { id: task.id, done: next === 1 });
    } catch (e) {
      setError(errorMessage(e));
      setTasks((list) => list.map((t) => (t.id === task.id ? { ...t, done: task.done } : t)));
    }
  };

  return (
    <>
      {error ? (
        <div className="mt-3 rounded-lg border border-alert bg-alert-soft px-3 py-2 text-sm font-semibold text-alert">
          {error}
        </div>
      ) : null}
      <div className="mt-4 space-y-2">
        {tasks.length === 0 ? (
          <p className="text-sm text-muted">지시받은 업무가 없습니다.</p>
        ) : (
          tasks.map((t) => (
            <label
              key={t.id}
              className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-1.5 hover:bg-navy-50"
            >
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[var(--color-navy-800)]"
                checked={t.done === 1}
                onChange={() => void toggle(t)}
              />
              <span className="min-w-0">
                <span className={`block text-sm ${t.done === 1 ? "text-muted line-through" : "text-ink"}`}>
                  {t.title}
                </span>
                {t.dueDate ? <span className="text-xs text-muted">{t.dueDate} 까지</span> : null}
              </span>
            </label>
          ))
        )}
      </div>
    </>
  );
}

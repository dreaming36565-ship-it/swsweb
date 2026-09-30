"use client";

// 설정 › 🗑 기록 정리 (관리자) — 학생 이름 + 기간으로 기록을 찾아 기능별로 체크 → 한꺼번에 지우기.
// 학생 명단은 지우지 않는다 (기록만). 베타테스트는 학생 이름 「테스트」로 한다.

import { useState } from "react";
import { useConfirm } from "../ConfirmDialog";
import { PurgeWhat } from "../Purge";
import { apiPost, errorMessage } from "@/lib/http";
import type { PurgeGroup, PurgeItem, PurgeRange } from "@/lib/repo/purge";

const RANGES: [PurgeRange, string][] = [
  ["TODAY", "오늘"],
  ["WEEK", "최근 1주"],
  ["MONTH", "최근 1달"],
  ["ALL", "전체"],
];

const GROUPS: [PurgeGroup, string][] = [
  ["ATT", "📋 출결"],
  ["ABS", "🔁 결석 · 보강"],
  ["HW", "📝 숙제검사 · 숙제반"],
  ["SR", "🪑 SR"],
  ["NOTIF", "🔔 알림"],
];

export default function PurgeSection() {
  const confirm = useConfirm();
  const [name, setName] = useState("테스트");
  const [range, setRange] = useState<PurgeRange>("MONTH");
  const [found, setFound] = useState<{ name: string; items: PurgeItem[] } | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const find = async (keepMsg = false) => {
    if (!keepMsg) setMsg(null);
    setBusy(true);
    try {
      const { items } = await apiPost<{ items: PurgeItem[] }>("/api/purge", { action: "FIND", name, range });
      setFound({ name: name.trim(), items });
      setChecked(new Set(items.map((i) => i.key)));
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const picked = found?.items.filter((i) => checked.has(i.key)) ?? [];

  const remove = async () => {
    if (!found || picked.length === 0) return;
    setMsg(null);
    const yes = await confirm({
      title: "기록을 지울까요?",
      message: <PurgeWhat items={picked} head={`${found.name} 기록 ${picked.length}건`} />,
      confirmText: "지우기",
      danger: true,
    });
    if (!yes) return;
    setBusy(true);
    try {
      const { deleted } = await apiPost<{ deleted: number }>("/api/purge", {
        action: "DELETE",
        items: picked.map(({ kind, id, studentId, date, month }) => ({ kind, id, studentId, date, month })),
      });
      setMsg({ ok: true, text: `${deleted}건 지웠어요.` });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
    await find(true);
  };

  const toggle = (key: string) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  return (
    <section className="card p-5 xl:col-span-3">
      <h2 className="text-base font-bold text-ink">🗑 기록 정리</h2>
      <p className="mt-1 text-sm text-muted">
        실수 · 테스트 기록을 이름으로 찾아 지워요. <b>학생 명단은 안 지워요</b> (기록만). 실제 학생 실수는 기간을 <b>오늘</b>로 좁히세요.
      </p>
      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void find();
        }}
      >
        <div>
          <label className="label">학생 이름</label>
          <input className="field w-40" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">기간</label>
          <select className="field w-36" value={range} onChange={(e) => setRange(e.target.value as PurgeRange)}>
            {RANGES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
          찾기
        </button>
      </form>
      {msg ? <div className={`mt-2 text-sm font-semibold ${msg.ok ? "text-present" : "text-alert"}`}>{msg.text}</div> : null}

      {found ? (
        found.items.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            <b className="text-ink">{found.name}</b> 기록이 없어요.
          </p>
        ) : (
          <div className="mt-3">
            <div className="mb-2 flex items-center gap-2 text-sm">
              <span>
                <b>{found.name}</b> 기록 <b>{found.items.length}건</b> <span className="text-muted">· 지울 것에 체크</span>
              </span>
              <button type="button" className="btn px-2 py-0.5 text-xs" onClick={() => setChecked(new Set(found.items.map((i) => i.key)))}>
                모두 체크
              </button>
              <button type="button" className="btn px-2 py-0.5 text-xs" onClick={() => setChecked(new Set())}>
                모두 해제
              </button>
            </div>
            {GROUPS.map(([g, title]) => {
              const list = found.items.filter((i) => i.group === g);
              if (!list.length) return null;
              return (
                <div key={g} className="mb-2 overflow-hidden rounded-lg border border-line">
                  <div className="flex justify-between bg-navy-50 px-3 py-1.5 text-[13px] font-bold">
                    <span>{title}</span>
                    <span className="text-muted">{list.length}</span>
                  </div>
                  {list.map((i) => (
                    <label key={i.key} className="flex cursor-pointer items-start gap-2 border-t border-line px-3 py-1.5 text-[13px] hover:bg-navy-50">
                      <input type="checkbox" className="mt-0.5" checked={checked.has(i.key)} onChange={() => toggle(i.key)} />
                      <span>
                        {i.label}
                        {i.extra.length ? <span className="text-muted"> ({i.extra.join(" · ")} 같이)</span> : null}
                        {i.note ? <span className="ml-1 text-xs text-late">{i.note}</span> : null}
                      </span>
                    </label>
                  ))}
                </div>
              );
            })}
            <div className="mt-2 flex justify-end">
              <button type="button" className="btn btn-danger" disabled={busy || picked.length === 0} onClick={() => void remove()}>
                선택한 기록 지우기 ({picked.length}건)
              </button>
            </div>
          </div>
        )
      ) : null}
    </section>
  );
}

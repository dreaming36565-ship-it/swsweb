"use client";

// 🗑 실수·테스트 기록 지우기 (관리자만) — 각 화면 줄 끝 🗑 버튼과 확인창.
// 확인창에 「같이 지워지는 것」을 보여 주고, 엔터로 확정한다 (useConfirm).

import { useCallback, type MouseEvent } from "react";
import { useConfirm } from "./ConfirmDialog";
import { apiPost } from "@/lib/http";
import type { PurgeItem, PurgeKey } from "@/lib/repo/purge";

/** 확인창 내용 — 지울 기록 목록 + 같이 지워지는 것 + 되돌릴 수 없어요 */
export function PurgeWhat({ items, head }: { items: PurgeItem[]; head?: string }) {
  const extra = [...new Set(items.flatMap((i) => i.extra))];
  const notes = [...new Set(items.map((i) => i.note).filter((n): n is string => !!n))];
  const shown = items.slice(0, 8);
  return (
    <div>
      {head ? <p className="mb-1 font-bold">{head}</p> : null}
      <ul className="space-y-0.5">
        {shown.map((i) => (
          <li key={i.key} className="font-semibold">
            {i.label}
          </li>
        ))}
        {items.length > shown.length ? <li className="text-muted">외 {items.length - shown.length}건</li> : null}
      </ul>
      <p className="mt-2 text-muted">
        {extra.length ? (
          <>
            같이 지워지는 것: {extra.join(" · ")}
            <br />
          </>
        ) : null}
        {notes.map((n) => (
          <span key={n}>
            {n}
            <br />
          </span>
        ))}
        <b className="text-alert">되돌릴 수 없어요.</b>
      </p>
    </div>
  );
}

/**
 * 🗑 누르면 — 서버에서 지울 것을 설명받아 확인창 → 지우기.
 * 지웠으면 true, 취소하면 false. 실패하면 한국어 메시지로 던진다 (화면에 표시할 것).
 */
export function usePurge() {
  const confirm = useConfirm();
  return useCallback(
    async (keys: PurgeKey[]): Promise<boolean> => {
      const { items } = await apiPost<{ items: PurgeItem[] }>("/api/purge", { action: "DESCRIBE", items: keys });
      if (!items.length) throw new Error("지울 기록이 없어요. 이미 지워졌을 수 있어요.");
      const yes = await confirm({ title: "기록을 지울까요?", message: <PurgeWhat items={items} />, confirmText: "지우기", danger: true });
      if (!yes) return false;
      await apiPost("/api/purge", { action: "DELETE", items: keys });
      return true;
    },
    [confirm],
  );
}

/** 줄 끝 작은 🗑 (관리자만 보이게 — 부르는 쪽에서 can(user, "records.purge") 확인) */
export function TrashButton({ onClick, title = "기록 지우기 (관리자)", disabled }: { onClick: () => void; title?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      className="rounded-md border border-alert-soft bg-white px-1.5 py-px text-xs text-alert hover:border-alert disabled:opacity-40"
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
        onClick();
      }}
    >
      🗑
    </button>
  );
}

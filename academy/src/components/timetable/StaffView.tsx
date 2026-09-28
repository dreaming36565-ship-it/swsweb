"use client";

// 계정 · 강의실 (관리자) — 아이디 = 한글 이름, 권한은 여러 개. 강의실 최대 인원 · 이름 · 순서.

import { useCallback, useEffect, useState } from "react";
import { useConfirm } from "../ConfirmDialog";
import { IconChevronLeft, IconChevronRight, IconTrash } from "../Icons";
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage } from "@/lib/http";
import { ROLES, ROLE_LABEL, rolesLabel, type Role, type StaffUser } from "@/lib/types";
import type { Ctx } from "./TimetableClient";

export default function StaffView({ ctx }: { ctx: Ctx }) {
  const confirm = useConfirm();
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [newName, setNewName] = useState("");
  const [newRoom, setNewRoom] = useState("");
  const [renaming, setRenaming] = useState<{ id: number; kind: "user" | "room"; value: string } | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      setUsers((await apiGet<{ users: StaffUser[] }>("/api/users")).users);
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    }
  }, []);
  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setMsg(null);
    try {
      await fn();
      await Promise.all([loadUsers(), ctx.reload()]);
      if (ok) setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
      await loadUsers();
    }
  };

  const toggleRole = (u: StaffUser, r: Role, on: boolean) => {
    const next = on ? [...new Set([...u.roles, r])] : u.roles.filter((x) => x !== r);
    void run(() => apiPatch("/api/users", { id: u.id, roles: next }), `${u.name}: ${rolesLabel(ROLES.filter((x) => next.includes(x)))}`);
  };

  const used = (roomId: number) => ctx.data.classes.some((c) => c.parts.some((p) => p.roomId === roomId));

  return (
    <div className="space-y-3">
      {msg ? (
        <div className={`rounded-xl border px-4 py-2.5 text-sm font-semibold ${msg.ok ? "border-present bg-present-soft text-present" : "border-alert bg-alert-soft text-alert"}`}>{msg.text}</div>
      ) : null}
      <section className="card p-4">
        <b>계정 · 권한</b>
        <p className="mb-2 mt-1 text-xs text-muted">
          아이디 = 한글 이름. 권한은 여러 개 고를 수 있고, 고른 권한들이 할 수 있는 일을 모두 해요. 예) 안예슬 = 관리자 + 선생님. 새 계정 · 초기화한 계정은 1234로 로그인한 뒤 새 비밀번호를 정해요.
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-navy-50 text-left text-xs text-muted">
              <th className="px-2.5 py-2">이름</th>
              {ROLES.map((r) => (
                <th key={r} className="px-2.5 py-2 text-center">
                  {ROLE_LABEL[r]}
                </th>
              ))}
              <th className="px-2.5 py-2">소속</th>
              <th className="px-2.5 py-2">할 수 있는 일</th>
              <th className="px-2.5 py-2" />
            </tr>
          </thead>
          <tbody>
            {users
              .filter((u) => u.active === 1)
              .map((u) => (
                <tr key={u.id} className="border-t border-line">
                  <td className="px-2.5 py-2">
                    {renaming?.kind === "user" && renaming.id === u.id ? (
                      <input
                        className="field w-32 py-1"
                        value={renaming.value}
                        autoFocus
                        onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void run(() => apiPatch("/api/users", { id: u.id, name: renaming.value }), "이름을 바꿨어요 — 시간표에도 함께 바뀌어요").then(() => setRenaming(null));
                          if (e.key === "Escape") setRenaming(null);
                        }}
                      />
                    ) : (
                      <button type="button" className="font-bold hover:underline" title="이름 바꾸기" onClick={() => setRenaming({ id: u.id, kind: "user", value: u.name })}>
                        {u.name}
                      </button>
                    )}
                    {u.id === ctx.user.id ? <span className="ml-1 text-xs text-muted">(나)</span> : null}
                  </td>
                  {ROLES.map((r) => (
                    <td key={r} className="px-2.5 py-2 text-center">
                      <input type="checkbox" className="h-[18px] w-[18px]" checked={u.roles.includes(r)} onChange={(e) => toggleRole(u, r, e.target.checked)} />
                    </td>
                  ))}
                  <td className="px-2.5 py-2">
                    <select className="field w-28 py-1" value={u.department} onChange={(e) => void run(() => apiPatch("/api/users", { id: u.id, department: e.target.value }))}>
                      <option value="ELEM">초중등부</option>
                      <option value="HIGH">고등부</option>
                    </select>
                  </td>
                  <td className="px-2.5 py-2 text-xs text-muted">{rolesLabel(u.roles)}</td>
                  <td className="whitespace-nowrap px-2.5 py-2 text-right">
                    <button
                      type="button"
                      className="btn px-2 py-0.5 text-xs"
                      onClick={async () => {
                        if (await confirm({ title: "비밀번호를 초기화할까요?", message: `${u.name} 비밀번호를 1234로 바꿔요. 다음 로그인 때 새 비밀번호를 정해요.`, confirmText: "초기화" }))
                          void run(() => apiPatch("/api/users", { id: u.id, resetPassword: true }), `${u.name} 비밀번호를 1234로 초기화했어요`);
                      }}
                    >
                      비밀번호 초기화
                    </button>{" "}
                    <button
                      type="button"
                      className="btn btn-ghost px-1.5 py-0.5 text-alert"
                      disabled={u.id === ctx.user.id}
                      aria-label="삭제"
                      onClick={async () => {
                        if (await confirm({ title: "계정을 지울까요?", message: `${u.name} 계정을 지워요.`, confirmText: "지우기", danger: true }))
                          void run(() => apiDelete("/api/users", { id: u.id }), "지웠어요");
                      }}
                    >
                      <IconTrash className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        <div className="mt-2 flex gap-1.5">
          <input className="field w-48" placeholder="새 직원 이름" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button
            type="button"
            className="btn"
            disabled={!newName.trim()}
            onClick={() =>
              void run(() => apiPost("/api/users", { name: newName, roles: ["TEACHER"] }), `${newName.trim()} 계정을 만들었어요 — 처음 비밀번호 1234`).then(() => setNewName(""))
            }
          >
            ＋ 계정 추가
          </button>
        </div>
      </section>

      <section className="card p-4">
        <b>강의실</b>
        <p className="mb-2 mt-1 text-xs text-muted">「최대 인원」을 넣으면 교실별 보기에서 정원 초과를 알려주고, 빈 교실 찾기에서 인원을 따져요. 순서 = 시간표 가로축 순서.</p>
        {ctx.data.rooms.map((r, i) => (
          <div key={r.id} className="mb-1.5 flex items-center justify-between rounded-lg border border-line px-3 py-2">
            {renaming?.kind === "room" && renaming.id === r.id ? (
              <input
                className="field w-40 py-1"
                value={renaming.value}
                autoFocus
                onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void run(() => apiPatch("/api/rooms", { id: r.id, name: renaming.value })).then(() => setRenaming(null));
                  if (e.key === "Escape") setRenaming(null);
                }}
              />
            ) : (
              <button type="button" className="font-bold hover:underline" title="이름 바꾸기" onClick={() => setRenaming({ id: r.id, kind: "room", value: r.name })}>
                {r.name}
                {r.isSr === 1 ? <span className="ml-1.5 text-xs text-srpink">SR룸</span> : null}
              </button>
            )}
            <span className="flex items-center gap-1.5 text-sm">
              최대 인원
              <input
                className="field w-16 py-1"
                type="number"
                min={1}
                defaultValue={r.capacity ?? ""}
                placeholder="—"
                onBlur={(e) => {
                  const v = e.target.value ? Number(e.target.value) : null;
                  if (v !== r.capacity) void run(() => apiPatch("/api/rooms", { id: r.id, capacity: v }));
                }}
              />
              명
              <button type="button" className="btn btn-ghost px-1.5 py-1" disabled={i === 0} onClick={() => void run(() => apiPatch("/api/rooms", { id: r.id, move: -1 }))} aria-label="앞으로">
                <IconChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="btn btn-ghost px-1.5 py-1"
                disabled={i === ctx.data.rooms.length - 1}
                onClick={() => void run(() => apiPatch("/api/rooms", { id: r.id, move: 1 }))}
                aria-label="뒤로"
              >
                <IconChevronRight className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="btn btn-danger px-2 py-0.5 text-xs"
                disabled={r.isSr === 1 || used(r.id)}
                title={r.isSr === 1 ? "SR룸은 지울 수 없어요" : used(r.id) ? "시간표에서 쓰는 중" : "삭제"}
                onClick={async () => {
                  if (await confirm({ title: "강의실을 지울까요?", message: `${r.name}`, confirmText: "지우기", danger: true })) void run(() => apiDelete("/api/rooms", { id: r.id }));
                }}
              >
                삭제
              </button>
            </span>
          </div>
        ))}
        <div className="mt-2 flex gap-1.5">
          <input className="field w-48" placeholder="새 강의실 이름" value={newRoom} onChange={(e) => setNewRoom(e.target.value)} />
          <button type="button" className="btn" disabled={!newRoom.trim()} onClick={() => void run(() => apiPost("/api/rooms", { name: newRoom })).then(() => setNewRoom(""))}>
            추가
          </button>
        </div>
      </section>
    </div>
  );
}

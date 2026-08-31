"use client";

// 설정 — 내 정보 / 알림음 / 강의실 관리 / 계정 관리 / 권한 표

import { useCallback, useEffect, useState } from "react";
import UserFormModal from "../UserFormModal";
import { useConfirm } from "../ConfirmDialog";
import { IconChevronLeft, IconChevronRight, IconPencil, IconPlus, IconTrash, IconVolume } from "../Icons";
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage } from "@/lib/http";
import { isAlarmEnabled, playAlarm, setAlarmEnabled, unlockAudio } from "@/lib/alarm";
import { DEPARTMENTS, ROLE_LABEL, type Room, type SessionUser, type StaffUser } from "@/lib/types";

const PERMISSION_ROWS: [string, string, string, string][] = [
  ["시간표 입력/수정/삭제", "○", "–", "–"],
  ["시간표·SR 조회", "○", "○", "○"],
  ["SR 좌석 수동 이동", "○", "○", "○"],
  ["출석체크 제출 / 최종 확인", "○", "담당 수업만", "–"],
  ["출결전화 저장", "○", "–", "○"],
  ["반 생성/수정/삭제", "○", "–", "–"],
  ["강의실 생성/수정/삭제·순서", "○", "–", "–"],
  ["계정 생성/수정/삭제", "○", "–", "–"],
  ["학생 명단 추가/수정/삭제", "○", "–", "○"],
  ["공지 작성 · 업무 지시", "○", "–", "–"],
];

export default function SettingsClient({ user }: { user: SessionUser }) {
  const confirm = useConfirm();
  const isAdmin = user.role === "ADMIN";

  const [rooms, setRooms] = useState<Room[]>([]);
  const [users, setUsers] = useState<StaffUser[]>([]);
  const [newRoom, setNewRoom] = useState("");
  const [editRoomId, setEditRoomId] = useState<number | null>(null);
  const [editRoomName, setEditRoomName] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTarget, setModalTarget] = useState<StaffUser | null>(null);
  const [alarmOn, setAlarmOn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAlarmOn(isAlarmEnabled());
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await apiGet<{ rooms: Room[] }>("/api/rooms");
      setRooms(r.rooms);
      if (isAdmin) {
        const u = await apiGet<{ users: StaffUser[] }>("/api/users");
        setUsers(u.users);
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const removeRoom = async (room: Room) => {
    const yes = await confirm({
      title: "강의실을 삭제할까요?",
      message: `${room.name} 강의실을 목록에서 지웁니다.`,
      confirmText: "삭제",
      danger: true,
    });
    if (yes) void run(() => apiDelete("/api/rooms", { id: room.id }));
  };

  const removeUser = async (target: StaffUser) => {
    const yes = await confirm({
      title: "계정을 삭제할까요?",
      message: `${target.name} (${target.loginId}) 계정을 지웁니다.`,
      confirmText: "삭제",
      danger: true,
    });
    if (yes) void run(() => apiDelete("/api/users", { id: target.id }));
  };

  return (
    <div className="w-full space-y-4">
      {error ? (
        <div className="rounded-xl border border-alert bg-alert-soft px-5 py-3 text-sm font-semibold text-alert">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* 내 정보 */}
        <section className="card p-5">
          <h2 className="text-base font-bold text-ink">내 정보</h2>
          <div className="mt-4 space-y-2 text-sm">
            <Row label="이름" value={user.name} />
            <Row label="아이디" value={user.loginId} />
            <Row label="권한" value={ROLE_LABEL[user.role]} />
            <Row label="소속" value={`${DEPARTMENTS[user.department].dept} · ${DEPARTMENTS[user.department].branch}`} />
          </div>
        </section>

        {/* 알림음 */}
        <section className="card p-5">
          <h2 className="text-base font-bold text-ink">출결 알림음</h2>
          <p className="mt-1 text-sm text-muted">
            출결 팝업이 뜨는 순간 울리고, 제출 전까지 1분마다 3초씩 반복합니다.
          </p>
          <div className="mt-4 flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--color-navy-800)]"
                checked={alarmOn}
                onChange={(e) => {
                  setAlarmOn(e.target.checked);
                  setAlarmEnabled(e.target.checked);
                }}
              />
              알림음 사용
            </label>
            <button
              type="button"
              className="btn"
              onClick={() => {
                unlockAudio();
                playAlarm(3, true);
              }}
            >
              <IconVolume className="h-4 w-4" />
              미리듣기
            </button>
          </div>
        </section>

        {/* 강의실 관리 */}
        <section className="card p-5">
          <h2 className="text-base font-bold text-ink">강의실 관리</h2>
          <p className="mt-1 text-sm text-muted">
            시간표 가로축 순서입니다. 부서 구분 없이 공용으로 씁니다.
          </p>

          {isAdmin ? (
            <div className="mt-4 flex gap-2">
              <input
                className="field"
                placeholder="새 강의실 이름"
                value={newRoom}
                onChange={(e) => setNewRoom(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-primary px-3"
                disabled={busy || !newRoom.trim()}
                onClick={() =>
                  void run(async () => {
                    await apiPost("/api/rooms", { name: newRoom });
                    setNewRoom("");
                  })
                }
              >
                <IconPlus className="h-4 w-4" />
              </button>
            </div>
          ) : null}

          <div className="mt-4 space-y-1">
            {rooms.map((r, i) => (
              <div key={r.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-navy-50">
                <span className="w-6 text-xs tabular-nums text-muted">{i + 1}</span>
                {editRoomId === r.id ? (
                  <>
                    <input
                      className="field"
                      value={editRoomName}
                      onChange={(e) => setEditRoomName(e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn px-2 py-1 text-xs"
                      onClick={() =>
                        void run(async () => {
                          await apiPatch("/api/rooms", { id: r.id, name: editRoomName });
                          setEditRoomId(null);
                        })
                      }
                    >
                      저장
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm text-ink">
                      {r.name}
                      {r.isSr === 1 ? <span className="ml-2 text-xs text-srpink">SR룸</span> : null}
                    </span>
                    {isAdmin ? (
                      <>
                        <button
                          type="button"
                          className="btn btn-ghost px-1.5 py-1"
                          disabled={i === 0 || busy}
                          onClick={() => void run(() => apiPatch("/api/rooms", { id: r.id, move: -1 }))}
                          aria-label="앞으로"
                        >
                          <IconChevronLeft className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost px-1.5 py-1"
                          disabled={i === rooms.length - 1 || busy}
                          onClick={() => void run(() => apiPatch("/api/rooms", { id: r.id, move: 1 }))}
                          aria-label="뒤로"
                        >
                          <IconChevronRight className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost px-1.5 py-1"
                          onClick={() => {
                            setEditRoomId(r.id);
                            setEditRoomName(r.name);
                          }}
                          aria-label="이름 수정"
                        >
                          <IconPencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost px-1.5 py-1 text-alert disabled:opacity-30"
                          disabled={r.isSr === 1}
                          title={r.isSr === 1 ? "SR룸은 삭제할 수 없습니다." : "삭제"}
                          onClick={() => void removeRoom(r)}
                          aria-label="삭제"
                        >
                          <IconTrash className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : null}
                  </>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* 계정 관리 */}
        {isAdmin ? (
          <section className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-ink">계정 관리</h2>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setModalTarget(null);
                  setModalOpen(true);
                }}
              >
                <IconPlus className="h-4 w-4" />
                계정 추가
              </button>
            </div>
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs font-semibold text-muted">
                  <th className="py-2">이름</th>
                  <th className="py-2">아이디</th>
                  <th className="py-2">권한</th>
                  <th className="py-2">소속</th>
                  <th className="w-20 py-2" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-line last:border-b-0">
                    <td className="py-2 font-semibold text-ink">{u.name}</td>
                    <td className="py-2 text-muted">{u.loginId}</td>
                    <td className="py-2 text-ink">{ROLE_LABEL[u.role]}</td>
                    <td className="py-2 text-ink">{DEPARTMENTS[u.department].dept}</td>
                    <td className="py-2">
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="btn btn-ghost px-1.5 py-1"
                          onClick={() => {
                            setModalTarget(u);
                            setModalOpen(true);
                          }}
                          aria-label="수정"
                        >
                          <IconPencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost px-1.5 py-1 text-alert"
                          onClick={() => void removeUser(u)}
                          aria-label="삭제"
                        >
                          <IconTrash className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {/* 권한 표 */}
        <section className="card p-5 xl:col-span-2">
          <h2 className="text-base font-bold text-ink">권한</h2>
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-semibold text-muted">
                <th className="py-2">기능</th>
                <th className="w-28 py-2 text-center">관리자</th>
                <th className="w-28 py-2 text-center">선생님</th>
                <th className="w-28 py-2 text-center">데스크</th>
              </tr>
            </thead>
            <tbody>
              {PERMISSION_ROWS.map(([label, a, t, d]) => (
                <tr key={label} className="border-b border-line last:border-b-0">
                  <td className="py-2 text-ink">{label}</td>
                  <td className="py-2 text-center text-ink">{a}</td>
                  <td className="py-2 text-center text-ink">{t}</td>
                  <td className="py-2 text-center text-ink">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <UserFormModal
        open={modalOpen}
        target={modalTarget}
        onClose={() => setModalOpen(false)}
        onSaved={() => void load()}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line pb-2 last:border-b-0">
      <span className="text-muted">{label}</span>
      <span className="font-semibold text-ink">{value}</span>
    </div>
  );
}

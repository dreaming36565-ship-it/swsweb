"use client";

// 시간표 — 선생님별 / 교실별 / 전체 반 / 학생 찾기 / 반 관리 / 교재 책장 / 계정 · 강의실.
// 반 = 여러 칸(수업 · SR). 같은 반은 같은 색, 점선 = SR, 빗금 = 교실배정, 주황 선 = 지금 시각.

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, errorMessage } from "@/lib/http";
import { can } from "@/lib/perm";
import { DAY_LABELS, minutesOfDay } from "@/lib/time";
import type { Book, ClassModel, Conflict, Room, RoomBooking, SessionUser, TempSwap } from "@/lib/types";
import { IconDownload, IconUpload } from "../Icons";
import { WEEK } from "./model";
import { AllView, ManageView, RoomView, SearchView, TeacherView } from "./views";
import BooksView from "./BooksView";
import StaffView from "./StaffView";
import ClassDetail from "./ClassDetail";
import ClassEditor from "./ClassEditor";
import { AssignModal, SwapModal, UploadModal } from "./ToolModals";

export type TimetableData = {
  today: string;
  nowMin: number;
  week: { day: number; date: string }[];
  classes: ClassModel[];
  rooms: Room[];
  teachers: { id: number; name: string }[];
  books: Book[];
  bookings: RoomBooking[];
  tempSwaps: TempSwap[];
  alertOk: string[];
  conflicts: { day: number; list: Conflict[] }[];
  seats: { classId: number; studentId: number; seat: string; manual: boolean }[];
  /** 오늘 결석 (미리 등록 · 출결 결석) — classId 가 없으면 그날 모든 반 */
  absents: { studentId: number; classId: number | null; reason: string }[];
};

/** 화면 곳곳에서 쓰는 것들 */
export type Ctx = {
  user: SessionUser;
  data: TimetableData;
  reload: () => Promise<void>;
  /** 지금 요일 · 분 (1분마다) */
  now: { day: number; min: number };
  openClass: (id: number) => void;
  editClass: (id: number | null) => void;
  setError: (msg: string | null) => void;
};

type View = "teacher" | "room" | "all" | "search" | "manage" | "books" | "staff";
const VIEWS: [View, string][] = [
  ["teacher", "선생님별"],
  ["room", "교실별"],
  ["all", "전체 반"],
  ["search", "학생 찾기"],
  ["manage", "반 관리"],
  ["books", "교재 책장"],
  ["staff", "계정 · 강의실"],
];
const ADMIN_VIEWS: View[] = ["manage", "staff"];

export default function TimetableClient({ user, initialView }: { user: SessionUser; initialView?: string }) {
  const admin = can(user, "timetable.write");
  const views = VIEWS.filter(([k]) => admin || !ADMIN_VIEWS.includes(k));
  const [view, setView] = useState<View>(() => (views.some(([k]) => k === initialView) ? (initialView as View) : "teacher"));
  const [day, setDay] = useState(() => new Date().getDay());
  const [data, setData] = useState<TimetableData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => ({ day: new Date().getDay(), min: minutesOfDay(new Date()) }));
  const [detailId, setDetailId] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ id: number | null } | null>(null);
  const [tool, setTool] = useState<"swap" | "assign" | "upload" | null>(null);

  const reload = useCallback(async () => {
    try {
      setData(await apiGet<TimetableData>("/api/timetable"));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 지금 시각 — 1분마다
  useEffect(() => {
    const t = setInterval(() => setNow({ day: new Date().getDay(), min: minutesOfDay(new Date()) }), 30_000);
    return () => clearInterval(t);
  }, []);

  const ctx: Ctx | null = useMemo(
    () =>
      data
        ? {
            user,
            data,
            reload,
            now,
            openClass: (id) => setDetailId(id),
            editClass: (id) => {
              setDetailId(null);
              setEditing({ id });
            },
            setError,
          }
        : null,
    [data, user, reload, now],
  );

  const showDay = view === "teacher" || view === "room";
  return (
    <div className="w-full space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {views.map(([k, n]) => (
            <button key={k} type="button" className={`btn ${view === k ? "btn-primary" : ""}`} onClick={() => setView(k)}>
              {n}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {can(user, "timetable.swap") ? (
            <button type="button" className="btn" onClick={() => setTool("swap")}>
              ⇄ 알파·수업 순서 바꾸기
            </button>
          ) : null}
          {can(user, "rooms.booking") ? (
            <button type="button" className="btn" onClick={() => setTool("assign")}>
              ＋ 교실배정 (빈 교실 찾기)
            </button>
          ) : null}
          <a className="btn" href="/api/timetable/excel">
            <IconDownload className="h-4 w-4" />
            엑셀 다운로드
          </a>
          {admin ? (
            <button type="button" className="btn" onClick={() => setTool("upload")}>
              <IconUpload className="h-4 w-4" />
              명단 엑셀 올리기
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="flex items-center justify-between rounded-xl border border-alert bg-alert-soft px-4 py-2.5 text-sm font-semibold text-alert">
          <span>{error}</span>
          <button type="button" className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => setError(null)}>
            닫기
          </button>
        </div>
      ) : null}

      {showDay ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {WEEK.map((d) => (
              <button key={d} type="button" className={`btn px-3 ${day === d ? "btn-primary" : ""}`} onClick={() => setDay(d)}>
                {DAY_LABELS[d]}
                {d === now.day ? " · 오늘" : ""}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted">같은 반은 같은 색 · 점선 = SR · 빗금 = 교실배정 · 주황 선 = 지금</span>
        </div>
      ) : null}

      {!ctx ? (
        <div className="card p-10 text-center text-sm text-muted">불러오는 중…</div>
      ) : view === "teacher" ? (
        <TeacherView ctx={ctx} day={day} />
      ) : view === "room" ? (
        <RoomView ctx={ctx} day={day} />
      ) : view === "all" ? (
        <AllView ctx={ctx} />
      ) : view === "search" ? (
        <SearchView ctx={ctx} />
      ) : view === "manage" ? (
        <ManageView ctx={ctx} />
      ) : view === "books" ? (
        <BooksView ctx={ctx} />
      ) : (
        <StaffView ctx={ctx} />
      )}

      {ctx && detailId !== null ? <ClassDetail ctx={ctx} classId={detailId} onClose={() => setDetailId(null)} /> : null}
      {ctx && editing ? <ClassEditor ctx={ctx} classId={editing.id} onClose={() => setEditing(null)} /> : null}
      {ctx && tool === "swap" ? <SwapModal ctx={ctx} initialDay={showDay ? day : now.day} onClose={() => setTool(null)} /> : null}
      {ctx && tool === "assign" ? (
        <AssignModal
          ctx={ctx}
          initialDay={showDay ? day : now.day}
          onClose={() => setTool(null)}
          onDone={(d) => {
            setTool(null);
            setView("room");
            setDay(d);
          }}
        />
      ) : null}
      {ctx && tool === "upload" ? <UploadModal ctx={ctx} onClose={() => setTool(null)} /> : null}
    </div>
  );
}

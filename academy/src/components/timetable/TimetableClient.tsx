"use client";

// 시간표 — 요일별 / 선생님별(월~토) / 교실별 / 전체 반 / 학생 찾기 / 반 관리 / 교재 책장 / 계정 · 강의실.
// 선생님(관리자 · 데스크 권한 없음) = 내 시간표 + 교재 책장만. 알바 데스크 = 근무 요일만(🔒).
// 반 = 여러 칸(수업 · SR). 같은 반은 같은 색, 점선 = SR, 빗금 = 교실배정, 주황 선 = 지금 시각.

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, errorMessage } from "@/lib/http";
import { useDataChanged } from "@/lib/dataChanged";
import { can, dayLimit } from "@/lib/perm";
import { DAY_LABELS, minutesOfDay } from "@/lib/time";
import { teacherLabel, type Book, type ClassModel, type Conflict, type Room, type RoomBooking, type SessionUser, type TempSwap } from "@/lib/types";
import { IconDownload, IconUpload } from "../Icons";
import { WEEK } from "./model";
import { AllView, ConflictBar, ManageView, RoomView, SearchView } from "./views";
import { DaySheet, OpsLegend, PrintTitle, TeacherWeek, termTitle } from "./opsViews";
import BooksView from "./BooksView";
import StaffView from "./StaffView";
import ClassDetail from "./ClassDetail";
import ClassEditor from "./ClassEditor";
import OpsPrint from "./OpsPrint";
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
  /** 교체 비교 기준 — 📸 분기 마감 저장본 */
  snapshot: { label: string; savedAt: string } | null;
};

/** 화면 곳곳에서 쓰는 것들 */
export type Ctx = {
  user: SessionUser;
  data: TimetableData;
  reload: () => Promise<void>;
  /** 지금 요일 · 분 (1분마다) */
  now: { day: number; min: number };
  /** day = 누른 요일 — 숙제반은 그 요일 학생만 */
  openClass: (id: number, day?: number) => void;
  editClass: (id: number | null) => void;
  setError: (msg: string | null) => void;
};

type View = "day" | "teacher" | "mine" | "room" | "all" | "search" | "manage" | "books" | "staff";
const VIEWS: [View, string][] = [
  ["day", "요일별"],
  ["teacher", "선생님별 (월~토)"],
  ["room", "교실별"],
  ["all", "전체 반"],
  ["search", "학생 찾기"],
  ["manage", "반 관리"],
  ["books", "교재 책장"],
  ["staff", "계정 · 강의실"],
];
const ADMIN_VIEWS: View[] = ["manage", "staff"];
/** 선생님(전체 시간표 권한 없음) — 내 시간표 + 교재 책장 */
const TEACHER_VIEWS: [View, string][] = [
  ["mine", "내 시간표"],
  ["books", "교재 책장"],
];
/** 예전 주소(?view=teacher 는 하루 선생님 칸이었다) */
const ALIAS: Record<string, View> = { teacher: "day" };

/** 선생님 한 주 — 월~금 한 장 + 토·일은 수업이 있을 때만 옆에 (알바는 근무 요일만) */
const weekDays = (limit: number[] | null) => WEEK.filter((d) => !limit || limit.includes(d));

export default function TimetableClient({ user, initialView }: { user: SessionUser; initialView?: string }) {
  const admin = can(user, "timetable.write");
  const full = can(user, "timetable.all");
  const limit = dayLimit(user);
  const views = full ? VIEWS.filter(([k]) => admin || !ADMIN_VIEWS.includes(k)) : TEACHER_VIEWS;
  const [view, setView] = useState<View>(() => {
    const want = (initialView && (ALIAS[initialView] ?? initialView)) as View | undefined;
    return views.some(([k]) => k === want) ? want! : views[0][0];
  });
  const allowed = (d: number) => !limit || limit.includes(d);
  const [day, setDay] = useState(() => {
    const d = new Date().getDay();
    return allowed(d) ? d : (limit?.[0] ?? d);
  });
  const [teacherId, setTeacherId] = useState<number | null>(null);
  const [data, setData] = useState<TimetableData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => ({ day: new Date().getDay(), min: minutesOfDay(new Date()) }));
  const [detail, setDetail] = useState<{ id: number; day?: number } | null>(null);
  const [editing, setEditing] = useState<{ id: number | null } | null>(null);
  const [tool, setTool] = useState<"swap" | "assign" | "upload" | null>(null);
  const [print, setPrint] = useState<{ title: string; kind: "days" | "teachers"; ids: number[] } | null>(null);

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
  // 다른 컴퓨터 · 탭에서 반 · 시간을 고치면 바로 다시 불러온다
  useDataChanged(reload);

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
            openClass: (id, day) => setDetail({ id, day }),
            editClass: (id) => {
              setDetail(null);
              setEditing({ id });
            },
            setError,
          }
        : null,
    [data, user, reload, now],
  );

  // 선생님별 — 수업이 있는 선생님 (선생님 순서)
  const teachersWithClass = useMemo(
    () => (data ? data.teachers.filter((t) => data.classes.some((c) => c.students.length > 0 && c.parts.some((p) => p.kind === "CLASS" && p.teacherId === t.id))) : []),
    [data],
  );
  const curTeacher = view === "mine" ? user.id : (teacherId ?? teachersWithClass[0]?.id ?? null);
  const tName = (id: number) => data?.teachers.find((t) => t.id === id)?.name ?? user.name;
  const days = weekDays(limit);
  const term = data ? termTitle(data.today) : "";

  const showDay = view === "day" || view === "room";
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
          {view === "day" ? (
            <>
              <button type="button" className="btn" onClick={() => setPrint({ title: `${DAY_LABELS[day]}요일 시간표`, kind: "days", ids: [day] })}>
                🖨 {DAY_LABELS[day]}요일 한 장
              </button>
              <button type="button" className="btn" onClick={() => setPrint({ title: limit ? "근무 요일 시간표" : "월~토 시간표", kind: "days", ids: days.filter((d) => d !== 0) })}>
                🖨 {limit ? "근무 요일" : "월~토"} 한 번에
              </button>
            </>
          ) : null}
          {(view === "teacher" || view === "mine") && curTeacher !== null ? (
            <>
              <button type="button" className="btn" onClick={() => setPrint({ title: `${teacherLabel(tName(curTeacher))} 시간표`, kind: "teachers", ids: [curTeacher] })}>
                🖨 {view === "mine" ? "내 시간표" : teacherLabel(tName(curTeacher))} 한 장
              </button>
              {view === "teacher" ? (
                <button type="button" className="btn" onClick={() => setPrint({ title: "선생님 전원 시간표", kind: "teachers", ids: teachersWithClass.map((t) => t.id) })}>
                  🖨 선생님 전원 (한 명당 한 장)
                </button>
              ) : null}
            </>
          ) : null}
          {can(user, "timetable.swap") ? (
            <button type="button" className="btn" onClick={() => setTool("swap")}>
              ⇄ 알파·수업 순서 바꾸기
            </button>
          ) : null}
          {full && can(user, "rooms.booking") ? (
            <button type="button" className="btn" onClick={() => setTool("assign")}>
              ＋ 교실배정 (빈 교실 찾기)
            </button>
          ) : null}
          {full && !limit ? (
            <a className="btn" href="/api/timetable/excel">
              <IconDownload className="h-4 w-4" />
              엑셀 다운로드
            </a>
          ) : null}
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
              <button
                key={d}
                type="button"
                disabled={!allowed(d)}
                title={allowed(d) ? undefined : "근무 요일이 아니에요"}
                className={`btn px-3 ${day === d ? "btn-primary" : ""} ${allowed(d) ? "" : "opacity-40"}`}
                onClick={() => setDay(d)}
              >
                {allowed(d) ? "" : "🔒 "}
                {DAY_LABELS[d]}
                {d === now.day ? " · 오늘" : ""}
              </button>
            ))}
          </div>
          {view === "day" ? <OpsLegend /> : <span className="text-xs text-muted">같은 반은 같은 색 · 점선 = SR · 빗금 = 교실배정 · 주황 선 = 지금</span>}
        </div>
      ) : null}
      {view === "teacher" ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {teachersWithClass.map((t) => (
              <button key={t.id} type="button" className={`btn px-3 ${curTeacher === t.id ? "btn-primary" : ""}`} onClick={() => setTeacherId(t.id)}>
                {teacherLabel(t.name)}
              </button>
            ))}
          </div>
          <OpsLegend />
        </div>
      ) : null}

      {!ctx ? (
        <div className="card p-10 text-center text-sm text-muted">불러오는 중…</div>
      ) : view === "day" ? (
        <div className="space-y-2">
          <h2 className="text-lg font-extrabold text-navy-900">
            {term} 시간표 — {DAY_LABELS[day]}요일
          </h2>
          <ConflictBar ctx={ctx} day={day} />
          <DaySheet ctx={ctx} day={day} />
          <p className="text-xs text-muted">🟠 주황 선 = 지금 시각 (오늘 요일에서만) · 블록을 누르면 반 상세가 열려요 · 선생님 칸 아래 작은 글씨 = 쓰는 교실</p>
        </div>
      ) : view === "teacher" || view === "mine" ? (
        <div className="space-y-2">
          {view === "mine" ? <OpsLegend /> : null}
          <h2 className="text-lg font-extrabold text-navy-900">
            {curTeacher !== null ? teacherLabel(tName(curTeacher)) : ""} {term} 시간표 (월~토)
          </h2>
          {curTeacher !== null ? <TeacherWeek ctx={ctx} teacherId={curTeacher} days={days} /> : <div className="card p-8 text-center text-sm text-muted">수업이 있는 선생님이 없어요.</div>}
        </div>
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

      {ctx && print ? (
        <OpsPrint
          title={print.title}
          landscape={print.kind === "teachers"}
          onClose={() => setPrint(null)}
          pages={print.ids.map((id) =>
            print.kind === "days"
              ? {
                  key: `d${id}`,
                  node: (
                    <>
                      <PrintTitle title={`${term} 시간표 — ${DAY_LABELS[id]}요일`} />
                      <DaySheet ctx={ctx} day={id} print />
                    </>
                  ),
                }
              : {
                  key: `t${id}`,
                  node: (
                    <>
                      <PrintTitle title={`${teacherLabel(tName(id))} ${term} 시간표 (월~토)`} />
                      <TeacherWeek ctx={ctx} teacherId={id} days={days} print />
                    </>
                  ),
                },
          )}
        />
      ) : null}
      {ctx && detail ? <ClassDetail ctx={ctx} classId={detail.id} day={detail.day} onClose={() => setDetail(null)} /> : null}
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

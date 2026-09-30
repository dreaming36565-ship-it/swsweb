import { withUser } from "@/lib/api";
import { can, dayLimit } from "@/lib/perm";
import {
  absentOn,
  conflictsForDay,
  getSnapshot,
  listAlertOk,
  listBookings,
  listBooks,
  listClassModels,
  listRooms,
  listTeachers,
  listTempSwaps,
  srSnapshot,
  today,
} from "@/lib/repo";
import { minutesOfDay, weekDateOf } from "@/lib/time";
import type { ClassModel } from "@/lib/types";

/**
 * 시간표 화면 — 반(칸) · 강의실 · 선생님 · 교재 · 이번 주 교실배정 · 이번 주만 바꾼 순서 · 교실 경고 확인 · SR 자리.
 * 선생님(관리자 · 데스크 권한 없음) = 내 반만 · 알바 데스크 = 근무 요일만 (화면뿐 아니라 여기서도 거른다).
 */
export const GET = withUser(({ user }) => {
  const week = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ day: d, date: weekDateOf(d) }));
  const t = today();
  const sr = srSnapshot(t);
  let classes = listClassModels();
  let conflicts = week.map((w) => ({ day: w.day, list: conflictsForDay(w.day, w.date) }));

  if (!can(user, "timetable.all")) {
    const mine = (c: ClassModel) => c.teacherId === user.id || c.parts.some((p) => p.teacherId === user.id);
    classes = classes.filter(mine);
    conflicts = [];
  }
  const limit = dayLimit(user);
  if (limit) {
    classes = classes
      .map((c) => ({
        ...c,
        days: c.days.filter((d) => limit.includes(d)),
        parts: c.parts.map((p) => ({ ...p, days: p.days.filter((d) => limit.includes(d)) })).filter((p) => p.days.length),
      }))
      .filter((c) => c.parts.length);
    conflicts = conflicts.filter((c) => limit.includes(c.day));
  }
  const ids = new Set(classes.map((c) => c.id));
  const studentIds = new Set(classes.flatMap((c) => c.students.map((s) => s.id)));
  const snap = getSnapshot();

  return {
    today: t,
    nowMin: minutesOfDay(new Date()),
    week,
    classes,
    rooms: listRooms(),
    teachers: listTeachers().map((u) => ({ id: u.id, name: u.name })),
    books: listBooks(),
    bookings: listBookings(t, week[6].date),
    tempSwaps: listTempSwaps().filter((s) => ids.has(s.classId)),
    alertOk: listAlertOk(),
    conflicts,
    seats: sr.seats.filter((s) => ids.has(s.classId)),
    absents: absentOn(t).filter((a) => studentIds.has(a.studentId)),
    /** 교체 비교 기준 — 📸 분기 마감 저장본 */
    snapshot: snap ? { label: snap.label, savedAt: snap.savedAt } : null,
  };
});

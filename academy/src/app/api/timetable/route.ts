import { withUser } from "@/lib/api";
import {
  conflictsForDay,
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

/** 시간표 화면 — 반(칸) · 강의실 · 선생님 · 교재 · 이번 주 교실배정 · 이번 주만 바꾼 순서 · 교실 경고 확인 · SR 자리 */
export const GET = withUser(() => {
  const week = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ day: d, date: weekDateOf(d) }));
  const t = today();
  const sr = srSnapshot(t);
  return {
    today: t,
    nowMin: minutesOfDay(new Date()),
    week,
    classes: listClassModels(),
    rooms: listRooms(),
    teachers: listTeachers().map((u) => ({ id: u.id, name: u.name })),
    books: listBooks(),
    bookings: listBookings(t, week[6].date),
    tempSwaps: listTempSwaps(),
    alertOk: listAlertOk(),
    conflicts: week.map((w) => ({ day: w.day, list: conflictsForDay(w.day, w.date) })),
    seats: sr.seats,
  };
});

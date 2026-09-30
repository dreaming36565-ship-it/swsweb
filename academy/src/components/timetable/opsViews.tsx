"use client";

// 운영 시간표 — ① 요일별(시간 | SR | 선생님 칸) ② 선생님별(한 선생님 월~금 + 토는 옆에 따로).
// 블록 = 반이름+인원 / 교체 색 줄 / 교재 / 시간·교실 / 명단 3명씩, 가운데 정렬. 반 색은 옅게, 같은 반 = 같은 색(수업 ↔ SR).
// 반레벨 변경 = 반이름 보라 바탕. 인쇄는 A4 세로 한 장씩.

import type { ReactNode } from "react";
import { classColorMap, softColor, type ClassColor } from "@/lib/colors";
import { quarterOf } from "@/lib/homework";
import { DAY_LABELS, rangeLabel } from "@/lib/time";
import { CHANGE_LABEL, teacherLabel, type ChangeKind, type ClassModel, type ClassPart } from "@/lib/types";
import TimeGrid, { dayRange, fitRange, type GridBlock, type GridColumn, type SrItem } from "./TimeGrid";
import { classesOn, isSwapped, partBooks, partsOn } from "./model";
import type { Ctx } from "./TimetableClient";

const CHG_BG: Record<ChangeKind, string> = { T: "bg-chg-t", H: "bg-chg-h", B: "bg-chg-b" };

/** 2026 4분기(9~11월) */
export function termTitle(today: string) {
  const q = quarterOf(today);
  return `${q.end.slice(0, 4)} ${q.label}(${Number(q.start.slice(5, 7))}~${Number(q.end.slice(5, 7))}월)`;
}

export const TempTag = () => <span className="mx-auto mt-0.5 block w-fit rounded bg-srpink px-1 text-[10px] font-bold text-white">⇄ 이번 주만</span>;

/** 명단 — 3명씩 줄바꿈 */
function names3(list: { name: string }[]) {
  const out: string[] = [];
  for (let i = 0; i < list.length; i += 3) out.push(list.slice(i, i + 3).map((s) => s.name).join(" "));
  return out;
}

/** 수업 블록 내용 — 반이름 · 인원 / 교체 색 줄 / 교재 / 시간 · 교실 / 명단 */
export function opsContent(
  ctx: Ctx,
  c: ClassModel,
  p: ClassPart,
  { names = true, room = true, extra }: { names?: boolean; room?: boolean; extra?: ReactNode } = {},
) {
  const book = partBooks(p, ctx.data.books) || c.textbook || "";
  return (
    <>
      <div className="text-[16px] font-black leading-tight">
        <span className={c.levelChanged ? "rounded-md bg-lvl px-1.5 text-white" : ""} title={c.levelChanged ? "반레벨 변경" : undefined}>
          {c.name}
        </span>
        <span className="ml-1 rounded-[5px] bg-white px-1.5 align-[1px] text-[13px] font-extrabold text-ink">{c.students.length}명</span>
      </div>
      {c.change ? (
        <div className={`-mx-1 my-0.5 px-0.5 text-[12.5px] font-extrabold text-chg-ink ${CHG_BG[c.change.kind]}`}>
          {CHANGE_LABEL[c.change.kind]}
          {c.change.note ? ` · ${c.change.note}` : ""}
        </div>
      ) : null}
      {p.kind === "CLASS" && c.hapbanWith !== null ? (
        <span className="mx-auto block w-fit rounded bg-navy-700 px-1 text-[10px] font-extrabold text-white">🔗 합반</span>
      ) : null}
      {extra}
      {book ? <div className="text-[13.5px] font-bold">{book}</div> : null}
      <div className="text-[12.5px] opacity-85">
        {rangeLabel(p.start, p.end)}
        {room && p.roomName ? ` · ${p.roomName}` : ""}
      </div>
      {names ? (
        <div className="mt-0.5 text-[13.5px] font-semibold leading-[1.4] text-ink">
          {names3(c.students).map((l) => (
            <div key={l}>{l}</div>
          ))}
        </div>
      ) : null}
    </>
  );
}

export function OpsLegend() {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
      블록 안 색 줄:
      {(["T", "H", "B"] as ChangeKind[]).map((k) => (
        <span key={k} className={`rounded px-2 py-px font-extrabold text-chg-ink ${CHG_BG[k]}`}>
          {CHANGE_LABEL[k]}
        </span>
      ))}
      <span className="rounded bg-lvl px-2 py-px font-extrabold text-white">반레벨 변경 = 반이름 보라</span>
      <span className="text-muted">· 같은 반 = 같은 색(수업 ↔ SR) · 점선 상자 = SR 같은 시간대 · 0명 반 안 보임</span>
    </div>
  );
}

/* ------------------------------------------------------------ 요일 하루 */

type OnItem = { c: ClassModel; p: ClassPart; swapped: boolean };

export function dayItems(ctx: Ctx, day: number): OnItem[] {
  return classesOn(ctx.data.classes, day).flatMap((c) => {
    const swapped = isSwapped(ctx.data.tempSwaps, c.id, day);
    return partsOn(c, day, swapped).map((p) => ({ c, p, swapped }));
  });
}

const colorsFor = (items: OnItem[]) => {
  const base = classColorMap(items.map((i) => i.c.id));
  return new Map([...base].map(([id, col]) => [id, softColor(col)]));
};

const srRoomOf = (ctx: Ctx) => ctx.data.rooms.find((r) => r.isSr === 1);

/** SR 칸 — SR룸을 쓰는 칸 (수업 없이 SR만 쓰는 반 포함) */
export function srItems(ctx: Ctx, items: OnItem[], colors: Map<number, ClassColor>, day: number, onClick = true): SrItem[] {
  const sr = srRoomOf(ctx);
  return items
    .filter(({ p }) => p.kind === "SR" && (!sr || p.roomId === sr.id || p.roomId === null))
    .map(({ c, p, swapped }) => ({
      key: `${c.id}-${p.start}`,
      name: c.name,
      count: c.students.length,
      start: p.start,
      end: p.end,
      color: colors.get(c.id),
      onClick: onClick ? () => ctx.openClass(c.id, day) : undefined,
      tag: swapped ? <TempTag /> : undefined,
    }));
}

/** ① 요일별 — 시간 | SR | 선생님 칸 (그날 수업이 있는 선생님만, 칸 아래 작은 글씨 = 쓰는 교실) */
export function DaySheet({ ctx, day, print = false }: { ctx: Ctx; day: number; print?: boolean }) {
  const items = dayItems(ctx, day);
  const colors = colorsFor(items);
  const classes = items.filter(({ p }) => p.kind === "CLASS");
  const order = ctx.data.teachers.map((t) => t.id);
  const tIds = [...new Set(classes.map(({ p }) => p.teacherId))].sort(
    (a, b) => (a === null ? 999 : order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (b === null ? 999 : order.indexOf(b) < 0 ? 99 : order.indexOf(b)),
  );
  const columns: GridColumn[] = tIds.map((id) => {
    const mine = classes.filter(({ p }) => p.teacherId === id);
    return {
      key: `t${id}`,
      label: id === null ? "담당 미정" : teacherLabel(mine[0].p.teacherName),
      sub: [...new Set(mine.map(({ p }) => p.roomName).filter(Boolean))].join("·"),
      blocks: mine.map<GridBlock>(({ c, p, swapped }) => ({
        key: `${c.id}-${p.start}`,
        start: p.start,
        end: p.end,
        color: colors.get(c.id),
        kind: "class",
        hapban: c.hapbanWith !== null,
        title: `${c.name} ${rangeLabel(p.start, p.end)}`,
        onClick: print ? undefined : () => ctx.openClass(c.id, day),
        content: opsContent(ctx, c, p, { extra: swapped ? <TempTag /> : null }),
      })),
    };
  });
  const [a, z] = print ? fitRange(items.flatMap(({ p }) => [p.start, p.end])) : dayRange(day, items.flatMap(({ p }) => [p.start, p.end]));
  const sr = srRoomOf(ctx);
  return (
    <TimeGrid
      from={a}
      to={z}
      columns={columns}
      sr={{ label: sr?.name ?? "SR룸", seats: sr?.capacity ?? 24, items: srItems(ctx, items, colors, day, !print) }}
      nowMin={!print && day === ctx.now.day ? ctx.now.min : null}
      print={print}
    />
  );
}

/* ------------------------------------------------------------ 선생님 한 주 */

/** 선생님이 수업하는 요일 — 월~금 한 장, 토(오전)는 옆에 따로 */
export function TeacherWeek({ ctx, teacherId, days, print = false }: { ctx: Ctx; teacherId: number; days: number[]; print?: boolean }) {
  const all = days.flatMap((d) => dayItems(ctx, d).filter(({ p }) => p.kind === "CLASS" && p.teacherId === teacherId).map((it) => ({ ...it, d })));
  const colors = colorsFor(all);
  const part = (ds: number[]) => {
    if (!ds.length) return null;
    const list = all.filter((i) => ds.includes(i.d));
    const [a, z] = fitRange(list.flatMap(({ p }) => [p.start, p.end]));
    const columns: GridColumn[] = ds.map((d) => {
      const on = list.filter((i) => i.d === d);
      return {
        key: `d${d}`,
        label: DAY_LABELS[d],
        sub: on.length ? `${on.length}개 반` : "수업 없음",
        blocks: on.map<GridBlock>(({ c, p, swapped }) => ({
          key: `${d}-${c.id}-${p.start}`,
          start: p.start,
          end: p.end,
          color: colors.get(c.id),
          kind: "class",
          hapban: c.hapbanWith !== null,
          title: `${c.name} ${rangeLabel(p.start, p.end)}`,
          onClick: print ? undefined : () => ctx.openClass(c.id, d),
          content: opsContent(ctx, c, p, { extra: swapped ? <TempTag /> : null }),
        })),
      };
    });
    return <TimeGrid from={a} to={z} columns={columns} nowMin={null} print={print} />;
  };
  const weekday = days.filter((d) => d >= 1 && d <= 5);
  const weekend = days.filter((d) => (d === 6 || d === 0) && all.some((i) => i.d === d));
  if (!all.length) return <div className="card p-8 text-center text-sm text-muted">이번 분기 수업이 없어요.</div>;
  return (
    <div className="flex items-start gap-2.5">
      {part(weekday)}
      {part(weekend)}
    </div>
  );
}

/* ------------------------------------------------------------ 인쇄 한 장 */

export function PrintTitle({ title }: { title: string }) {
  return (
    <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
      <h2 className="text-[20px] font-extrabold text-navy-900">{title}</h2>
      <OpsLegend />
    </div>
  );
}

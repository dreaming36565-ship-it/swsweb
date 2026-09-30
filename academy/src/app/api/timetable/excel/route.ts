import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { can, dayLimit } from "@/lib/perm";
import { listClassModels, listTeachers } from "@/lib/repo";
import { classColorMap } from "@/lib/colors";
import { DAY_LABELS, dateKey, fmtTime, overlaps } from "@/lib/time";

/**
 * 📥 주간 시간표 엑셀 — 시트 7개(월~일). 한 시트 = 한 요일, 줄 = 30분, 칸 = 선생님(+SR).
 * 겹치는 수업은 한 칸에 줄을 바꿔 함께 적고, 반 색으로 칠한다.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false, error: "로그인이 필요합니다." }, { status: 401 });
  // 전체 시간표 — 관리자 · 데스크 (알바는 근무 요일만 봐서 전체 엑셀은 안 됨)
  if (!can(user, "timetable.all") || dayLimit(user))
    return NextResponse.json({ ok: false, error: "전체 시간표 엑셀은 관리자 · 데스크(정직원)만 받을 수 있어요." }, { status: 403 });

  const classes = listClassModels();
  const teachers = listTeachers();
  const wb = new ExcelJS.Workbook();
  for (const day of [1, 2, 3, 4, 5, 6, 0]) {
    const ws = wb.addWorksheet(`${DAY_LABELS[day]}요일`);
    const on = classes.flatMap((c) => c.parts.filter((p) => p.days.includes(day)).map((p) => ({ c, p })));
    const colors = classColorMap(on.map((x) => x.c.id));
    const cols = [{ key: "SR", name: "SR" }, ...teachers.map((t) => ({ key: String(t.id), name: `${t.name}T` }))];
    ws.columns = [{ header: "시간", width: 12 }, ...cols.map((c) => ({ header: c.name, width: 22 }))];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
    if (on.length === 0) continue;
    const from = Math.floor(Math.min(...on.map((x) => x.p.start)) / 30) * 30;
    const to = Math.ceil(Math.max(...on.map((x) => x.p.end)) / 30) * 30;
    for (let t = from; t < to; t += 30) {
      const cells = cols.map((col) => {
        const hits = on.filter(({ p }) =>
          col.key === "SR" ? p.kind === "SR" : p.kind === "CLASS" && String(p.teacherId) === col.key,
        ).filter(({ p }) => overlaps(p.start, p.end, t, t + 30));
        return hits;
      });
      const row = ws.addRow([
        fmtTime(t),
        ...cells.map((hits) => hits.map(({ c, p }) => `${c.name}(${c.students.length}명) ${p.label}`).join("\n")),
      ]);
      row.alignment = { vertical: "top", wrapText: true };
      cells.forEach((hits, i) => {
        if (!hits.length) return;
        const color = colors.get(hits[0].c.id);
        if (!color) return;
        const cell = row.getCell(i + 2);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${color.bg.slice(1)}` } };
        cell.font = { color: { argb: `FF${color.text.slice(1)}` } };
      });
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  const name = `유투엠_시간표_${dateKey(new Date())}.xlsx`;
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    },
  });
}

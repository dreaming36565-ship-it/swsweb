import ExcelJS from "exceljs";
import { requirePermission, withUser } from "@/lib/api";
import { assert } from "@/lib/errors";
import { rosterUpload } from "@/lib/repo";

/**
 * 📤 명단 엑셀 올리기 (관리자) — 첫 줄에 「반이름」 「학생이름」 칸. 한 줄에 학생 한 명.
 * 이미 있는 반에 새 학생만 더한다(빼지는 않는다). 없는 반은 건너뛴다.
 * form-data: file(.xlsx / .csv), apply("1" 이면 반영, 아니면 미리보기)
 */
export const POST = withUser(async ({ user, req }) => {
  requirePermission(user, "timetable.write");
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    assert(false, "파일을 골라 주세요.");
  }
  const file = form.get("file");
  assert(file instanceof File && file.size > 0, "파일을 골라 주세요.");
  const apply = form.get("apply") === "1";
  const table: string[][] = [];
  if (/\.csv$/i.test(file.name)) {
    const text = new TextDecoder("utf-8").decode(await file.arrayBuffer()).replace(/^﻿/, "");
    for (const line of text.split(/\r?\n/)) table.push(line.split(",").map((x) => x.trim()));
  } else {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(await file.arrayBuffer());
    } catch {
      assert(false, "엑셀 파일을 읽지 못했어요. .xlsx 또는 .csv 파일인지 확인해 주세요.");
    }
    const ws = wb.worksheets[0];
    assert(ws, "엑셀에 시트가 없어요.");
    ws.eachRow((row) => {
      const vals = (row.values as unknown[]).slice(1).map((v) => String((v as { text?: string })?.text ?? v ?? "").trim());
      table.push(vals);
    });
  }
  const headIdx = table.findIndex((r) => r.includes("반이름") && r.includes("학생이름"));
  assert(headIdx >= 0, "첫 줄에 「반이름」과 「학생이름」 칸이 있어야 해요.");
  const ci = table[headIdx].indexOf("반이름");
  const si = table[headIdx].indexOf("학생이름");
  const lines = table.slice(headIdx + 1).map((r) => ({ className: r[ci] ?? "", studentName: r[si] ?? "" }));
  return rosterUpload(lines, apply);
});

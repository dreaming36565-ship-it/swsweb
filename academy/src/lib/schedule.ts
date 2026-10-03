// 📅 월간 스케줄 규칙 — 휴강일 · 보충 · 옮김 · 반별 횟수 · 안내문 글. 순수 함수 (서버 · 화면 공용). DB 접근 금지.
//
// 확정 (2026-10-03, 시안 schedule.html 4차):
//   - 휴강은 유투엠 · 스킬 같음. 전체 휴강 / 반만 휴강. 공휴일이지만 수업하면 ★정상수업★
//   - 휴강 = 출결 · 알림음 · SR · 숙제검사 칸 · 인증 · 결석 없음
//   - 정한 횟수 자동: 초3 · 고등 · 피팅 = 월 8회, 나머지(초4~중3) = 월 12회(정규 + 개별 금·토). 합계만 맞으면 됨
//   - 고등 회당 수강료 자동: 고1 6만 · 고2 · 3 6.5만 (고등 안내문에만)
//   - 보충(EXTRA) = 다른 날 수업 1회 더 (어느 달 횟수인지 countMonth) · 옮김(MOVE) = from 수업을 to 로 (횟수는 from 달)
//   - 다음 달로 넘김(carry) = 이 달 차이(+1 많음 / −1 모자람)를 다음 달 정한 횟수에서 빼고 더함
//   - 무료 수업(고등 누적오답)은 달력에만, 세지 않음
//   - 학기 이름 = 3월 봄 · 6월 여름 · 9월 가을 · 12월 겨울학기 (분기 시작 달 = 반별 안내문 + 시간표 · 학습과정)

export type Brand = "U" | "S";
export const BRAND_LABEL: Record<Brand, string> = { U: "유투엠", S: "스터디킬러" };

/** 그 날 전체 — off 전체 휴강 · open 공휴일이지만 정상수업 · memo 휴강 이름(없으면 공휴일 이름) */
export type SchedDay = { date: string; off: boolean; open: boolean; memo: string | null };
/** 반만 휴강 */
export type ClassOff = { date: string; classId: number; memo: string | null };
/** MOVE = fromDate 수업을 toDate 로 옮김 (횟수는 countMonth = from 달) / EXTRA = toDate 에 보충 1회 (countMonth 달 횟수) */
export type SchedMove = { id: number; classId: number; kind: "MOVE" | "EXTRA"; fromDate: string | null; toDate: string; countMonth: string };
/** 이 달 차이를 다음 달로 넘김 — delta +1 = 이 달 1회 많음(다음 달 1회 덜) / −1 = 모자람(다음 달 1회 더) */
export type SchedCarry = { classId: number; month: string; delta: number };
/** 학원 행사 막대 — 기간이면 한 줄로 이어짐. dy = 안내문 막대 위아래 · ex/ey/es = 이모지 위치 · 크기 */
export type SchedEvent = {
  id: number;
  brand: Brand;
  title: string;
  start: string;
  end: string;
  color: string;
  emoji: string | null;
  dy: number;
  ex: number;
  ey: number;
  es: number;
  classId: number | null;
  inNote: boolean;
  orderNo: number;
};
/** 안내문에 얹은 이모지 (그 학원 · 그 달 안내문 모두에) */
export type SchedSticker = { id: number; brand: Brand; month: string; emoji: string; x: number; y: number; size: number };
/** 학교 시험 시작 (학사일정에서 자동) */
export type ExamStart = { date: string; school: string; level: "H" | "M" | "E" };

/** 스케줄 대상 반 (수업이 있는 반 — 개별 · 숙제반 · 누적오답 반 제외) */
export type SchedClass = {
  id: number;
  name: string;
  brand: Brand;
  grade: string | null;
  /** 정규 수업 요일 */
  regDays: number[];
  /** 개별 수업 요일 — 12회 반 = 금 · 토 (학생마다 둘 중 하나) */
  indDays: number[];
  /** 무료 수업 (고등 누적오답) 요일 */
  freeDays: { day: number; label: string }[];
  target: number;
  /** 고등 회당 수강료 (만원) */
  fee: number | null;
  /** 칸 글자 (고등) — 정규 수업 / 선택 수업 */
  label: string;
  /** 시간 · 교재 — 분기 시작 달 안내문 */
  time: string;
  book: string;
};

export type Closures = { days: SchedDay[]; classOff: ClassOff[]; moves: SchedMove[] };

/* ---------------------------------------------------------------- 날짜 */

const pad = (n: number) => String(n).padStart(2, "0");
const DOW = "일월화수목금토";
const toDate = (s: string) => new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
export const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const dowOf = (s: string) => toDate(s).getDay();
export const monthOf = (date: string) => date.slice(0, 7);
export function shiftMonth(ym: string, n: number): string {
  const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export const daysIn = (ym: string) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
export const monthDates = (ym: string) => Array.from({ length: daysIn(ym) }, (_, i) => `${ym}-${pad(i + 1)}`);
export const monNo = (ym: string) => Number(ym.slice(5, 7));
/** 10/6(화) */
export const mdw = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}(${DOW[dowOf(d)]})`;
/** 10월 6일(화) */
export const mdwLong = (d: string) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일(${DOW[dowOf(d)]})`;
export const dayNo = (d: string) => Number(d.slice(8));
/** 같은 달 다른 날 (지난달 행사 복사) — 없는 날은 그 달 끝 날 */
export function sameDayIn(date: string, ym: string): string {
  return `${ym}-${pad(Math.min(dayNo(date), daysIn(ym)))}`;
}
export const daysLabel = (days: number[]) => [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DOW[d]).join("");

/* ---------------------------------------------------------------- 공휴일 (후보 — 휴강인지는 사람이 정한다) */

const HOLIDAYS: Record<string, string> = {
  "2026-01-01": "신정",
  "2026-02-16": "설날 연휴",
  "2026-02-17": "설날",
  "2026-02-18": "설날 연휴",
  "2026-03-01": "삼일절",
  "2026-03-02": "대체공휴일",
  "2026-05-05": "어린이날",
  "2026-05-24": "부처님오신날",
  "2026-05-25": "대체공휴일",
  "2026-06-03": "지방선거",
  "2026-06-06": "현충일",
  "2026-08-15": "광복절",
  "2026-08-17": "대체공휴일",
  "2026-09-24": "추석 연휴",
  "2026-09-25": "추석",
  "2026-09-26": "추석 연휴",
  "2026-09-28": "대체공휴일",
  "2026-10-03": "개천절",
  "2026-10-05": "대체공휴일",
  "2026-10-09": "한글날",
  "2026-12-25": "성탄절",
  "2027-01-01": "신정",
  "2027-02-06": "설날 연휴",
  "2027-02-07": "설날",
  "2027-02-08": "설날 연휴",
  "2027-02-09": "대체공휴일",
  "2027-03-01": "삼일절",
  "2027-05-05": "어린이날",
  "2027-05-13": "부처님오신날",
  "2027-06-06": "현충일",
  "2027-08-15": "광복절",
  "2027-08-16": "대체공휴일",
  "2027-09-14": "추석 연휴",
  "2027-09-15": "추석",
  "2027-09-16": "추석 연휴",
  "2027-10-03": "개천절",
  "2027-10-04": "대체공휴일",
  "2027-10-09": "한글날",
  "2027-10-11": "대체공휴일",
  "2027-12-25": "성탄절",
  "2027-12-27": "대체공휴일",
};
export const holidayOf = (date: string): string | null => HOLIDAYS[date] ?? null;

/* ---------------------------------------------------------------- 반 정보 */

/** 정한 횟수 — 고등 · 초3 · 피팅 = 8, 나머지 = 12 */
export function targetOf(brand: Brand, grade: string | null, name: string): number {
  if (brand === "S") return 8;
  const s = `${grade ?? ""} ${name}`;
  return /초3|피팅/.test(s) ? 8 : 12;
}

/** 고등 회당 수강료(만원) — 고1 6만 · 고2 · 3 6.5만. 학년을 모르면 null */
export function feeOf(grade: string | null, name: string): number | null {
  const s = `${grade ?? ""} ${name}`;
  if (/고1|H1/.test(s)) return 6;
  if (/고[23]|H[23]/.test(s)) return 6.5;
  return null;
}
export const feeLabel = (n: number) => `${+n.toFixed(1)}만원`;

/** 분기 시작 달 (3 · 6 · 9 · 12월) */
export const isTermStart = (ym: string) => [3, 6, 9, 12].includes(monNo(ym));
export const termName = (ym: string) => ({ 3: "봄", 6: "여름", 9: "가을", 12: "겨울" })[monNo(ym)] ?? "";

/* ---------------------------------------------------------------- 휴강 · 수업 */

export function dayOf(c: Closures, date: string): SchedDay | undefined {
  return c.days.find((d) => d.date === date);
}
export const isAllOff = (c: Closures, date: string) => !!dayOf(c, date)?.off;
export const isClassOff = (c: Closures, date: string, classId: number) =>
  isAllOff(c, date) || c.classOff.some((x) => x.date === date && x.classId === classId);
/** 그 날 그 반 수업이 다른 날로 옮겨 감 */
export const movedAway = (c: Closures, date: string, classId: number) => c.moves.some((m) => m.kind === "MOVE" && m.classId === classId && m.fromDate === date);
/** 그 날 그 반에 옮겨 오거나 보충하는 수업 */
export const movedIn = (c: Closures, date: string, classId: number) => c.moves.filter((m) => m.classId === classId && m.toDate === date);
/** 수업 없는 날 (휴강 · 옮겨 감) — 출결 · SR · 숙제검사 칸이 없다 */
export const noLesson = (c: Closures, date: string, classId: number) => isClassOff(c, date, classId) || movedAway(c, date, classId);

/** 숙제검사 — 그 학생의 그 날 수업(정규 요일이면 정규반, 아니면 개별반)이 없나 */
export function studentOff(
  c: Closures,
  date: string,
  st: { regular: { id: number; days: number[] } | null; individualId: number | null },
): boolean {
  if (isAllOff(c, date)) return true;
  if (st.regular && st.regular.days.includes(dowOf(date))) return noLesson(c, date, st.regular.id);
  return st.individualId !== null && noLesson(c, date, st.individualId);
}

/** 그 날 그 반: reg 정규 · ind 개별 · free 무료 · null 없음 (휴강 · 옮겨 간 날 = null, 옮겨 온 날 = reg) */
export function lessonOf(c: Closures, cls: SchedClass, date: string): "reg" | "ind" | "free" | null {
  if (isClassOff(c, date, cls.id)) return null;
  if (movedIn(c, date, cls.id).length) return "reg";
  if (movedAway(c, date, cls.id)) return null;
  const w = dowOf(date);
  if (cls.regDays.includes(w)) return "reg";
  if (cls.indDays.includes(w)) return "ind";
  if (cls.freeDays.some((f) => f.day === w)) return "free";
  return null;
}

export type Count = {
  reg: number;
  /** 개별 — 금요일 / 토요일 (학생마다 둘 중 하나라 따로 센다) */
  indFri: number;
  indSat: number;
  /** 빠진 날 (휴강) */
  off: number;
  /** 이 달 날짜지만 다른 달 횟수인 보충 */
  otherMonth: number;
  /** 다른 달 날짜지만 이 달 횟수인 보충 · 옮김 */
  fromOther: number;
  /** 합계 — 개별이 금 · 토 다르면 두 개 */
  totals: number[];
  /** 정한 횟수 (지난달에서 넘어온 만큼 더하고 뺀 것) */
  target: number;
  carryIn: number;
};

/** 반 한 달 수업 횟수 — 휴강 · 옮겨 간 날 빼고, 이 달 횟수인 보충 · 옮김 더함. 무료 수업은 세지 않는다 */
export function countOf(c: Closures, cls: SchedClass, ym: string, carries: SchedCarry[]): Count {
  let reg = 0;
  let indFri = 0;
  let indSat = 0;
  let off = 0;
  for (const d of monthDates(ym)) {
    const w = dowOf(d);
    const planned = cls.regDays.includes(w);
    if (planned && isClassOff(c, d, cls.id)) off += 1;
    if (planned && !noLesson(c, d, cls.id)) reg += 1;
    // 개별반은 따로 된 반이라 전체 휴강만 빠진다
    if (cls.indDays.includes(w) && !isAllOff(c, d)) {
      if (w === 5) indFri += 1;
      else indSat += 1;
    }
  }
  let otherMonth = 0;
  let fromOther = 0;
  for (const m of c.moves.filter((x) => x.classId === cls.id)) {
    const inThis = monthOf(m.toDate) === ym;
    if (m.countMonth === ym) {
      reg += 1;
      if (!inThis) fromOther += 1;
    } else if (inThis) otherMonth += 1;
  }
  const ind = cls.indDays.length ? [...new Set(cls.indDays.map((w) => (w === 5 ? indFri : indSat)))] : [0];
  const carryIn = carries.find((x) => x.classId === cls.id && x.month === shiftMonth(ym, -1))?.delta ?? 0;
  return { reg, indFri, indSat, off, otherMonth, fromOther, totals: ind.map((n) => reg + n), target: cls.target - carryIn, carryIn };
}

/* ---------------------------------------------------------------- 안내문 */

/** 유투엠 묶음 — 정규 요일 + (12회면 개별 금·토 / 8회면 「월 8회」). 분기 시작 달은 반마다 한 장 */
export type PosterItem = { key: string; title: string; classIds: number[] };
export function posterList(brand: Brand, classes: SchedClass[], perClass: boolean): PosterItem[] {
  const mine = classes.filter((c) => c.brand === brand);
  if (brand === "S" || perClass) return mine.map((c) => ({ key: `c${c.id}`, title: c.name, classIds: [c.id] }));
  const groups = new Map<string, PosterItem>();
  for (const c of mine) {
    const days = daysLabel(c.regDays);
    const key = `g${days}-${c.target}`;
    const title = c.target === 12 ? `${days} + 개별(금 · 토)` : `${days} · 월 ${c.target}회${/초3/.test(`${c.grade} ${c.name}`) ? " (초3)" : ""}`;
    const g = groups.get(key) ?? { key, title, classIds: [] };
    g.classIds.push(c.id);
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title, "ko"));
}

/** 학교 시험 시작 글 — 「대진 · 송림 · 분당고 시험 시작」 */
export function examLines(exams: ExamStart[], date: string, levels: ("H" | "M" | "E")[]): string[] {
  const list = exams.filter((e) => e.date === date && levels.includes(e.level));
  const out: string[] = [];
  for (const lv of levels) {
    const names = list.filter((e) => e.level === lv).map((e) => e.school);
    if (!names.length) continue;
    const tail = lv === "H" ? "고" : lv === "M" ? "중" : "초";
    const short = names.map((n) => (n.endsWith(tail) ? n.slice(0, -1) : n));
    out.push(`${short.join(" · ")}${tail} 시험 시작`);
  }
  return out;
}

/** 휴강 이름 — 메모 → 공휴일 이름 → 「휴강」 */
export const offName = (c: Closures, date: string) => dayOf(c, date)?.memo || holidayOf(date) || "휴강";

/** 안내문 「이 달 안내」 자동 글 */
export function autoNote(opts: {
  brand: Brand;
  ym: string;
  classes: SchedClass[];
  closures: Closures;
  events: SchedEvent[];
  termStart: boolean;
  classNames: Map<number, string>;
}): string {
  const { brand, ym, classes, closures: c, events, termStart } = opts;
  const lines: string[] = [];
  const ids = new Set(classes.map((x) => x.id));
  const evLines = events
    .filter((e) => e.inNote)
    .map((e) => `${e.title} : ${e.start === e.end ? mdwLong(e.start) : `${mdwLong(e.start)} ~ ${monthOf(e.start) === monthOf(e.end) ? `${dayNo(e.end)}일(${DOW[dowOf(e.end)]})` : mdwLong(e.end)}`}`);
  if (brand === "S") {
    const cls = classes[0];
    if (cls) {
      lines.push(`■ 정규 ${cls.target}회${cls.fee ? ` (${feeLabel(cls.fee)}/회)` : ""}${cls.freeDays.length ? " + 누적오답 모의고사 (무료)" : ""}`);
      if (cls.fee) lines.push(`   ㄴ 정규 수업료 : ${feeLabel(cls.fee * cls.target)}`);
    }
    for (const l of evLines) lines.push(`📌 ${l}`);
    return lines.join("\n");
  }
  const offs = c.days.filter((d) => d.off && monthOf(d.date) === ym).sort((a, b) => a.date.localeCompare(b.date));
  lines.push(`■ 휴강일 : ${offs.length ? offs.map((d) => `${mdwLong(d.date)}_${offName(c, d.date)}`).join(" / ") : "없음"}`);
  // 반만 휴강 (이 안내문 반)
  const partial = c.classOff.filter((x) => ids.has(x.classId) && monthOf(x.date) === ym && !isAllOff(c, x.date));
  for (const d of [...new Set(partial.map((x) => x.date))].sort()) {
    const who = partial.filter((x) => x.date === d);
    const all = who.length === ids.size;
    const memo = who.find((x) => x.memo)?.memo;
    lines.push(`   ㄴ ${mdwLong(d)} ${all ? "" : `${who.map((x) => opts.classNames.get(x.classId)).join(" · ")} `}수업 없음${memo ? ` (${memo})` : ""}`);
  }
  // 보충 · 옮김 (이 달 날짜)
  for (const m of c.moves.filter((x) => ids.has(x.classId) && (monthOf(x.toDate) === ym || (x.fromDate && monthOf(x.fromDate) === ym)))) {
    const who = classes.length > 1 ? `${opts.classNames.get(m.classId)} ` : "";
    if (m.kind === "EXTRA") lines.push(`   ㄴ ${who}${monNo(m.countMonth)}월 보충 수업 : ${mdw(m.toDate)}`);
    else if (m.fromDate) lines.push(`   ㄴ ${who}${mdw(m.fromDate)} 수업은 ${mdw(m.toDate)}로 대체됩니다.`);
  }
  if (offs.length) lines.push("   ㄴ 휴강일에는 행정업무가 진행되지 않습니다.");
  if (termStart) {
    const name = termName(ym);
    for (const cls of classes) {
      lines.push(`■ ${name}학기 시간표 안내 : ${classes.length > 1 ? `${cls.name} ` : ""}${cls.time}`);
      if (cls.book) lines.push(`■ ${name}학기 학습과정 : ${cls.book}`);
    }
    if (classes.some((x) => x.book)) lines.push("   ㄴ 원활한 수업 진행을 위해 교재를 미리 구입해주세요!");
  }
  for (const l of evLines) lines.push(`■ ${l}`);
  return lines.join("\n");
}

export const DEFAULT_FIXED: Record<Brand, string> = {
  U: "■ 결석 보강은 선생님 시간표에 맞추어 진행됩니다\n■ 3회 이상의 결석을 해야 할 경우, 학원에 미리 홀딩 신청 부탁드립니다.\n   ㄴ 공통과정의 경우, 진도상의 문제로 홀딩이 어려울 수 있습니다\n■ 홀딩 신청 시 결석 보강은 진행되지 않으며, 수강료를 차감해드립니다.",
  S: "■ 누적오답 모의고사 수업은 무료로 진행됩니다.\n   ㄴ 단, 정규수업 모두 출석시 무료로 진행됩니다.\n   ㄴ 정규수업 결석 시, 이 수업은 정규로 전환되어 빠진 수업 공부가 이루어집니다.\n   ㄴ 그 동안 틀렸던 오답들에 대한 누적 복습 시간으로 학생의 성취도에 따라 하원시간은 달라집니다.",
};

/** 행사 막대 — 한 주(일~토) 안에서 이어진 막대, 겹치면 아래 줄 */
export type BarPiece = { ev: SchedEvent; c0: number; c1: number; lane: number; isEnd: boolean };
export function weekBars(events: SchedEvent[], weekStart: string): BarPiece[] {
  const end = iso(new Date(toDate(weekStart).getTime() + 6 * 86400000));
  const lanes: [number, number][][] = [];
  const out: BarPiece[] = [];
  for (const ev of [...events].sort((a, b) => a.orderNo - b.orderNo || a.start.localeCompare(b.start) || a.id - b.id)) {
    const s = ev.start > weekStart ? ev.start : weekStart;
    const e = ev.end < end ? ev.end : end;
    if (s > e) continue;
    const c0 = dowOf(s);
    const c1 = dowOf(e);
    let lane = 0;
    while ((lanes[lane] ?? []).some(([x, y]) => !(c1 < x || c0 > y))) lane += 1;
    (lanes[lane] ??= []).push([c0, c1]);
    out.push({ ev, c0, c1, lane, isEnd: e === ev.end });
  }
  return out;
}

/** 달력 주 — 일요일 시작, 그 달 날짜가 아니면 null */
export function monthWeeks(ym: string): { start: string; days: (string | null)[] }[] {
  const first = toDate(`${ym}-01`);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const out: { start: string; days: (string | null)[] }[] = [];
  const last = `${ym}-${pad(daysIn(ym))}`;
  for (const d = new Date(start); iso(d) <= last; ) {
    const ws = iso(d);
    const days: (string | null)[] = [];
    for (let i = 0; i < 7; i += 1) {
      const k = iso(d);
      days.push(monthOf(k) === ym ? k : null);
      d.setDate(d.getDate() + 1);
    }
    out.push({ start: ws, days });
  }
  return out;
}

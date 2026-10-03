"use client";

// 📅 월간 스케줄 3단계 — 안내문(카톡용 그림). 「📋 그림 복사」 → 카톡 PC 대화창 Ctrl+V.
// 유투엠 = 요일 묶음마다 한 장(분기 시작 달 = 반마다 + 시간표 · 학습과정) / 스킬 = 반마다.
// 안내문에서: 행사 막대 위아래 끌기 · 이모지 끌기(누르면 － ＋ 🗑) · 😀 이모지 추가 · ✏️ 글씨 직접 고치기(고친 그림은 따로 저장).

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { SCHED_BRAND, SCHED_CELL, SCHED_INK, SCHED_TEXT_COLORS } from "@/lib/colors";
import {
  autoNote,
  countOf,
  dayOf,
  dowOf,
  examLines,
  holidayOf,
  isClassOff,
  isTermStart,
  lessonOf,
  mdw,
  monNo,
  monthOf,
  monthWeeks,
  movedIn,
  offName,
  posterList,
  shiftMonth,
  weekBars,
  type Brand,
  type SchedClass,
} from "@/lib/schedule";
import type { ScheduleData } from "@/lib/repo/schedule";
import type { Act } from "./ScheduleClient";

const DOW = "일월화수목금토";
const STICKERS = ["🚩", "🏆", "📝", "⏰", "💬", "👑", "📖", "✏️", "🐰", "🎉", "📢", "⭐", "🎯", "📚", "🍂", "🎃", "🎄", "🌸", "☀️", "❤️", "✅", "📌", "🔥", "💯"];
const esc = (s: string) => s.replace(/[&<>]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[x]!);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Picked = { kind: "ev"; id: number } | { kind: "st"; id: number } | null;

export default function PosterStep({
  data,
  brand,
  act,
  setError,
  setToast,
}: {
  data: ScheduleData;
  brand: Brand;
  act: Act;
  setError: (m: string | null) => void;
  setToast: (m: string) => void;
}) {
  const [termStart, setTermStart] = useState(() => isTermStart(data.month));
  const [pick, setPick] = useState(0);
  const [editing, setEditing] = useState(false);
  /** 고치는 중인 그림 (✏️ 시작할 때 찍어 둔 html — 고치는 동안 React 가 건드리지 않게) */
  const [editHtml, setEditHtml] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked>(null);
  const [emoPick, setEmoPick] = useState(false);
  const [emoIn, setEmoIn] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => setTermStart(isTermStart(data.month)), [data.month]);
  const list = useMemo(() => posterList(brand, data.classes, brand === "U" && termStart), [brand, data.classes, termStart]);
  const item = list[Math.min(pick, list.length - 1)];
  const classes = item ? data.classes.filter((c) => item.classIds.includes(c.id)) : [];
  const saved = item ? data.posters.find((p) => p.brand === brand && p.pkey === item.key) : undefined;
  const names = useMemo(() => new Map(data.allClasses.map((x) => [x.id, x.name])), [data]);
  const events = data.events.filter((e) => e.brand === brand && (!e.classId || item?.classIds.includes(e.classId)));
  const auto = item ? autoNote({ brand, ym: data.month, classes, closures: data.closures, events, termStart: brand === "U" && termStart, classNames: names }) : "";
  const [note, setNote] = useState(saved?.note ?? auto);
  const [fixed, setFixed] = useState(data.fixed[brand]);
  const noteKey = `${brand}|${item?.key}|${data.month}|${saved?.note ?? ""}|${auto}`;
  useEffect(() => setNote(saved?.note ?? auto), [noteKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setFixed(data.fixed[brand]), [data.fixed, brand]);
  useEffect(() => {
    setEditing(false);
    setEditHtml(null);
    setPicked(null);
  }, [brand, item?.key, data.month]);

  if (!item) return <div className="card p-10 text-center text-sm text-muted">안내문을 만들 반이 없어요.</div>;
  const override = editHtml ?? saved?.html ?? null;
  const stickers = data.stickers.filter((s) => s.brand === brand);

  /* ---------- 저장 도우미 ---------- */
  const posterEl = () => wrapRef.current?.querySelector<HTMLElement>("[data-poster]") ?? null;
  const cleanHtml = () => {
    const w = wrapRef.current;
    if (!w) return "";
    const c = w.cloneNode(true) as HTMLElement;
    c.querySelectorAll("[data-picked]").forEach((x) => x.removeAttribute("data-picked"));
    c.querySelectorAll<HTMLElement>("[contenteditable]").forEach((x) => x.removeAttribute("contenteditable"));
    c.querySelectorAll<HTMLElement>("[data-poster]").forEach((x) => (x.style.outline = ""));
    return c.innerHTML;
  };
  const saveOverride = () => act({ action: "POSTER", brand, month: data.month, pkey: item.key, html: cleanHtml() });

  /* ---------- 끌기 (막대 위아래 · 이모지 어디로든) ---------- */
  const onPointerDown = (ev: RPointerEvent<HTMLDivElement>) => {
    if (editing) return;
    const t = ev.target as HTMLElement;
    const emo = t.closest<HTMLElement>("[data-emo]");
    const bar = !emo ? t.closest<HTMLElement>("[data-bar]") : null;
    if (!emo && !bar) {
      setPicked(null);
      return;
    }
    ev.preventDefault();
    const x0 = ev.clientX;
    const y0 = ev.clientY;
    const ovr = !!override;
    if (bar) {
      const id = Number(bar.dataset.bar);
      const same = [...(wrapRef.current?.querySelectorAll<HTMLElement>(`[data-bar="${id}"]`) ?? [])];
      const base = same.map((b) => parseFloat(b.style.top));
      let d = 0;
      const move = (m: PointerEvent) => {
        d = Math.round(m.clientY - y0);
        same.forEach((b, i) => (b.style.top = `${base[i] + d}px`));
      };
      const up = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        if (!d) return;
        const e = data.events.find((x) => x.id === id);
        if (ovr) void saveOverride();
        else if (e) void act({ action: "EVENT_SAVE", event: { ...e, dy: e.dy + d } });
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      return;
    }
    const kind = emo!.dataset.emo as "ev" | "st";
    const id = Number(emo!.dataset.id);
    setPicked({ kind, id });
    const sx = parseFloat(emo!.dataset.x ?? "0");
    const sy = parseFloat(emo!.dataset.y ?? "0");
    let dx = 0;
    let dy = 0;
    const move = (m: PointerEvent) => {
      dx = Math.round(m.clientX - x0);
      dy = Math.round(m.clientY - y0);
      if (kind === "ev") emo!.style.transform = `translate(${sx + dx}px, ${sy + dy}px)`;
      else {
        emo!.style.left = `${sx + dx}px`;
        emo!.style.top = `${sy + dy}px`;
      }
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      if (!dx && !dy) return;
      emo!.dataset.x = String(sx + dx);
      emo!.dataset.y = String(sy + dy);
      if (ovr) return void saveOverride();
      if (kind === "ev") {
        const e = data.events.find((x) => x.id === id);
        if (e) void act({ action: "EVENT_SAVE", event: { ...e, ex: sx + dx, ey: sy + dy } });
      } else {
        const s = data.stickers.find((x) => x.id === id);
        if (s) void act({ action: "STICKER_SAVE", id, x: sx + dx, y: sy + dy, size: s.size });
      }
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };

  /** 고른 이모지 크기 · 지우기 */
  const emoTool = async (op: number | "del") => {
    if (!picked) return;
    const el = wrapRef.current?.querySelector<HTMLElement>(`[data-emo="${picked.kind}"][data-id="${picked.id}"]`);
    if (override) {
      if (!el) return;
      if (op === "del") el.remove();
      else el.style.fontSize = `${Math.max(12, Math.min(90, parseFloat(el.style.fontSize) + op))}px`;
      if (op === "del") setPicked(null);
      await saveOverride();
      return;
    }
    if (picked.kind === "ev") {
      const e = data.events.find((x) => x.id === picked.id);
      if (!e) return;
      await act({ action: "EVENT_SAVE", event: op === "del" ? { ...e, emoji: null } : { ...e, es: Math.max(12, Math.min(90, e.es + op)) } });
    } else {
      const s = data.stickers.find((x) => x.id === picked.id);
      if (!s) return;
      await act(op === "del" ? { action: "STICKER_DEL", id: s.id } : { action: "STICKER_SAVE", id: s.id, x: s.x, y: s.y, size: Math.max(12, Math.min(90, s.size + op)) });
    }
    if (op === "del") setPicked(null);
  };

  const addSticker = async (emoji: string) => {
    if (!emoji.trim()) return;
    const id = await act({ action: "STICKER_ADD", brand, month: data.month, emoji, x: 470, y: 120, size: 36 });
    if (typeof id !== "number") return;
    if (override) {
      // 직접 고친 그림에도 바로 얹기
      const p = posterEl();
      if (p) {
        const d = document.createElement("div");
        d.dataset.emo = "st";
        d.dataset.id = String(id);
        d.dataset.x = "470";
        d.dataset.y = "120";
        d.style.cssText = "position:absolute;left:470px;top:120px;font-size:36px;line-height:1;z-index:3;cursor:move;user-select:none";
        d.textContent = emoji;
        p.appendChild(d);
        await saveOverride();
      }
    }
    setPicked({ kind: "st", id });
  };

  /* ---------- ✏️ 글씨 직접 고치기 ---------- */
  const startEdit = () => {
    setPicked(null);
    setEditHtml(wrapRef.current?.innerHTML ?? "");
    setEditing(true);
  };
  const doneEdit = async () => {
    const html = cleanHtml();
    setEditing(false);
    const r = await act({ action: "POSTER", brand, month: data.month, pkey: item.key, html }, "직접 고친 안내문 저장");
    if (r !== false) setEditHtml(null);
  };
  useEffect(() => {
    const p = posterEl();
    if (!p) return;
    p.contentEditable = editing ? "true" : "false";
    p.style.outline = editing ? `3px dashed ${SCHED_INK.term}` : "";
    if (editing) p.focus();
  });
  const fmt = (fn: () => void) => () => {
    fn();
  };
  const fontSize = (d: number) => {
    const sel = getSelection();
    if (!sel?.rangeCount || sel.isCollapsed) return;
    const r = sel.getRangeAt(0);
    const node = r.startContainer.nodeType === 3 ? r.startContainer.parentElement! : (r.startContainer as HTMLElement);
    const cur = parseFloat(getComputedStyle(node).fontSize);
    const span = document.createElement("span");
    span.style.fontSize = `${Math.max(7, cur + d * 1.5)}px`;
    span.appendChild(r.extractContents());
    r.insertNode(span);
    sel.removeAllRanges();
    const nr = document.createRange();
    nr.selectNodeContents(span);
    sel.addRange(nr);
  };

  /* ---------- 그림 만들기 ---------- */
  const shot = async (): Promise<HTMLCanvasElement> => {
    setPicked(null);
    await sleep(60);
    const p = posterEl();
    if (!p) throw new Error("안내문을 찾지 못했어요.");
    const h2c = (await import("html2canvas")).default;
    return h2c(p, { scale: 2, backgroundColor: SCHED_INK.white, useCORS: true, logging: false });
  };
  const fileName = (t: string) => `${monNo(data.month)}월_${brand === "U" ? "유투엠" : "스킬"}_${t.replace(/[\\/:*?"<>|]/g, "")}.png`;
  const download = (cv: HTMLCanvasElement, name: string) => {
    const a = document.createElement("a");
    a.href = cv.toDataURL("image/png");
    a.download = name;
    a.click();
  };
  const copyImg = async () => {
    if (editing) return setError("✅ 다 고침을 먼저 눌러 주세요.");
    setBusy("만드는 중…");
    try {
      const cv = await shot();
      const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, "image/png"));
      if (!blob) throw new Error("그림을 만들지 못했어요.");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setToast("✅ 복사됨 — 카톡 대화창에서 Ctrl + V");
    } catch (e) {
      setError(`복사 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"} — 「💾 그림 파일로 저장」을 써 주세요.`);
    } finally {
      setBusy(null);
    }
  };
  const saveImg = async () => {
    if (editing) return setError("✅ 다 고침을 먼저 눌러 주세요.");
    setBusy("만드는 중…");
    try {
      download(await shot(), fileName(item.title));
    } catch (e) {
      setError(`저장 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
    } finally {
      setBusy(null);
    }
  };
  const saveAll = async () => {
    if (editing) return setError("✅ 다 고침을 먼저 눌러 주세요.");
    const start = pick;
    try {
      for (let i = 0; i < list.length; i += 1) {
        setBusy(`${i + 1} / ${list.length}장 만드는 중…`);
        setPick(i);
        await sleep(450);
        download(await shot(), fileName(list[i].title));
      }
      setToast(`📦 ${list.length}장 저장함 (다운로드 폴더)`);
    } catch (e) {
      setError(`저장 실패: ${e instanceof Error ? e.message : "알 수 없는 오류"}`);
    } finally {
      setPick(start);
      setBusy(null);
    }
  };

  const U = brand === "U";
  return (
    <div className="flex items-start gap-4">
      <div className="w-[290px] shrink-0 space-y-2">
        {U ? (
          <label className="card flex items-start gap-2 p-3 text-[13px]">
            <input type="checkbox" className="mt-1" checked={termStart} onChange={(e) => (setTermStart(e.target.checked), setPick(0))} />
            <span>
              <b>분기 시작 달</b> (3 · 6 · 9 · 12월)
              <br />
              <span className="text-xs text-muted">반마다 한 장 + 시간표 · 학습과정(교재 구입) 안내가 반 정보에서 자동으로</span>
            </span>
          </label>
        ) : null}
        <div className="label">
          안내문 고르기 <span className="text-xs font-normal text-muted">{list.length}장</span>
        </div>
        <div className="flex max-h-56 flex-col gap-1 overflow-auto">
          {list.map((p, i) => {
            const has = data.posters.some((x) => x.brand === brand && x.pkey === p.key && x.html);
            return (
              <button key={p.key} type="button" className={`btn justify-start text-left ${i === pick ? "btn-primary" : ""}`} onClick={() => setPick(i)}>
                {p.title}
                {U && !termStart ? <span className="text-xs opacity-70">{p.classIds.map((id) => names.get(id)).join(" · ")}</span> : null}
                {has ? <span title="직접 고친 안내문">✏️</span> : null}
              </button>
            );
          })}
        </div>
        <div className="label mt-2 flex items-center justify-between">
          이 달 안내
          {saved?.note != null ? (
            <button type="button" className="btn px-1.5 py-0 text-xs" onClick={() => void act({ action: "POSTER", brand, month: data.month, pkey: item.key, note: null }, "자동 글로 되돌림")}>
              ↺ 자동 글로
            </button>
          ) : (
            <span className="text-xs font-normal text-muted">1단계 내용으로 자동</span>
          )}
        </div>
        <textarea
          className="field w-full text-xs leading-5"
          rows={8}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            if (note !== (saved?.note ?? auto)) void act({ action: "POSTER", brand, month: data.month, pkey: item.key, note }, "안내 글 저장");
          }}
        />
        <div className="label">{U ? "보강 수업 관련 안내" : "이 달의 학원 스케줄 안내 — 아래 글"} <span className="text-xs font-normal text-muted">(매달 같은 글)</span></div>
        <textarea
          className="field w-full text-xs leading-5"
          rows={5}
          value={fixed}
          onChange={(e) => setFixed(e.target.value)}
          onBlur={() => {
            if (fixed !== data.fixed[brand]) void act({ action: "FIXED", brand, text: fixed }, "저장");
          }}
        />
        <div className="flex flex-col gap-1.5 pt-1">
          <button type="button" className="btn justify-center" onClick={() => setEmoPick(!emoPick)}>
            😀 이모지 추가
          </button>
          {emoPick ? (
            <div className="flex flex-wrap gap-1">
              {STICKERS.map((e) => (
                <button key={e} type="button" className="rounded border border-line bg-white px-1 text-xl" onClick={() => void addSticker(e)}>
                  {e}
                </button>
              ))}
              <input
                className="field w-44 text-sm"
                placeholder="직접 넣고 Enter (Win + . )"
                value={emoIn}
                onChange={(e) => setEmoIn(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void addSticker(emoIn);
                    setEmoIn("");
                  }
                }}
              />
            </div>
          ) : null}
          <p className="text-xs text-muted">
            안내문의 이모지는 <b>끌어서 옮기고</b>, 누르면 나오는 <b>－ ＋ 🗑</b>으로 크기 · 지우기. 행사 막대는 <b>위아래로 끌기</b>.
          </p>
          <button type="button" className={`btn justify-center ${editing ? "btn-primary" : ""}`} onClick={() => (editing ? void doneEdit() : startEdit())}>
            {editing ? "✅ 다 고침" : "✏️ 글씨 직접 고치기"}
          </button>
          {saved?.html && !editing ? (
            <>
              <button
                type="button"
                className="btn justify-center text-xs"
                onClick={() => void act({ action: "POSTER", brand, month: data.month, pkey: item.key, html: null }, "자동 내용으로 되돌림")}
              >
                ↺ 자동 내용으로 되돌리기
              </button>
              <p className="text-xs text-late">직접 고친 안내문이에요 — 1 · 2단계를 바꿔도 이 그림은 그대로예요.</p>
            </>
          ) : null}
          <button type="button" className="btn btn-primary justify-center" disabled={!!busy} onClick={() => void copyImg()}>
            📋 그림 복사 → 카톡에 붙여넣기
          </button>
          <button type="button" className="btn justify-center" disabled={!!busy} onClick={() => void saveImg()}>
            💾 그림 파일로 저장
          </button>
          <button type="button" className="btn justify-center" disabled={!!busy} onClick={() => void saveAll()}>
            📦 전부 한 번에 저장 ({list.length}장)
          </button>
          {busy ? <p className="text-xs font-bold text-navy-800">{busy}</p> : null}
        </div>
      </div>

      <div className="min-w-0">
        {editing ? (
          <div className="mb-1.5 flex w-[620px] flex-wrap items-center gap-1 rounded-xl border border-late bg-late-soft px-2 py-1.5 text-xs">
            <b>글씨 고르고 →</b>
            {[
              ["가−", () => fontSize(-1)],
              ["가＋", () => fontSize(1)],
              ["굵게", () => document.execCommand("bold")],
            ].map(([t, f]) => (
              <button key={t as string} type="button" className="btn px-2 py-0 text-xs" onMouseDown={(e) => e.preventDefault()} onClick={fmt(f as () => void)}>
                {t as string}
              </button>
            ))}
            {SCHED_TEXT_COLORS.map((col) => (
              <button
                key={col}
                type="button"
                className="h-5 w-5 rounded-full border-2 border-white ring-1 ring-line"
                style={{ background: col }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  document.execCommand("styleWithCSS", false, "true");
                  document.execCommand("foreColor", false, col);
                }}
              />
            ))}
            <span className="text-muted">글씨를 마우스로 긁어서 고른 뒤 누르세요</span>
          </div>
        ) : null}
        <div className="relative inline-block" onPointerDown={onPointerDown}>
          {override !== null ? (
            <div ref={wrapRef} dangerouslySetInnerHTML={{ __html: override }} />
          ) : (
            <div ref={wrapRef}>
              <Poster data={data} brand={brand} classes={classes} note={note} fixed={fixed} picked={picked} />
            </div>
          )}
          {picked && !editing ? <EmoTool wrap={wrapRef} picked={picked} onTool={(op) => void emoTool(op)} /> : null}
        </div>
        <Legend brand={brand} classes={classes} />
      </div>
    </div>
  );
}

/** 고른 이모지 아래 작은 도구 */
function EmoTool({ wrap, picked, onTool }: { wrap: React.RefObject<HTMLDivElement | null>; picked: NonNullable<Picked>; onTool: (op: number | "del") => void }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    const el = wrap.current?.querySelector<HTMLElement>(`[data-emo="${picked.kind}"][data-id="${picked.id}"]`);
    const w = wrap.current?.getBoundingClientRect();
    if (!el || !w) return setPos(null);
    el.dataset.picked = "1";
    const r = el.getBoundingClientRect();
    setPos({ left: r.left - w.left, top: r.bottom - w.top + 6 });
    return () => {
      delete el.dataset.picked;
    };
  });
  if (!pos) return null;
  return (
    <div className="absolute z-20 flex gap-1 rounded-lg border border-line bg-white p-1 shadow-lg" style={pos} onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" className="btn px-2 py-0" onClick={() => onTool(-4)}>
        －
      </button>
      <button type="button" className="btn px-2 py-0" onClick={() => onTool(4)}>
        ＋
      </button>
      <button type="button" className="btn px-2 py-0" onClick={() => onTool("del")}>
        🗑
      </button>
    </div>
  );
}

function Legend({ brand, classes }: { brand: Brand; classes: SchedClass[] }) {
  const sw = (bg: string): CSSProperties => ({ display: "inline-block", width: 12, height: 12, border: `1px solid ${SCHED_INK.infoGray}`, background: bg, verticalAlign: -2, marginRight: 3 });
  return (
    <div className="mt-1.5 flex gap-3 text-xs text-muted">
      <span>
        <i style={sw(SCHED_CELL.reg)} />
        {brand === "U" ? "공통 수업" : "정규 수업"}
      </span>
      {classes.some((c) => c.indDays.length) ? (
        <span>
          <i style={sw(SCHED_CELL.ind)} />
          개별 수업 (금 · 토)
        </span>
      ) : null}
      {classes.some((c) => c.freeDays.length) ? (
        <span>
          <i style={sw(SCHED_CELL.free)} />
          무료 수업
        </span>
      ) : null}
      <span>
        <i style={sw(SCHED_INK.white)} />
        수업 없음
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- 안내문 그림 */

function Poster({
  data,
  brand,
  classes,
  note,
  fixed,
  picked,
}: {
  data: ScheduleData;
  brand: Brand;
  classes: SchedClass[];
  note: string;
  fixed: string;
  picked: Picked;
}) {
  const U = brand === "U";
  const col = SCHED_BRAND[brand];
  const c = data.closures;
  const ym = data.month;
  const ids = new Set(classes.map((x) => x.id));
  const names = new Map(data.allClasses.map((x) => [x.id, x.name]));
  const rep = classes[0];
  const events = data.events.filter((e) => e.brand === brand && (!e.classId || ids.has(e.classId)));
  const stickers = data.stickers.filter((s) => s.brand === brand);
  const levels: ("H" | "M")[] = U ? ["M"] : ["H"];

  // 배지 — 「월 12회 수업」 / 「H1S / 정규 8회 수업」, 다음 달에 하는 이 달 보충이 있으면 「9월 11회 + 10월 1회」
  const k = rep ? countOf(c, rep, ym, data.carries) : null;
  const main = U ? `월 ${k?.target ?? 0}회 수업` : `${rep?.name.split(" ")[0] ?? ""} / 정규 ${k?.target ?? 0}회 수업`;
  const later = rep ? c.moves.filter((m) => m.classId === rep.id && m.countMonth === ym && monthOf(m.toDate) > ym).length : 0;
  const badge = later && k ? `${monNo(ym)}월 ${k.target - later}회 + ${monNo(shiftMonth(ym, 1))}월 ${later}회` : main;
  const clsOff = c.classOff.filter((x) => ids.has(x.classId) && monthOf(x.date) === ym && !dayOf(c, x.date)?.off);
  const offDays = [...new Set(clsOff.map((x) => x.date))].sort();
  const badgeSub = offDays.length
    ? `${monNo(ym)}월 ${offDays
        .map((d) => {
          const who = clsOff.filter((x) => x.date === d);
          return `${who.length < ids.size ? `${who.map((x) => names.get(x.classId)).join("·")} ` : ""}${Number(d.slice(8))}일`;
        })
        .join(" · ")} 휴강`
    : "";

  const cellLesson = (d: string): "reg" | "ind" | "free" | null => {
    const ls = classes.map((x) => lessonOf(c, x, d));
    return ls.includes("reg") ? "reg" : ls.includes("ind") ? "ind" : ls.includes("free") ? "free" : null;
  };
  const allOff = (d: string) => classes.length > 0 && classes.every((x) => isClassOff(c, d, x.id));
  const barTop = U ? 32 : 22;

  const noteHtml = esc(note)
    .split("\n")
    .map((l) =>
      l.startsWith("■ 휴강")
        ? `<span style="color:${SCHED_INK.red};font-weight:800;font-size:13.5px">${l}</span>`
        : l.startsWith("■ 정규")
          ? `<span style="color:${col};font-weight:900;font-size:14px">${l}</span>`
          : /^■ .{1,2}학기/.test(l)
            ? `<span style="color:${SCHED_INK.term};font-weight:800;font-size:13.5px">${l}</span>`
            : l.startsWith("📌")
              ? `<span style="color:${col};font-weight:800;font-size:13.5px">${l}</span>`
              : l,
    )
    .join("\n");
  const fx = esc(fixed).split("\n");

  const info: CSSProperties = { margin: "12px 22px", border: "2px solid", borderRadius: 10, padding: "10px 14px", fontSize: 12, lineHeight: 1.75, position: "relative", background: "rgba(255,255,255,.6)", whiteSpace: "pre-wrap" };
  const tt: CSSProperties = { position: "absolute", top: -11, left: 24, background: SCHED_INK.white, padding: "0 8px", fontWeight: 800, fontSize: 13.5, color: col };

  return (
    <div data-poster="1" style={{ width: 620, background: SCHED_INK.white, border: `1px solid ${SCHED_INK.line}`, position: "relative", overflow: "hidden", color: "#111827", fontFamily: "inherit" }}>
      <div style={{ height: 14, background: col }} />
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "18px 30px 6px" }}>
        <div style={{ fontSize: 50, fontWeight: 900, lineHeight: 1, paddingLeft: 10, color: col, borderLeft: `7px solid ${col}` }}>{monNo(ym)}월</div>
        <div>
          <b style={{ display: "block", fontSize: 17, color: col }}>{U ? "유투엠 수학학원" : "고등수학 스터디킬러"}</b>
          <span style={{ fontSize: 16 }}>월간 수업 계획표</span>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={U ? "/logos/sched-u2m.png" : "/logos/sched-sk.png"} alt="" style={{ marginLeft: "auto", height: 64 }} />
      </div>
      <div style={{ margin: "6px 22px", background: SCHED_INK.box, padding: "10px 12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <b style={{ fontSize: 17, color: col }}>
            {ym}월 수업 스케줄{classes.length === 1 && U ? ` · ${rep?.name}` : ""}
          </b>
          <div style={{ color: SCHED_INK.white, background: col, borderRadius: 8, padding: "6px 14px", fontWeight: 900, fontSize: 15, textAlign: "center", lineHeight: 1.2 }}>
            {badge}
            {badgeSub ? <small style={{ display: "block", fontSize: 11, color: SCHED_INK.badgeSub, fontWeight: 800 }}>{badgeSub}</small> : null}
          </div>
        </div>
        <div style={{ border: `1px solid ${SCHED_INK.line}` }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", background: SCHED_INK.white, borderBottom: `2px solid ${SCHED_INK.infoU}`, fontSize: 11 }}>
            {[...DOW].map((x, i) => (
              <div key={x} style={{ textAlign: "center", fontWeight: 700, padding: 6, color: i === 0 ? SCHED_INK.red : i === 6 ? SCHED_INK.blue : SCHED_INK.gray }}>
                {x}
              </div>
            ))}
          </div>
          {monthWeeks(ym).map((wk) => (
            <div key={wk.start} style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(7,1fr)" }}>
              {wk.days.map((d, i) => {
                const cellStyle: CSSProperties = { height: 66, borderRight: `1px solid ${SCHED_INK.line}`, borderBottom: `1px solid ${SCHED_INK.line}`, padding: "2px 4px", fontSize: 9.5, position: "relative" };
                if (!d) return <div key={i} style={{ ...cellStyle, background: SCHED_INK.white }} />;
                const l = cellLesson(d);
                const off = allOff(d);
                const holi = holidayOf(d);
                const day = dayOf(c, d);
                const bg = l === "reg" ? SCHED_CELL.reg : l === "ind" ? SCHED_CELL.ind : l === "free" ? SCHED_CELL.free : SCHED_INK.white;
                const w = dowOf(d);
                const moves = c.moves.filter((m) => ids.has(m.classId) && (m.toDate === d || m.fromDate === d));
                const exams = examLines(data.exams, d, levels);
                const inMove = classes.some((x) => movedIn(c, d, x.id).length);
                const free = !U && l === "free" ? rep?.freeDays.find((f) => f.day === w) : undefined;
                const center: CSSProperties = { color: SCHED_INK.red, fontWeight: 800, textAlign: "center", marginTop: 6, fontSize: 11 };
                return (
                  <div key={d} style={{ ...cellStyle, background: bg }}>
                    <div style={{ fontSize: 11, color: w === 0 || (holi && !day?.open) ? SCHED_INK.red : w === 6 ? SCHED_INK.blue : SCHED_INK.gray }}>{Number(d.slice(8))}</div>
                    {off ? <div style={center}>{offName(c, d)}</div> : holi && !day?.open ? <div style={center}>{holi}</div> : null}
                    {day?.open && U ? <div style={{ ...center, marginTop: 4, fontSize: 9, whiteSpace: "nowrap", letterSpacing: -0.3 }}>★정상수업 진행★</div> : null}
                    {moves.map((m) => {
                      const who = classes.length > 1 ? `${names.get(m.classId)} ` : "";
                      const text =
                        m.kind === "EXTRA"
                          ? `${who}${m.countMonth === ym ? "" : `${monNo(m.countMonth)}월 `}보충 수업`
                          : m.fromDate === d
                            ? `${who}${mdw(m.fromDate)} 수업은 ${mdw(m.toDate)} 대체됩니다.`
                            : "";
                      return text ? (
                        <div key={m.id} style={{ color: SCHED_INK.move, fontSize: 8.5, textAlign: "center", marginTop: 3, lineHeight: 1.2 }}>
                          {text}
                        </div>
                      ) : null;
                    })}
                    {exams.length ? (
                      <div style={{ color: SCHED_INK.red, fontSize: 8.5, lineHeight: 1.15, position: "absolute", bottom: 2, left: 4, right: 2 }}>
                        {exams.map((t) => (
                          <div key={t}>{t}</div>
                        ))}
                      </div>
                    ) : null}
                    {!U && l === "reg" && !inMove ? <Lab bg={SCHED_CELL.regLab}>{rep?.label}</Lab> : null}
                    {free ? <Lab bg={SCHED_CELL.freeLab}>{free.label}</Lab> : null}
                  </div>
                );
              })}
              {weekBars(events, wk.start).map((b) => {
                const top = barTop + b.lane * 17 + b.ev.dy;
                return (
                  <div key={`${b.ev.id}-${wk.start}`} style={{ display: "contents" }}>
                    <div
                      data-bar={b.ev.id}
                      title="위아래로 끌어서 옮기기"
                      style={{
                        position: "absolute",
                        left: `calc(${(b.c0 / 7) * 100}% + 2px)`,
                        width: `calc(${((b.c1 - b.c0 + 1) / 7) * 100}% - 4px)`,
                        top,
                        height: 15,
                        background: b.ev.color,
                        borderRadius: 3,
                        fontWeight: 800,
                        fontSize: 9.5,
                        textAlign: "center",
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "ns-resize",
                      }}
                    >
                      {b.ev.title}
                    </div>
                    {U && b.ev.emoji && b.isEnd ? (
                      <div
                        data-emo="ev"
                        data-id={b.ev.id}
                        data-x={b.ev.ex}
                        data-y={b.ev.ey}
                        style={{
                          position: "absolute",
                          left: `calc(${((b.c1 + 1) / 7) * 100}% - 26px)`,
                          top: top - 18,
                          transform: `translate(${b.ev.ex}px, ${b.ev.ey}px)`,
                          fontSize: b.ev.es,
                          lineHeight: 1,
                          zIndex: 1,
                          cursor: "move",
                          userSelect: "none",
                          outline: picked?.kind === "ev" && picked.id === b.ev.id ? `2px dashed ${SCHED_INK.term}` : undefined,
                        }}
                      >
                        {b.ev.emoji}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {U ? (
        <>
          <div style={{ ...info, borderColor: SCHED_INK.infoU }} dangerouslySetInnerHTML={{ __html: noteHtml }} />
          <div style={{ ...info, borderColor: SCHED_INK.infoGray, marginTop: 20 }}>
            <span style={tt}>보강 수업 관련 안내</span>
            {fx.join("\n")}
          </div>
        </>
      ) : (
        <>
          <div style={{ ...info, borderColor: col, marginTop: 20 }}>
            <span style={tt}>이 달의 학원 스케줄 안내</span>
            <span dangerouslySetInnerHTML={{ __html: noteHtml }} />
            {"\n\n"}
            <b>{fx[0] ?? ""}</b>
            {`\n${fx.slice(1).join("\n")}`}
          </div>
          <div style={{ textAlign: "right", fontSize: 10.5, color: SCHED_INK.ask, margin: "0 22px" }}>문의 사항은 학원으로 연락 주시길 바랍니다^^</div>
        </>
      )}
      <div style={{ height: 30, marginTop: 12, color: SCHED_INK.white, background: col, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontWeight: 900, fontSize: 14 }}>
        {U ? (
          "(주)올림피아드교육 | 유투엠"
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logos/sched-sk.png" alt="" style={{ height: 20, filter: "brightness(0) invert(1)" }} />
            STUDYKILLER
          </>
        )}
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={U ? "/logos/sched-wm-u2m.png" : "/logos/sched-wm-sk.png"}
        alt=""
        style={{
          position: "absolute",
          pointerEvents: "none",
          zIndex: 2,
          width: 250,
          ...(U ? { right: -40, bottom: -45, opacity: 0.11, transform: "rotate(10deg)" } : { right: -30, bottom: -70, opacity: 0.045, transform: "rotate(20deg)" }),
        }}
      />
      {stickers.map((s) => (
        <div
          key={s.id}
          data-emo="st"
          data-id={s.id}
          data-x={s.x}
          data-y={s.y}
          style={{
            position: "absolute",
            left: s.x,
            top: s.y,
            fontSize: s.size,
            lineHeight: 1,
            zIndex: 3,
            cursor: "move",
            userSelect: "none",
            outline: picked?.kind === "st" && picked.id === s.id ? `2px dashed ${SCHED_INK.term}` : undefined,
          }}
        >
          {s.emoji}
        </div>
      ))}
    </div>
  );
}

function Lab({ bg, children }: { bg: string; children: React.ReactNode }) {
  return <span style={{ position: "absolute", left: 2, right: 2, bottom: 10, textAlign: "center", borderRadius: 2, fontWeight: 700, fontSize: 10, padding: "2px 0", background: bg }}>{children}</span>;
}

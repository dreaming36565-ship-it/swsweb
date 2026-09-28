"use client";

// 시간표 도구 — ⇄ 알파·수업 순서 바꾸기 · ＋ 교실배정(빈 교실 찾기) · 📤 명단 엑셀 올리기

import { useState } from "react";
import Modal from "../Modal";
import TimeSelect from "../TimeSelect";
import { apiPost, errorMessage } from "@/lib/http";
import { DAY_LABELS, fmtTime, monthDay, overlaps, rangeLabel } from "@/lib/time";
import { teacherLabel } from "@/lib/types";
import { WEEK, isSwapped, levelOf, orderText, partsOn, swapPair } from "./model";
import type { Ctx } from "./TimetableClient";

/* ------------------------------------------------------------ ⇄ 알파·수업 순서 바꾸기 */

export function SwapModal({ ctx, initialDay, onClose }: { ctx: Ctx; initialDay: number; onClose: () => void }) {
  const [day, setDay] = useState(initialDay);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [keep, setKeep] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { classes, tempSwaps, week } = ctx.data;
  const date = week.find((w) => w.day === day)?.date ?? "";
  const list = classes.filter((c) => swapPair(c, day));
  const high = list.filter((c) => levelOf(c) === "고등");
  const shown = (id: number) => isSwapped(tempSwaps, id, day);
  const after = (id: number) => {
    const c = classes.find((x) => x.id === id)!;
    return partsOn(c, day, shown(id) !== sel.has(id));
  };
  // 바꾼 뒤 같은 선생님 · 교실이 겹치는지
  const clashes: string[] = [];
  const everyone = classes.map((c) => ({ c, ps: after(c.id).filter((p) => p.kind === "CLASS") }));
  for (let i = 0; i < everyone.length; i++) {
    for (let j = i + 1; j < everyone.length; j++) {
      for (const p of everyone[i].ps)
        for (const q of everyone[j].ps) {
          if (!overlaps(p.start, p.end, q.start, q.end)) continue;
          if (!sel.has(everyone[i].c.id) && !sel.has(everyone[j].c.id)) continue;
          if (p.teacherId && p.teacherId === q.teacherId)
            clashes.push(`${teacherLabel(p.teacherName)}: ${everyone[i].c.name} · ${everyone[j].c.name} 수업이 ${rangeLabel(Math.max(p.start, q.start), Math.min(p.end, q.end))}에 겹쳐요`);
          else if (p.roomId && p.roomId === q.roomId) clashes.push(`${p.roomName}: ${everyone[i].c.name} · ${everyone[j].c.name} 수업이 겹쳐요`);
        }
    }
  }
  const temp = tempSwaps.filter((s) => s.day === day);

  const run = async (body: Record<string, unknown>, close = true) => {
    setError(null);
    setBusy(true);
    try {
      await apiPost("/api/timetable/swap", body);
      await ctx.reload();
      setSel(new Set());
      if (close) onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      width={980}
      title="⇄ 알파·수업 순서 바꾸기"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            닫기
          </button>
          <button type="button" className="btn btn-primary" disabled={!sel.size || busy} onClick={() => void run({ day, classIds: [...sel], keep })}>
            {sel.size}개 반 바꾸기 ({keep ? "계속 적용" : "이번 주만"})
          </button>
        </>
      }
    >
      <p className="text-sm text-muted">
        진도에 따라 <b>알파+수업</b> 반을 <b>수업+알파</b>로 (또는 반대로) 바꿔요. 고른 반은 그 요일의 알파 시간과 수업 시간을 서로 맞바꿔요. 바꾸면 SR 자리·출결 시작 시각도 저절로 따라가요.
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {WEEK.map((x) => (
            <button
              key={x}
              type="button"
              className={`btn px-3 ${x === day ? "btn-primary" : ""}`}
              onClick={() => {
                setDay(x);
                setSel(new Set());
              }}
            >
              {DAY_LABELS[x]}
            </button>
          ))}
        </div>
        {high.length ? (
          <button type="button" className="btn px-2.5 py-1 text-xs" onClick={() => setSel(new Set([...sel, ...high.map((c) => c.id)]))}>
            고등부 전체 선택
          </button>
        ) : null}
      </div>
      {list.length ? (
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="bg-navy-50 text-left text-xs text-muted">
              <th className="w-8 px-2 py-2" />
              <th className="px-2 py-2">반</th>
              <th className="px-2 py-2">지금</th>
              <th className="px-2 py-2">바꾼 뒤</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => {
              const on = sel.has(c.id);
              return (
                <tr key={c.id} className="border-t border-line">
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        const n = new Set(sel);
                        if (on) n.delete(c.id);
                        else n.add(c.id);
                        setSel(n);
                      }}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <b>{c.name}</b> <span className="text-xs text-muted">{levelOf(c)}</span>
                    {shown(c.id) ? <span className="ml-1 rounded bg-srpink px-1 text-[10px] font-bold text-white">⇄ 이번 주만</span> : null}
                  </td>
                  <td className="px-2 py-2">{orderText(partsOn(c, day, shown(c.id)))}</td>
                  <td className={`px-2 py-2 ${on ? "font-bold text-present" : "text-muted"}`}>{on ? orderText(after(c.id)) : "그대로"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="mt-3 text-sm text-muted">이 요일에는 알파와 수업이 함께 있는 반이 없어요.</p>
      )}
      {clashes.length ? (
        <div className="mt-2.5 text-sm font-bold text-alert">
          {[...new Set(clashes)].map((m) => (
            <div key={m}>⚠ {m}</div>
          ))}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={!keep} onChange={() => setKeep(false)} />
          <b>
            이번 주 {date ? monthDay(date) : ""}({DAY_LABELS[day]}) 하루만
          </b>
          <span className="text-muted">— 다음 주엔 저절로 원래대로</span>
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={keep} onChange={() => setKeep(true)} />
          <b>계속 적용</b>
          <span className="text-muted">— 다시 바꿀 때까지 매주</span>
        </label>
      </div>
      {temp.length ? (
        <div className="mt-3.5 rounded-xl bg-srpink-soft px-3 py-2.5">
          <b className="text-srpink">⇄ 이번 주만 바꾼 반</b>
          {temp.map((t) => {
            const c = classes.find((x) => x.id === t.classId);
            if (!c) return null;
            return (
              <div key={t.classId} className="mt-1.5 flex items-center justify-between rounded-lg border border-line bg-white px-3 py-2 text-sm">
                <span>
                  <b>{c.name}</b> {orderText(partsOn(c, day, true))}
                </span>
                <span className="flex gap-1">
                  <button type="button" className="btn px-2 py-0.5 text-xs" disabled={busy} onClick={() => void run({ day, classId: c.id, action: "UNDO" }, false)}>
                    원래대로
                  </button>
                  <button type="button" className="btn px-2 py-0.5 text-xs" disabled={busy} onClick={() => void run({ day, classId: c.id, action: "KEEP" }, false)}>
                    계속 적용으로
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
      {error ? <p className="mt-2 text-sm font-semibold text-alert">{error}</p> : null}
    </Modal>
  );
}

/* ------------------------------------------------------------ ＋ 교실배정 */

export function AssignModal({ ctx, initialDay, onClose, onDone }: { ctx: Ctx; initialDay: number; onClose: () => void; onDone: (day: number) => void }) {
  const { rooms, classes, bookings, tempSwaps, week, teachers, today } = ctx.data;
  const [day, setDay] = useState(initialDay);
  const [name, setName] = useState("");
  const [n, setN] = useState("");
  const [teacherId, setTeacherId] = useState<number | null>(null);
  const [start, setStart] = useState<number | null>(15 * 60);
  const [end, setEnd] = useState<number | null>(16 * 60);
  const [result, setResult] = useState<{ ok: { id: number; name: string; cap: number | null }[]; bad: { name: string; why: string; free: number }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const date = week.find((w) => w.day === day)?.date ?? today;

  const find = () => {
    setError(null);
    setResult(null);
    if (!name.trim()) return setError("무엇에 쓰는지 입력해 주세요.");
    if (start === null || end === null || start >= end) return setError("끝 시간이 시작보다 늦어야 해요.");
    if (date < today) return setError("지난 날이에요. 이번 주 오늘 이후 요일을 골라 주세요.");
    const count = Number(n) || 0;
    const ok: { id: number; name: string; cap: number | null }[] = [];
    const bad: { name: string; why: string; free: number }[] = [];
    for (const r of rooms.filter((x) => x.isSr !== 1)) {
      const busy = [
        ...classes.flatMap((c) => partsOn(c, day, isSwapped(tempSwaps, c.id, day)).filter((p) => p.roomId === r.id).map((p) => ({ start: p.start, end: p.end, who: c.name }))),
        ...bookings.filter((b) => b.date === date && b.roomId === r.id).map((b) => ({ start: b.start, end: b.end, who: b.name })),
      ]
        .filter((x) => overlaps(x.start, x.end, start, end))
        .sort((a, b) => a.start - b.start);
      if (busy.length) bad.push({ name: r.name, why: `${fmtTime(busy[0].start)}부터 ${busy[0].who}`, free: Math.max(0, busy[0].start - start) });
      else if (r.capacity && count > r.capacity) bad.push({ name: r.name, why: `정원 ${r.capacity}명 — 모자람`, free: end - start });
      else ok.push({ id: r.id, name: r.name, cap: r.capacity });
    }
    setResult({ ok, bad: bad.sort((a, b) => b.free - a.free) });
  };

  const take = async (roomId: number) => {
    try {
      await apiPost("/api/timetable/booking", { date, roomId, start, end, name, headcount: Number(n) || null, teacherId });
      await ctx.reload();
      onDone(day);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Modal open width={620} title={`＋ 교실배정 — ${DAY_LABELS[day]}요일 (${monthDay(date)})`} onClose={onClose}>
      <p className="text-sm text-muted">보강·특강처럼 시간표에 없는 일에 빈 교실을 잡아요. 이번 주 그 요일 하루만 잡히고, 지난 날짜는 저절로 안 보여요.</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {WEEK.map((x) => (
          <button key={x} type="button" className={`btn px-3 py-1 ${x === day ? "btn-primary" : ""}`} onClick={() => setDay(x)}>
            {DAY_LABELS[x]}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <div className="col-span-2">
          <label className="label">무엇에 쓰나요 (필수)</label>
          <input className="field" placeholder="예) 7A1 보강" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">몇 명</label>
          <input className="field" type="number" min={1} placeholder="예) 4" value={n} onChange={(e) => setN(e.target.value)} />
        </div>
        <div>
          <label className="label">담당 선생님</label>
          <select className="field" value={teacherId ?? ""} onChange={(e) => setTeacherId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">—</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">시작</label>
          <TimeSelect value={start} onChange={setStart} />
        </div>
        <div>
          <label className="label">끝</label>
          <TimeSelect value={end} onChange={setEnd} />
        </div>
      </div>
      <button type="button" className="btn btn-primary mt-3" onClick={find}>
        빈 교실 찾기
      </button>
      {error ? <p className="mt-2 text-sm font-semibold text-alert">{error}</p> : null}
      {result && start !== null && end !== null ? (
        <div className="mt-3">
          <b>
            {rangeLabel(start, end)} 에 쓸 수 있는 교실 {result.ok.length}곳
          </b>
          <div className="mt-2 space-y-1.5">
            {result.ok.length === 0 ? <div className="text-sm text-muted">빈 교실이 없어요.</div> : null}
            {result.ok.map((o) => (
              <div key={o.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
                <span>
                  <b>{o.name}</b> <span className="text-sm text-muted">{o.cap ? `${o.cap}명까지` : "정원 미정"}</span>
                </span>
                <button type="button" className="btn btn-primary px-2.5 py-1 text-xs" onClick={() => void take(o.id)}>
                  이 교실로
                </button>
              </div>
            ))}
          </div>
          <details className="mt-2">
            <summary className="cursor-pointer text-sm text-muted">안 되는 교실도 보기 ({result.bad.length})</summary>
            {result.bad.map((b) => (
              <div key={b.name} className="mt-1.5 flex items-center justify-between rounded-lg border border-line bg-navy-50 px-3 py-2 text-sm text-muted">
                <span>
                  <b>{b.name}</b> — {b.why}
                </span>
                <span className="text-xs">{b.free ? `${b.free}분은 비어 있음` : ""}</span>
              </div>
            ))}
          </details>
        </div>
      ) : null}
    </Modal>
  );
}

/* ------------------------------------------------------------ 📤 명단 엑셀 올리기 */

type UploadResult = { groups: { className: string; classId: number | null; names: string[]; add: string[] }[]; added: number };

export function UploadModal({ ctx, onClose }: { ctx: Ctx; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<UploadResult | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const send = async (apply: boolean) => {
    if (!file) return;
    setMsg(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("apply", apply ? "1" : "0");
    try {
      const res = await fetch("/api/timetable/roster", { method: "POST", body: fd });
      const json = (await res.json()) as { ok: boolean; data?: UploadResult; error?: string };
      if (!json.ok || !json.data) throw new Error(json.error || "처리하지 못했어요.");
      if (apply) {
        await ctx.reload();
        setMsg({ ok: true, text: `${json.data.added}명을 반에 더했어요.` });
        setPreview(null);
      } else setPreview(json.data);
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    }
  };
  return (
    <Modal open width={620} title="📤 명단 엑셀 올리기" onClose={onClose}>
      <p className="text-sm text-muted">
        엑셀 첫 줄에 <b>반이름</b>, <b>학생이름</b> 칸이 있으면 돼요 (한 줄에 학생 한 명). 이미 있는 반에 <b>새 학생만 더해요</b> (빼지는 않아요). 없는 반은 건너뛰어요.
      </p>
      <input
        className="mt-3 block text-sm"
        type="file"
        accept=".xlsx,.csv"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setPreview(null);
        }}
      />
      <button type="button" className="btn mt-2" disabled={!file} onClick={() => void send(false)}>
        미리보기
      </button>
      {preview ? (
        <>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="bg-navy-50 text-left text-xs text-muted">
                <th className="px-2 py-1.5">반이름</th>
                <th className="px-2 py-1.5">상태</th>
                <th className="px-2 py-1.5">학생 수</th>
              </tr>
            </thead>
            <tbody>
              {preview.groups.map((g) => (
                <tr key={g.className} className="border-t border-line">
                  <td className="px-2 py-1.5">{g.className}</td>
                  <td className="px-2 py-1.5">
                    {g.classId ? <b className="text-present">추가 {g.add.length}명</b> : <b className="text-alert">반 없음</b>}
                  </td>
                  <td className="px-2 py-1.5">{g.names.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn btn-primary mt-2" onClick={() => void send(true)}>
            이 내용대로 반영하기
          </button>
        </>
      ) : null}
      {msg ? <p className={`mt-2 text-sm font-semibold ${msg.ok ? "text-present" : "text-alert"}`}>{msg.text}</p> : null}
    </Modal>
  );
}

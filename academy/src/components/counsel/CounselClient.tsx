"use client";

// 📝 상담기록 — 고등부 선생님이 가르치는 학생(중3 포함). 📋 기간별(강사별 묶음, 첫 줄만 / 펼쳐보기) · 👤 학생별.
// 쓰기 = 고등부 선생님 · 데스크(정직원) · 관리자 (고등부 선생님끼리 전부 공유) / 초중등부 선생님 = 중등 학생 기록만 보기.
// 고치기 · 지우기 = 쓴 사람 + 관리자.

import { useCallback, useEffect, useMemo, useState } from "react";
import Modal from "../Modal";
import Combobox, { type ComboValue } from "../Combobox";
import { useConfirm } from "../ConfirmDialog";
import { apiGet, apiPost, errorMessage } from "@/lib/http";
import { useDataChanged } from "@/lib/dataChanged";
import { COUNSEL_DEFAULT, COUNSEL_HOW, COUNSEL_KIND, COUNSEL_ROLE, COUNSEL_TARGET, COUNSEL_TOPIC } from "@/lib/counsel";
import { dateKey } from "@/lib/time";
import type { SessionUser } from "@/lib/types";
import type { Counsel, CounselData, CounselStudent } from "@/lib/repo/counsel";

const TOPIC_CLS: Record<string, string> = {
  학교성적: "bg-present-soft text-present border-present/30",
  출결: "bg-late-soft text-late border-late/30",
  "수강/반이동": "bg-alert-soft text-alert border-alert/30",
};
const KIND_CLS: Record<string, string> = { 신규상담: "bg-ok-soft text-ok border-ok/30", 퇴원상담: "bg-alert-soft text-alert border-alert/30" };
const tag = "inline-block rounded-md border border-line px-1.5 py-px text-xs font-bold";
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
const pad = (n: number) => String(n).padStart(2, "0");
const monthRange = (offset: number) => {
  const now = new Date();
  const a = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const b = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { from: dateKey(a), to: dateKey(b) };
};
const weekRange = () => {
  const now = new Date();
  const mon = new Date(now);
  mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { from: dateKey(mon), to: dateKey(sun) };
};

export default function CounselClient({ user }: { user: SessionUser }) {
  const [range, setRange] = useState(() => monthRange(0));
  const [data, setData] = useState<CounselData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<"list" | "student">("list");
  const [grade, setGrade] = useState("전체");
  const [cls, setCls] = useState("전체");
  const [author, setAuthor] = useState("전체");
  const [topic, setTopic] = useState("전체");
  const [q, setQ] = useState("");
  const [unfold, setUnfold] = useState(false);
  const [form, setForm] = useState<{ record: Counsel | null } | null>(null);
  const [studentId, setStudentId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiGet<CounselData>(`/api/counsel?from=${range.from}&to=${range.to}`));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [range]);
  useEffect(() => {
    void load();
  }, [load]);
  useDataChanged(load);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1800);
    return () => clearTimeout(t);
  }, [toast]);

  const write = data?.access === "WRITE";
  const records = useMemo(
    () =>
      (data?.records ?? []).filter(
        (r) =>
          (grade === "전체" || r.grade === grade) &&
          (cls === "전체" || r.className === cls) &&
          (author === "전체" || r.authorName === author) &&
          (topic === "전체" || r.topic === topic) &&
          (!q.trim() || r.studentName.includes(q.trim())),
      ),
    [data, grade, cls, author, topic, q],
  );
  const opts = (key: "grade" | "className" | "authorName") => [...new Set((data?.records ?? []).map((r) => r[key]).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, "ko"));

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          <button type="button" className={`btn ${tab === "list" ? "btn-primary" : ""}`} onClick={() => setTab("list")}>
            📋 기간별 (강사별)
          </button>
          <button type="button" className={`btn ${tab === "student" ? "btn-primary" : ""}`} onClick={() => setTab("student")}>
            👤 학생별
          </button>
        </div>
        {write ? (
          <button type="button" className="btn btn-primary" onClick={() => setForm({ record: null })}>
            ＋ 상담 등록
          </button>
        ) : data ? (
          <span className="text-xs text-muted">초중등부 선생님은 고등부 선생님이 가르치는 <b>중등 학생</b> 상담만 볼 수 있어요.</span>
        ) : null}
      </div>

      {error ? (
        <div className="flex items-center justify-between rounded-xl border border-alert bg-alert-soft px-4 py-2.5 text-sm font-semibold text-alert">
          <span>{error}</span>
          <button type="button" className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => setError(null)}>
            닫기
          </button>
        </div>
      ) : null}

      {tab === "list" ? (
        <>
          <div className="card flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
            <b className="text-navy-800">기간</b>
            <input className="field w-40" type="date" value={range.from} onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))} />
            ~
            <input className="field w-40" type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))} />
            <button type="button" className="btn px-2.5 py-1 text-xs" onClick={() => setRange(monthRange(0))}>
              이번 달
            </button>
            <button type="button" className="btn px-2.5 py-1 text-xs" onClick={() => setRange(monthRange(-1))}>
              지난 달
            </button>
            <button type="button" className="btn px-2.5 py-1 text-xs" onClick={() => setRange(weekRange())}>
              이번 주
            </button>
            <span className="w-2" />
            학년
            <Select value={grade} onChange={setGrade} options={opts("grade")} />
            반
            <Select value={cls} onChange={setCls} options={opts("className")} />
            강사
            <Select value={author} onChange={setAuthor} options={opts("authorName")} />
            주제
            <Select value={topic} onChange={setTopic} options={[...COUNSEL_TOPIC]} />
            이름
            <input className="field w-28" value={q} onChange={(e) => setQ(e.target.value)} placeholder="학생 이름" />
            <label className="ml-auto flex cursor-pointer items-center gap-1.5 font-bold">
              <input type="checkbox" checked={unfold} onChange={(e) => setUnfold(e.target.checked)} /> 상담내용 펼쳐보기
            </label>
          </div>
          {!data ? <div className="card p-10 text-center text-sm text-muted">불러오는 중…</div> : <ListView records={records} unfold={unfold} onOpen={(r) => setForm({ record: r })} />}
        </>
      ) : data ? (
        <StudentView
          students={data.students}
          studentId={studentId}
          setStudentId={setStudentId}
          onOpen={(r) => setForm({ record: r })}
          onError={setError}
        />
      ) : null}

      {data && form ? (
        <CounselForm
          user={user}
          students={data.students}
          record={form.record}
          canWrite={write}
          onClose={() => setForm(null)}
          onSaved={(msg) => {
            setForm(null);
            setToast(msg);
            void load();
          }}
        />
      ) : null}
      {toast ? <div className="fixed bottom-6 left-1/2 z-[90] -translate-x-1/2 rounded-xl bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white">{toast}</div> : null}
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select className="field w-auto py-1.5" value={value} onChange={(e) => onChange(e.target.value)}>
      <option>전체</option>
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  );
}

const authorLabel = (r: Counsel) => r.authorName;

function ListView({ records, unfold, onOpen }: { records: Counsel[]; unfold: boolean; onOpen: (r: Counsel) => void }) {
  const authors = [...new Set(records.map(authorLabel))];
  const th = "border border-line bg-navy-50 px-2 py-2 text-xs font-bold text-muted";
  const td = "border border-line px-2 py-1.5 text-center text-[13px]";
  return (
    <div className="card overflow-auto">
      <table className="w-full table-fixed border-collapse bg-white">
        <colgroup>
          <col style={{ width: 66 }} />
          <col style={{ width: 80 }} />
          <col style={{ width: 84 }} />
          <col style={{ width: 84 }} />
          <col style={{ width: 70 }} />
          <col style={{ width: 96 }} />
          <col style={{ width: 104 }} />
          <col />
        </colgroup>
        <thead>
          <tr>
            {["일자", "반", "학생", "구분", "대상", "방법", "주제", "상담내용"].map((h) => (
              <th key={h} className={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {authors.map((a) => {
            const rs = records.filter((r) => authorLabel(r) === a);
            return [
              <tr key={`h-${a}`}>
                <td colSpan={8} className="border border-line bg-navy-100 px-3 py-1.5 font-extrabold text-navy-900">
                  ▾ 강사: {a} <span className="ml-1 text-xs font-semibold text-muted">{rs.length}건</span>
                </td>
              </tr>,
              ...rs.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-navy-50" onClick={() => onOpen(r)}>
                  <td className={td}>{md(r.date)}</td>
                  <td className={td}>{r.className}</td>
                  <td className={`${td} font-bold`}>{r.studentName}</td>
                  <td className={td}>
                    <span className={`${tag} ${KIND_CLS[r.kind] ?? "bg-navy-50"}`}>{r.kind}</span>
                  </td>
                  <td className={td}>{r.target}</td>
                  <td className={td}>{r.how}</td>
                  <td className={td}>
                    <span className={`${tag} ${TOPIC_CLS[r.topic] ?? "bg-navy-50"}`}>{r.topic}</span>
                  </td>
                  <td className="border border-line px-2 py-1.5 text-left text-[13px]">
                    <div className={unfold ? "whitespace-pre-wrap leading-relaxed" : "truncate"}>{r.text}</div>
                  </td>
                </tr>
              )),
            ];
          })}
          {records.length === 0 ? (
            <tr>
              <td colSpan={8} className="h-20 border border-line text-center text-sm text-muted">
                기간 안 상담 기록이 없어요.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      <div className="px-3 py-2 text-right text-sm text-muted">{records.length}건</div>
    </div>
  );
}

function StudentView({
  students,
  studentId,
  setStudentId,
  onOpen,
  onError,
}: {
  students: CounselStudent[];
  studentId: number | null;
  setStudentId: (id: number | null) => void;
  onOpen: (r: Counsel) => void;
  onError: (msg: string) => void;
}) {
  const [list, setList] = useState<Counsel[] | null>(null);
  const [unfold, setUnfold] = useState(true);
  const st = students.find((s) => s.id === studentId);
  const load = useCallback(async () => {
    if (!studentId) return setList(null);
    try {
      setList((await apiGet<{ records: Counsel[] }>(`/api/counsel?student=${studentId}`)).records);
    } catch (e) {
      onError(errorMessage(e));
    }
  }, [studentId, onError]);
  useEffect(() => {
    void load();
  }, [load]);
  useDataChanged(load);
  return (
    <div className="card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-56">
          <Combobox
            options={students.map((s) => ({ id: s.id, label: s.name, hint: s.className }))}
            value={{ id: st?.id ?? null, name: st?.name ?? "" }}
            onChange={(v: ComboValue) => setStudentId(v.id)}
            allowCreate={false}
            placeholder="학생 이름"
          />
        </div>
        {st ? (
          <span className="text-sm text-muted">
            {st.className} · {st.grade} · 상담 {list?.length ?? 0}건 (기간 상관없이 전부, 최근 것부터)
          </span>
        ) : (
          <span className="text-sm text-muted">학생을 고르면 그 학생의 상담을 날짜순으로 쭉 보여줘요.</span>
        )}
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-sm font-bold">
          <input type="checkbox" checked={unfold} onChange={(e) => setUnfold(e.target.checked)} /> 상담내용 펼쳐보기
        </label>
      </div>
      {list?.map((r) => (
        <button key={r.id} type="button" onClick={() => onOpen(r)} className="mt-2 flex w-full gap-3 rounded-lg border border-line px-3 py-2 text-left text-sm hover:bg-navy-50">
          <span className="w-12 shrink-0 font-bold">{md(r.date)}</span>
          <span className="w-24 shrink-0">
            <span className={`${tag} ${TOPIC_CLS[r.topic] ?? "bg-navy-50"}`}>{r.topic}</span>
          </span>
          <span className="w-36 shrink-0 text-muted">
            {r.authorName} · {r.target} · {r.how}
          </span>
          <span className={`min-w-0 flex-1 ${unfold ? "whitespace-pre-wrap leading-relaxed" : "truncate"}`}>{r.text}</span>
        </button>
      ))}
      {st && list && list.length === 0 ? <p className="mt-3 text-sm text-muted">아직 상담 기록이 없어요.</p> : null}
    </div>
  );
}

function Seg({ value, options, onChange, disabled }: { value: string; options: readonly string[]; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          disabled={disabled}
          className={`rounded-lg border px-2.5 py-1 text-[13px] font-semibold ${value === o ? "border-navy-800 bg-navy-800 text-white" : "border-line bg-white"} disabled:cursor-default`}
          onClick={() => onChange(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function CounselForm({
  user,
  students,
  record,
  canWrite,
  onClose,
  onSaved,
}: {
  user: SessionUser;
  students: CounselStudent[];
  record: Counsel | null;
  canWrite: boolean;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const confirm = useConfirm();
  const mine = !!record && (record.authorId === user.id || user.roles.includes("ADMIN"));
  const ro = !canWrite || (!!record && !mine);
  const [f, setF] = useState(() => ({
    date: record?.date ?? dateKey(new Date()),
    studentId: record?.studentId ?? null,
    kind: record?.kind ?? COUNSEL_DEFAULT.kind,
    how: record?.how ?? COUNSEL_DEFAULT.how,
    target: record?.target ?? COUNSEL_DEFAULT.target,
    topic: record?.topic ?? "",
    role: record?.role ?? COUNSEL_DEFAULT.role,
    text: record?.text ?? "",
  }));
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const st = students.find((s) => s.id === f.studentId);
  const [hist, setHist] = useState<Counsel[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!f.studentId || record) return setHist([]);
    apiGet<{ records: Counsel[] }>(`/api/counsel?student=${f.studentId}`)
      .then((d) => setHist(d.records.slice(0, 3)))
      .catch(() => setHist([]));
  }, [f.studentId, record]);

  const save = async () => {
    setError(null);
    if (!record && !f.studentId) return setError("학생을 목록에서 골라 주세요.");
    if (!f.topic) return setError("상담주제를 골라 주세요.");
    if (!f.text.trim()) return setError("상담내용을 적어 주세요.");
    setBusy(true);
    try {
      await apiPost("/api/counsel", { action: "SAVE", id: record?.id, ...f });
      onSaved(record ? "상담 고침" : `${st?.name ?? ""} 상담 저장`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!record) return;
    const ok = await confirm({ title: "상담기록 지우기", message: `${record.studentName} ${md(record.date)} 상담을 지울까요? 되돌릴 수 없어요.`, confirmText: "지우기", danger: true });
    if (!ok) return;
    try {
      await apiPost("/api/counsel", { action: "DELETE", id: record.id });
      onSaved("🗑 지움");
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const lbl = "text-right text-[13px] font-bold text-navy-700";

  return (
    <Modal
      open
      width={980}
      title={!record ? "상담 등록" : ro ? "상담 보기" : "상담 고치기"}
      subtitle={!record ? "기본값이 골라져 있어요 — 학생 · 주제 · 내용만 채우면 돼요" : ro ? `${record.authorName} 님이 쓴 기록 — 고치기 · 지우기는 쓴 사람 · 관리자만` : undefined}
      onClose={onClose}
      footer={
        ro ? (
          <button type="button" className="btn" onClick={onClose}>
            닫기
          </button>
        ) : (
          <>
            {record ? (
              <button type="button" className="btn btn-danger mr-auto" onClick={() => void remove()}>
                🗑 지우기
              </button>
            ) : null}
            <button type="button" className="btn" onClick={onClose}>
              취소
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
              저장
            </button>
          </>
        )
      }
    >
      <div className="grid grid-cols-[84px_1fr_84px_1fr_84px_1fr] items-center gap-x-2.5 gap-y-2.5">
        <span className={lbl}>상담일자</span>
        <input className="field" type="date" value={f.date} disabled={ro} onChange={(e) => e.target.value && set({ date: e.target.value })} />
        <span className={lbl}>상담자</span>
        <input className="field bg-navy-50" value={record?.authorName ?? user.name} disabled />
        <span className={lbl}>학생</span>
        {record ? (
          <input className="field bg-navy-50" value={`${record.studentName} (${record.className ?? ""})`} disabled />
        ) : (
          <Combobox
            options={students.map((s) => ({ id: s.id, label: s.name, hint: s.className }))}
            value={{ id: st?.id ?? null, name: st?.name ?? "" }}
            onChange={(v) => set({ studentId: v.id })}
            allowCreate={false}
            placeholder="학생 이름"
          />
        )}
        <span className={lbl}>구분</span>
        <div className="col-span-3">
          <Seg value={f.kind} options={COUNSEL_KIND} onChange={(v) => set({ kind: v })} disabled={ro} />
        </div>
        <span className={lbl}>반</span>
        <input className="field bg-navy-50" value={record?.className ?? st?.className ?? ""} placeholder="학생 고르면 저절로" disabled />
        <span className={lbl}>상담방법</span>
        <div className="col-span-3">
          <Seg value={f.how} options={COUNSEL_HOW} onChange={(v) => set({ how: v })} disabled={ro} />
        </div>
        <span className={lbl}>상담대상</span>
        <Seg value={f.target} options={COUNSEL_TARGET} onChange={(v) => set({ target: v })} disabled={ro} />
        <span className={lbl}>상담주제</span>
        <div className="col-span-3">
          <Seg value={f.topic} options={COUNSEL_TOPIC} onChange={(v) => set({ topic: v })} disabled={ro} />
        </div>
        <span className={lbl}>상담강사</span>
        <Seg value={f.role} options={COUNSEL_ROLE} onChange={(v) => set({ role: v })} disabled={ro} />
        <span className={`${lbl} self-start pt-2`}>상담내용</span>
        <textarea
          className={`field col-span-5 h-56 resize-y leading-relaxed ${ro ? "bg-navy-50" : ""}`}
          value={f.text}
          readOnly={ro}
          maxLength={5000}
          onChange={(e) => set({ text: e.target.value })}
          placeholder="상담 내용"
        />
      </div>
      {hist.length ? (
        <div className="mt-3 rounded-lg bg-navy-50 px-3 py-2 text-xs leading-relaxed">
          <b>{st?.name} 지난 상담</b>
          {hist.map((h) => (
            <div key={h.id}>
              {md(h.date)} {h.authorName} · {h.topic} — {h.text.split("\n").find((x) => x.trim()) ?? ""}
            </div>
          ))}
        </div>
      ) : null}
      {error ? <p className="mt-2 rounded-lg bg-alert-soft px-3 py-2 text-sm font-semibold text-alert">{error}</p> : null}
    </Modal>
  );
}

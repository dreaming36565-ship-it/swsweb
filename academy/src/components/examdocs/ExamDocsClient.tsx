"use client";

// 📄 기출분석 — 리포트 · 블로그 원고를 열어 문장을 고친다.
// 직원 = 저장하면 원장님 확인 대기 (고친 문장은 「확인 중」 표시) / 관리자 = 바로 반영 + 확인 대기 · 수정 기록 · 보이는 사람 · PDF 만들기.
// 문서는 iframe(스크립트 막음, 같은 주소)으로 열고, 고치기 · 저장은 이 화면이 iframe 안의 [data-k] 문장을 직접 다룬다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConfirm } from "../ConfirmDialog";
import { apiGet, apiPost, errorMessage } from "@/lib/http";
import type { ExamDoc, ExamDocUser, ExamEdit, ExamEditStatus, ExamOverlay } from "@/lib/repo/examdocs";
import { teacherLabel, type SessionUser } from "@/lib/types";

type Tab = "docs" | "pending" | "history" | "users" | "sync";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const h = d.getHours();
  return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, "0")} (${WEEK[d.getDay()]}) ${h < 12 ? "오전" : "오후"} ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 문장 HTML → 글자 (줄바꿈은 ⏎) */
function toText(html: string): string {
  const d = new DOMParser().parseFromString(html.replace(/<br\s*\/?>/gi, " ⏎ "), "text/html");
  return (d.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** 띄어쓰기 단위 비교 — 지운 말 빨강 · 더한 말 초록 */
function WordDiff({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => {
    const x = toText(before).split(/(\s+)/);
    const y = toText(after).split(/(\s+)/);
    const n = x.length;
    const m = y.length;
    if (n * m > 400_000) return [{ k: "del" as const, t: toText(before) }, { k: "ins" as const, t: toText(after) }];
    const L = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out: { k: "same" | "del" | "ins"; t: string }[] = [];
    const push = (k: "same" | "del" | "ins", t: string) => {
      const last = out[out.length - 1];
      if (last && last.k === k) last.t += t;
      else out.push({ k, t });
    };
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && x[i] === y[j]) {
        push("same", x[i]);
        i++;
        j++;
      } else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) push("del", x[i++]);
      else push("ins", y[j++]);
    }
    return out;
  }, [before, after]);
  return (
    <div className="leading-7">
      {parts.map((p, i) =>
        p.k === "del" ? (
          <del key={i} className="bg-alert-soft text-alert">{p.t}</del>
        ) : p.k === "ins" ? (
          <ins key={i} className="bg-ok-soft text-ok no-underline">{p.t}</ins>
        ) : (
          <span key={i}>{p.t}</span>
        ),
      )}
    </div>
  );
}

const STATUS: Record<ExamEditStatus, { label: string; cls: string }> = {
  PENDING: { label: "대기", cls: "bg-late-soft text-late" },
  APPROVED: { label: "반영", cls: "bg-ok-soft text-ok" },
  REJECTED: { label: "거절", cls: "bg-alert-soft text-alert" },
};

export default function ExamDocsClient({ admin }: { user: SessionUser; admin: boolean }) {
  const [tab, setTab] = useState<Tab>("docs");
  const [docs, setDocs] = useState<ExamDoc[]>([]);
  const [open, setOpen] = useState<ExamDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadDocs = useCallback(async () => {
    try {
      setDocs((await apiGet<{ docs: ExamDoc[] }>("/api/examdocs")).docs);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void loadDocs();
  }, [loadDocs]);

  const pendingTotal = docs.reduce((s, d) => s + d.pending, 0);

  if (open) return <DocViewer doc={open} admin={admin} onBack={() => (setOpen(null), void loadDocs())} />;

  const tabs: [Tab, string][] = [
    ["docs", "문서"],
    ["pending", "확인 대기"],
    ["history", "수정 기록"],
    ["users", "보이는 사람"],
    ["sync", "PDF 만들기"],
  ];
  return (
    <div className="w-full space-y-4">
      {admin && (
        <div className="flex flex-wrap gap-2">
          {tabs.map(([k, l]) => (
            <button key={k} type="button" className={`btn ${tab === k ? "btn-primary" : ""}`} onClick={() => setTab(k)}>
              {l}
              {k === "pending" && pendingTotal > 0 && (
                <span className="ml-1.5 rounded-full bg-alert px-1.5 text-[11px] font-bold text-white">{pendingTotal}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-sm text-alert">{error}</p>}
      {tab === "docs" && <DocList docs={docs} admin={admin} onOpen={setOpen} />}
      {tab === "pending" && <Pending onChange={loadDocs} />}
      {tab === "history" && <History docs={docs} />}
      {tab === "users" && <Users />}
      {tab === "sync" && <Sync />}
    </div>
  );
}

// ---------- 문서 목록 ----------

function DocList({ docs, admin, onOpen }: { docs: ExamDoc[]; admin: boolean; onOpen: (d: ExamDoc) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, ExamDoc[]>();
    for (const d of docs) m.set(d.grp, [...(m.get(d.grp) ?? []), d]);
    return [...m.entries()];
  }, [docs]);
  if (!docs.length)
    return (
      <section className="card p-8 text-center text-muted">
        아직 올라온 문서가 없습니다.{admin && " 「PDF 만들기」 탭에서 학원 컴퓨터를 연결해 주세요."}
      </section>
    );
  return (
    <div className="space-y-5">
      {groups.map(([g, list]) => (
        <section key={g}>
          <h2 className="mb-2 text-base font-bold text-ink">{g}</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
            {list.map((d) => (
              <button key={d.id} type="button" className="card p-4 text-left hover:border-navy-300" onClick={() => onOpen(d)}>
                <div className="font-bold text-navy-900">{d.name}</div>
                <div className="mt-1 text-xs text-muted">
                  {d.kind === "REPORT" ? "리포트" : "블로그 원고"} · {when(d.updatedAt)}
                </div>
                {d.pending > 0 && <div className="mt-2 inline-block rounded-md bg-late-soft px-1.5 text-xs font-bold text-late">확인 중 {d.pending}</div>}
              </button>
            ))}
          </div>
        </section>
      ))}
      <p className="rounded-xl border border-dashed border-navy-300 bg-navy-50 px-4 py-3 text-sm leading-7 text-ink">
        문서를 열고 <b>✏️ 수정</b> → 점선 문장을 고친 뒤 <b>💾 저장</b>.{" "}
        {admin ? (
          <>
            원장님이 고친 것은 <b>바로 반영</b>, 직원이 고친 것은 <b>확인 대기</b>에 쌓입니다.
          </>
        ) : (
          <>
            원장님 확인 후 반영됩니다. 확인 중인 문장은 <span className="rounded bg-late-soft px-1 font-bold text-late">주황 밑줄</span>로 보입니다.
          </>
        )}
      </p>
    </div>
  );
}

// ---------- 문서 열기 · 고치기 ----------

/** 문장 위치 이름 — 바로 앞 제목 + (문항 번호) */
function labelFor(el: Element, path: string): string {
  const heads = [...(el.ownerDocument.querySelectorAll("h1, h2, h3, h4, .section-title, .sub-title, .p-title") as NodeListOf<Element>)];
  let head = "";
  for (const h of heads) {
    if (h.contains(el)) break;
    if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) head = (h.textContent ?? "").replace(/\s+/g, " ").trim();
  }
  const m = /^(problems|killers)\.(\d+)/.exec(path);
  const no = m ? ` · ${m[1] === "killers" ? "킬러 " : ""}${Number(m[2]) + 1}${m[1] === "problems" ? "번" : ""}` : "";
  return (head.slice(0, 40) || path) + no;
}

const cleanHtml = (h: string) =>
  h.replace(/<div>/g, "<br>").replace(/<\/div>/g, "").replace(/(<br>)+$/, "").replace(/&nbsp;/g, " ").trim();

function DocViewer({ doc, admin, onBack }: { doc: ExamDoc; admin: boolean; onBack: () => void }) {
  const confirm = useConfirm();
  const frame = useRef<HTMLIFrameElement>(null);
  const orig = useRef(new Map<Element, string>());
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [changed, setChanged] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const els = () => [...(frame.current?.contentDocument?.querySelectorAll("[data-k]") ?? [])] as HTMLElement[];

  const onLoad = async () => {
    const d = frame.current?.contentDocument;
    if (!d) return;
    // 앱 색 토큰을 iframe 안으로 (하드코딩 금지)
    const css = getComputedStyle(document.documentElement);
    const v = (n: string) => css.getPropertyValue(n).trim();
    const style = d.createElement("style");
    style.textContent = `
      body.xd-edit [data-k] { outline: 1.5px dashed ${v("--color-late")}; outline-offset: 2px; border-radius: 3px; cursor: text; }
      body.xd-edit [data-k]:focus { outline: 2px solid ${v("--color-present")}; background: ${v("--color-present-soft")}; }
      [data-k].xd-ch { background: ${v("--color-hw-miss")} !important; }
      [data-k].xd-rev { background: ${v("--color-late-soft")}; box-shadow: inset 0 -2px 0 ${v("--color-late")}; }
      [data-k].xd-rev::after { content: "확인 중"; font: 800 10px/1.6 sans-serif; color: #fff; background: ${v("--color-late")}; border-radius: 4px; padding: 0 5px; margin-left: 5px; vertical-align: middle; white-space: nowrap; }`;
    d.head.appendChild(style);
    d.body.addEventListener("input", () => {
      let n = 0;
      for (const e of els()) {
        const ch = e.innerHTML !== orig.current.get(e);
        e.classList.toggle("xd-ch", ch);
        if (ch) n++;
      }
      setChanged(n);
    });
    try {
      const { overlay } = await apiGet<{ overlay: ExamOverlay[] }>(`/api/examdocs?doc=${encodeURIComponent(doc.id)}`);
      for (const o of overlay) {
        const e = d.querySelector(`[data-k="${CSS.escape(o.path)}"]`);
        if (!e) continue;
        e.innerHTML = o.html;
        e.classList.toggle("xd-rev", o.pending);
      }
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    }
    orig.current = new Map(els().map((e) => [e, e.innerHTML]));
    setReady(true);
  };

  const toggle = () => {
    const on = !editing;
    setEditing(on);
    frame.current?.contentDocument?.body.classList.toggle("xd-edit", on);
    for (const e of els()) e.contentEditable = on ? "true" : "false";
    setMsg(on ? { ok: true, text: "점선 문장을 눌러 고치세요" } : null);
  };

  const save = async () => {
    const list = els().filter((e) => e.innerHTML !== orig.current.get(e));
    if (!list.length) return setMsg({ ok: false, text: "바뀐 문장이 없습니다" });
    setBusy(true);
    try {
      const items = list.map((e) => ({
        path: e.dataset.k!,
        label: labelFor(e, e.dataset.k!),
        before: orig.current.get(e) ?? "",
        after: cleanHtml(e.innerHTML),
      }));
      const r = await apiPost<{ count: number; approved: boolean }>("/api/examdocs", { doc: doc.id, items });
      for (const e of list) {
        orig.current.set(e, e.innerHTML);
        e.classList.remove("xd-ch");
        e.classList.toggle("xd-rev", !r.approved);
      }
      setChanged(0);
      setMsg({ ok: true, text: r.approved ? `✅ ${r.count}건 반영 · PDF는 「PDF 만들기」에서` : `✅ ${r.count}건 저장 · 원장님 확인 후 반영` });
    } catch (e) {
      setMsg({ ok: false, text: `❌ ${errorMessage(e)}` });
    } finally {
      setBusy(false);
    }
  };

  const back = async () => {
    if (changed && !(await confirm({ title: `저장 안 한 문장 ${changed}개가 있어요. 나갈까요?`, confirmText: "나가기", danger: true }))) return;
    onBack();
  };

  return (
    <section className="card flex h-[calc(100vh-130px)] min-h-[500px] w-full flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <button type="button" className="btn" onClick={() => void back()}>
          ← 목록
        </button>
        <b className="mr-auto text-navy-900">{doc.name}</b>
        {msg && <span className={`text-sm ${msg.ok ? "text-muted" : "text-alert"}`}>{msg.text}</span>}
        {changed > 0 && <span className="text-sm font-bold text-late">고친 문장 {changed}</span>}
        <button type="button" className={`btn ${editing ? "btn-primary" : ""}`} disabled={!ready} onClick={toggle}>
          {editing ? "👁 보기" : "✏️ 수정"}
        </button>
        {editing && (
          <button type="button" className="btn btn-primary" disabled={busy || !changed} onClick={save}>
            💾 저장
          </button>
        )}
      </div>
      <iframe
        ref={frame}
        title={doc.name}
        sandbox="allow-same-origin"
        src={`/api/examdocs/file?id=${encodeURIComponent(doc.id)}&v=${encodeURIComponent(doc.updatedAt)}`}
        onLoad={() => void onLoad()}
        className="w-full flex-1 bg-canvas"
      />
    </section>
  );
}

// ---------- 관리자: 확인 대기 ----------

function Pending({ onChange }: { onChange: () => void }) {
  const confirm = useConfirm();
  const [edits, setEdits] = useState<ExamEdit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setEdits((await apiGet<{ edits: ExamEdit[] }>("/api/examdocs/admin?status=PENDING")).edits.reverse());
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (ids: number[], status: "APPROVED" | "REJECTED", ask?: string) => {
    if (ask && !(await confirm({ title: ask, confirmText: status === "APPROVED" ? "반영" : "거절", danger: status === "REJECTED" }))) return;
    setError(null);
    try {
      await apiPost("/api/examdocs/admin", { action: "decide", ids, status });
      await load();
      onChange();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  if (!edits) return error ? <p className="text-sm text-alert">{error}</p> : null;
  if (!edits.length) return <section className="card p-8 text-center text-muted">확인할 수정 없음</section>;
  const groups = new Map<string, ExamEdit[]>();
  for (const e of edits) groups.set(e.docName, [...(groups.get(e.docName) ?? []), e]);
  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-alert">{error}</p>}
      {[...groups.entries()].map(([name, list]) => (
        <section key={name} className="card overflow-hidden">
          <div className="flex items-center justify-between bg-navy-50 px-4 py-2.5">
            <b className="text-navy-900">
              {name} <span className="font-normal text-muted">· {list.length}건</span>
            </b>
            <span className="flex gap-2">
              <button type="button" className="btn btn-danger" onClick={() => void decide(list.map((e) => e.id), "REJECTED", `${name} ${list.length}건을 전부 거절할까요?`)}>
                전부 거절
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void decide(list.map((e) => e.id), "APPROVED", `${name} ${list.length}건을 전부 반영할까요?`)}>
                전부 반영
              </button>
            </span>
          </div>
          {list.map((e) => (
            <div key={e.id} className="border-t border-line px-4 py-3">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <span>
                  <b>{e.userName}</b>
                  <span className="text-xs text-muted">
                    {" "}
                    · {when(e.createdAt)} · {e.label}
                  </span>
                </span>
                <span className="flex gap-2">
                  <button type="button" className="btn" onClick={() => void decide([e.id], "REJECTED")}>
                    거절
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => void decide([e.id], "APPROVED")}>
                    반영
                  </button>
                </span>
              </div>
              <WordDiff before={e.before} after={e.after} />
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

// ---------- 관리자: 수정 기록 ----------

function History({ docs }: { docs: ExamDoc[] }) {
  const [edits, setEdits] = useState<ExamEdit[] | null>(null);
  const [who, setWho] = useState("");
  const [doc, setDoc] = useState("");
  const [st, setSt] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiGet<{ edits: ExamEdit[] }>("/api/examdocs/admin")
      .then((r) => setEdits(r.edits))
      .catch((e) => setError(errorMessage(e)));
  }, []);
  const people = useMemo(() => [...new Set((edits ?? []).map((e) => e.userName))], [edits]);
  const list = (edits ?? []).filter((e) => (!who || e.userName === who) && (!doc || e.docId === doc) && (!st || e.status === st));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className="field !w-40" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">모든 사람</option>
          {people.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        <select className="field !w-56" value={doc} onChange={(e) => setDoc(e.target.value)}>
          <option value="">모든 문서</option>
          {docs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select className="field !w-32" value={st} onChange={(e) => setSt(e.target.value)}>
          <option value="">모든 결과</option>
          <option value="PENDING">대기</option>
          <option value="APPROVED">반영</option>
          <option value="REJECTED">거절</option>
        </select>
        <span className="ml-auto text-xs text-muted">🔒 관리자만 보는 화면 · {list.length}건</span>
      </div>
      {error && <p className="text-sm text-alert">{error}</p>}
      <section className="card overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-navy-50 text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">누가</th>
              <th className="px-3 py-2 font-semibold">언제</th>
              <th className="px-3 py-2 font-semibold">문서 · 어디</th>
              <th className="px-3 py-2 font-semibold">고친 내용</th>
              <th className="px-3 py-2 font-semibold">결과</th>
            </tr>
          </thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id} className="border-t border-line align-top">
                <td className="whitespace-nowrap px-3 py-2 font-bold">{e.userName}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{when(e.createdAt)}</td>
                <td className="px-3 py-2 text-xs text-muted">
                  {e.docName}
                  <br />
                  {e.label}
                </td>
                <td className="px-3 py-2">
                  <WordDiff before={e.before} after={e.after} />
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">
                  <span className={`rounded px-1.5 py-0.5 font-bold ${STATUS[e.status].cls}`}>{STATUS[e.status].label}</span>
                  {e.decidedAt && e.status !== "PENDING" && (
                    <div className="mt-1 text-muted">
                      {e.decidedBy} · {when(e.decidedAt)}
                    </div>
                  )}
                  {e.status === "APPROVED" && <div className="mt-0.5 text-muted">{e.syncedAt ? "PDF 반영됨" : "PDF 대기"}</div>}
                </td>
              </tr>
            ))}
            {!list.length && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted">
                  기록 없음
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

// ---------- 관리자: 보이는 사람 ----------

function Users() {
  const [users, setUsers] = useState<ExamDocUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setUsers((await apiGet<{ users: ExamDocUser[] }>("/api/examdocs/admin?what=users")).users);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const set = async (id: number, on: boolean) => {
    setError(null);
    try {
      await apiPost("/api/examdocs/admin", { action: "user", userId: id, on });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <section className="card p-5">
      <h2 className="text-base font-bold text-ink">📄 기출분석 메뉴가 보이는 사람</h2>
      <p className="mt-1 text-sm text-muted">관리자는 항상 보입니다. 알바는 목록에 없습니다.</p>
      {error && <p className="mt-2 text-sm text-alert">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        {(users ?? []).map((u) => (
          <label key={u.id} className={`btn cursor-pointer ${u.on ? "btn-primary" : ""}`}>
            <input type="checkbox" className="mr-1.5" checked={u.on} onChange={(e) => void set(u.id, e.target.checked)} />
            {u.roles.includes("TEACHER") ? teacherLabel(u.name) : u.name}
          </label>
        ))}
      </div>
    </section>
  );
}

// ---------- 관리자: PDF 만들기 (학원 컴퓨터 연결) ----------

function Sync() {
  const confirm = useConfirm();
  const [info, setInfo] = useState<{ key: string; unsynced: ExamEdit[]; last: string | null } | null>(null);
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const load = useCallback(async () => {
    try {
      setInfo(await apiGet("/api/examdocs/admin?what=sync"));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const renew = async () => {
    if (!(await confirm({ title: "연결 열쇠를 새로 만들까요?", message: "학원 컴퓨터에 새 열쇠를 다시 넣어야 합니다.", confirmText: "새로 만들기", danger: true }))) return;
    try {
      await apiPost("/api/examdocs/admin", { action: "newKey" });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const copy = async () => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.key);
      setCopied(true);
    } catch {
      setError("복사하지 못했습니다. 「보기」를 눌러 직접 복사해 주세요.");
    }
  };
  if (!info) return error ? <p className="text-sm text-alert">{error}</p> : null;
  const byDoc = new Map<string, number>();
  for (const e of info.unsynced) byDoc.set(e.docName, (byDoc.get(e.docName) ?? 0) + 1);
  return (
    <section className="card space-y-4 p-5">
      <div>
        <div className="text-base font-bold text-navy-900">
          PDF에 아직 안 들어간 반영 <span className={info.unsynced.length ? "text-alert" : ""}>{info.unsynced.length}건</span>
        </div>
        <p className="mt-1 text-sm text-muted">
          {[...byDoc.entries()].map(([n, c]) => `${n} ${c}건`).join(" · ") || "모두 PDF에 들어갔습니다."}
        </p>
        <p className="mt-1 text-xs text-muted">마지막으로 PDF 만든 때: {when(info.last) || "아직 없음"}</p>
      </div>
      <p className="rounded-xl border border-dashed border-navy-300 bg-navy-50 px-4 py-3 text-sm leading-7">
        학원 컴퓨터 바탕화면의 <b>「기출분석 PDF 다시 만들기」</b>를 두 번 누르면, 반영된 수정을 받아 와 PDF · 블로그 미리보기를 새로 만들고 이 화면의 문서도 새 것으로 바꿉니다.
        <br />
        (PDF는 리포트 만드는 프로그램이 있는 학원 컴퓨터에서만 만들 수 있어요)
      </p>
      <div>
        <label className="label">학원 컴퓨터 연결 열쇠 (처음 한 번만 학원 컴퓨터에 넣어 둡니다)</label>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-lg border border-line bg-canvas px-3 py-1.5 text-sm">{show ? info.key : "••••••••••••••••"}</code>
          <button type="button" className="btn" onClick={() => setShow(!show)}>
            {show ? "숨기기" : "보기"}
          </button>
          <button type="button" className="btn" onClick={() => void copy()}>
            {copied ? "복사됨" : "복사"}
          </button>
          <button type="button" className="btn btn-danger" onClick={() => void renew()}>
            새로 만들기
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-alert">{error}</p>}
      </div>
    </section>
  );
}

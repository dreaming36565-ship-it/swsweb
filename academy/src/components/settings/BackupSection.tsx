"use client";

// 백업 (관리자) — 💾 지금 백업 받기 · 자동 백업(하루 한 번, 최근 14개) 받기 · 📤 백업 올리기(복원).
// 백업 파일에는 실제 학생 이름이 들어 있다 — 학원 컴퓨터에만 보관할 것.

import { useCallback, useEffect, useRef, useState } from "react";
import { useConfirm } from "../ConfirmDialog";
import { apiGet, errorMessage } from "@/lib/http";

type Info = { backups: { name: string; size: number }[]; volumeMissing: boolean };

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
/** academy-2026-09-30.db → 9/30 자동 · before-restore-… → 복원 전 */
const label = (name: string) => {
  const m = name.match(/(\d{4})-(\d{2})-(\d{2})/);
  const d = m ? `${Number(m[2])}/${Number(m[3])}` : name;
  return name.startsWith("before-restore") ? `${d} 올리기 전` : `${d} 자동`;
};

export default function BackupSection() {
  const confirm = useConfirm();
  const [info, setInfo] = useState<Info | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setInfo(await apiGet<Info>("/api/backup?list=1"));
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (file: File) => {
    setMsg(null);
    const yes = await confirm({
      title: "📤 백업 올리기",
      message: `「${file.name}」으로 지금 자료를 통째로 바꿔요. 지금 자료는 「올리기 전」 백업으로 남겨 둬요. 바꾼 뒤에는 모두 다시 로그인해야 해요.`,
      confirmText: "바꾸기",
      danger: true,
    });
    if (!yes) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await fetch("/api/backup", { method: "POST", body: fd });
      const json = (await res.json().catch(() => null)) as { ok: boolean; error?: string } | null;
      if (!json?.ok) throw new Error(json?.error || "백업을 올리지 못했어요.");
      setMsg({ ok: true, text: "바꿨어요. 3초 뒤 로그인 화면으로 가요." });
      setTimeout(() => window.location.assign("/login"), 3000);
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <section className="card p-5 xl:col-span-3">
      <h2 className="text-base font-bold text-ink">백업</h2>
      <p className="mt-1 text-sm text-muted">
        하루 한 번 저절로 백업해요(최근 14개 보관). 백업 파일에는 <b>실제 학생 이름</b>이 들어 있으니 학원 컴퓨터에만 보관하세요.
      </p>
      {info?.volumeMissing ? (
        <div className="mt-2 rounded-lg border border-alert bg-alert-soft px-3 py-2 text-sm font-bold text-alert">
          ⚠ 저장 공간(볼륨)이 연결되지 않았어요 — 서버를 다시 올리면 자료가 지워져요. Railway에서 볼륨을 붙여 주세요.
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a className="btn btn-primary" href="/api/backup">
          💾 지금 백업 받기
        </a>
        <button type="button" className="btn" disabled={busy} onClick={() => fileRef.current?.click()}>
          📤 백업 올리기 (복원)
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".db"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        {busy ? <span className="text-sm text-muted">올리는 중…</span> : null}
      </div>
      {msg ? <div className={`mt-2 text-sm font-semibold ${msg.ok ? "text-present" : "text-alert"}`}>{msg.text}</div> : null}
      {info?.backups.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {info.backups.map((b) => (
            <a key={b.name} className="btn px-2 py-0.5 text-xs" href={`/api/backup?file=${encodeURIComponent(b.name)}`} title={b.name}>
              {label(b.name)} · {kb(b.size)}
            </a>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted">자동 백업이 아직 없어요 (앱을 켜 두면 오늘 안에 만들어져요).</p>
      )}
    </section>
  );
}

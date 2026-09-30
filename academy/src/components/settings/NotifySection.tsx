"use client";

// 설정 › 🔔 윈도우 알림 — 이 컴퓨터 알림 켜기 · 시험 · 📌 앱으로 설치(따로 된 창 · 컴퓨터 켜면 자동으로)

import { useEffect, useState } from "react";
import { askNotify, notifyState, showDesktop, type NotifyState } from "@/lib/desktopNotify";
import { hookInstallPrompt, promptInstall, runningAsApp } from "../NotifyBanner";

const LABEL: Record<NotifyState, { text: string; cls: string }> = {
  granted: { text: "켜짐", cls: "bg-ok-soft text-ok" },
  default: { text: "꺼짐", cls: "bg-late-soft text-late" },
  denied: { text: "차단됨", cls: "bg-alert-soft text-alert" },
  none: { text: "이 브라우저는 안 됨", cls: "bg-navy-50 text-muted" },
};

export default function NotifySection() {
  const [state, setState] = useState<NotifyState>("default");
  const [app, setApp] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    hookInstallPrompt();
    setState(notifyState());
    setApp(runningAsApp());
  }, []);

  const test = async () => {
    setMsg(null);
    const s = await askNotify();
    setState(s);
    if (s !== "granted") {
      setMsg(s === "denied" ? "알림이 차단돼 있어요 — 주소창 왼쪽 자물쇠(🔒) › 알림 › 허용" : "알림을 켜야 시험할 수 있어요.");
      return;
    }
    setMsg("5초 뒤에 떠요 — 다른 창을 눌러 두고 오른쪽 아래를 보세요.");
    setTimeout(() => {
      const ok = showDesktop({ tag: "academy-test", title: "🔔 출석체크해주세요.", body: "시험 알림 — 누르면 학원앱으로 돌아와요" });
      setMsg(ok ? "알림을 보냈어요. 안 보이면 윈도우 「방해 금지 / 집중 모드」가 켜져 있는지 확인해 주세요." : "알림을 띄우지 못했어요.");
    }, 5000);
  };

  const install = async () => {
    setMsg(null);
    if (await promptInstall()) return;
    setMsg("주소창 오른쪽 끝의 설치 아이콘(⊕ 또는 모니터 모양)을 누르거나, 크롬 메뉴(⋮)에서 「앱으로 설치」(또는 「페이지를 앱으로 설치」)를 눌러 주세요.");
  };

  const l = LABEL[state];
  return (
    <section className="card p-5">
      <h2 className="text-base font-bold text-ink">🔔 윈도우 알림</h2>
      <p className="mt-1 text-sm text-muted">
        학원앱을 안 보고 있을 때 팝업이 뜨면 <b>화면 오른쪽 아래에 작은 알림창</b>이 떠요(소리를 꺼 둬도 보임). 누르면 학원앱이 앞으로 나와요. 컴퓨터마다 한 번 켜 주세요.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        이 컴퓨터: <span className={`rounded-md px-2 py-0.5 font-bold ${l.cls}`}>{l.text}</span>
        <button type="button" className="btn" onClick={() => void test()}>
          🔔 알림 시험
        </button>
        {app ? (
          <span className="rounded-md bg-ok-soft px-2 py-0.5 font-bold text-ok">앱으로 열려 있음</span>
        ) : (
          <button type="button" className="btn" onClick={() => void install()}>
            📌 앱으로 설치
          </button>
        )}
      </div>
      {msg ? <p className="mt-2 text-sm font-semibold text-navy-700">{msg}</p> : null}
      <p className="mt-2 text-xs text-muted">
        <b>앱으로 설치</b>하면 바탕화면 · 작업표시줄에 학원앱 아이콘이 생기고 따로 된 창으로 열려요(탭을 실수로 닫지 않게). 컴퓨터 켤 때 자동으로 켜려면: 크롬 주소창에{" "}
        <b>chrome://apps</b> → 학원앱 오른쪽 클릭 → <b>「로그인 시 시작」</b>.
      </p>
    </section>
  );
}

// 윈도우 알림창 — 카톡 알림처럼 화면 오른쪽 아래에 작게 뜬다(크기 · 위치는 윈도우가 정함).
// 소리를 꺼 둔 컴퓨터에서도 보이고, 다른 창을 보고 있어도 뜬다. 누르면 학원앱이 앞으로 나온다.
// 화면(클라이언트) 전용. 컴퓨터마다 처음 한 번 「알림 켜기 → 허용」이 필요하다.
// 안 뜨는 경우: 학원앱(크롬)이 꺼져 있을 때 · 윈도우 「방해 금지 / 집중 모드」 · 알림 차단.

export type NotifyState = "granted" | "default" | "denied" | "none";

const api = () => (typeof window !== "undefined" && "Notification" in window ? window.Notification : null);

/** 이 컴퓨터의 알림 상태 — none = 이 브라우저는 알림을 못 씀 */
export function notifyState(): NotifyState {
  const N = api();
  return N ? (N.permission as NotifyState) : "none";
}

/** 「알림 켜기」 — 크롬이 허용 / 차단을 묻는다 (버튼을 눌렀을 때만 물을 수 있다) */
export async function askNotify(): Promise<NotifyState> {
  const N = api();
  if (!N) return "none";
  if (N.permission !== "default") return N.permission as NotifyState;
  return (await N.requestPermission()) as NotifyState;
}

/**
 * 알림창 띄우기. 같은 tag 는 새 알림으로 바꿔 끼운다(쌓이지 않음).
 * 누르면 학원앱 창을 앞으로 가져오고 onClick (예: 접어 둔 팝업 열기).
 */
export function showDesktop(opts: { tag: string; title: string; body: string; onClick?: () => void }): boolean {
  const N = api();
  if (!N || N.permission !== "granted") return false;
  try {
    const n = new N(opts.title, {
      body: opts.body,
      tag: opts.tag,
      icon: "/icon-192.png",
      // 같은 tag 로 다시 띄울 때도 알림창이 다시 올라오게
      renotify: true,
    } as NotificationOptions & { renotify?: boolean });
    n.onclick = () => {
      window.focus();
      n.close();
      opts.onClick?.();
    };
    return true;
  } catch {
    return false;
  }
}

/** 지금 이 창을 보고 있나 — 안 보고 있을 때만 알림창을 띄운다 */
export const looking = () => typeof document !== "undefined" && !document.hidden && document.hasFocus();

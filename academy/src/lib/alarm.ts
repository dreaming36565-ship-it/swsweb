// 출결 알림음 — Web Audio API로 만든다(오디오 파일 없음). 클라이언트 전용.
// 팝업이 뜨는 순간 울리고, 제출 전까지 1분마다 3초씩 반복한다.

const STORAGE_KEY = "academy.alarm.enabled";

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

/** 브라우저는 사용자 조작 없이는 소리를 못 낸다. 첫 클릭 때 한 번 호출해 둔다. */
export function unlockAudio(): void {
  const c = getCtx();
  if (c && c.state === "suspended") void c.resume();
}

export function isAlarmEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setAlarmEnabled(on: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    /* localStorage 를 못 쓰는 환경이면 이번 세션에만 적용된다 */
  }
}

/**
 * 알림음을 durationSec 동안 재생한다.
 * 삐- 삐- 하는 두 음 패턴을 0.75초 주기로 반복한다.
 * @returns 재생을 중간에 멈추는 함수
 */
export function playAlarm(durationSec = 3, force = false): () => void {
  if (!force && !isAlarmEnabled()) return () => {};
  const c = getCtx();
  if (!c) return () => {};
  if (c.state === "suspended") void c.resume();

  const stops: OscillatorNode[] = [];
  const start = c.currentTime;
  const period = 0.75;

  for (let t = 0; t < durationSec; t += period) {
    for (const [offset, freq] of [
      [0, 880],
      [0.22, 1174.7],
    ] as const) {
      const at = start + t + offset;
      if (at >= start + durationSec) break;

      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.18, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18);
      osc.connect(gain).connect(c.destination);
      osc.start(at);
      osc.stop(at + 0.2);
      stops.push(osc);
    }
  }

  return () => {
    for (const osc of stops) {
      try {
        osc.stop();
      } catch {
        /* 이미 끝난 노드 */
      }
    }
  };
}

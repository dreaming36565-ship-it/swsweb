"use client";

// 설정 — 내 정보 · 비밀번호 바꾸기 / 알림음 / 숙제반 설문 응답 주소(관리자) / 권한 표.
// 계정 · 강의실 관리는 시간표 화면의 「계정 · 강의실」 탭으로 옮겼다.

import { useEffect, useState } from "react";
import Link from "next/link";
import { IconVolume } from "../Icons";
import { apiGet, apiPost, errorMessage } from "@/lib/http";
import { isAlarmEnabled, playAlarm, setAlarmEnabled, unlockAudio } from "@/lib/alarm";
import { DEPARTMENTS, hasRole, rolesLabel, type SessionUser } from "@/lib/types";

/** 권한 표 — 한 사람이 권한을 여러 개 가지면 그 권한들이 할 수 있는 일을 모두 한다 */
const PERMISSION_ROWS: [string, string, string, string][] = [
  ["시간표 보기 · 학생 찾기 · 엑셀 다운로드", "○", "○", "○"],
  ["반 관리 (반 만들기·시간) · 계정 · 강의실 · 명단 엑셀 올리기", "○", "–", "–"],
  ["교재 책장 · 반 학생 명단 고치기 · 사용교재 입력", "○", "○", "○"],
  ["알파·수업 순서 바꾸기", "○", "–", "–"],
  ["교실배정 (빈 교실 찾기) · 사용 표시", "○", "–", "○"],
  ["SR 자리 보기 (실시간)", "○", "○", "○"],
  ["SR 자리 바꾸기 · 요청 승인", "○", "요청", "○"],
  ["SR 임시 자리 · 하원 · 미션지 받음/요청", "○", "–", "○"],
  ["미션지 요청 받기 (팝업 + 알림음)", "–", "○", "–"],
  ["월초 자리 정리", "○", "–", "–"],
  ["출석체크 제출", "○", "담당 수업만", "알파 먼저인 반"],
  ["출결전화 저장", "○", "–", "○"],
  ["결석 사유 · 알린 때 · 유료 보강 · 결석 미리 등록", "○", "–", "○"],
  ["인정 / 개인사유 판정 · 이월 승인", "○", "–", "–"],
  ["보강 일정 · 완료 · 이월 요청", "내 반", "내 반", "–"],
  ["숙제검사 기입", "○", "내 반", "○"],
  ["숙제반 관리 (요일 · 신청 등록)", "○", "보기", "○"],
  ["📷 숙제인증 확인", "○", "내 반", "○"],
  ["공지 작성 · 업무 지시", "○", "–", "–"],
];

export default function SettingsClient({ user }: { user: SessionUser }) {
  const isAdmin = hasRole(user, "ADMIN");
  const [alarmOn, setAlarmOn] = useState(true);
  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [formUrl, setFormUrl] = useState("");
  const [formMsg, setFormMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setAlarmOn(isAlarmEnabled());
    if (isAdmin) {
      apiGet<{ formUrl: string | null }>("/api/homework")
        .then((d) => setFormUrl(d.formUrl ?? ""))
        .catch((e) => setFormMsg({ ok: false, text: errorMessage(e) }));
    }
  }, [isAdmin]);

  const changePw = async () => {
    setPwMsg(null);
    if (pw !== pw2) return setPwMsg({ ok: false, text: "두 비밀번호가 달라요." });
    try {
      await apiPost("/api/auth/password", { current: cur, next: pw });
      setCur("");
      setPw("");
      setPw2("");
      setPwMsg({ ok: true, text: "비밀번호를 바꿨어요." });
    } catch (e) {
      setPwMsg({ ok: false, text: errorMessage(e) });
    }
  };

  const saveFormUrl = async () => {
    setFormMsg(null);
    try {
      await apiPost("/api/homework", { action: "FORM_URL", url: formUrl });
      setFormMsg({ ok: true, text: "저장했어요. 숙제 관리 › 숙제반 현황에서 「🔄 설문 응답 불러오기」를 누르세요." });
    } catch (e) {
      setFormMsg({ ok: false, text: errorMessage(e) });
    }
  };

  return (
    <div className="w-full space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <section className="card p-5">
          <h2 className="text-base font-bold text-ink">내 정보</h2>
          <div className="mt-4 space-y-2 text-sm">
            <Row label="이름 (= 아이디)" value={user.name} />
            <Row label="권한" value={rolesLabel(user.roles)} />
            <Row label="소속" value={`${DEPARTMENTS[user.department].dept} · ${DEPARTMENTS[user.department].branch}`} />
          </div>
          {isAdmin ? (
            <p className="mt-3 text-xs text-muted">
              계정 · 권한 · 강의실은 <Link href="/timetable?view=staff" className="font-semibold text-navy-700 underline">시간표 › 계정 · 강의실</Link>에서 관리해요.
            </p>
          ) : null}
        </section>

        <section className="card p-5">
          <h2 className="text-base font-bold text-ink">비밀번호 바꾸기</h2>
          <form
            className="mt-3 space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void changePw();
            }}
          >
            <input className="field" type="password" placeholder="지금 비밀번호" value={cur} onChange={(e) => setCur(e.target.value)} />
            <input className="field" type="password" placeholder="새 비밀번호 (4자 이상)" value={pw} onChange={(e) => setPw(e.target.value)} />
            <input className="field" type="password" placeholder="새 비밀번호 한 번 더" value={pw2} onChange={(e) => setPw2(e.target.value)} />
            <button type="submit" className="btn btn-primary w-full" disabled={!pw}>
              바꾸기
            </button>
            {pwMsg ? <div className={`text-sm font-semibold ${pwMsg.ok ? "text-present" : "text-alert"}`}>{pwMsg.text}</div> : null}
          </form>
        </section>

        <section className="card p-5">
          <h2 className="text-base font-bold text-ink">알림음</h2>
          <p className="mt-1 text-sm text-muted">출결 · 미션지 팝업이 뜨는 순간 울리고, 처리할 때까지 1분마다 3초씩 반복합니다.</p>
          <div className="mt-4 flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--color-navy-800)]"
                checked={alarmOn}
                onChange={(e) => {
                  setAlarmOn(e.target.checked);
                  setAlarmEnabled(e.target.checked);
                }}
              />
              알림음 사용
            </label>
            <button
              type="button"
              className="btn"
              onClick={() => {
                unlockAudio();
                playAlarm(3, true);
              }}
            >
              <IconVolume className="h-4 w-4" />
              미리듣기
            </button>
          </div>
        </section>

        {isAdmin ? (
          <section className="card p-5 xl:col-span-3">
            <h2 className="text-base font-bold text-ink">숙제반 신청 설문 응답 주소</h2>
            <p className="mt-1 text-sm text-muted">
              구글 설문 응답 시트 → <b>파일 › 공유 › 웹에 게시 → CSV</b> 로 만든 주소를 넣으면, 숙제 관리에서 신청 명단을 자동으로 불러와요.
              설문에는 <b>이름 · 반 · 요일</b>만 묻고, 연락처는 묻지 않아요 (앱에 저장하지 않음).
            </p>
            <div className="mt-3 flex gap-2">
              <input className="field" placeholder="https://docs.google.com/spreadsheets/d/e/…/pub?output=csv" value={formUrl} onChange={(e) => setFormUrl(e.target.value)} />
              <button type="button" className="btn btn-primary" onClick={() => void saveFormUrl()}>
                저장
              </button>
            </div>
            {formMsg ? <div className={`mt-2 text-sm font-semibold ${formMsg.ok ? "text-present" : "text-alert"}`}>{formMsg.text}</div> : null}
          </section>
        ) : null}

        <section className="card p-5 xl:col-span-3">
          <h2 className="text-base font-bold text-ink">권한</h2>
          <p className="mt-1 text-sm text-muted">한 사람이 권한을 여러 개 가질 수 있어요. 예) 안예슬 = 관리자 + 선생님 → 두 권한이 할 수 있는 일을 모두 해요.</p>
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs font-semibold text-muted">
                <th className="py-2">할 수 있는 일</th>
                <th className="w-28 py-2 text-center">관리자</th>
                <th className="w-28 py-2 text-center">선생님</th>
                <th className="w-28 py-2 text-center">데스크</th>
              </tr>
            </thead>
            <tbody>
              {PERMISSION_ROWS.map(([label, a, t, d]) => (
                <tr key={label} className="border-b border-line last:border-b-0">
                  <td className="py-2 text-ink">{label}</td>
                  <td className="py-2 text-center text-ink">{a}</td>
                  <td className="py-2 text-center text-ink">{t}</td>
                  <td className="py-2 text-center text-ink">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line pb-2 last:border-b-0">
      <span className="text-muted">{label}</span>
      <span className="font-semibold text-ink">{value}</span>
    </div>
  );
}

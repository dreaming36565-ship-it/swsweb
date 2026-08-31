# academy — 학원 관리 시스템 작업 규칙

**작업 전 `academy/HANDOFF.md` 를 먼저 읽을 것.** 확정된 요구사항·도메인 규칙·변경 이력이 전부 거기 있다.

## 실행
```bash
npm run dev --prefix academy     # http://localhost:3100
npm run build --prefix academy   # 타입체크 (작업 후 필수)
npm run seed --prefix academy    # DB 초기화 — dev 서버 끈 상태에서만
```

## 하드 룰

1. **`window.confirm()` / `alert()` 쓰지 말 것.** `useConfirm()` (`components/ConfirmDialog.tsx`) 사용.
   크롬의 "추가 대화 상자 표시 안 함" 때문에 버튼이 먹통이 된다.
2. **실패한 요청은 반드시 화면에 사유를 표시**한다. 조용히 무시 금지.
3. **시간은 분(minute) 정수**로 저장·계산한다. UI 입력은 **`<TimeSelect>` (오전/오후 + 10분 단위)** 만 사용.
   `<input type="time">` 금지.
   **화면 표기는 앱 전체가 오전/오후(12시간제)** — `fmtTime()` / `rangeLabel()` 을 쓴다.
   `toHHMM()` 은 내부용이니 화면에 쓰지 말 것.
4. **`lib/sr.ts`, `lib/conflicts.ts` 는 순수 함수**로 유지한다. DB 접근은 `lib/repo.ts` 에서만.
5. **`lib/repo.ts`·`lib/db.ts`·`lib/auth.ts`·`lib/seed.ts` 는 서버 전용.** 클라이언트 컴포넌트에서 import 금지.
6. **`node:sqlite` 는 null 프로토타입 객체를 돌려준다.** 서버 컴포넌트에서 클라이언트로 넘기려면
   `repo.ts` 의 `rows()`/`row()` 헬퍼를 반드시 거칠 것 (평범한 객체로 복사해 준다).
7. **스키마 변경 시 DB 재생성**이 필요하다(`CREATE TABLE IF NOT EXISTS`, 마이그레이션 없음).
8. **PC 가로형(Desktop First).** 페이지 컨테이너는 `w-full`, `max-w-[…]` 로 폭을 좁히지 말 것.
9. **색은 `globals.css` 의 `@theme` 토큰**만 쓴다. 하드코딩 금지.
   (navy / ink / muted / line / alert / present / late / **srpink**)
10. **`@types/node` 는 `^24` 이상 유지** — `node:sqlite` 타입 때문.
11. HANDOFF.md "바꾸면 안 되는 문구" 의 한국어 UI 카피를 임의로 수정하지 말 것.

## 도메인 핵심 (자세한 건 HANDOFF.md)

- 강의실 가로축 순서: `SR룸 · 1강 · 2강 · 3강 · 4강 · 대강의실` (부서 공용, `rooms.order_no`)
- SR 자동배정: **같은 반은 같은 열(세로줄)에 연속 배치**. 알파 강의실이 SR룸일 때만 배정
- SR 수동 이동: **학생 이용시간 전체가 비어 있는 좌석만** 가능
- 출결: 수업 시작 +2분 → 선생님 출석체크 → 데스크 출결전화 → 선생님 최종확인
- 출결 알림음: 팝업 시 + **제출 전까지 1분마다 3초**
- 학생은 이름·소속 반만 관리 (연락처·학교 없음). 학년·사용교재는 **반**이 갖는다
- 수업 종류: `공통 · 개별 · 정규 · 누적오답 · 알파`. **보강은 수업 종류가 아니다**
- 보강: 결석 1건마다 보강 여부를 추적한다(횟수제 수강료). `makeups` 테이블, `보강 관리` 탭
- 시간표 입력은 **요일 다중 선택** 가능 (월·수·금을 한 번에 생성)
- 확인창(`useConfirm`)은 **엔터로 확정**된다 — 이 동작을 없애지 말 것

## 마무리

작업 후 `npm run build` 로 타입체크하고, 브라우저에서 실제로 눌러 확인한다.

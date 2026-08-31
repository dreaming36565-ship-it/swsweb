# 인수인계 문서 — 학원 관리 시스템 (academy)

> 이 문서 하나로 다른 세션/계정에서 작업을 이어받을 수 있도록 정리했습니다.
> 새 세션 시작 시 이 파일과 `README.md` 를 먼저 읽으세요.

---

## 0. 새 세션 시작용 프롬프트 (복사해서 붙여넣기)

```
academy 폴더의 학원 관리 웹앱을 이어서 개발할 거야.
먼저 academy/HANDOFF.md 와 academy/README.md 를 읽고 현재 상태를 파악해줘.
그 다음 내가 요청하는 기능을 추가/수정하면 돼.

지켜야 할 것:
- 이미 확정된 기능을 임의로 삭제하거나 바꾸지 말 것 (HANDOFF.md의 "확정 사항" 참고)
- 기능 충돌이 생기면 먼저 알려줄 것
- PC 가로형(Desktop First), 흰 배경 + 네이비 디자인 유지
- 화면에 고정된 한국어 문구는 그대로 유지 (HANDOFF.md "바꾸면 안 되는 문구")
- 작업 후 npm run build 로 타입체크하고, 브라우저에서 실제로 눌러 확인할 것
```

---

## 1. 프로젝트 한 줄 요약

경기도 성남 분당서현의 학원(초중등부 **유투엠**, 고등부 **스터디킬러**)에서
직원들이 하루 종일 PC로 쓰는 업무 프로그램.
**반 편성 → 시간표 → SR(알파) 자리 자동배정 → 출결 3단계 워크플로우** 가 하나로 연결되어 있다.

## 2. 실행

**저장소**: `https://github.com/dreaming36565-ship-it/swsweb` (비공개, 브랜치 `main`)
작업 시작할 때 `git pull`, 끝낼 때 커밋 + `git push`. 한 번에 한 컴퓨터에서만 작업할 것.

> 예전 저장소 `sws-maker/shuttle-dashboard` 는 접근 권한이 없어 더 이상 쓰지 않는다. 12장 6회차 참고.

```bash
npm install --prefix academy     # 최초 1회
npm run dev --prefix academy     # http://localhost:3100
npm run build --prefix academy   # 타입체크 + 빌드
npm run seed --prefix academy    # DB 삭제 → 다음 실행 때 데모 데이터 재생성
```

- 루트의 `학원앱_실행.bat` 더블클릭으로도 실행 가능(설치까지 자동).
- **`npm run seed` 는 dev 서버를 끈 상태에서 실행**해야 한다. Windows가 DB 파일을 잠근다.
- 데모 계정 비밀번호는 전부 `1234` — `admin`(관리자 김도현) / `nayoung`(초중등 최나영) /
  `jihoon`(초중등 박지훈) / `field`(고등 정필드) / `seoyeon`(고등 한서연) / `desk`(데스크 이수민)

## 3. 기술 스택

| 항목 | 선택 | 이유 |
| --- | --- | --- |
| 프레임워크 | Next.js 16 App Router + React 19 + TypeScript | 단일 프로세스로 UI + API |
| 스타일 | Tailwind CSS v4 (`@theme` 토큰) | `src/app/globals.css` 한 곳에 디자인 토큰 |
| DB | **Node 24 내장 `node:sqlite`** | 네이티브 빌드 의존성 0. `better-sqlite3` 안 씀 |
| 인증 | httpOnly 쿠키 + HMAC 서명 | 사내망 전제의 단순 구현 |
| 실시간 | 폴링 (출결 4초 / 알림 8초 / 결석관리 5초) | SSE/WebSocket 아님 |
| 알림음 | Web Audio API | 오디오 파일 없음 |

> `@types/node` 는 반드시 `^24` 이상이어야 `node:sqlite` 타입이 잡힌다. 낮추지 말 것.

---

## 4. 확정 사항 (임의로 바꾸지 말 것)

### 4.1 학원 구조
- 초중등부 = **U2M 유투엠** / 지점명 **유투엠 분당서현**
- 고등부 = **STUDYKILLER** / 지점명 **스터디킬러 분당서현**
- 로그인한 직원의 소속 부서에 따라 사이드바·상단바 브랜드가 자동 전환

### 4.2 강의실 (시간표 가로축)
`SR룸 · 1강 · 2강 · 3강 · 4강 · 대강의실` 순서. 부서 공용(부서 구분 없음).
순서는 `rooms.order_no`, SR룸 식별은 `rooms.is_sr = 1`.
설정 › 강의실 관리에서 추가·이름수정·순서변경·삭제(SR룸은 삭제 불가).

### 4.3 SR룸
4열(A/B/C/D) × 6자리 = **24석**. `A1…A6, B1…B6, C1…C6, D1…D6`.

### 4.4 SR 자동배정 원칙
> **같은 반 친구들은 세로줄(같은 열)로 위아래 연속 배치**한다.

- 알파 강의실이 **SR룸인 경우에만** 좌석을 배정한다.
- 한 열에 다 못 앉히면 최소 개수의 열로 쪼갠다 (best-fit).
- 배치 순서: 알파 시작이 이른 순 → 인원 많은 반 순.
- 구현: `src/lib/sr.ts` `autoAssignSeats()` — **DB 의존 없는 순수 함수**.

### 4.5 SR 수동 이동 규칙 (핵심)
> **해당 학생의 SR 이용시간 전체 구간 동안 단 한 번도 다른 배정이 없는 좌석만** 이동 가능.

예) 17:10~18:00 이용 학생에게, 17:10엔 비었지만 17:30부터 다른 학생이 쓰는 좌석은 **이동 불가**.
색: 핑크 = 이동 가능 / 진한 네이비 = 선택 학생 / 흰색 = 사용 중 / 회색 = 이동 불가.
구현: `src/lib/sr.ts` `movableSeats()`.

### 4.6 출결 3단계 워크플로우
```
수업 시작 → +2분 → 담당 선생님 "출석체크해주세요."
  → [제출 완료] → 데스크 "출결전화 돌려주세요."
  → [저장 완료] → 담당 선생님 "출결사항 확인해주세요."
  → [확인 완료] → 종료(DONE)
```
- 상태 3종: **출석 / 결석 / 미체크**. 출석·결석 동시 체크 불가, 같은 걸 다시 누르면 미체크로 복귀.
- 결석 체크 시 **결석 사유 필수**.
- 데스크는 미체크 학생에게 전화 후 **지각 사유 + 도착예정시간** 입력 → 자동으로 `LATE` 처리.
- 팝업을 닫아도(`나중에`) 3분 뒤 다시 뜨고, 알림 종 아이콘·`알림 & 공지`에 기록이 남는다.

### 4.7 출결 알림음
- 팝업이 뜨는 순간 울리고, **제출 전까지 1분마다 3초씩** 반복.
- 적용 대상: `TEACHER_PENDING`(출석체크), `DESK_PENDING`(출결전화). 최종확인 단계는 제외.
- 팝업 오른쪽 위 `1분마다 알림` 버튼으로 그 팝업만 음소거. 설정에서 전체 on/off + 미리듣기.
- 구현: `src/lib/alarm.ts` + `src/components/useAlarmLoop.ts`.

### 4.8 시간 입력 · 표기
- 입력은 **오전/오후를 먼저 고르고 시:분을 고르는 방식**. 10분 단위만
  (`src/components/TimeSelect.tsx`, 오전 6:00 ~ 오후 11:50).
- **화면 표기는 앱 전체가 오전/오후(12시간제)** 다. 24시간 표기는 헷갈린다는 요청으로 쓰지 않는다.
  `fmtTime()` → `오후 2:40`, `rangeLabel()` → `오후 2:40 ~ 5:10` (`src/lib/time.ts`).
  `toHHMM()` 은 내부 저장·비교용이며 화면에 쓰지 말 것.
- 저장 형식은 여전히 **자정으로부터의 분(minute) 정수**. `toMin()` / `toHHMM()`.

### 4.9 권한
| 기능 | ADMIN | TEACHER | DESK |
| --- | :-: | :-: | :-: |
| 시간표 입력/수정/삭제 | ○ | – | – |
| 시간표·SR 조회 | ○ | ○ | ○ |
| SR 좌석 수동 이동 | ○ | ○ | ○ |
| 출석체크 제출 / 최종 확인 | ○ | 담당 수업만 | – |
| 출결전화 저장 | ○ | – | ○ |
| 반 생성/수정/삭제 | ○ | – | – |
| 강의실 생성/수정/삭제·순서 | ○ | – | – |
| 계정 생성/수정/삭제 | ○ | – | – |
| 학생 명단 추가/수정/삭제 | ○ | – | ○ |
| 공지 작성 · 업무 지시 | ○ | – | – |

정의 위치: `src/lib/auth.ts` `PERMISSIONS`

### 4.10 입력하지 않기로 한 것
- **학생·학부모 연락처** — 이 앱에서 관리하지 않음 (스키마에 없음)
- **학교** — 반에서도 없음. 반이 갖는 정보는 `학년`, `사용교재`.

### 4.11 바꾸면 안 되는 문구
| 위치 | 문구 |
| --- | --- |
| 로그인 | `스마트한 학원 관리의 시작` |
| 로그인 | `시간표, SR 관리, 학생 운영을 한 번에.` |
| 선생님 팝업 | `출석체크해주세요.` |
| 데스크 팝업 | `출결전화 돌려주세요.` |
| 데스크 팝업 하단 | `체크되지 않은 친구들 전화 돌려주시고, 지각사유와 도착예정시간 남겨주세요.` |
| 선생님 최종 팝업 | `출결사항 확인해주세요.` |
| 사이드바 메뉴 | `결석관리` (출결관리 아님) |
| 사이드바 메뉴 | `보강 관리` |
| 시간표 입력 버튼 | `입력완료` |

### 4.12 수업 종류
`공통 · 개별 · 정규 · 누적오답 · 알파` 5종 (`SESSION_TYPE_LABEL`).
DB 값은 `COMMON`, `INDIVIDUAL`, `REGULAR`, `REVIEW`, `ALPHA`.
**보강은 수업 종류가 아니다** — 보강은 `보강 관리` 탭에서 날짜 단위로 따로 관리한다(4.14).

### 4.13 시간표 입력의 요일 다중 선택
같은 수업이 주 2~3회인 경우가 많아, 시간표 입력에서 **요일을 여러 개 선택**하면
한 번의 `입력완료` 로 그 요일들에 같은 수업이 모두 생성된다.
수정 모드에서는 요일을 하나만 고를 수 있다(그 수업 1건만 바뀐다).

### 4.14 보강 관리 (핵심)
> 횟수로 수강료를 받기 때문에 **결석 1건마다 보강이 이루어졌는지** 반드시 추적해야 한다.

- 사이드바 메뉴명은 **`보강 관리`**.
- `결석관리`에서 **결석**으로 처리된 건이 자동으로 "보강이 필요한 결석" 목록에 쌓인다.
- `보강 잡기` → 날짜·시간·강의실·담당 선생님을 넣으면 보강 1건이 등록되고 그 결석과 연결된다
  (같은 결석에 보강을 두 번 등록할 수 없다).
- 등록한 보강은 **담당 선생님의 대시보드 "오늘의 일정"** 과 **시간표 관리**(해당 요일, 앰버 점선 블록)에 표시된다.
- 상태는 `예정 / 완료 / 취소`. 보강을 진행하면 `완료` 로 체크한다.
- 정규 시간표(`timetable_sessions`)와는 **별도 테이블(`makeups`)** 이다.
  요일 반복이 아니라 특정 날짜 1회이기 때문.

### 4.15 확인창은 엔터로 확정
`useConfirm()` 확인창이 뜨면 **확인 버튼에 포커스가 잡히고, 엔터를 누르면 바로 확정**된다(취소는 ESC).
마우스로 일일이 누르지 않기 위한 것이므로 이 동작을 없애지 말 것.

---

## 5. 화면 구성 (사이드바 순서)

| 경로 | 메뉴 | 파일 |
| --- | --- | --- |
| `/login` | 로그인 | `app/login/LoginForm.tsx` |
| `/dashboard` | 대시보드 | `app/(app)/dashboard/page.tsx` |
| `/timetable` | 시간표 관리 | `components/timetable/TimetableClient.tsx` |
| `/sr` | SR 관리 | `components/sr/SrClient.tsx` |
| `/classes` | 반 관리 | `components/classes/ClassesClient.tsx` |
| `/attendance` | 결석관리 | `components/attendance/AttendanceClient.tsx` |
| `/makeup` | 보강 관리 | `components/makeup/MakeupClient.tsx` |
| `/notices` | 알림 & 공지 | `components/NoticesClient.tsx` |
| `/tasks` | 업무 지시 | `components/TasksClient.tsx` |
| `/settings` | 설정 | `components/settings/SettingsClient.tsx` |

- 대시보드: 인사 문구 + **우측 큰 실시간 시계**, 가로 3열(오늘의 일정 / 오늘의 할 일 / 오늘 출결 처리 현황) + 최근 공지 3열
- 시간표 관리: **왼쪽 입력(300px) / 오른쪽 시간표** 2분할. `입력완료` 하면 오른쪽에 즉시 반영
- 반 관리: 상단 가로 폼(새 반 만들기) + 넓은 표(인라인 수정/삭제) + 오른쪽 학생 명단

## 6. 파일 지도

```
academy/src/
├─ app/
│  ├─ layout.tsx              루트 레이아웃 (Pretendard CDN)
│  ├─ page.tsx                / → /dashboard 또는 /login 리다이렉트
│  ├─ globals.css             ★ 디자인 토큰(@theme) + .card/.btn/.field 유틸
│  ├─ login/                  로그인 화면
│  ├─ (app)/                  로그인 후 라우트 그룹 (layout이 인증 가드)
│  └─ api/                    REST 엔드포인트 (아래 7장)
├─ components/
│  ├─ AppShell.tsx            ★ 사이드바 + 상단바 + 출결 팝업 호스트 + 오디오 unlock
│  ├─ BrandLogo.tsx           로고 PNG 없으면 대체 마크
│  ├─ Combobox.tsx            ★ 선택 + 직접입력(신규 생성) 겸용 입력창
│  ├─ TimeSelect.tsx          ★ 10분 단위 시각 선택
│  ├─ ConfirmDialog.tsx       ★ useConfirm() — window.confirm 대체
│  ├─ UserFormModal.tsx       계정 추가/수정 (아이디 직접 부여)
│  ├─ Modal.tsx / Icons.tsx / LiveClock.tsx / NotificationBell.tsx / DashboardTasks.tsx
│  ├─ useAlarmLoop.ts         ★ 1분마다 3초 알림음 루프
│  ├─ attendance/             출결 팝업 3종 + PopupFrame + AttendanceHost + 결석관리 페이지
│  ├─ makeup/                 보강 관리 화면
│  ├─ classes/ settings/ sr/ timetable/
└─ lib/
   ├─ db.ts                   ★ 스키마 + SQLite 연결 (싱글턴)
   ├─ seed.ts                 데모 시드 + rebuildSrForDay()
   ├─ repo.ts                 ★ 모든 도메인 쿼리 + 기준정보 CRUD (가장 큰 파일)
   ├─ sr.ts                   ★ SR 자동배정 / 이동가능 좌석 (순수 함수)
   ├─ conflicts.ts            ★ 시간표 충돌 감지 (순수 함수)
   ├─ auth.ts                 세션 + PERMISSIONS
   ├─ api.ts                  withUser() 래퍼 + ok()/fail()
   ├─ http.ts                 클라이언트 fetch 래퍼 (한국어 오류 메시지)
   ├─ errors.ts               AppError / assert()
   ├─ alarm.ts                Web Audio 알림음
   ├─ time.ts                 분 단위 시간 유틸 + 그리드 상수
   ├─ types.ts                공통 타입 + DEPARTMENTS/ROLE_LABEL
   └─ colors.ts               반별 구분 색
```

## 7. API 목록

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| POST | `/api/auth/login` `/logout` · GET `/me` | 세션 |
| GET | `/api/timetable?day=&dept=` | 시간표 + 강의실/반/선생님/SR배정/충돌 한 번에 |
| POST/PATCH/DELETE | `/api/timetable/session` | 수업 CRUD (ADMIN). POST 는 `days: number[]` 로 여러 요일 동시 생성 |
| GET | `/api/sr?day=&dept=` | 좌석 배정 |
| GET | `/api/sr/options?assignmentId=` | 이동 가능 좌석 |
| POST | `/api/sr/move` · `/api/sr/reset` | 좌석 이동 / 요일 자동배정 재계산 |
| GET | `/api/attendance/pending` | **4초 폴링** — tick + 내가 처리할 팝업 |
| POST | `/api/attendance/submit` | `step: TEACHER \| DESK \| CONFIRM` 단계 전이 |
| POST | `/api/attendance/trigger` | 수동으로 출결 즉시 열기 |
| GET | `/api/attendance/list?date=&dept=` | 결석관리 페이지 |
| GET/POST/PATCH/DELETE | `/api/makeups?dept=&unfinished=` | 보강 CRUD + 보강이 필요한 결석 목록 |
| GET/POST/PATCH/DELETE | `/api/classes` | 반 CRUD (payload에 rooms/teachers/students 동봉) |
| GET/POST/PATCH/DELETE | `/api/rooms` | 강의실 CRUD (`move: -1\|1` 로 순서 변경) |
| GET/POST/PATCH/DELETE | `/api/users` | 계정 CRUD (ADMIN) |
| GET/POST/PATCH/DELETE | `/api/students` | 학생 CRUD |
| GET/POST | `/api/notices` · GET/POST `/api/notifications` · GET/POST/PATCH/DELETE `/api/tasks` | |

응답 형식은 항상 `{ ok: true, data }` 또는 `{ ok: false, error: "한국어 메시지" }`.

## 8. DB 스키마

```
users(id, login_id UNIQUE, password, name, role, department, active)
rooms(id, name, order_no, is_sr)
classes(id, name, department, teacher_id→users, room_id→rooms, grade, textbook)
students(id, name, department, class_id→classes, active)
timetable_sessions(id, day_of_week 0=일, class_id, type, start_min, end_min,
                   alpha_start_min, alpha_end_min, room_id, alpha_room_id, teacher_id)
sr_assignments(id, session_id, student_id, day_of_week, seat, start_min, end_min, is_manual)
attendance_events(id, session_id, date, stage, created_at, updated_at)  UNIQUE(session_id,date)
attendance_records(id, event_id, student_id, status, absent_reason, late_reason, eta)
notifications(id, user_id, kind, title, body, link, read_at, created_at)
tasks(id, assignee_id, created_by, title, done, due_date, created_at)
notices(id, title, body, department, author_id, created_at)
makeups(id, student_id, class_id, absent_date, date, start_min, end_min,
        room_id, teacher_id, note, status, created_at)
```

- `role`: `ADMIN | TEACHER | DESK`
- `department`: `ELEM | HIGH`
- `type`: `COMMON | INDIVIDUAL | REGULAR | REVIEW | ALPHA`
- `stage`: `TEACHER_PENDING → DESK_PENDING → TEACHER_CONFIRM → DONE`
- `attendance_records.status`: `UNCHECKED | PRESENT | ABSENT | LATE`
- `makeups.status`: `PLANNED | DONE | CANCELED`

## 9. 디자인 시스템

`src/app/globals.css` 의 `@theme` 에 토큰이 있다. 색을 하드코딩하지 말 것.

| 토큰 | 용도 |
| --- | --- |
| `navy-50…950` | 메인 컬러 (사이드바 `navy-900`, 주요 버튼 `navy-800`) |
| `ink` / `muted` / `line` / `canvas` | 본문 / 보조 텍스트 / 테두리 / 페이지 배경 |
| `alert` / `alert-soft` | 결석·충돌·삭제 (레드) |
| `present` / `present-soft` | 출석 (블루) |
| `late` / `late-soft` | 지각 (앰버) |
| `srpink` / `srpink-soft` | **이동 가능 SR 좌석 (핑크)** |

- 커스텀 유틸: `.card` `.btn` `.btn-primary` `.btn-ghost` `.btn-danger` `.field` `.label` `.pop-in` `.fade-in`
- **PC 가로형** — 페이지 컨테이너는 `w-full`. `max-w-[…]` 로 폭을 좁히지 말 것.
- 폰트: Pretendard (CDN, `app/layout.tsx`). 오프라인이면 시스템 한글 폰트로 대체됨.

---

## 10. 작업 시 반드시 지킬 것 (gotchas)

1. **`window.confirm()` / `alert()` 금지.**
   크롬에서 "이 페이지에서 추가 대화 상자를 표시하지 않음"을 한 번 체크하면 이후 항상 취소로
   처리되어 버튼이 먹통이 된다(실제로 겪은 버그). `useConfirm()` (`components/ConfirmDialog.tsx`) 사용.
2. **실패한 요청은 반드시 화면에 사유를 표시**한다. 조용히 무시하지 말 것.
3. **스키마를 바꾸면 DB를 재생성**해야 한다. `CREATE TABLE IF NOT EXISTS` 라 자동 마이그레이션이 없다.
   → dev 서버 종료 → `npm run seed` → 재시작.
4. **시간은 항상 분(minute) 정수**로 다룬다. 문자열 `"14:40"` 은 UI 입출력에서만.
5. **시간 입력은 `<TimeSelect>` 만 사용**한다. `<input type="time">` 은 임의 분 단위가 들어간다.
6. **SR 재계산 타이밍** — 수업 생성/수정/삭제, 학생 추가/반 이동/삭제 시 해당 요일이 자동 재계산되고
   **그 요일의 수동 이동은 초기화**된다. 의도된 동작이지만 새 기능 만들 때 유의.
7. **순수 함수 유지** — `sr.ts`, `conflicts.ts` 는 DB를 몰라야 한다. DB 접근은 `repo.ts` 에서만.
8. **`repo.ts`·`db.ts`·`auth.ts`·`seed.ts` 는 서버 전용**이다. 클라이언트 컴포넌트에서 import 하면 빌드가 깨진다.
   클라이언트가 쓰는 건 `types.ts` / `time.ts` / `sr.ts` / `colors.ts` / `alarm.ts` / `http.ts` 정도.
9. **`node:sqlite` 는 null 프로토타입 객체를 돌려준다.** 그대로 클라이언트 컴포넌트에 넘기면
   React 가 거부한다. `repo.ts` 의 `rows()`/`row()` 헬퍼가 평범한 객체로 복사해 주므로 반드시 그걸 통할 것.
10. **부서(dept) 필터는 `ALL` 문자열**을 쓴다.
11. **강의실은 부서 무관**이다.
12. 출결 이벤트는 **`/api/attendance/pending` 이 호출될 때만** 생성된다(폴링 시점 tick).
    아무도 앱을 켜두지 않으면 그 시간 이벤트가 안 열린다 — 알려진 한계(11.3 참고).
13. 작업 후 **`npm run build`** 로 타입체크하고, 브라우저에서 실제로 눌러 확인할 것.

---

## 11. 남은 일 / 알려진 한계

### 11.1 바로 해야 할 것
- **로고 파일 미투입** — `public/logos/u2m.png`, `public/logos/studykiller.png` 를 넣어야 원본 로고가 뜬다.
  없으면 `BrandLogo.tsx` 의 대체 마크(U2M / SK)가 표시된다.

### 11.2 보안 (사내망 전제로 미루어 둔 것)
- 비밀번호가 **평문 저장**이다(`users.password`). 해싱(bcrypt/argon2) 미적용.
- 세션 쿠키는 HMAC 서명만 하며 만료가 12시간 고정이다.
- `비밀번호 찾기` 는 안내 문구만 뜨고 실제 재설정 기능이 없다.

### 11.3 기능 한계
- 실시간이 **폴링**(출결 4초, 알림 8초, 결석관리 5초). SSE/WebSocket 아님.
- 출결 자동 트리거가 접속 중일 때만 동작(위 gotcha 12번). 서버 크론이 필요하면 별도 구현.
- 학생은 **반 1개에만** 소속(`students.class_id` 단일). 복수 반 수강 미지원.
- 수업 종류(공통/개별/누적오답)별 세부 로직 없음 — 라벨과 색만 다름.
- 보강은 **강의실·선생님 충돌을 검사하지 않는다.** 정규 시간표와 겹쳐도 경고가 뜨지 않는다.
- 시간표 관리에는 **오늘 이후의 예정 보강**만 그 요일에 표시된다(지난 보강은 보강 관리에서 본다).
- 출결 통계·기간별 리포트·엑셀 내보내기 없음.
- 모바일 대응 없음(의도적, Desktop First).
- 자동화 테스트 없음. 브라우저 수동 검증으로만 확인했다.
- 시간표에서 선생님은 **기존 계정 중에서만** 고를 수 있다(아이디가 필요해서). 반·강의실은 직접 입력으로 새로 만들 수 있다.

### 11.4 아직 확정 안 된 것
- 역할별 세부 권한 체계 확장 (현재는 3역할 고정)
- 알림 팝업/알림함의 보관 기간·정리 정책

---

## 12. 지금까지의 변경 이력 (요약)

| 회차 | 내용 |
| --- | --- |
| 1 | 최초 구현 — 로그인/대시보드/시간표 3분할/SR 24석/출결 3단계/알림/업무지시/설정 |
| 2 | 모든 선택 항목에 **직접 입력(신규 생성)** 추가, 설정에 계정·반·강의실 관리, **아이디 직접 부여** |
| 3 | **PC 가로형** 전면 적용, 학생 관리 → **반 관리** 로 교체, 시간표 2분할 + 알파 강의실 선택, 강의실 축을 `SR룸·1강·2강·3강·4강·대강의실` 로 재구성, 연락처 필드 제거 |
| 4 | 반 관리에서 학교 제거, 학생 명단 **수정+삭제**, `window.confirm` → **앱 내부 확인 모달**(삭제 먹통 버그 수정), 시간표 입력에 **요일 선택** 추가 |
| 5 | 시간 입력 **10분 단위 드롭다운**, 출결 팝업 **알림음**(팝업 시 + 제출 전까지 1분마다 3초), 시간표 세로축 범위 자동 조정(토요일 오전 수업 표시 수정) |
| 6 | **2026-09-01 — 소스 코드 재구축.** 원본 저장소(`sws-maker/shuttle-dashboard`)에 접근할 수 없어, 이 문서와 `CLAUDE.md`·기획 프롬프트를 근거로 앱 전체를 새로 구현했다. 확정 사항·고정 문구·DB 스키마·API 목록·디자인 토큰은 문서대로 복원했다. 아래 "13. 재구축 시 달라진 점" 참고 |
| 7 | **2026-09-01 — 시간 표기·수업 종류·보강 관리.** 시간 입력을 오전/오후 분리 방식으로 바꾸고 **앱 전체 표기를 12시간제**로 통일. 수업 종류를 `공통·개별·정규·누적오답·알파` 로 교체(보강 제외). 시간표 입력에 **요일 다중 선택** 추가. **`보강 관리` 탭 신설**(결석↔보강 추적, `makeups` 테이블). 확인창을 **엔터로 확정** 가능하게 함 |

## 13. 재구축(6회차) 시 달라진 점

문서에 남아 있지 않던 세부 구현은 새로 판단해서 만들었다. 원본과 다를 수 있는 부분:

- **데모 데이터가 다르다.** 반 7개 / 학생 35명 / 주간 시간표를 새로 짰다.
  (월·수·금 = 5A1·5B2·중2A·고1수학A·고1영어A / 화·목 = 6A1·중2A·고2수학B / 토 = 6A1·고2수학B 오전)
- **시간표 블록 클릭 → 왼쪽 폼에서 수정·삭제** 하는 방식으로 만들었다.
- **결석관리 화면이 5초마다 자동 갱신**된다(팝업에서 다른 사람이 처리한 결과가 바로 보이도록).
- **SR 관리에 "기준 시각" 선택**을 두어, 그 시각에 앉아 있는 학생 기준으로 자리배치도를 그린다.
- 알림음 파형(삐-삐- 2음, 0.75초 주기)은 새로 만든 것이다.
- 원본에 있던 `lib/api.ts` 의 세부 시그니처, 컴포넌트 내부 구조는 문서의 역할 설명만 맞추었다.

## 14. 검증 방법 (수동)

```bash
npm run build --prefix academy   # 타입체크
npm run dev --prefix academy
```

브라우저에서 확인할 핵심 시나리오:

1. **SR 자동배정** — `admin` 로그인 → SR 관리 → 월요일 / 기준 시각 `17:30` →
   A열=고1수학A, B열=5A1, C열=5B2, D열=고1영어A 처럼 **반별 세로줄**이면 정상.
2. **SR 이동 규칙** — 위 화면에서 B1 김서준(17:10~18:00) 클릭 → 이동 가능 좌석이 `A6 B6 C6 D6` 네 곳만
   핑크로 뜨면 정상. A1~A5는 지금 비어 보여도 이용시간이 겹쳐 이동 불가다.
3. **출결 워크플로우** — 결석관리 → 오른쪽 `지금 열기` → `출석체크해주세요.` 팝업 →
   결석만 체크하고 사유를 비우면 경고가 뜨는지 → `제출 완료` → `출결전화 돌려주세요.` →
   지각 사유·도착예정시간 입력 → `저장 완료` → `출결사항 확인해주세요.` → `확인 완료`.
4. **알림음 반복** — 팝업을 제출하지 않고 1분 기다리면 다시 3초 울리는지.
5. **충돌 감지** — 화요일에 5A1 수업을 `3강 15:00~17:00 / 최나영` 으로 하나 더 넣으면
   상단에 빨간 경고 바로 강의실 중복·선생님 중복 2건이 뜬다. 지우면 0건으로 돌아온다.

끝나면 `npm run seed` 로 데모 데이터를 되돌려 두면 깔끔하다.

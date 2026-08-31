# shuttle-dashboard

이 저장소에는 아래 앱이 들어 있습니다.

| 폴더 | 앱 | 설명 |
| --- | --- | --- |
| [`academy/`](academy) | 학원 관리 시스템 | 시간표 · SR(알파) 자리배정 · 출결 워크플로우 · 업무 지시 (PC 업무용 웹앱) |

## 빠르게 실행하기

Windows 라면 **`학원앱_실행.bat` 를 더블클릭**하면 설치부터 실행까지 자동으로 됩니다.

명령어로 실행하려면:

```bash
npm install --prefix academy
```

```bash
npm run dev --prefix academy
```

→ http://localhost:3100 · 계정 `admin` / `1234`

> **Node.js 24 이상**이 필요합니다. DB로 Node 내장 `node:sqlite` 를 쓰기 때문입니다.
> https://nodejs.org 에서 LTS 버전을 받으면 됩니다.

## 문서

- [`academy/README.md`](academy/README.md) — 앱 사용 설명, 화면 구성, 핵심 자동화
- [`academy/HANDOFF.md`](academy/HANDOFF.md) — **인수인계 문서.** 확정 사항, 도메인 규칙, 주의점, 변경 이력
- [`CLAUDE.md`](CLAUDE.md) — 이 저장소에서 작업할 때의 규칙

## 옮겨지지 않는 것

- **입력한 데이터** (`academy/data/academy.db`) — 실제 학생 정보라 git에 올리지 않습니다.
  다른 PC로 옮기려면 이 파일을 직접 복사하세요. 없으면 연습용 데모 데이터로 시작합니다.
- **로고 이미지** — `academy/public/logos/u2m.png`, `studykiller.png` 를 넣으면 자동 반영됩니다.
  없으면 임시 대체 마크가 표시됩니다.

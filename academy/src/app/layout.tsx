import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "학원 관리 시스템 — 유투엠 분당서현 / 스터디킬러 분당서현",
  description: "시간표 · SR 자리배정 · 출결 워크플로우를 하나로 묶은 학원 업무 프로그램",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* Pretendard — 오프라인이면 시스템 한글 폰트로 대체된다 */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

import type { MetadataRoute } from "next";

// 📌 앱으로 설치(PWA) — 크롬이 학원앱을 따로 된 창 · 바탕화면 아이콘으로 설치할 수 있게 (설정 › 🔔 윈도우 알림)
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "학원앱 — 유투엠 · 스터디킬러 분당서현",
    short_name: "학원앱",
    description: "시간표 · SR 자리 · 출결 업무 프로그램",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#24325a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}

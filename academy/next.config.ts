import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: false,
  // 작업 규칙은 저장소 루트의 CLAUDE.md 에 직접 관리한다 (자동 생성 끔)
  agentRules: false,
};

export default nextConfig;

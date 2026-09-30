// npm start — 이 컴퓨터에서는 http://127.0.0.1:3100 (이 컴퓨터에서만),
// 배포 서버(Railway 가 PORT 를 알려줌)에서는 0.0.0.0:PORT (인터넷에서 접속).
// 시간은 항상 한국 시간 — 서버가 외국에 있어도 출결 시각이 맞게.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const next = require.resolve("next/dist/bin/next");
const server = !!process.env.PORT;
const args = ["start", "-H", server ? "0.0.0.0" : "127.0.0.1", "-p", process.env.PORT || "3100"];

const child = spawn(process.execPath, [next, ...args], {
  stdio: "inherit",
  env: { ...process.env, TZ: "Asia/Seoul" },
});
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
child.on("exit", (code) => process.exit(code ?? 0));

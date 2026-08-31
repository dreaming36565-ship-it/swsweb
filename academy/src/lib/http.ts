// 클라이언트에서 API를 부르는 얇은 래퍼.
// 실패 사유는 항상 한국어 메시지로 던진다 — 화면에 그대로 표시할 것.

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: "same-origin", ...init });
  } catch {
    throw new Error("서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  let json: ApiResponse<T> | null = null;
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    json = null;
  }
  if (!json) throw new Error("서버 응답을 읽지 못했습니다.");
  if (json.ok !== true) throw new Error(json.error || "요청을 처리하지 못했습니다.");
  return json.data;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const apiGet = <T>(url: string) => request<T>(url);
export const apiPost = <T>(url: string, body: unknown) => request<T>(url, jsonInit("POST", body));
export const apiPatch = <T>(url: string, body: unknown) => request<T>(url, jsonInit("PATCH", body));
export const apiDelete = <T>(url: string, body: unknown) => request<T>(url, jsonInit("DELETE", body));

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.";
}

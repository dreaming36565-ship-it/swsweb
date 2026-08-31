/** 사용자에게 그대로 보여줄 한국어 메시지를 담는 오류 */
export class AppError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}

export function assert(cond: unknown, message: string, status = 400): asserts cond {
  if (!cond) throw new AppError(message, status);
}

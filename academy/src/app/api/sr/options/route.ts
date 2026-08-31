import { numParam, withUser } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { srMoveOptions } from "@/lib/repo";

export const GET = withUser(({ req }) => {
  const id = numParam(req, "assignmentId");
  if (!id) throw new AppError("좌석 배정을 찾을 수 없습니다.");
  return { seats: srMoveOptions(id) };
});

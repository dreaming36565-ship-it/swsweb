"use client";

// 반 관리 — 상단 가로 폼(새 반 만들기) + 넓은 표(인라인 수정/삭제) + 오른쪽 학생 명단.
// 학생은 이름·소속 반만 관리한다(연락처·학교 없음). 학년·사용교재는 반이 갖는다.

import { useCallback, useEffect, useState } from "react";
import { useConfirm } from "../ConfirmDialog";
import { IconPencil, IconPlus, IconTrash } from "../Icons";
import { apiDelete, apiGet, apiPatch, apiPost, errorMessage } from "@/lib/http";
import { DEPARTMENTS, type ClassRow, type Department, type Room, type SessionUser, type Student } from "@/lib/types";

type Payload = {
  classes: ClassRow[];
  rooms: Room[];
  teachers: { id: number; name: string; department: Department }[];
  students: Student[];
};

type Draft = {
  name: string;
  department: Department;
  teacherId: number | null;
  roomId: number | null;
  grade: string;
  textbook: string;
};

const emptyDraft = (department: Department): Draft => ({
  name: "",
  department,
  teacherId: null,
  roomId: null,
  grade: "",
  textbook: "",
});

export default function ClassesClient({ user }: { user: SessionUser }) {
  const confirm = useConfirm();
  const canEditClass = user.role === "ADMIN";
  const canEditStudent = user.role === "ADMIN" || user.role === "DESK";

  const [data, setData] = useState<Payload | null>(null);
  const [dept, setDept] = useState<"ALL" | Department>("ALL");
  const [draft, setDraft] = useState<Draft>(emptyDraft(user.department));
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft(user.department));
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [newStudent, setNewStudent] = useState("");
  const [editStudentId, setEditStudentId] = useState<number | null>(null);
  const [editStudentName, setEditStudentName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const payload = await apiGet<Payload>(`/api/classes?dept=${dept}`);
      setData(payload);
      setSelectedClassId((cur) =>
        cur && payload.classes.some((c) => c.id === cur) ? cur : (payload.classes[0]?.id ?? null),
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [dept]);

  useEffect(() => {
    void load();
  }, [load]);

  const classes = data?.classes ?? [];
  const rooms = data?.rooms ?? [];
  const teachers = data?.teachers ?? [];
  const students = (data?.students ?? []).filter((s) => s.classId === selectedClassId);
  const selectedClass = classes.find((c) => c.id === selectedClassId) ?? null;

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const createClass = () =>
    run(async () => {
      await apiPost("/api/classes", {
        name: draft.name,
        department: draft.department,
        teacherId: draft.teacherId,
        roomId: draft.roomId,
        grade: draft.grade,
        textbook: draft.textbook,
      });
      setDraft(emptyDraft(user.department));
    });

  const saveEdit = () =>
    run(async () => {
      await apiPatch("/api/classes", { id: editingId, ...editDraft });
      setEditingId(null);
    });

  const removeClass = async (c: ClassRow) => {
    const yes = await confirm({
      title: "반을 삭제할까요?",
      message: `${c.name} 반과 그 반의 시간표가 함께 지워집니다. 학생은 소속 없음으로 남습니다.`,
      confirmText: "삭제",
      danger: true,
    });
    if (yes) void run(() => apiDelete("/api/classes", { id: c.id }));
  };

  const addStudent = () =>
    run(async () => {
      await apiPost("/api/students", {
        name: newStudent,
        department: selectedClass?.department ?? user.department,
        classId: selectedClassId,
      });
      setNewStudent("");
    });

  const removeStudent = async (s: Student) => {
    const yes = await confirm({
      title: "학생을 삭제할까요?",
      message: `${s.name} 학생을 명단에서 지웁니다. 해당 요일의 SR 자리도 다시 계산됩니다.`,
      confirmText: "삭제",
      danger: true,
    });
    if (yes) void run(() => apiDelete("/api/students", { id: s.id }));
  };

  return (
    <div className="w-full space-y-4">
      {/* 새 반 만들기 — 상단 가로 폼 */}
      {canEditClass ? (
        <section className="card p-5">
          <h2 className="text-base font-bold text-ink">새 반 만들기</h2>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <Field label="반 이름" width="w-40">
              <input
                className="field"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="예) 5A1"
              />
            </Field>
            <Field label="부서" width="w-32">
              <select
                className="field"
                value={draft.department}
                onChange={(e) => setDraft({ ...draft, department: e.target.value as Department })}
              >
                <option value="ELEM">초중등부</option>
                <option value="HIGH">고등부</option>
              </select>
            </Field>
            <Field label="담당 선생님" width="w-36">
              <select
                className="field"
                value={draft.teacherId ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, teacherId: e.target.value === "" ? null : Number(e.target.value) })
                }
              >
                <option value="">선택</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="강의실" width="w-32">
              <select
                className="field"
                value={draft.roomId ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, roomId: e.target.value === "" ? null : Number(e.target.value) })
                }
              >
                <option value="">선택</option>
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="학년" width="w-28">
              <input
                className="field"
                value={draft.grade}
                onChange={(e) => setDraft({ ...draft, grade: e.target.value })}
                placeholder="예) 초5"
              />
            </Field>
            <Field label="사용교재" width="w-44">
              <input
                className="field"
                value={draft.textbook}
                onChange={(e) => setDraft({ ...draft, textbook: e.target.value })}
                placeholder="예) 개념원리 5-1"
              />
            </Field>
            <button type="button" className="btn btn-primary" onClick={() => void createClass()} disabled={busy}>
              <IconPlus className="h-4 w-4" />
              반 추가
            </button>
          </div>
        </section>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-alert bg-alert-soft px-5 py-3 text-sm font-semibold text-alert">
          {error}
        </div>
      ) : null}

      <div className="flex w-full gap-4">
        {/* 반 목록 */}
        <section className="card min-w-0 flex-1 overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-base font-bold text-ink">반 목록</h2>
            <select
              className="field w-36"
              value={dept}
              onChange={(e) => setDept(e.target.value as "ALL" | Department)}
            >
              <option value="ALL">전체 부서</option>
              <option value="ELEM">초중등부</option>
              <option value="HIGH">고등부</option>
            </select>
          </div>

          <div className="overflow-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-b border-line bg-navy-50 text-left text-xs font-semibold text-muted">
                  <th className="px-4 py-2.5">반 이름</th>
                  <th className="px-4 py-2.5">부서</th>
                  <th className="px-4 py-2.5">담당 선생님</th>
                  <th className="px-4 py-2.5">강의실</th>
                  <th className="px-4 py-2.5">학년</th>
                  <th className="px-4 py-2.5">사용교재</th>
                  <th className="px-4 py-2.5 text-center">학생</th>
                  {canEditClass ? <th className="w-28 px-4 py-2.5" /> : null}
                </tr>
              </thead>
              <tbody>
                {classes.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted">
                      등록된 반이 없습니다.
                    </td>
                  </tr>
                ) : (
                  classes.map((c) =>
                    editingId === c.id ? (
                      <tr key={c.id} className="border-b border-line bg-navy-50/50">
                        <td className="px-4 py-2">
                          <input
                            className="field"
                            value={editDraft.name}
                            onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                          />
                        </td>
                        <td className="px-4 py-2">
                          <select
                            className="field"
                            value={editDraft.department}
                            onChange={(e) =>
                              setEditDraft({ ...editDraft, department: e.target.value as Department })
                            }
                          >
                            <option value="ELEM">초중등부</option>
                            <option value="HIGH">고등부</option>
                          </select>
                        </td>
                        <td className="px-4 py-2">
                          <select
                            className="field"
                            value={editDraft.teacherId ?? ""}
                            onChange={(e) =>
                              setEditDraft({
                                ...editDraft,
                                teacherId: e.target.value === "" ? null : Number(e.target.value),
                              })
                            }
                          >
                            <option value="">선택</option>
                            {teachers.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2">
                          <select
                            className="field"
                            value={editDraft.roomId ?? ""}
                            onChange={(e) =>
                              setEditDraft({
                                ...editDraft,
                                roomId: e.target.value === "" ? null : Number(e.target.value),
                              })
                            }
                          >
                            <option value="">선택</option>
                            {rooms.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2">
                          <input
                            className="field"
                            value={editDraft.grade}
                            onChange={(e) => setEditDraft({ ...editDraft, grade: e.target.value })}
                          />
                        </td>
                        <td className="px-4 py-2" colSpan={2}>
                          <input
                            className="field"
                            value={editDraft.textbook}
                            onChange={(e) => setEditDraft({ ...editDraft, textbook: e.target.value })}
                          />
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex gap-1">
                            <button type="button" className="btn px-2 py-1 text-xs" onClick={() => void saveEdit()}>
                              저장
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost px-2 py-1 text-xs"
                              onClick={() => setEditingId(null)}
                            >
                              취소
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr
                        key={c.id}
                        onClick={() => setSelectedClassId(c.id)}
                        className={`cursor-pointer border-b border-line last:border-b-0 hover:bg-navy-50 ${
                          selectedClassId === c.id ? "bg-navy-50" : ""
                        }`}
                      >
                        <td className="px-4 py-2.5 font-semibold text-ink">{c.name}</td>
                        <td className="px-4 py-2.5 text-muted">{DEPARTMENTS[c.department].dept}</td>
                        <td className="px-4 py-2.5 text-ink">{c.teacherName ?? "—"}</td>
                        <td className="px-4 py-2.5 text-ink">{c.roomName ?? "—"}</td>
                        <td className="px-4 py-2.5 text-ink">{c.grade ?? "—"}</td>
                        <td className="px-4 py-2.5 text-ink">{c.textbook ?? "—"}</td>
                        <td className="px-4 py-2.5 text-center tabular-nums text-ink">{c.studentCount}</td>
                        {canEditClass ? (
                          <td className="px-4 py-2.5">
                            <div className="flex gap-1">
                              <button
                                type="button"
                                className="btn btn-ghost px-2 py-1"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingId(c.id);
                                  setEditDraft({
                                    name: c.name,
                                    department: c.department,
                                    teacherId: c.teacherId,
                                    roomId: c.roomId,
                                    grade: c.grade ?? "",
                                    textbook: c.textbook ?? "",
                                  });
                                }}
                                aria-label="수정"
                              >
                                <IconPencil className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost px-2 py-1 text-alert"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void removeClass(c);
                                }}
                                aria-label="삭제"
                              >
                                <IconTrash className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        ) : null}
                      </tr>
                    ),
                  )
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* 오른쪽 — 학생 명단 */}
        <aside className="card w-[320px] shrink-0 self-start p-5">
          <h2 className="text-base font-bold text-ink">
            학생 명단{selectedClass ? ` — ${selectedClass.name}` : ""}
          </h2>
          {!selectedClass ? (
            <p className="mt-3 text-sm text-muted">왼쪽에서 반을 선택해 주세요.</p>
          ) : (
            <>
              {canEditStudent ? (
                <div className="mt-4 flex gap-2">
                  <input
                    className="field"
                    placeholder="학생 이름"
                    value={newStudent}
                    onChange={(e) => setNewStudent(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newStudent.trim()) void addStudent();
                    }}
                  />
                  <button type="button" className="btn btn-primary px-3" onClick={() => void addStudent()} disabled={busy}>
                    <IconPlus className="h-4 w-4" />
                  </button>
                </div>
              ) : null}

              <div className="mt-4 space-y-1">
                {students.length === 0 ? (
                  <p className="text-sm text-muted">등록된 학생이 없습니다.</p>
                ) : (
                  students.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-navy-50"
                    >
                      {editStudentId === s.id ? (
                        <>
                          <input
                            className="field"
                            value={editStudentName}
                            onChange={(e) => setEditStudentName(e.target.value)}
                          />
                          <button
                            type="button"
                            className="btn px-2 py-1 text-xs"
                            onClick={() =>
                              void run(async () => {
                                await apiPatch("/api/students", { id: s.id, name: editStudentName });
                                setEditStudentId(null);
                              })
                            }
                          >
                            저장
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-sm text-ink">{s.name}</span>
                          {canEditStudent ? (
                            <span className="flex gap-1">
                              <button
                                type="button"
                                className="btn btn-ghost px-1.5 py-1"
                                onClick={() => {
                                  setEditStudentId(s.id);
                                  setEditStudentName(s.name);
                                }}
                                aria-label="수정"
                              >
                                <IconPencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost px-1.5 py-1 text-alert"
                                onClick={() => void removeStudent(s)}
                                aria-label="삭제"
                              >
                                <IconTrash className="h-3.5 w-3.5" />
                              </button>
                            </span>
                          ) : null}
                        </>
                      )}
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function Field({ label, width, children }: { label: string; width: string; children: React.ReactNode }) {
  return (
    <div className={width}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

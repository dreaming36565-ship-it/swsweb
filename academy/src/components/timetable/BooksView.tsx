"use client";

// 교재 책장 — 과정(학교급 + 학년-학기) + 교재 이름. 관리자 · 선생님 · 데스크 모두 고칠 수 있다.

import { useState } from "react";
import Modal from "../Modal";
import { useConfirm } from "../ConfirmDialog";
import { apiDelete, apiPatch, apiPost, errorMessage } from "@/lib/http";
import { can } from "@/lib/perm";
import { BOOK_GRADES, BOOK_LEVELS, bookFull } from "@/lib/books";
import { LEVEL_COLOR } from "@/lib/colors";
import type { Book } from "@/lib/types";
import type { Ctx } from "./TimetableClient";

export default function BooksView({ ctx }: { ctx: Ctx }) {
  const [level, setLevel] = useState("전체");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"recent" | "name" | "grade">("recent");
  const [edit, setEdit] = useState<Book | "new" | null>(null);
  const { books, classes } = ctx.data;
  const LV: Record<string, number> = { 초등: 0, 중등: 1, 고등: 2 };
  let list = books.filter((b) => (level === "전체" || b.level === level) && (!q || bookFull(b).includes(q)));
  list =
    sort === "name"
      ? [...list].sort((a, b) => a.name.localeCompare(b.name, "ko"))
      : sort === "grade"
        ? [...list].sort((a, b) => LV[a.level] - LV[b.level] || a.grade.localeCompare(b.grade, "ko"))
        : [...list].sort((a, b) => b.id - a.id);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5">
          {["전체", ...BOOK_LEVELS].map((l) => (
            <button key={l} type="button" className={`btn ${level === l ? "btn-primary" : ""}`} onClick={() => setLevel(l)}>
              {l}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <input className="field w-48" placeholder="교재 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="field w-32" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="recent">최근 등록순</option>
            <option value="name">이름순</option>
            <option value="grade">학년순</option>
          </select>
          {can(ctx.user, "books.write") ? (
            <button type="button" className="btn btn-primary" onClick={() => setEdit("new")}>
              ＋ 교재 추가
            </button>
          ) : null}
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5">
        {list.map((b) => {
          const users = classes.filter((c) => c.parts.some((p) => p.bookIds.includes(b.id))).map((c) => c.name);
          return (
            <div
              key={b.id}
              role="button"
              tabIndex={0}
              className="card cursor-pointer px-3.5 py-3 hover:shadow-md"
              onClick={() => can(ctx.user, "books.write") && setEdit(b)}
            >
              <h4 className="mb-1.5 text-[17px] font-bold">
                <span className="mr-1 rounded px-1.5 py-px text-[11px] font-bold text-white" style={{ background: LEVEL_COLOR[b.level] }}>
                  {b.level[0]}
                </span>
                {bookFull(b)}
              </h4>
              <div className="text-xs text-muted">
                쓰는 반: <b className="font-semibold text-ink">{users.join(", ") || "—"}</b>
              </div>
            </div>
          );
        })}
      </div>
      {edit ? <BookModal ctx={ctx} book={edit === "new" ? null : edit} onClose={() => setEdit(null)} /> : null}
    </div>
  );
}

function BookModal({ ctx, book, onClose }: { ctx: Ctx; book: Book | null; onClose: () => void }) {
  const confirm = useConfirm();
  const [course, setCourse] = useState(book ? `${book.level} ${book.grade}` : "초등 5-1");
  const [name, setName] = useState(book?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [level, ...g] = course.split(" ");
  const rec = { level, grade: g.join(" "), name: name.trim() };
  const save = async () => {
    setError(null);
    try {
      if (book) await apiPatch("/api/books", { id: book.id, ...rec });
      else await apiPost("/api/books", rec);
      await ctx.reload();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const remove = async () => {
    if (!book) return;
    const yes = await confirm({ title: "교재를 지울까요?", message: `${bookFull(book)} — 이 교재를 쓰는 칸에서도 빠져요.`, confirmText: "지우기", danger: true });
    if (!yes) return;
    try {
      await apiDelete("/api/books", { id: book.id });
      await ctx.reload();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      width={520}
      title={book ? "교재 고치기" : "교재 추가"}
      onClose={onClose}
      footer={
        <>
          {book ? (
            <button type="button" className="btn btn-danger mr-auto" onClick={() => void remove()}>
              지우기
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()}>
            저장
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className="label">과정 (학년-학기)</label>
          <select className="field" value={course} onChange={(e) => setCourse(e.target.value)}>
            {BOOK_LEVELS.map((l) => (
              <optgroup key={l} label={l}>
                {BOOK_GRADES[l].map((gr) => (
                  <option key={gr} value={`${l} ${gr}`}>
                    {l} {gr}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label className="label">교재 이름</label>
          <input className="field" placeholder="예) 심화 · 데메테르 · 입" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      <p className="mt-3 text-[15px]">
        → <b>{`${course} ${name.trim()}`.trim()}</b>
      </p>
      <p className="text-xs text-muted">한 줄로 쓰면: 초등 5-1 심화 · 중등 1-1 데메테르 · 고등 공통수학2 입</p>
      {error ? <p className="mt-2 text-sm font-semibold text-alert">{error}</p> : null}
    </Modal>
  );
}

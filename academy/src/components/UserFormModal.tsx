"use client";

// 계정 추가/수정 — 아이디는 관리자가 직접 부여한다.

import { useEffect, useState } from "react";
import Modal from "./Modal";
import { apiPatch, apiPost, errorMessage } from "@/lib/http";
import { ROLE_LABEL, type Department, type Role, type StaffUser } from "@/lib/types";

export default function UserFormModal({
  open,
  target,
  onClose,
  onSaved,
}: {
  open: boolean;
  target: StaffUser | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [loginId, setLoginId] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("TEACHER");
  const [department, setDepartment] = useState<Department>("ELEM");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPassword("");
    setLoginId(target?.loginId ?? "");
    setName(target?.name ?? "");
    setRole(target?.role ?? "TEACHER");
    setDepartment(target?.department ?? "ELEM");
  }, [open, target]);

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      if (target) {
        await apiPatch("/api/users", {
          id: target.id,
          name,
          role,
          department,
          password: password || undefined,
        });
      } else {
        await apiPost("/api/users", { loginId, password, name, role, department });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={target ? "계정 수정" : "계정 추가"}
      subtitle={target ? `아이디 ${target.loginId}` : "아이디를 직접 정해 주세요."}
      onClose={onClose}
      width={460}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            저장
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {!target ? (
          <div>
            <label className="label">아이디</label>
            <input className="field" value={loginId} onChange={(e) => setLoginId(e.target.value)} />
          </div>
        ) : null}
        <div>
          <label className="label">이름</label>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">권한</label>
            <select className="field" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">소속 부서</label>
            <select
              className="field"
              value={department}
              onChange={(e) => setDepartment(e.target.value as Department)}
            >
              <option value="ELEM">초중등부</option>
              <option value="HIGH">고등부</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label">{target ? "새 비밀번호 (변경할 때만)" : "비밀번호"}</label>
          <input
            className="field"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={target ? "비워두면 그대로" : ""}
          />
        </div>

        {error ? (
          <div className="rounded-lg border border-alert bg-alert-soft px-3 py-2 text-sm font-semibold text-alert">
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

"use client";

// ★ window.confirm() / alert() 를 쓰지 말 것.
// 크롬의 "이 페이지에서 추가 대화 상자를 표시하지 않음" 을 한 번 체크하면
// 이후 항상 취소로 처리되어 삭제 버튼이 먹통이 된다(실제로 겪은 버그).
// 확인이 필요한 곳은 전부 이 useConfirm() 을 쓴다.

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import Modal from "./Modal";

type ConfirmOptions = {
  title: string;
  message?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    setOptions(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = useCallback((result: boolean) => {
    setOptions(null);
    resolver.current?.(result);
    resolver.current = null;
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Modal
        open={options !== null}
        title={options?.title ?? ""}
        onClose={() => close(false)}
        width={440}
        footer={
          <>
            <button type="button" className="btn" onClick={() => close(false)}>
              {options?.cancelText ?? "취소"}
            </button>
            <button
              type="button"
              className={options?.danger ? "btn btn-danger" : "btn btn-primary"}
              onClick={() => close(true)}
            >
              {options?.confirmText ?? "확인"}
            </button>
          </>
        }
      >
        <div className="text-sm leading-relaxed text-ink">{options?.message ?? "계속 진행할까요?"}</div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm 은 ConfirmProvider 안에서만 쓸 수 있습니다.");
  return ctx;
}

"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

export default function useConfirmation() {
  const [message, setMessage] = useState("");
  const resolve = useRef<((confirmed: boolean) => void) | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => () => { resolve.current?.(false); }, []);

  const confirm = useCallback((text: string) => {
    resolve.current?.(false);
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMessage(text);
    return new Promise<boolean>((done) => { resolve.current = done; });
  }, []);

  function close(confirmed: boolean) {
    const done = resolve.current;
    resolve.current = null;
    setMessage("");
    previousFocus.current?.focus();
    done?.(confirmed);
  }

  const confirmation = message ? (
    <div className="modal-backdrop" onClick={() => close(false)}>
      <div className="modal-card admin-confirmation" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); close(false); }
          if (event.key === "Tab") {
            const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button");
            if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[1]?.focus(); }
            else if (!event.shiftKey && document.activeElement === buttons[1]) { event.preventDefault(); buttons[0]?.focus(); }
          }
        }}>
        <h2 id={titleId}>Xác nhận xóa</h2>
        <p id={messageId}>{message}</p>
        <p className="muted">Thao tác này không thể hoàn tác.</p>
        <div className="confirmation-actions">
          <button type="button" autoFocus onClick={() => close(false)}>Hủy</button>
          <button type="button" className="confirmation-delete" onClick={() => close(true)}>Xác nhận xóa</button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, confirmation };
}

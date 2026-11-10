import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  tone,
  children,
  onCancel,
  onConfirm,
  busy = false,
  disabled = false
}: {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly tone: "danger" | "primary";
  readonly children?: ReactNode;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly busy?: boolean;
  readonly disabled?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  if (!open) return null;

  return createPortal(
    <dialog
      ref={ref}
      className="confirm-dialog confirm-dialog-porcelain"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={`${titleId}-description`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <p id={`${titleId}-description`}>{description}</p>
      {children}
      <div className="dialog-actions">
        <button
          type="button"
          className="terminal-button terminal-button-ghost"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className={`terminal-button terminal-button-${tone}`}
          onClick={onConfirm}
          disabled={busy || disabled}
        >
          {busy ? "Saving" : confirmLabel}
        </button>
      </div>
    </dialog>,
    document.body
  );
}

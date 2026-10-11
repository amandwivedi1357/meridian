import { useRef, type ReactNode } from "react";
import { useDialogFocus } from "../../lib/use-dialog-focus.js";

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
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, open, busy ? undefined : onCancel);
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        ref={ref}
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <h2 id="confirm-title">{title}</h2>
        <p>{description}</p>
        {children}
        <div className="dialog-actions">
          <button
            className="terminal-button terminal-button-ghost"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            className={`terminal-button terminal-button-${tone}`}
            onClick={onConfirm}
            disabled={busy || disabled}
          >
            {busy ? "Saving" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

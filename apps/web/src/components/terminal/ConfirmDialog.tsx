import type { ReactNode } from "react";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  tone,
  children,
  onCancel,
  onConfirm
}: {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly tone: "danger" | "primary";
  readonly children?: ReactNode;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title">{title}</h2>
        <p>{description}</p>
        {children}
        <div className="dialog-actions">
          <button className="terminal-button terminal-button-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className={`terminal-button terminal-button-${tone}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

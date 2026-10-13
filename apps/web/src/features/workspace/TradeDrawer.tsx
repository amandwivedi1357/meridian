import { useEffect, useRef, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { ArrowRightLeft, X } from "lucide-react";
import { ManualOrderTicket } from "./ManualOrderTicket.js";

export function TradeDrawer(props: ComponentProps<typeof ManualOrderTicket>) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element || !open) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      trigger.current?.focus();
    };
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="market-trade-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Open Testnet trade ticket"
        onClick={() => setOpen(true)}
      >
        <ArrowRightLeft size={15} />
        Trade
      </button>
      {createPortal(
        <dialog
          ref={dialog}
          className="trade-drawer"
          aria-labelledby="trade-drawer-title"
          onCancel={(event) => {
            event.preventDefault();
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              const bounds = event.currentTarget.getBoundingClientRect();
              if (
                event.clientX < bounds.left ||
                event.clientX > bounds.right ||
                event.clientY < bounds.top ||
                event.clientY > bounds.bottom
              )
                setOpen(false);
            }
          }}
        >
          <header className="trade-drawer-header">
            <div>
              <h2 id="trade-drawer-title">Trade</h2>
              <span>Testnet / {props.symbol}</span>
            </div>
            <button
              type="button"
              className="trade-drawer-close"
              title="Close trade drawer"
              aria-label="Close trade drawer"
              onClick={() => setOpen(false)}
            >
              <X size={18} />
            </button>
          </header>
          <div className="trade-drawer-body">
            <ManualOrderTicket {...props} />
          </div>
        </dialog>,
        document.body
      )}
    </>
  );
}

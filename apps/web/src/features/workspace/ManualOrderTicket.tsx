import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Decimal } from "decimal.js";
import { Send } from "lucide-react";

import { ApiError, queueManualOrder, type MarketInstrument } from "../../lib/api-client.js";
import { useTerminalStore } from "../../lib/terminal-store.js";
import { StatusBadge } from "../../components/terminal/StatusBadge.js";
import { ConfirmDialog } from "../../components/terminal/ConfirmDialog.js";
import {
  readManualRetry,
  saveManualRetry,
  clearManualRetry
} from "../../lib/manual-order-retry.js";

export function ManualOrderTicket({
  symbol,
  baseAsset,
  quoteAsset,
  instruments,
  onSymbol,
  operator,
  riskEngaged,
  lastPrice,
  compact = false
}: {
  readonly symbol: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly instruments: readonly MarketInstrument[];
  readonly onSymbol: (value: string) => void;
  readonly operator: boolean;
  readonly riskEngaged: boolean;
  readonly lastPrice?: string | undefined;
  readonly compact?: boolean;
}) {
  const [manualSide, setManualSide] = useState<"BUY" | "SELL">("BUY");
  const [manualType, setManualType] = useState<"MARKET" | "LIMIT">("MARKET");
  const [manualQuantity, setManualQuantity] = useState("");
  const [manualLimitPrice, setManualLimitPrice] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [manualConfirm, setManualConfirm] = useState("");
  const request = useRef<Parameters<typeof queueManualOrder>[0] | undefined>(
    readManualRetry(sessionStorage)
  );
  const [clearRetry, setClearRetry] = useState(false),
    [clearConfirm, setClearConfirm] = useState("");

  const manualMutation = useMutation({
    mutationFn: async () => {
      if (!operator || riskEngaged) throw new Error("Manual trading unavailable");
      if (!request.current && manualConfirm !== "QUEUE")
        throw new Error("Manual order confirmation required");
      request.current ??= {
        requestId: crypto.randomUUID(),
        symbol,
        side: manualSide,
        type: manualType,
        quantity: manualQuantity.trim(),
        ...(manualType === "LIMIT" ? { limitPrice: manualLimitPrice.trim() } : {}),
        reason: manualReason.trim(),
        confirm: "QUEUE_MANUAL_ORDER"
      };
      saveManualRetry(sessionStorage, request.current);
      return queueManualOrder(request.current);
    },
    onSuccess: () => {
      request.current = undefined;
      clearManualRetry(sessionStorage);
      setManualQuantity("");
      setManualLimitPrice("");
      setManualReason("");
      setManualConfirm("");
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401)
        useTerminalStore.getState().setSession(null, "required");
    }
  });

  const manualQuantityValid = decimalInput(manualQuantity);
  const manualPriceValid = manualType === "MARKET" || decimalInput(manualLimitPrice);
  const manualReady =
    operator &&
    !riskEngaged &&
    manualQuantityValid &&
    manualPriceValid &&
    manualReason.trim().length > 0 &&
    manualConfirm === "QUEUE";
  const manualNotional =
    manualQuantityValid && (manualType === "LIMIT" ? manualPriceValid : lastPrice)
      ? estimateNotional(manualQuantity, manualType === "LIMIT" ? manualLimitPrice : lastPrice)
      : "--";

  return (
    <section
      className={`manual-trade-panel${compact ? " compact" : ""}`}
      aria-labelledby="manual-trade-title"
    >
      <div className="manual-trade-head">
        <div>
          <h2 id="manual-trade-title">Manual order ticket</h2>
          <p>Routes through risk, write-ahead storage and executor.</p>
        </div>
        <StatusBadge tone={operator && !riskEngaged ? "green" : "amber"}>
          {riskEngaged ? "Blocked" : operator ? "Operator armed" : "Read only"}
        </StatusBadge>
      </div>
      <fieldset
        className="manual-ticket-grid"
        disabled={!!request.current || manualMutation.isPending}
        style={{ border: 0, padding: 0, margin: 0 }}
      >
        <label className="manual-field">
          Instrument
          <select value={symbol} onChange={(event) => onSymbol(event.target.value)}>
            {instruments.map((instrument) => (
              <option key={instrument.symbol} value={instrument.symbol}>
                {instrument.baseAsset} / {instrument.quoteAsset}
              </option>
            ))}
          </select>
        </label>
        <div className="manual-field">
          Side
          <div className="manual-segmented" role="group" aria-label="Manual order side">
            {(["BUY", "SELL"] as const).map((side) => (
              <button
                key={side}
                type="button"
                className={manualSide === side ? "active" : ""}
                data-side={side.toLowerCase()}
                onClick={() => {
                  manualMutation.reset();
                  setManualSide(side);
                }}
              >
                {side}
              </button>
            ))}
          </div>
        </div>
        <div className="manual-field">
          Order type
          <div className="manual-segmented" role="group" aria-label="Manual order type">
            {(["MARKET", "LIMIT"] as const).map((type) => (
              <button
                key={type}
                type="button"
                className={manualType === type ? "active" : ""}
                onClick={() => {
                  manualMutation.reset();
                  setManualType(type);
                  if (type === "MARKET") setManualLimitPrice("");
                }}
              >
                {type}
              </button>
            ))}
          </div>
        </div>
        <label className="manual-field">
          Quantity / {baseAsset}
          <input
            inputMode="decimal"
            placeholder="0.0002"
            value={manualQuantity}
            onChange={(event) => {
              manualMutation.reset();
              setManualQuantity(event.target.value);
            }}
          />
        </label>
        <label className="manual-field">
          Limit price / {quoteAsset}
          <input
            inputMode="decimal"
            placeholder={manualType === "LIMIT" ? "85000.00" : "Market order"}
            disabled={manualType === "MARKET"}
            value={manualLimitPrice}
            onChange={(event) => {
              manualMutation.reset();
              setManualLimitPrice(event.target.value);
            }}
          />
        </label>
        <label className="manual-field manual-field-wide">
          Reason
          <input
            maxLength={300}
            placeholder="Why this manual order is being queued"
            value={manualReason}
            onChange={(event) => {
              manualMutation.reset();
              setManualReason(event.target.value);
            }}
          />
        </label>
        <label className="manual-field">
          Confirm
          <input
            autoComplete="off"
            placeholder="Type QUEUE"
            value={manualConfirm}
            onChange={(event) => {
              manualMutation.reset();
              setManualConfirm(event.target.value);
            }}
          />
        </label>
      </fieldset>
      <div className="manual-ticket-footer">
        <dl className="workspace-readings">
          <div>
            <dt>Estimated notional</dt>
            <dd>{manualNotional}</dd>
          </div>
          <div>
            <dt>Execution path</dt>
            <dd>
              signals {"->"} executor {"->"} risk {"->"} write-ahead {"->"} gateway
            </dd>
          </div>
          <div>
            <dt>Risk status</dt>
            <dd>{riskEngaged ? "Kill switch engaged" : "Risk hook required"}</dd>
          </div>
        </dl>
        <div className="manual-submit-stack">
          {request.current && (
            <>
              <p role="status">
                Pending {request.current.side} {request.current.quantity} {request.current.symbol};
                retries use these original inputs.
              </p>
              <button
                type="button"
                disabled={manualMutation.isPending}
                onClick={() => {
                  setClearConfirm("");
                  setClearRetry(true);
                }}
              >
                Start a separate request
              </button>
            </>
          )}
          <button
            type="button"
            className={`manual-submit manual-submit-${manualSide.toLowerCase()}`}
            disabled={
              (!request.current && !manualReady) ||
              manualMutation.isPending ||
              !operator ||
              riskEngaged
            }
            onClick={() => manualMutation.mutate()}
          >
            <Send size={15} />
            {manualMutation.isPending
              ? "Queueing"
              : request.current
                ? "Retry original request"
                : `${manualSide} ${manualType.toLowerCase()} order`}
          </button>
          {manualMutation.isSuccess && (
            <p className="manual-feedback positive" role="status">
              Queued {manualMutation.data.signalId} on {manualMutation.data.streamId}
            </p>
          )}
          {manualMutation.isError && (
            <p className="manual-feedback negative" role="alert">
              Queue outcome unconfirmed. Retry keeps the original order identity and inputs; inspect
              orders if it has expired.
            </p>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={clearRetry}
        title="Start a separate order request"
        description="Check Orders first: the original request may already have executed. A separate identity can create another order."
        confirmLabel="Release retry identity"
        tone="danger"
        disabled={clearConfirm !== "NEW REQUEST" || manualMutation.isPending}
        onCancel={() => setClearRetry(false)}
        onConfirm={() => {
          clearManualRetry(sessionStorage);
          request.current = undefined;
          manualMutation.reset();
          setManualConfirm("");
          setClearRetry(false);
        }}
      >
        <label>
          Type NEW REQUEST
          <input value={clearConfirm} onChange={(event) => setClearConfirm(event.target.value)} />
        </label>
      </ConfirmDialog>
    </section>
  );
}

function decimalInput(value: string): boolean {
  if (!/^\d+(\.\d+)?$/.test(value.trim())) return false;
  try {
    return new Decimal(value.trim()).gt(0);
  } catch {
    return false;
  }
}

function estimateNotional(quantity: string, price: string | undefined): string {
  if (!price || !decimalInput(quantity) || !decimalInput(price)) return "--";
  return `${new Decimal(quantity.trim()).mul(price.trim()).toFixed(2)} USDT`;
}

import { useState } from "react";

export function CandleInterval({
  timeframe,
  onTimeframe,
  label = "Candle interval"
}: {
  timeframe: string;
  onTimeframe: (value: string) => void;
  label?: string;
}) {
  const [intervalMotion, setIntervalMotion] = useState<"pointer" | "keyboard" | "none">("none");
  const intervalIndex = Math.max(0, ["1m", "15m", "1h"].indexOf(timeframe));
  return (
    <div
      className="ov-intervals"
      role="group"
      aria-label={label}
      data-motion={intervalMotion}
      onKeyDownCapture={() => setIntervalMotion("keyboard")}
    >
      <div
        className="ov-interval-active"
        aria-hidden="true"
        style={{
          clipPath: `inset(0 calc(${((2 - intervalIndex) * 100) / 3}% + ${2 - intervalIndex}px) 0 calc(${(intervalIndex * 100) / 3}% + ${intervalIndex}px) round 4px)`
        }}
      >
        {["1m", "15m", "1h"].map((interval) => (
          <span key={interval}>{interval}</span>
        ))}
      </div>
      {["1m", "15m", "1h"].map((interval) => (
        <button
          type="button"
          key={interval}
          aria-pressed={timeframe === interval}
          onClick={(event) => {
            setIntervalMotion(event.detail === 0 ? "keyboard" : "pointer");
            onTimeframe(interval);
          }}
        >
          {interval}
        </button>
      ))}
    </div>
  );
}

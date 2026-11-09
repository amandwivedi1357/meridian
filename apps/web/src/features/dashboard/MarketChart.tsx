import { useEffect, useRef, useState } from "react";
import {
  CandlestickChart,
  ChartLine,
  Crosshair,
  Maximize,
  Minimize,
  Navigation,
  Minus,
  Plus
} from "lucide-react";
import {
  ColorType,
  CrosshairMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type UTCTimestamp
} from "lightweight-charts";
import type { FillRecord, MarketCandle } from "../../lib/api-client.js";
import { formatUsd } from "../../lib/format.js";
import { getTheme, useTheme } from "../../lib/theme.js";

const darkChartColors: Record<string, string> = {
  "#ffffff": "#191c27",
  "#667085": "#adb5c9",
  "#edf0f5": "#2b3142",
  "#8b90a0": "#7885a1",
  "#5558c9": "#b3b6ff",
  "#dde1e8": "#353c50",
  "#268568": "#66bc97",
  "#d65161": "#e48091",
  "#4a9b80": "#417b64",
  "#c97580": "#925363"
};
function chartColor(light: string) {
  return getTheme() === "dark" ? (darkChartColors[light] ?? light) : light;
}

export function MarketChart({
  candles,
  baseAsset = "BTC",
  fills = [],
  appearance = "terminal"
}: {
  candles: readonly MarketCandle[];
  baseAsset?: string;
  fills?: readonly FillRecord[];
  appearance?: "terminal" | "overview";
}) {
  const theme = useTheme();
  const shell = useRef<HTMLDivElement>(null),
    container = useRef<HTMLDivElement>(null),
    chartRef = useRef<IChartApi>();
  const series = useRef<ISeriesApi<"Candlestick">>(),
    line = useRef<ISeriesApi<"Line">>(),
    volume = useRef<ISeriesApi<"Histogram">>();
  const data = useRef(candles),
    fitted = useRef(false),
    appliedInterval = useRef<string>(),
    appliedCount = useRef(0),
    hoveredTime = useRef<number>();
  data.current = candles;
  const [hovered, setHovered] = useState<MarketCandle>(),
    [mode, setMode] = useState<"candles" | "line">("candles"),
    [fullscreen, setFullscreen] = useState(false),
    [error, setError] = useState("");
  const reset = () => {
    const count = data.current.length,
      width = container.current?.clientWidth ?? 800;
    if (count)
      chartRef.current?.timeScale().setVisibleLogicalRange({
        from: Math.max(-1, count - Math.min(100, Math.max(30, Math.floor(width / 9)))),
        to: count + 4
      });
    chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
  };
  useEffect(() => {
    const chart = createChart(container.current!, {
      autoSize: true,
      layout: {
        background: {
          type: ColorType.Solid,
          color: appearance === "overview" ? chartColor("#ffffff") : "#080d11"
        },
        textColor: appearance === "overview" ? chartColor("#667085") : "#a3b1bd",
        fontSize: 11
      },
      grid: {
        vertLines: { color: appearance === "overview" ? chartColor("#edf0f5") : "#131d25" },
        horzLines: { color: appearance === "overview" ? chartColor("#edf0f5") : "#131d25" }
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: appearance === "overview" ? chartColor("#8b90a0") : "#73818d",
          labelBackgroundColor: appearance === "overview" ? chartColor("#5558c9") : "#263540"
        },
        horzLine: {
          color: appearance === "overview" ? chartColor("#8b90a0") : "#73818d",
          labelBackgroundColor: appearance === "overview" ? chartColor("#5558c9") : "#263540"
        }
      },
      rightPriceScale: {
        borderColor: appearance === "overview" ? chartColor("#dde1e8") : "#26333d",
        scaleMargins: { top: 0.12, bottom: 0.23 }
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: appearance === "overview" ? chartColor("#dde1e8") : "#26333d",
        rightOffset: 5,
        barSpacing: 9
      },
      localization: { locale: "en-US" }
    });
    chartRef.current = chart;
    series.current = chart.addCandlestickSeries({
      upColor: appearance === "overview" ? chartColor("#268568") : "#00c896",
      downColor: appearance === "overview" ? chartColor("#d65161") : "#ff4d6d",
      wickUpColor: appearance === "overview" ? chartColor("#268568") : "#00c896",
      wickDownColor: appearance === "overview" ? chartColor("#d65161") : "#ff4d6d",
      borderVisible: false,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 }
    });
    line.current = chart.addLineSeries({
      color: appearance === "overview" ? chartColor("#5558c9") : "#4ea1ff",
      lineWidth: 2,
      visible: false,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 }
    });
    volume.current = chart.addHistogramSeries({
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.83, bottom: 0.02 } });
    chart.subscribeCrosshairMove((event) => {
      const time = typeof event.time === "number" ? Number(event.time) * 1000 : undefined;
      hoveredTime.current = time;
      setHovered(time === undefined ? undefined : data.current.find((c) => c.openTimeMs === time));
    });
    let resizeTimer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (fitted.current) reset();
      }, 100);
    });
    observer.observe(container.current!);
    const changed = () => setFullscreen(document.fullscreenElement === shell.current);
    document.addEventListener("fullscreenchange", changed);
    return () => {
      observer.disconnect();
      clearTimeout(resizeTimer);
      document.removeEventListener("fullscreenchange", changed);
      chart.remove();
      series.current = undefined;
      line.current = undefined;
      volume.current = undefined;
      chartRef.current = undefined;
      fitted.current = false;
    };
  }, [appearance]);
  useEffect(() => {
    if (appearance !== "overview") return;
    // Recolor the existing canvas instead of recreating it: retain zoom, pan and chart mode.
    chartRef.current?.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: chartColor("#ffffff") },
        textColor: chartColor("#667085")
      },
      grid: {
        vertLines: { color: chartColor("#edf0f5") },
        horzLines: { color: chartColor("#edf0f5") }
      },
      crosshair: {
        vertLine: { color: chartColor("#8b90a0"), labelBackgroundColor: chartColor("#5558c9") },
        horzLine: { color: chartColor("#8b90a0"), labelBackgroundColor: chartColor("#5558c9") }
      },
      rightPriceScale: { borderColor: chartColor("#dde1e8") },
      timeScale: { borderColor: chartColor("#dde1e8") }
    });
    series.current?.applyOptions({
      upColor: chartColor("#268568"),
      downColor: chartColor("#d65161"),
      wickUpColor: chartColor("#268568"),
      wickDownColor: chartColor("#d65161")
    });
    line.current?.applyOptions({ color: chartColor("#5558c9") });
  }, [theme, appearance]);
  useEffect(() => {
    const interval = candles.at(-1)?.interval;
    if (
      !candles.length ||
      interval !== appliedInterval.current ||
      (appliedCount.current <= 1 && candles.length > 1)
    )
      fitted.current = false;
    appliedInterval.current = interval;
    appliedCount.current = candles.length;
    series.current?.setData(
      candles.map((c) => ({
        time: Math.floor(c.openTimeMs / 1000) as UTCTimestamp,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close)
      }))
    );
    line.current?.setData(
      candles.map((c) => ({
        time: Math.floor(c.openTimeMs / 1000) as UTCTimestamp,
        value: Number(c.close)
      }))
    );
    volume.current?.setData(
      candles.map((c) => ({
        time: Math.floor(c.openTimeMs / 1000) as UTCTimestamp,
        value: Number(c.volume),
        color:
          Number(c.close) >= Number(c.open)
            ? appearance === "overview"
              ? chartColor("#4a9b80")
              : "#126650"
            : appearance === "overview"
              ? chartColor("#c97580")
              : "#702a3b"
      }))
    );
    if (!fitted.current && candles.length) {
      reset();
      fitted.current = true;
    }
    if (hoveredTime.current !== undefined)
      setHovered(candles.find((c) => c.openTimeMs === hoveredTime.current));
  }, [candles, appearance, theme]);
  useEffect(() => {
    series.current?.setMarkers(executionMarkers(candles, fills, appearance));
  }, [candles, fills, appearance, theme]);
  useEffect(() => {
    series.current?.applyOptions({ visible: mode === "candles" });
    line.current?.applyOptions({ visible: mode === "line" });
  }, [mode, appearance]);
  const zoom = (factor: number) => {
    const scale = chartRef.current?.timeScale(),
      range = scale?.getVisibleLogicalRange();
    if (range) {
      const span = Math.max(10, Math.min(250, (range.to - range.from) * factor));
      scale?.setVisibleLogicalRange({ from: range.to - span, to: range.to });
    }
  };
  const current = hovered ?? candles.at(-1);
  const up = current ? Number(current.close) >= Number(current.open) : true;
  return (
    <div ref={shell} className="market-chart-shell terminal-chart">
      <div className="chart-toolbar">
        <div className="chart-mode" role="group" aria-label="Chart style">
          <button
            className={`icon-button ${mode === "candles" ? "active" : ""}`}
            title="Candlesticks"
            aria-label="Candlesticks"
            aria-pressed={mode === "candles"}
            onClick={() => setMode("candles")}
          >
            <CandlestickChart size={16} />
          </button>
          <button
            className={`icon-button ${mode === "line" ? "active" : ""}`}
            title="Line chart"
            aria-label="Line chart"
            aria-pressed={mode === "line"}
            onClick={() => setMode("line")}
          >
            <ChartLine size={16} />
          </button>
        </div>
        <span className="chart-source">
          Binance Spot <span>/</span> {candles.at(-1)?.interval ?? "--"}
        </span>
        <div className="chart-tools">
          <button
            className="icon-button"
            title="Zoom out"
            aria-label="Zoom out"
            onClick={() => zoom(1.3)}
            disabled={!current}
          >
            <Minus size={16} />
          </button>
          <button
            className="icon-button"
            title="Zoom in"
            aria-label="Zoom in"
            onClick={() => zoom(0.75)}
            disabled={!current}
          >
            <Plus size={16} />
          </button>
          <button
            className="icon-button"
            title="Reset chart view"
            aria-label="Reset chart view"
            onClick={reset}
            disabled={!current}
          >
            <Crosshair size={16} />
          </button>
          <button
            className="icon-button"
            title="Go to latest candle"
            aria-label="Go to latest candle"
            onClick={() => chartRef.current?.timeScale().scrollToRealTime()}
            disabled={!current}
          >
            <Navigation size={16} />
          </button>
          <button
            className="icon-button"
            title={fullscreen ? "Exit fullscreen" : "Fullscreen chart"}
            aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen chart"}
            onClick={() => {
              setError("");
              const work = fullscreen
                ? document.exitFullscreen()
                : shell.current?.requestFullscreen();
              void work?.catch(() => setError("Fullscreen unavailable"));
            }}
          >
            {fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
        </div>
      </div>
      <div className={`chart-readout ${up ? "positive" : "negative"}`} aria-label="Candle values">
        {(["open", "high", "low", "close"] as const).map((key, index) => (
          <span key={key}>
            <small>{["O", "H", "L", "C"][index]}</small>
            {formatUsd(current?.[key])}
          </span>
        ))}
        <span>
          <small>Vol</small>
          {current?.volume
            ? Number(current.volume).toLocaleString("en-US", { maximumFractionDigits: 3 })
            : "--"}
          <small>{baseAsset}</small>
        </span>
        <time>
          {current
            ? new Date(current.openTimeMs).toLocaleString("en-GB", {
                timeZone: "UTC",
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false
              }) + " UTC"
            : "--"}
        </time>
      </div>
      <div className="market-chart" ref={container} />
      {!candles.length && <div className="chart-overlay-note">Market unavailable</div>}
      {error && (
        <div className="chart-overlay-note" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

function executionMarkers(
  candles: readonly MarketCandle[],
  fills: readonly FillRecord[],
  appearance: "terminal" | "overview"
): SeriesMarker<UTCTimestamp>[] {
  if (!candles.length || !fills.length) return [];
  const first = candles[0]!;
  const last = candles[candles.length - 1]!;
  const symbol = last.symbol;
  return fills
    .filter(
      (fill) =>
        fill.symbol === symbol &&
        fill.eventTimeMs >= first.openTimeMs &&
        fill.eventTimeMs <= last.closeTimeMs
    )
    .map((fill) => {
      const candle =
        candles.find(
          (item) => fill.eventTimeMs >= item.openTimeMs && fill.eventTimeMs <= item.closeTimeMs
        ) ?? nearestCandle(candles, fill.eventTimeMs);
      const marker: SeriesMarker<UTCTimestamp> = {
        time: Math.floor(candle.openTimeMs / 1000) as UTCTimestamp,
        position: fill.side === "BUY" ? "belowBar" : "aboveBar",
        color:
          fill.side === "BUY"
            ? appearance === "overview"
              ? chartColor("#268568")
              : "#00c896"
            : appearance === "overview"
              ? chartColor("#d65161")
              : "#ff4d6d",
        shape: fill.side === "BUY" ? "arrowUp" : "arrowDown",
        text: `${fill.side} ${fill.quantity} @ ${formatUsd(fill.price)}`
      };
      return marker;
    })
    .sort((a, b) => Number(a.time) - Number(b.time));
}

function nearestCandle(candles: readonly MarketCandle[], timeMs: number) {
  return candles.reduce((nearest, candle) =>
    Math.abs(candle.openTimeMs - timeMs) < Math.abs(nearest.openTimeMs - timeMs) ? candle : nearest
  );
}

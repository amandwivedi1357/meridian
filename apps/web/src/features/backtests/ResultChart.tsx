import { useEffect, useRef } from "react";
import {
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp
} from "lightweight-charts";

import { getTheme, useTheme } from "../../lib/theme.js";

function palette() {
  const dark = getTheme() === "dark";
  return {
    background: dark ? "#191c27" : "#ffffff",
    text: dark ? "#adb5c9" : "#667085",
    grid: dark ? "#2b3142" : "#edf0f5",
    border: dark ? "#353c50" : "#dde1e8",
    equity: dark ? "#b3b6ff" : "#5558c9",
    equityFill: dark ? "#b3b6ff24" : "#5558c91a",
    drawdown: dark ? "#f0929f" : "#bb3f50",
    drawdownFill: dark ? "#f0929f24" : "#bb3f5018"
  };
}

export function ResultChart({
  points,
  tone
}: {
  points: readonly { time: number; value: number }[];
  tone: "equity" | "drawdown";
}) {
  const theme = useTheme();
  const ref = useRef<HTMLDivElement>(null),
    chart = useRef<IChartApi>(),
    series = useRef<ISeriesApi<"Area">>();
  useEffect(() => {
    const colors = palette();
    const api = createChart(ref.current!, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: colors.background },
        textColor: colors.text,
        fontSize: 11
      },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      timeScale: { timeVisible: true, borderColor: colors.border },
      rightPriceScale: { borderColor: colors.border }
    });
    chart.current = api;
    series.current = api.addAreaSeries({
      lineColor: tone === "equity" ? colors.equity : colors.drawdown,
      topColor: tone === "equity" ? colors.equityFill : colors.drawdownFill,
      bottomColor: "#00000000",
      lineWidth: 2,
      priceFormat:
        tone === "drawdown"
          ? { type: "custom", formatter: (v: number) => `${v.toFixed(2)}%` }
          : { type: "price", precision: 2, minMove: 0.01 }
    });
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => api.timeScale().fitContent(), 100);
    });
    observer.observe(ref.current!);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
      api.remove();
      chart.current = undefined;
      series.current = undefined;
    };
  }, [tone]);
  useEffect(() => {
    const colors = palette();
    chart.current?.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: colors.background },
        textColor: colors.text
      },
      grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
      timeScale: { borderColor: colors.border },
      rightPriceScale: { borderColor: colors.border }
    });
    series.current?.applyOptions({
      lineColor: tone === "equity" ? colors.equity : colors.drawdown,
      topColor: tone === "equity" ? colors.equityFill : colors.drawdownFill,
      bottomColor: "#00000000"
    });
  }, [theme, tone]);
  useEffect(() => {
    series.current?.setData(points.map((p) => ({ ...p, time: p.time as UTCTimestamp })));
    chart.current?.timeScale().fitContent();
  }, [points]);
  return <div className="backtest-result-chart" ref={ref} />;
}

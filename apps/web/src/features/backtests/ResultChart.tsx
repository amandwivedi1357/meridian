import { useEffect, useRef } from "react";
import {
  ColorType,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp
} from "lightweight-charts";

export function ResultChart({
  points,
  tone
}: {
  points: readonly { time: number; value: number }[];
  tone: "equity" | "drawdown";
}) {
  const ref = useRef<HTMLDivElement>(null),
    chart = useRef<IChartApi>(),
    series = useRef<ISeriesApi<"Area">>();
  useEffect(() => {
    const api = createChart(ref.current!, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#080d11" },
        textColor: "#a3b1bd",
        fontSize: 11
      },
      grid: { vertLines: { color: "#131d25" }, horzLines: { color: "#131d25" } },
      timeScale: { timeVisible: true, borderColor: "#26333d" },
      rightPriceScale: { borderColor: "#26333d" }
    });
    chart.current = api;
    series.current = api.addAreaSeries({
      lineColor: tone === "equity" ? "#4ea1ff" : "#ff4d6d",
      topColor: tone === "equity" ? "#4ea1ff30" : "#ff4d6d30",
      bottomColor: "#080d1100",
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
    series.current?.setData(points.map((p) => ({ ...p, time: p.time as UTCTimestamp })));
    chart.current?.timeScale().fitContent();
  }, [points]);
  return <div className="backtest-result-chart" ref={ref} />;
}

import {
  Activity,
  BarChart3,
  CandlestickChart,
  FlaskConical,
  LayoutDashboard,
  ListOrdered,
  ShieldAlert,
  Workflow
} from "lucide-react";

export const pages = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "market", label: "Market", icon: CandlestickChart },
  { id: "trading", label: "Trading", icon: ListOrdered },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "risk", label: "Risk", icon: ShieldAlert },
  { id: "strategies", label: "Strategies", icon: Workflow },
  { id: "backtests", label: "Backtests", icon: FlaskConical },
  { id: "system", label: "System", icon: Activity }
] as const;
export type PageId = (typeof pages)[number]["id"];
export function pageFromHash(hash: string): PageId {
  return pages.find((p) => `#/${p.id}` === hash)?.id ?? "overview";
}

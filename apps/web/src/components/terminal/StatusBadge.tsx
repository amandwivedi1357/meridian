export function StatusBadge({
  tone,
  children
}: {
  readonly tone: "green" | "red" | "amber" | "blue" | "muted";
  readonly children: string;
}) {
  return <span className={`terminal-status terminal-status-${tone}`}>{children}</span>;
}

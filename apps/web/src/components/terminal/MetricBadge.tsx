export function MetricBadge({
  label,
  value,
  tone = "neutral"
}: {
  readonly label: string;
  readonly value: string;
  readonly tone?: "positive" | "negative" | "warning" | "neutral";
}) {
  return (
    <div className={`metric-badge metric-badge-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

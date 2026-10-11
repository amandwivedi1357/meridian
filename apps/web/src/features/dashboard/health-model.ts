export interface SystemHealth {
  checkedAt: number;
  redis: "available" | "unavailable";
  database: "available" | "unavailable";
  streams: {
    stream: string;
    status: "available" | "missing" | "unavailable";
    length: number | null;
    groups: { name: string; consumers: number; pending: number; lag: number | null }[];
  }[];
}
const count = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
export function parseHealth(value: unknown): SystemHealth {
  if (!value || typeof value !== "object") throw new Error("invalid_health");
  const h = value as SystemHealth;
  if (
    !count(h.checkedAt) ||
    !["available", "unavailable"].includes(h.redis) ||
    !["available", "unavailable"].includes(h.database) ||
    !Array.isArray(h.streams) ||
    h.streams.length > 7
  )
    throw new Error("invalid_health");
  for (const row of h.streams) {
    if (
      !row ||
      typeof row.stream !== "string" ||
      row.stream.length > 100 ||
      !["available", "missing", "unavailable"].includes(row.status) ||
      (row.length !== null && !count(row.length)) ||
      !Array.isArray(row.groups) ||
      row.groups.length > 50
    )
      throw new Error("invalid_health");
    for (const group of row.groups) {
      if (
        !group ||
        typeof group.name !== "string" ||
        group.name.length > 100 ||
        !count(group.consumers) ||
        !count(group.pending) ||
        (group.lag !== null && !count(group.lag))
      )
        throw new Error("invalid_health");
    }
  }
  return h;
}
export function age(timestamp: number | null, now: number): string {
  if (timestamp === null || !count(timestamp) || timestamp > now + 5000) return "--";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
export function sampleFresh(health: SystemHealth | null, now: number) {
  return !!health && health.checkedAt <= now + 5000 && now - health.checkedAt <= 15000;
}

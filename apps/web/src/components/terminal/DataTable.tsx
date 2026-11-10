import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function DataTable({
  columns,
  rows,
  emptyLabel,
  label = "Data table"
}: {
  readonly columns: readonly string[];
  readonly rows: readonly ReactNode[][];
  readonly emptyLabel: string;
  readonly label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    const update = () => {
      const style = getComputedStyle(container);
      setScrollable(
        (["auto", "scroll"].includes(style.overflowX) &&
          container.scrollWidth > container.clientWidth + 1) ||
          (["auto", "scroll"].includes(style.overflowY) &&
            container.scrollHeight > container.clientHeight + 1)
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    const table = container.querySelector("table");
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className="terminal-table-wrap"
      tabIndex={scrollable ? 0 : undefined}
      role={scrollable ? "region" : undefined}
      aria-label={scrollable ? label : undefined}
    >
      <table className="terminal-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="terminal-empty">{emptyLabel}</div>}
    </div>
  );
}

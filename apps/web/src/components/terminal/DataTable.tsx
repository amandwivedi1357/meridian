import type { ReactNode } from "react";

export function DataTable({
  columns,
  rows,
  emptyLabel
}: {
  readonly columns: readonly string[];
  readonly rows: readonly ReactNode[][];
  readonly emptyLabel: string;
}) {
  return (
    <div className="terminal-table-wrap">
      <table className="terminal-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
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

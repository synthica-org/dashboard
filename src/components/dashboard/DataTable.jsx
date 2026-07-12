import { EmptyState, Loading } from '../ui.jsx';

/**
 * DataTable — a light, responsive table for dashboard lists (applicants,
 * members, papers, …). Pure presentation: pass columns + rows.
 *
 * Each column: { key, header, render?(row, index), align?, width?, className? }.
 * If `render` is omitted, `row[key]` is shown. Keep cells simple — for complex
 * layouts, render custom nodes from `render`.
 *
 * Handles the three states out of the box: loading, empty, and populated.
 *
 * @param {{ key: string, header: React.ReactNode, render?: Function,
 *           align?: 'left'|'center'|'right', width?: string|number,
 *           className?: string }[]} columns
 * @param {object[]} rows
 * @param {(row: object, index: number) => React.Key} [rowKey]  Defaults to row.id ?? index.
 * @param {(row: object) => void} [onRowClick]   Makes rows clickable.
 * @param {boolean} [loading]
 * @param {React.ReactNode} [empty='Nothing here yet.']  Empty-state message.
 * @param {string} [emptyIcon]                    Icon for the empty state.
 * @param {string} [className]
 */
export default function DataTable({
  columns = [],
  rows = [],
  rowKey,
  onRowClick,
  loading = false,
  empty = 'Nothing here yet.',
  emptyIcon,
  className = '',
}) {
  if (loading) {
    return <Loading>Loading…</Loading>;
  }
  if (!rows.length) {
    return <EmptyState icon={emptyIcon}>{empty}</EmptyState>;
  }
  const keyOf = rowKey || ((row, i) => row?.id ?? i);
  const clickable = typeof onRowClick === 'function';

  return (
    <div className={`dash-table-wrap ${className}`.trim()}>
      <table className="dash-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={c.className}
                style={{ textAlign: c.align || 'left', width: c.width }}
                scope="col"
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={keyOf(row, i)}
              className={clickable ? 'dash-table-row-link' : ''}
              onClick={clickable ? () => onRowClick(row) : undefined}
              tabIndex={clickable ? 0 : undefined}
              onKeyDown={clickable ? (e) => { if (e.key === 'Enter') onRowClick(row); } : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={c.className} style={{ textAlign: c.align || 'left' }}>
                  {c.render ? c.render(row, i) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

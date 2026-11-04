import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './ui';

export interface Column<T> {
  key: string;
  label: string;
  /** Field to sort on. Columns without one are not sortable. */
  sortKey?: string;
  align?: 'right';
  render: (row: T) => ReactNode;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  sort?: string;
  dir?: string;
  onSort?: (key: string) => void;
  caption: string;
  selectedKey?: string | null;
  footer?: ReactNode;
}

export function DataTable<T>({ columns, rows, rowKey, sort, dir, onSort, caption, selectedKey, footer }: Props<T>) {
  return (
    <div className="overflow-x-auto">
      <table className="num w-full border-collapse text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
            {columns.map((c) => {
              const sorted = sort === c.sortKey && c.sortKey;
              return (
                <th key={c.key} scope="col" aria-sort={sorted ? (dir === 'asc' ? 'ascending' : 'descending') : undefined} className={`whitespace-nowrap px-2 py-1.5 font-medium ${c.align === 'right' ? 'text-right' : ''}`}>
                  {c.sortKey && onSort ? (
                    <button type="button" onClick={() => onSort(c.sortKey!)} className="inline-flex items-center gap-0.5 uppercase hover:text-fg">
                      {c.label}
                      {sorted && (dir === 'asc' ? <ArrowUp size={11} aria-hidden /> : <ArrowDown size={11} aria-hidden />)}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            return (
              <tr key={key} className={`border-b border-line/60 hover:bg-surface-2 ${selectedKey === key ? 'bg-accent-bg' : ''}`}>
                {columns.map((c) => (
                  <td key={c.key} className={`px-2 py-1 align-top ${c.align === 'right' ? 'text-right' : ''}`}>
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {footer}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  return (
    <div className="num flex items-center justify-between gap-2 px-2 py-1.5 text-xs text-muted">
      <span aria-live="polite">
        {first}-{Math.min(page * pageSize, total)} of {total}
      </span>
      <span className="flex items-center gap-1">
        <Button variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft size={13} aria-hidden />
        </Button>
        Page {page} of {pages}
        <Button variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight size={13} aria-hidden />
        </Button>
      </span>
    </div>
  );
}

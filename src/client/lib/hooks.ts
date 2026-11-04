import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api } from './api';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api.get('/api/me'), retry: false, staleTime: 60_000 });
}

export function useFilterOptions() {
  return useQuery({ queryKey: ['filter-options'], queryFn: () => api.get('/api/meta/filters'), staleTime: 60_000 });
}

export function usePrefs() {
  const client = useQueryClient();
  const query = useQuery<Record<string, any>>({ queryKey: ['prefs'], queryFn: () => api.get('/api/me/preferences'), staleTime: Infinity });
  const save = useCallback(
    (patch: Record<string, unknown>) => {
      client.setQueryData<Record<string, any>>(['prefs'], (old) => ({ ...(old ?? {}), ...patch }));
      void api.put('/api/me/preferences', patch);
    },
    [client],
  );
  return { prefs: query.data ?? {}, loaded: query.isSuccess, save };
}

/** Filters that follow the user between views and through drill-down. */
export const CARRIED_KEYS = ['customerId', 'serviceId', 'systemId', 'objectId', 'os', 'period', 'from', 'to'];
const TRANSIENT_KEYS = ['record', 'page', 'calc', 'level', 'levelId'];

const CHILD_KEYS: Record<string, string[]> = {
  customerId: ['serviceId', 'systemId', 'objectId'],
  serviceId: ['systemId', 'objectId'],
  systemId: ['objectId'],
};

export function useCarry() {
  const [params] = useSearchParams();
  return useCallback(
    (path: string, extra: Record<string, string> = {}) => {
      const next = new URLSearchParams();
      for (const k of CARRIED_KEYS) {
        const v = params.get(k);
        if (v) next.set(k, v);
      }
      for (const [k, v] of Object.entries(extra)) next.set(k, v);
      const s = next.toString();
      return s ? `${path}?${s}` : path;
    },
    [params],
  );
}

export type Filters = ReturnType<typeof useFilters>;

/** URL-backed filters for one view, restored from and saved to the account's preferences. */
export function useFilters(viewKey: string) {
  const [params, setParams] = useSearchParams();
  const { prefs, loaded, save } = usePrefs();
  const restored = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!loaded || restored.current) return;
    restored.current = true;
    const hasOwnFilters = [...params.keys()].some((k) => !CARRIED_KEYS.includes(k) && !TRANSIENT_KEYS.includes(k));
    const saved: Record<string, string> | undefined = prefs.filters?.[viewKey];
    if (!hasOwnFilters && saved && Object.keys(saved).length) {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(saved)) if (!next.has(k)) next.set(k, v);
      setParams(next, { replace: true });
    }
    setReady(true);
    // Runs once, after preferences first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const serialized = params.toString();
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      const toSave: Record<string, string> = {};
      new URLSearchParams(serialized).forEach((v, k) => {
        if (!TRANSIENT_KEYS.includes(k) && !CHILD_KEYS.customerId.includes(k) && k !== 'customerId') toSave[k] = v;
      });
      const current = prefs.filters?.[viewKey] ?? {};
      if (JSON.stringify(current) !== JSON.stringify(toSave)) save({ filters: { ...(prefs.filters ?? {}), [viewKey]: toSave } });
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, ready, viewKey]);

  const values = useMemo(() => Object.fromEntries(params.entries()) as Record<string, string>, [params]);

  const set = useCallback(
    (key: string, value: string | null) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        for (const child of CHILD_KEYS[key] ?? []) next.delete(child);
        if (key !== 'page' && key !== 'record') next.delete('page');
        return next;
      });
    },
    [setParams],
  );

  const setMany = useCallback(
    (patch: Record<string, string | null>) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v) next.set(k, v);
          else next.delete(k);
        }
        return next;
      });
    },
    [setParams],
  );

  const clear = useCallback(() => {
    setParams((prev) => {
      const next = new URLSearchParams();
      const customer = prev.get('customerId');
      if (customer) next.set('customerId', customer);
      const tab = prev.get('tab');
      if (tab) next.set('tab', tab);
      return next;
    });
  }, [setParams]);

  const activeCount = Object.keys(values).filter((k) => !TRANSIENT_KEYS.includes(k) && !['customerId', 'tab', 'sort', 'dir', 'groupBy'].includes(k)).length;

  return { values, set, setMany, clear, activeCount, ready };
}

export function useLocalSort<T extends Record<string, any>>(rows: T[], initial: string, initialDir: 'asc' | 'desc' = 'desc') {
  const [sort, setSort] = useState(initial);
  const [dir, setDir] = useState<'asc' | 'desc'>(initialDir);
  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const x = a[sort];
      const y = b[sort];
      const missingX = x === null || x === undefined;
      const missingY = y === null || y === undefined;
      if (missingX || missingY) return missingX === missingY ? 0 : missingX ? 1 : -1;
      const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sort, dir]);
  const onSort = (key: string) => {
    if (key === sort) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setSort(key);
      setDir('asc');
    }
  };
  return { sorted, sort, dir, onSort };
}

'use client';

import { useEffect, useState } from 'react';
import type { Campus } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { Alert, SelectField, Skeleton } from '@/components/ui';

const KEY = 'erp.academics.campus';

const read = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const write = (v: string) => {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* storage unavailable: selection just isn't remembered */
  }
};

/**
 * Loads the campuses the user can see and keeps one selected (remembered per browser).
 * Renders the picker only when there is more than one campus.
 */
export function useCampus() {
  const { data, loading, error } = useApi<Campus[]>('/campuses');
  const active = (data ?? []).filter((c) => c.status === 'active');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!active.length) return;
    const saved = read();
    setSelected((cur) =>
      cur && active.some((c) => c.id === cur)
        ? cur
        : saved && active.some((c) => c.id === saved)
          ? saved
          : active[0]!.id,
    );
  }, [data]);

  const choose = (id: string) => {
    setSelected(id);
    write(id);
  };

  const campus = active.find((c) => c.id === selected) ?? null;

  const picker =
    loading && !data ? (
      <Skeleton rows={1} />
    ) : error ? (
      <Alert>{error.message}</Alert>
    ) : active.length > 1 ? (
      <SelectField
        label="Campus"
        value={selected ?? ''}
        onChange={(e) => choose(e.target.value)}
        className="w-64"
      >
        {active.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </SelectField>
    ) : null;

  return { campus, campuses: active, picker, choose, loading: loading && !data };
}

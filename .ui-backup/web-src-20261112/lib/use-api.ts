'use client';
import type React from 'react';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from './api';

/** Minimal data hook: loads on mount, exposes reload. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(Boolean(path));

  const reload = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError(
        e instanceof ApiError ? e : new ApiError(0, { code: 'NETWORK', message: 'Network error' }),
      );
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

/** Result of a successful action: the response body, or `true` when there was none. */
type Done<T> = undefined extends T ? Exclude<T, undefined> | true : T;

/** Runs a mutation and keeps its pending/error state for a form. */
export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  /**
   * Resolves to the result, or `undefined` when the action failed. Actions that succeed
   * without a body (204) resolve to `true`, so `if (await run(...))` means "it worked".
   */
  const run = useCallback(async <T>(fn: () => Promise<T>): Promise<Done<T> | undefined> => {
    setPending(true);
    setError(null);
    try {
      const result = await fn();
      return (result === undefined ? true : result) as Done<T>;
    } catch (e) {
      setError(
        e instanceof ApiError ? e : new ApiError(0, { code: 'NETWORK', message: 'Network error' }),
      );
      return undefined;
    } finally {
      setPending(false);
    }
  }, []);

  return { pending, error, run, setError };
}

/**
 * Form submit handler that keeps what the user typed. (React 19 form `action`s reset
 * uncontrolled inputs after every submission — including failed ones.)
 */
export const onSubmitForm =
  (fn: (form: FormData) => Promise<unknown>) =>
  (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    void fn(new FormData(e.currentTarget));
  };

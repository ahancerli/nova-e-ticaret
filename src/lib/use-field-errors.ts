"use client";

import { useCallback, useMemo, useState } from "react";
import { ClientApiError, type FieldErrors } from "./api-client";

/**
 * Form-level field errors from client checks and from the server (ClientApiError.fieldErrors share the
 * same "a.b.c" keys). One hook instead of every form re-implementing the same state.
 *
 *   const errors = useFieldErrors();
 *   try { … } catch (err) { errors.fromError(err); }
 *   <input aria-invalid={!!errors.get("name")} /> {errors.get("name")}
 */
export function useFieldErrors() {
  const [errors, setErrors] = useState<FieldErrors>({});

  const fromError = useCallback((err: unknown): number => {
    const fe = err instanceof ClientApiError ? err.fieldErrors : {};
    setErrors(fe);
    return Object.keys(fe).length;
  }, []);

  const clear = useCallback((key?: string) => {
    setErrors((prev) => {
      if (!key) return Object.keys(prev).length ? {} : prev;
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  return useMemo(() => ({
    all: errors,
    /** First message for a field (or undefined). */
    get: (key: string) => errors[key]?.[0],
    has: (key: string) => Boolean(errors[key]?.length),
    count: Object.keys(errors).length,
    set: setErrors,
    fromError,
    clear,
  }), [errors, fromError, clear]);
}

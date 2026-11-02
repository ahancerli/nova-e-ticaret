"use client";

import { toast } from "sonner";
import { errorMessage as apiErrorMessage } from "./api-client";

/**
 * Single entry point for notifications.
 *   notify.success("Kaydedildi")                       · notify.error(err)  (maps API errors)
 *   notify.promise(api(...), { loading, success })     · notify.info / warning / dismiss
 * Pass `id` to de-duplicate (e.g. a toast fired from an effect that may run twice in dev).
 */
type Opts = { description?: string; id?: string | number; action?: { label: string; onClick: () => void } };

function errorMessage(err: unknown, fallback: string): string {
  return typeof err === "string" ? err : apiErrorMessage(err, fallback);
}

export const notify = {
  success: (title: string, o?: Opts) => toast.success(title, o),
  info: (title: string, o?: Opts) => toast.info(title, o),
  warning: (title: string, o?: Opts) => toast.warning(title, o),
  error: (err: unknown, o?: Opts & { fallback?: string }) =>
    toast.error(errorMessage(err, o?.fallback ?? "İşlem tamamlanamadı. Lütfen tekrar deneyin."), { duration: 7000, ...o }),
  promise: <T,>(p: Promise<T>, m: { loading: string; success: string | ((v: T) => string); error?: string }) =>
    toast.promise(p, { loading: m.loading, success: m.success, error: (e: unknown) => errorMessage(e, m.error ?? "İşlem başarısız.") }),
  dismiss: (id?: string | number) => toast.dismiss(id),
};

import Link from "next/link";
import type { ReactNode } from "react";

export interface ErrorStateProps {
  title: string;
  description: string;
  /** Next.js error digest or API request id — shown so support can find the log line. */
  reference?: string | null;
  onRetry?: () => void;
  home?: { href: string; label: string };
  icon?: ReactNode;
  tone?: "storefront" | "admin";
}

/** One look for every error / empty-result screen (route error boundaries, not-found, widget fallbacks). */
export function ErrorState({ title, description, reference, onRetry, home, icon, tone = "storefront" }: ErrorStateProps) {
  const admin = tone === "admin";
  return (
    <div role="alert" className={admin ? "mx-auto mt-10 max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm" : "mx-auto max-w-md px-4 py-24 text-center"}>
      {icon ? <div className="mx-auto mb-4 flex justify-center">{icon}</div> : null}
      <h1 className={admin ? "text-lg font-semibold text-slate-800" : "text-xl font-bold"}>{title}</h1>
      <p className={admin ? "mt-2 text-sm text-slate-500" : "mt-2 text-sm text-ink-soft"}>{description}</p>
      {reference ? <p className="mt-3 font-mono text-xs text-slate-400">Ref: {reference}</p> : null}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className={admin ? "inline-flex min-h-9 items-center rounded-lg bg-[#7367f0] px-4 text-sm font-semibold text-white hover:bg-[#6559df]" : "btn btn-primary"}
          >
            Tekrar dene
          </button>
        ) : null}
        {home ? (
          <Link
            href={home.href}
            className={admin ? "inline-flex min-h-9 items-center rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50" : "btn btn-ghost"}
          >
            {home.label}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

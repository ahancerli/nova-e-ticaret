"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/error-reporting";
import { ErrorState } from "./ErrorState";

/** Props Next.js passes to error.tsx (retry is the current name; reset / unstable_retry on older minors). */
export interface RouteErrorProps {
  error: unknown;
  retry?: () => void;
  unstable_retry?: () => void;
  reset?: () => void;
}

/**
 * Shared body of every error.tsx: reports the error (with Next's digest, which matches the server log line)
 * and shows a generic message — server error text is never echoed to the user.
 */
export function RouteError({ error, retry, unstable_retry, reset, tone, home }: RouteErrorProps & { tone: "storefront" | "admin"; home: { href: string; label: string } }) {
  const digest = error && typeof error === "object" && "digest" in error ? String((error as { digest?: unknown }).digest ?? "") || null : null;

  useEffect(() => {
    reportClientError(error, { kind: "render", digest: digest ?? undefined });
  }, [error, digest]);

  return (
    <ErrorState
      tone={tone}
      title="Bir şeyler ters gitti"
      description="Beklenmeyen bir hata oluştu. Sorun kaydedildi; lütfen tekrar deneyin."
      reference={digest}
      onRetry={retry ?? unstable_retry ?? reset}
      home={home}
    />
  );
}

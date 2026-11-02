"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/error-reporting";
import type { RouteErrorProps } from "@/components/ui/RouteError";

/**
 * Last-resort boundary: replaces the ROOT layout when it crashes, so it renders its own document and cannot
 * rely on globals.css — inline styles only, no imports of app UI.
 */
export default function GlobalError({ error, retry, unstable_retry, reset }: RouteErrorProps) {
  const digest = error && typeof error === "object" && "digest" in error ? String((error as { digest?: unknown }).digest ?? "") : "";
  useEffect(() => {
    reportClientError(error, { kind: "render", digest: digest || undefined, boundary: "global" });
  }, [error, digest]);
  const again = retry ?? unstable_retry ?? reset;

  return (
    <html lang="tr">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f8fafc", color: "#0f172a" }}>
        <title>Bir şeyler ters gitti | nova.</title>
        <main style={{ maxWidth: 420, margin: "96px auto", padding: "0 16px", textAlign: "center" }}>
          <h1 style={{ fontSize: 20, margin: 0 }}>Bir şeyler ters gitti</h1>
          <p style={{ fontSize: 14, color: "#475569" }}>Beklenmeyen bir hata oluştu. Sorun kaydedildi; lütfen tekrar deneyin.</p>
          {digest ? <p style={{ fontFamily: "monospace", fontSize: 12, color: "#94a3b8" }}>Ref: {digest}</p> : null}
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 24 }}>
            {again ? (
              <button type="button" onClick={again} style={{ padding: "10px 16px", borderRadius: 10, border: 0, background: "#0f172a", color: "#fff", fontWeight: 600, cursor: "pointer" }}>
                Tekrar dene
              </button>
            ) : null}
            {/* A plain link: the app router may be what crashed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid #cbd5e1", color: "#0f172a", textDecoration: "none" }}>Ana sayfa</a>
          </div>
        </main>
      </body>
    </html>
  );
}

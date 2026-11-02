"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/error-reporting";

/** Mounted once in the root layout: reports uncaught errors and unhandled promise rejections. */
export function ClientErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      // Cross-origin script errors carry no information ("Script error.") — not worth a report.
      if (!e.error && e.message === "Script error.") return;
      reportClientError(e.error ?? e.message, { kind: "uncaught" });
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      // API failures are already shown to the user and logged on the server; only report real bugs.
      if (e.reason && typeof e.reason === "object" && (e.reason as { name?: string }).name === "ClientApiError") return;
      reportClientError(e.reason, { kind: "unhandled_rejection" });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}

"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-xl font-bold">Bir şeyler ters gitti</h1>
      <p className="mt-2 text-sm text-ink-soft">
        {error.message.includes("yetki") ? error.message : "Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin."}
      </p>
      {error.digest && <p className="mt-2 font-mono text-xs text-muted">Ref: {error.digest}</p>}
      <button className="btn btn-primary mt-8" onClick={reset}>Tekrar dene</button>
    </div>
  );
}

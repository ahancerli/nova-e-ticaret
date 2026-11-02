"use client";

import { useId, useState } from "react";
import { Check, Eye, EyeOff, X } from "lucide-react";
import { PASSWORD_MIN, passwordProblems } from "@/modules/identity/domain/password-policy";

/**
 * New-password input with show/hide and live rules (the same policy the server enforces). `tone` picks the
 * panel (slate/violet) or storefront (ink/brand) look.
 */
export function PasswordField({ id, label, value, onChange, context, error, tone, autoFocus }: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  context: { email?: string; name?: string };
  error?: string;
  tone: "admin" | "storefront";
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const hintId = useId();
  const problems = value ? passwordProblems(value, context) : [];
  const rules = [
    { ok: [...value].length >= PASSWORD_MIN, text: `En az ${PASSWORD_MIN} karakter` },
    { ok: /\p{L}/u.test(value) && /\p{N}/u.test(value), text: "Harf ve rakam" },
    { ok: !!value && !problems.some((p) => /yaygın|e-posta|adınızı/i.test(p)), text: "Tahmin edilmesi zor (adınız, e-postanız veya yaygın bir parola değil)" },
  ];
  const input = tone === "admin"
    ? "input h-11 border-slate-300 pr-11 text-slate-800"
    : "input pr-11";

  return (
    <div>
      <label htmlFor={id} className={tone === "admin" ? "mb-1 block text-sm font-medium text-slate-700" : "mb-1 block text-sm font-medium"}>{label}</label>
      <div className="relative">
        <input id={id} type={visible ? "text" : "password"} autoComplete="new-password" className={input} value={value} maxLength={128} autoFocus={autoFocus}
          aria-invalid={!!error} aria-describedby={hintId} onChange={(e) => onChange(e.target.value)} />
        <button type="button" onClick={() => setVisible((v) => !v)} aria-label={visible ? "Parolayı gizle" : "Parolayı göster"}
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400 hover:text-slate-700">
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      <ul id={hintId} className="mt-2 space-y-1 text-xs">
        {rules.map((r) => (
          <li key={r.text} className={`flex items-center gap-1.5 ${r.ok ? "text-emerald-600" : "text-slate-500"}`}>
            {r.ok ? <Check className="size-3.5" aria-hidden /> : <X className="size-3.5" aria-hidden />}
            <span>{r.text}</span><span className="sr-only">{r.ok ? " (sağlanıyor)" : " (sağlanmıyor)"}</span>
          </li>
        ))}
      </ul>
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

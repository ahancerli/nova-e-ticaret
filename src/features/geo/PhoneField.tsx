"use client";

import { useMemo, useState } from "react";
import { DEFAULT_COUNTRY, formatNational, nationalDigits, splitE164, type Country } from "@/modules/geo/domain/geo";
import { useCountries } from "./api";
import { SearchSelect, type SelectOption } from "./SearchSelect";

export const countryOptions = (list: Country[], withDial: boolean): SelectOption[] =>
  list.map((c) => ({ value: c.code, label: c.name, flag: c.code, hint: withDial ? `+${c.dialCode}` : undefined }));

/**
 * Mobile number with a flag + calling-code picker (searchable). Digits are grouped like the country's numbers; a
 * pasted +44… switches the country. Reports E.164 (`+905321234567`, "" when empty) — the server checks the number
 * against the country's rules. With `name`, hidden inputs `<name>` and `<name>Country` carry it in a plain form.
 */
export function PhoneField({
  id, label, defaultValue, defaultCountry = DEFAULT_COUNTRY, name, onChange, error, required,
}: {
  id: string;
  label: string;
  defaultValue?: string | null;
  defaultCountry?: string;
  name?: string;
  onChange?: (e164: string, country: string) => void;
  error?: string;
  required?: boolean;
}) {
  const countries = useCountries();
  const [typed, setTyped] = useState<{ country: string; digits: string } | null>(null);
  // until the person types, the value comes from the saved number (resolved once the country list arrives)
  const current = useMemo(() => {
    if (typed) return typed;
    const hit = countries && defaultValue ? splitE164(countries, defaultValue, defaultCountry) : null;
    return hit ? { country: hit.country.code, digits: hit.national } : { country: defaultCountry, digits: "" };
  }, [typed, countries, defaultValue, defaultCountry]);
  const country = countries?.find((c) => c.code === current.country) ?? null;
  const options = useMemo(() => countryOptions(countries ?? [], true), [countries]);
  const e164 = country && current.digits ? `+${country.dialCode}${current.digits}` : "";

  const set = (next: { country: string; digits: string }) => {
    setTyped(next);
    const c = countries?.find((x) => x.code === next.country);
    onChange?.(c && next.digits ? `+${c.dialCode}${next.digits}` : "", next.country);
  };

  const type = (raw: string) => {
    if (!countries || !country) return;
    if (/^\s*(\+|00)/.test(raw)) {
      const hit = splitE164(countries, raw, country.code);
      if (hit) return set({ country: hit.country.code, digits: hit.national });
    }
    set({ country: country.code, digits: nationalDigits(country, raw).slice(0, country.phone.max) });
  };

  const errId = `${id}-err`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      <div className={`flex min-h-[44px] items-stretch rounded-[10px] border bg-white focus-within:border-brand ${error ? "border-danger" : "border-line"}`}>
        {countries ? (
          <SearchSelect id={`${id}-country`} label="Ülke kodu" compact options={options} value={current.country} searchPlaceholder="Ülke veya kod ara"
            onChange={(code) => set({ country: code, digits: current.digits })} />
        ) : (
          <span aria-hidden className="flex items-center pl-3 pr-2"><span className="skeleton h-[15px] w-12" /></span>
        )}
        <span aria-hidden className="my-2.5 w-px bg-line" />
        <input
          id={id} type="tel" inputMode="tel" autoComplete="tel-national" required={required}
          value={country ? formatNational(country, current.digits) : ""} placeholder={country?.phone.example}
          onChange={(e) => type(e.target.value)}
          aria-invalid={!!error} aria-describedby={error ? errId : undefined}
          className="min-w-0 flex-1 rounded-r-[10px] bg-transparent px-3 text-sm tabular-nums outline-none placeholder:text-muted"
        />
      </div>
      {name && <><input type="hidden" name={name} value={e164} /><input type="hidden" name={`${name}Country`} value={current.country} /></>}
      {error && <p id={errId} className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

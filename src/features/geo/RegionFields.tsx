"use client";

import { useMemo, useState } from "react";
import { DEFAULT_COUNTRY } from "@/modules/geo/domain/geo";
import { countryOptions } from "./PhoneField";
import { useCountries, useRegions } from "./api";
import { SearchSelect } from "./SearchSelect";

export interface RegionValue { countryCode: string; province: string; district: string }

/**
 * Country → province → district. Türkiye (any country with lists) gets searchable pickers, the district list follows
 * the province; other countries get free-text city and region. With `name`, hidden inputs `<name>country`,
 * `<name>province`, `<name>district` carry the value in a plain form. Errors are keyed countryCode / province / district.
 */
export function RegionFields({
  id, defaultValue, name, onChange, errors = {}, autoSection,
}: {
  id: string;
  defaultValue?: Partial<RegionValue> | null;
  name?: string;
  onChange?: (v: RegionValue) => void;
  errors?: Partial<Record<keyof RegionValue, string | undefined>>;
  /** autocomplete section ("shipping" / "billing"). */
  autoSection?: string;
}) {
  const countries = useCountries();
  const [v, setV] = useState<RegionValue>({ countryCode: defaultValue?.countryCode || DEFAULT_COUNTRY, province: defaultValue?.province ?? "", district: defaultValue?.district ?? "" });
  const country = countries?.find((c) => c.code === v.countryCode) ?? null;
  const provinces = useRegions(country);
  const lists = !!country?.hasRegions;
  const province = provinces.find((p) => p.name === v.province) ?? null;

  const set = (patch: Partial<RegionValue>) => {
    const next = { ...v, ...patch };
    setV(next);
    onChange?.(next);
  };

  const cOptions = useMemo(() => countryOptions(countries ?? [], false), [countries]);
  const pOptions = useMemo(() => provinces.map((p) => ({ value: p.name, label: p.name })), [provinces]);
  const dOptions = useMemo(() => (province?.districts ?? []).map((d) => ({ value: d, label: d })), [province]);
  const ac = (s: string) => (autoSection ? `section-${autoSection} ${autoSection} ${s}` : s);

  const err = (k: keyof RegionValue) => errors[k] ? <p id={`${id}-${k}-err`} className="mt-1 text-xs text-danger">{errors[k]}</p> : null;
  const text = (k: "province" | "district", label: string, auto: string) => (
    <div>
      <label htmlFor={`${id}-${k}`} className="mb-1 block text-sm font-medium">{label}</label>
      <input id={`${id}-${k}`} className="input" autoComplete={ac(auto)} maxLength={60} value={v[k]} onChange={(e) => set({ [k]: e.target.value })}
        aria-invalid={!!errors[k]} aria-describedby={errors[k] ? `${id}-${k}-err` : undefined} />
      {err(k)}
    </div>
  );
  const pickLabel = (k: "province" | "district", label: string) => (
    // the picker is a button, so the label points at it explicitly
    <label htmlFor={`${id}-${k}`} className="mb-1 block text-sm font-medium">{label}</label>
  );

  return (
    <>
      <div className="sm:col-span-2">
        <label htmlFor={`${id}-country`} className="mb-1 block text-sm font-medium">Ülke</label>
        {countries ? (
          <SearchSelect id={`${id}-country`} label="Ülke" options={cOptions} value={v.countryCode} searchPlaceholder="Ülke ara" error={errors.countryCode}
            onChange={(code) => code !== v.countryCode && set({ countryCode: code, province: "", district: "" })} />
        ) : <div className="skeleton h-11" />}
        {err("countryCode")}
      </div>
      {lists ? (
        <>
          <div>
            {pickLabel("province", "İl")}
            <SearchSelect id={`${id}-province`} label="İl" options={pOptions} value={v.province} placeholder={provinces.length ? "İl seçin" : "Yükleniyor…"}
              searchPlaceholder="İl ara" disabled={!provinces.length} error={errors.province} describedBy={errors.province ? `${id}-province-err` : undefined}
              onChange={(p) => p !== v.province && set({ province: p, district: "" })} />
            {err("province")}
          </div>
          <div>
            {pickLabel("district", "İlçe")}
            <SearchSelect id={`${id}-district`} label="İlçe" options={dOptions} value={v.district} placeholder={province ? "İlçe seçin" : "Önce il seçin"}
              searchPlaceholder="İlçe ara" disabled={!province} error={errors.district} describedBy={errors.district ? `${id}-district-err` : undefined}
              onChange={(d) => set({ district: d })} />
            {err("district")}
          </div>
        </>
      ) : (
        <>
          {text("province", "Şehir", "address-level2")}
          {text("district", "Eyalet / bölge", "address-level1")}
        </>
      )}
      {name && <>
        <input type="hidden" name={`${name}country`} value={v.countryCode} />
        <input type="hidden" name={`${name}province`} value={v.province} />
        <input type="hidden" name={`${name}district`} value={v.district} />
      </>}
    </>
  );
}

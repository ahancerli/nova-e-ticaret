"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { Country, Province } from "@/modules/geo/domain/geo";

// Reference data: one request per tab (the server also sends max-age), shared by every picker on the page.
let countries: Promise<Country[]> | null = null;
const regions = new Map<string, Promise<Province[]>>();

export const geoApi = {
  countries: () => (countries ??= api<Country[]>("/api/geo/countries").then((r) => r.data).catch((e) => { countries = null; throw e; })),
  regions: (code: string) => {
    let p = regions.get(code);
    if (!p) regions.set(code, (p = api<Province[]>(`/api/geo/countries/${code}/regions`).then((r) => r.data).catch((e) => { regions.delete(code); throw e; })));
    return p;
  },
};

export function useCountries(): Country[] | null {
  const [list, setList] = useState<Country[] | null>(null);
  useEffect(() => {
    let live = true;
    geoApi.countries().then((c) => { if (live) setList(c); }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  return list;
}

/** Provinces (with districts) of a country with lists; [] while loading or for free-text countries. */
export function useRegions(country: Country | null): Province[] {
  const [loaded, setLoaded] = useState<{ code: string; list: Province[] } | null>(null);
  const code = country?.hasRegions ? country.code : null;
  useEffect(() => {
    if (!code) return;
    let live = true;
    geoApi.regions(code).then((list) => { if (live) setLoaded({ code, list }); }).catch(() => undefined);
    return () => { live = false; };
  }, [code]);
  return code && loaded?.code === code ? loaded.list : [];
}

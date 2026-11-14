import { ValidationError } from "@/core";
import { DEFAULT_COUNTRY, foldTr, phoneHint, splitE164, toE164, type Country, type Province } from "../domain/geo";

export interface GeoRepository {
  countries(): Promise<Country[]>;
  country(code: string): Promise<Country | null>;
  provinces(countryCode: string): Promise<Province[]>;
}

export interface RegionInput { countryCode?: string; province: string; district: string }

/**
 * Query + validation service over the geo_* reference tables. Other modules call `phone` / `region` before writing
 * so a stored number is always E.164 of a known country and a Turkish address names a real province and district.
 */
export class GeoDirectory {
  constructor(private readonly repo: GeoRepository) {}

  countries() { return this.repo.countries(); }

  async regions(countryCode: string): Promise<Province[] | null> {
    const c = await this.repo.country(countryCode);
    if (!c) return null;
    return c.hasRegions ? this.repo.provinces(c.code) : [];
  }

  /**
   * Mobile number → E.164. `+…` / `00…` input is read as international (country from the calling code,
   * `countryCode` breaks +1 / +7 ties); anything else is a national number of `countryCode` (default TR).
   */
  async phone(path: string, raw: string, countryCode?: string): Promise<string> {
    const picked = await this.repo.country(countryCode ?? DEFAULT_COUNTRY);
    if (!picked) throw ValidationError.field(path, "Ülke kodunu seçin.");
    const international = /^\s*(\+|00)/.test(raw);
    if (international && !raw.replace(/\D/g, "").replace(/^00/, "").startsWith(picked.dialCode)) {
      const hit = splitE164(await this.repo.countries(), raw);
      if (hit) return `+${hit.country.dialCode}${hit.national}`;
    }
    const e164 = toE164(picked, raw);
    if (!e164) throw ValidationError.field(path, `${picked.name} için geçerli bir cep telefonu girin (örnek: ${phoneHint(picked)}).`);
    return e164;
  }

  /** Country exists; with a province list (TR) the names must match it and come back in their canonical spelling. */
  async region(path: string, a: RegionInput): Promise<{ countryCode: string; province: string; district: string }> {
    const at = (k: string) => (path ? `${path}.${k}` : k);
    const c = await this.repo.country(a.countryCode ?? DEFAULT_COUNTRY);
    if (!c) throw ValidationError.field(at("countryCode"), "Ülke seçin.");
    if (!c.hasRegions) return { countryCode: c.code, province: a.province.trim(), district: a.district.trim() };
    const provinces = await this.repo.provinces(c.code);
    const p = provinces.find((x) => foldTr(x.name) === foldTr(a.province));
    if (!p) throw ValidationError.field(at("province"), "Listeden bir il seçin.");
    const d = p.districts.find((x) => foldTr(x) === foldTr(a.district));
    if (!d) throw ValidationError.field(at("district"), `${p.name} iline ait bir ilçe seçin.`);
    return { countryCode: c.code, province: p.name, district: d };
  }
}

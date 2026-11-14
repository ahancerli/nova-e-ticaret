import { Repository } from "@/core";
import type { GeoRepository } from "../application/geo-directory";
import type { Country, Province } from "../domain/geo";

type CountryRow = {
  code: string; name: string; dial_code: string; phone_min_length: number; phone_max_length: number; phone_pattern: string;
  phone_example: string; national_prefix: string; has_regions: number;
};
const country = (r: CountryRow): Country => ({
  code: r.code, name: r.name, dialCode: r.dial_code, hasRegions: r.has_regions === 1,
  phone: { min: r.phone_min_length, max: r.phone_max_length, pattern: r.phone_pattern, example: r.phone_example, nationalPrefix: r.national_prefix },
});
const COLS = "code, name, dial_code, phone_min_length, phone_max_length, phone_pattern, phone_example, national_prefix, has_regions";

export class D1GeoRepository extends Repository implements GeoRepository {
  async countries() {
    return (await this.db.all<CountryRow>(`SELECT ${COLS} FROM geo_countries WHERE is_active = 1 ORDER BY sort_order, name`)).map(country);
  }

  async country(code: string) {
    const r = await this.db.first<CountryRow>(`SELECT ${COLS} FROM geo_countries WHERE code = ? AND is_active = 1`, code);
    return r ? country(r) : null;
  }

  async provinces(countryCode: string): Promise<Province[]> {
    const rows = await this.db.all<{ id: string; name: string; district: string | null }>(
      `SELECT p.id, p.name, d.name AS district FROM geo_provinces p LEFT JOIN geo_districts d ON d.province_id = p.id
        WHERE p.country_code = ? ORDER BY p.code, d.name`, countryCode,
    );
    const out = new Map<string, Province>();
    for (const r of rows) {
      const p = out.get(r.id) ?? out.set(r.id, { id: r.id, name: r.name, districts: [] }).get(r.id)!;
      if (r.district) p.districts.push(r.district);
    }
    const coll = new Intl.Collator("tr");
    return [...out.values()].map((p) => ({ ...p, districts: p.districts.sort(coll.compare) })).sort((a, b) => coll.compare(a.name, b.name));
  }
}

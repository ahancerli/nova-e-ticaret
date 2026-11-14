import { DatabaseToken, token, type Container } from "@/core";
import { GeoDirectory } from "./application/geo-directory";
import { D1GeoRepository } from "./infrastructure/d1-geo.repository";

export const GeoDirectoryToken = token<GeoDirectory>("GeoDirectory");

export function registerGeo(c: Container): void {
  c.scoped(GeoDirectoryToken, (r) => new GeoDirectory(new D1GeoRepository(r.resolve(DatabaseToken))));
}

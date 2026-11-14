/** Public surface of the geo reference data (countries + phone rules, provinces, districts). */
export { DEFAULT_COUNTRY, COUNTRY_CODE, type Country, type Province } from "./domain/geo";
export { GeoDirectory, type RegionInput } from "./application/geo-directory";
export { GeoDirectoryToken, registerGeo } from "./module";

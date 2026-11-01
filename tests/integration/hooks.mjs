import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
const SRC = new URL("../../src", import.meta.url).pathname;
const M = new URL("./mocks/", import.meta.url).href;
const map = { "server-only": M + "empty.mjs", "@opennextjs/cloudflare": M + "cf.mjs", "next/headers": M + "headers.mjs", "next/server": M + "server.mjs", "bcryptjs": M + "bcrypt.mjs", "zod": M + "zod.mjs" };
export async function resolve(spec, ctx, next) {
  if (map[spec]) return { url: map[spec], shortCircuit: true };
  let s = spec;
  if (s.startsWith("@/")) s = pathToFileURL(SRC + "/" + s.slice(2)).href;
  else if ((s.startsWith("./") || s.startsWith("../")) && ctx.parentURL?.endsWith(".ts")) s = new URL(s, ctx.parentURL).href;
  if (s.startsWith("file:") && !/\.(m?[jt]s|json)$/.test(s)) {
    for (const ext of [".ts", "/index.ts"]) if (existsSync(new URL(s + ext))) return { url: s + ext, shortCircuit: true };
  }
  return next(s === spec ? spec : s, ctx);
}

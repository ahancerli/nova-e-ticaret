import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Integration tests import modules dynamically by path, so their shapes are untyped here.
    files: ["tests/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  globalIgnores(["node_modules/**", ".next/**", "data/**", "next-env.d.ts", "runtime-env.d.ts"]),
]);

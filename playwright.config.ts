import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests (npm run test:e2e). They run against `next dev` on its own port with an ISOLATED local D1
 * (.wrangler/e2e, rebuilt by scripts/e2e-setup.mjs before the server starts) — the developer's local
 * database is never touched. Tests are serial: they share one database and tell a story (order → admin).
 */
const PORT = 3210;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `D1_MODE=local node scripts/e2e-setup.mjs && D1_MODE=local NOVA_PERSIST_DIR=.wrangler/e2e npm run dev -- -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: "ignore",
    stderr: "pipe",
  },
});

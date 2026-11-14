import { chromium } from "playwright";
const out = "/private/tmp/claude-501/-Users-akmanhancerli-Desktop-nova/f62bdcc0-1404-4387-b0f3-e2dbb6003862/scratchpad/";
const [,, prefix, ...pages] = process.argv;
const b = await chromium.launch();
for (const spec of pages) {
  const [name, path] = spec.split("=");
  for (const [tag, w, h] of [["d", 1440, 900], ["m", 390, 844]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto("http://localhost:3000" + path, { waitUntil: "networkidle", timeout: 180000 });
    await p.waitForTimeout(600);
    await p.screenshot({ path: `${out}${prefix}-${name}-${tag}.png`, fullPage: true });
    if (errs.length) console.log(name, tag, errs.slice(0, 3));
    await p.close();
  }
}
await b.close();

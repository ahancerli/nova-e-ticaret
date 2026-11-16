export const dynamic = "force-dynamic";

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * GET — where Instagram sends the browser back (`?code=…&state=…` or `?error=access_denied`). This request arrives
 * from another site, so the panel's SameSite=Strict session cookie is not on it: nothing is decided here. The answer
 * is a tiny page that moves the browser to the channel page (now a same-site navigation, session included), whose
 * screen finishes the connection with an authenticated POST (/api/admin/social-ai/instagram/complete).
 */
export function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const pass = new URLSearchParams();
  for (const key of ["code", "state", "error"]) {
    const value = q.get(key);
    if (value && value.length <= 2000) pass.set(key === "error" ? "red" : key, value);
  }
  const target = `/admin/social-ai/instagram?${pass}`;
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${esc(target)}"><title>Instagram bağlanıyor…</title></head>` +
    `<body><p>Instagram bağlanıyor… <a href="${esc(target)}">Devam et</a></p></body></html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

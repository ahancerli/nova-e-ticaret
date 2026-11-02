// next/navigation in tests: redirect()/notFound() throw a recognisable error instead of rendering.
export function redirect(url) { const e = new Error(`NEXT_REDIRECT:${url}`); e.digest = `NEXT_REDIRECT;${url}`; throw e; }
export function notFound() { throw new Error("NEXT_NOT_FOUND"); }

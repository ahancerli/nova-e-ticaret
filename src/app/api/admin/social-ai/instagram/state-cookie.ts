/** Holds the signed state of an Instagram login in flight. Lax: it must survive the trip to instagram.com and back. */
export const IG_STATE_COOKIE = "nova_social_ig_state";

export function stateCookie(value: string, maxAgeSec: number, secure: boolean): string {
  return `${IG_STATE_COOKIE}=${value}; Path=/api/admin/social-ai/instagram; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function readStateCookie(req: Request): string | null {
  const hit = (req.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${IG_STATE_COOKIE}=`));
  return hit ? hit.slice(IG_STATE_COOKIE.length + 1) : null;
}

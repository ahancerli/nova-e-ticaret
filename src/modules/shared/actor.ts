import { UnauthorizedError, type Principal } from "@/core";

/** Who performs a command, and under which request (audit + log correlation). */
export interface Actor {
  userId: string;
  requestId: string;
}

export const actorFrom = (user: Principal, requestId: string): Actor => ({ userId: user.id, requestId });

/** Actor of an authenticated route (`auth: admin` / storefront `required`); throws if the route forgot auth. */
export function actorOf(ctx: { user: Principal | null; requestId: string }): Actor {
  if (!ctx.user) throw new UnauthorizedError();
  return actorFrom(ctx.user, ctx.requestId);
}

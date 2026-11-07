import { UnauthorizedError, type Principal } from "@/core";
import type { Viewer } from "../application/ports";

/** The signed-in staff member as a notification viewer (admin routes only; auth already ran). */
export function viewerOf(user: Principal | null): Viewer {
  if (!user) throw new UnauthorizedError();
  return { userId: user.id, permissions: [...user.permissions] };
}

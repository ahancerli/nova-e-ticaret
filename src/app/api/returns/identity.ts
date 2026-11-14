import { ValidationError, type Principal } from "@/core";

/** A signed-in customer acts on their own orders; a guest proves the order with the e-mail it was placed with. */
export function returnIdentity(user: Principal | null, email: string | undefined): { userId: string } | { email: string } {
  if (user && !user.isStaff && !email) return { userId: user.id };
  if (!email) throw ValidationError.field("email", "Siparişte kullandığınız e-postayı girin.");
  return { email };
}

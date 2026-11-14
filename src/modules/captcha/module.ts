import { CaptchaGuardToken, ClockToken, ConfigToken, DatabaseToken, LoggerToken, token, type Container, type Resolver } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { CaptchaGate, GetCaptchaSettings, GetPublicCaptchaConfig, SaveCaptchaSettings, type CaptchaDeps } from "./application/captcha-use-cases";
import type { CaptchaRepository, CaptchaVerifier } from "./application/ports";
import { D1CaptchaRepository } from "./infrastructure/d1-captcha.repository";
import { HttpCaptchaVerifier } from "./infrastructure/http-verifier";

export const CaptchaRepositoryToken = token<CaptchaRepository>("CaptchaRepository");
/** Provider siteverify client; tests replace this token with a fake. */
export const CaptchaVerifierToken = token<CaptchaVerifier>("CaptchaVerifier");
export const GetCaptchaSettingsToken = token<GetCaptchaSettings>("GetCaptchaSettings");
export const GetPublicCaptchaConfigToken = token<GetPublicCaptchaConfig>("GetPublicCaptchaConfig");
export const SaveCaptchaSettingsToken = token<SaveCaptchaSettings>("SaveCaptchaSettings");

export function registerCaptcha(c: Container): void {
  const deps = (r: Resolver): CaptchaDeps => ({
    db: r.resolve(DatabaseToken), repo: r.resolve(CaptchaRepositoryToken), verifier: r.resolve(CaptchaVerifierToken), audit: r.resolve(AuditLogToken),
    clock: r.resolve(ClockToken), logger: r.resolve(LoggerToken), masterKey: r.resolve(ConfigToken).secretsMasterKey,
  });
  c.singleton(CaptchaVerifierToken, () => new HttpCaptchaVerifier());
  c.scoped(CaptchaRepositoryToken, (r) => new D1CaptchaRepository(r.resolve(DatabaseToken)));
  c.scoped(GetCaptchaSettingsToken, (r) => new GetCaptchaSettings(r.resolve(CaptchaRepositoryToken)));
  c.scoped(GetPublicCaptchaConfigToken, (r) => new GetPublicCaptchaConfig(r.resolve(CaptchaRepositoryToken)));
  c.scoped(SaveCaptchaSettingsToken, (r) => new SaveCaptchaSettings(deps(r)));
  // route({ captcha: "<form>" }) resolves this port (core/http/router.ts)
  c.scoped(CaptchaGuardToken, (r) => new CaptchaGate(deps(r)));
}

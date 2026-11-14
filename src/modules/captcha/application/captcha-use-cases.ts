import { UnitOfWork, decryptSecret, encryptSecret, isAppError, type CaptchaGuard, type Clock, type Database, type Logger } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import { clientIp } from "@/modules/platform/module";
import type { Actor } from "@/modules/shared/actor";
import {
  CAPTCHA_HEADER, CAPTCHA_PROVIDERS, CAPTCHA_VERIFY_ACTION, judgeVerdict,
  type CaptchaSettingsInput, type CaptchaSettingsView, type PublicCaptchaConfig,
} from "../domain/captcha";
import { CaptchaErrors } from "../domain/errors";
import type { CaptchaRepository, CaptchaVerifier, SealedSecret, StoredCaptchaSettings } from "./ports";

const KEY_VERSION = "v1";
/** A token no provider issues: the answer only tells whether the secret key is known (`invalid-input-secret`). */
const PROBE_TOKEN = "nova-secret-probe";
const MAX_TOKEN_LENGTH = 4096;

export interface CaptchaDeps {
  db: Database;
  repo: CaptchaRepository;
  verifier: CaptchaVerifier;
  audit: AuditLog;
  clock: Clock;
  logger: Logger;
  /** SECRETS_MASTER_KEY (base64, 32 bytes); empty = the secret key cannot be stored or read. */
  masterKey: string;
}

const viewOf = (s: StoredCaptchaSettings): CaptchaSettingsView => ({
  enabled: s.enabled, provider: s.provider, siteKey: s.siteKey, secretHint: s.secretHint, forms: s.forms, minScore: s.minScore,
  verifiedAt: s.verifiedAt, updatedAt: s.updatedAt, updatedBy: s.updatedByName,
});

async function openSecret(masterKey: string, sealed: SealedSecret): Promise<string | null> {
  if (!masterKey) return null;
  try { return await decryptSecret(masterKey, sealed); } catch { return null; } // wrong master key: treated as not configured
}

/** Query: settings for the panel (never the secret key). */
export class GetCaptchaSettings {
  constructor(private readonly repo: CaptchaRepository) {}
  async execute(): Promise<CaptchaSettingsView | null> {
    const s = await this.repo.find();
    return s ? viewOf(s) : null;
  }
}

/** Query: what the storefront widget needs; `null` while protection is off. */
export class GetPublicCaptchaConfig {
  constructor(private readonly repo: CaptchaRepository) {}
  async execute(): Promise<PublicCaptchaConfig | null> {
    const s = await this.repo.find();
    return s?.enabled && s.forms.length ? { provider: s.provider, siteKey: s.siteKey, forms: s.forms } : null;
  }
}

/**
 * Command: save the settings. A new secret key is probed at the provider (typos / site key pasted twice are caught
 * at once), and protection can only be switched on — or its keys changed while on — with a widget token the admin
 * solved in the panel with exactly these keys. A wrong site key would otherwise lock every customer out of login.
 */
export class SaveCaptchaSettings {
  constructor(private readonly deps: CaptchaDeps) {}

  async execute(input: CaptchaSettingsInput, actor: Actor): Promise<CaptchaSettingsView> {
    const { deps } = this;
    const existing = await deps.repo.find();
    if ((existing?.updatedAt ?? null) !== input.expectedUpdatedAt) throw CaptchaErrors.changedMeanwhile();
    const newSecret = input.secretKey?.trim() ?? "";
    const providerChanged = !!existing && existing.provider !== input.provider;
    if (!existing && !newSecret) throw CaptchaErrors.secretRequired();
    if (providerChanged && !newSecret) throw CaptchaErrors.secretRequiredForProvider();
    if (newSecret && !deps.masterKey) throw CaptchaErrors.masterKeyMissing();
    if (input.enabled && !input.forms.length) throw CaptchaErrors.formsRequired();

    const secret = newSecret || (await openSecret(deps.masterKey, existing!.secret));
    if (!secret) throw CaptchaErrors.secretUnreadable();
    if (newSecret) {
      const probe = await deps.verifier.verify(input.provider, { secret, token: PROBE_TOKEN });
      if (!probe.ok && probe.codes.includes("invalid-input-secret")) throw CaptchaErrors.secretRejected();
    }

    const now = deps.clock.nowIso();
    const keysChanged = !existing || providerChanged || !!newSecret || existing.siteKey !== input.siteKey;
    let verifiedAt = keysChanged ? null : existing.verifiedAt;
    if (input.verificationToken) {
      const v = await deps.verifier.verify(input.provider, { secret, token: input.verificationToken });
      if (!v.ok || (v.action && v.action !== CAPTCHA_VERIFY_ACTION)) throw CaptchaErrors.verificationFailed(v.ok ? ["action_mismatch"] : v.codes);
      verifiedAt = now;
    }
    if (input.enabled && !verifiedAt) throw CaptchaErrors.verificationRequired();

    const sealed: SealedSecret | null = newSecret ? { ...(await encryptSecret(deps.masterKey, newSecret)), keyVersion: KEY_VERSION } : null;
    const row = {
      enabled: input.enabled, provider: input.provider, siteKey: input.siteKey.trim(), forms: [...new Set(input.forms)], minScore: input.minScore,
      verifiedAt, actorId: actor.userId, now,
    };
    const hint = newSecret ? newSecret.slice(-4) : null;
    const uow = new UnitOfWork(deps.db);
    if (existing) uow.add(deps.repo.updateStatement({ ...row, secret: sealed, secretHint: hint }, existing.updatedAt)).expectChanges(1, CaptchaErrors.changedMeanwhile);
    else uow.add(deps.repo.insertStatement({ ...row, secret: sealed!, secretHint: hint! }));
    await uow
      .add(deps.audit.recordStatement({
        actor, action: "captcha.update", entityType: "captcha_settings", entityId: "default",
        // the secret key itself never reaches the audit log
        diff: { enabled: row.enabled, provider: row.provider, siteKey: row.siteKey, forms: row.forms, minScore: row.minScore, secretChanged: !!sealed },
      }))
      .commit();
    return viewOf((await deps.repo.find())!);
  }
}

/**
 * The router's CaptchaGuard. Fails closed for a missing or rejected token, but open (logged) when the provider is
 * down or the stored secret cannot be read: an outage at Cloudflare / Google must not stop every login and sign-up,
 * and IP rate limits still apply to those routes.
 */
export class CaptchaGate implements CaptchaGuard {
  constructor(private readonly deps: Pick<CaptchaDeps, "repo" | "verifier" | "logger" | "masterKey">) {}

  async assert(req: Request, form: string): Promise<void> {
    const s = await this.deps.repo.find();
    if (!s?.enabled || !(s.forms as string[]).includes(form)) return;
    const token = req.headers.get(CAPTCHA_HEADER)?.trim();
    if (!token || token.length > MAX_TOKEN_LENGTH) throw CaptchaErrors.required();

    const secret = await openSecret(this.deps.masterKey, s.secret);
    if (!secret) {
      this.deps.logger.error("captcha secret unreadable, request let through", { form, provider: s.provider });
      return;
    }
    let verdict;
    try {
      verdict = await this.deps.verifier.verify(s.provider, { secret, token, remoteIp: clientIp(req) });
    } catch (err) {
      this.deps.logger.warn("captcha provider unreachable, request let through", { form, provider: s.provider, code: isAppError(err) ? err.code : String(err) });
      return;
    }
    const decision = judgeVerdict(verdict, { action: form, scored: CAPTCHA_PROVIDERS[s.provider].scored, minScore: s.minScore });
    if (decision === "fail") {
      this.deps.logger.info("captcha rejected", { form, provider: s.provider, ...(verdict.ok ? { score: verdict.score, action: verdict.action } : { codes: verdict.codes }) });
      throw CaptchaErrors.failed();
    }
  }
}

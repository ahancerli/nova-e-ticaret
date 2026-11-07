import { UnitOfWork, decryptSecret, encryptSecret, toBase64, type Clock, type Database } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { Actor } from "@/modules/shared/actor";
import { AiErrors } from "../domain/errors";
import { parseProductDraft } from "../domain/product-draft";
import {
  AI_IMAGE_MIME, AI_PROVIDERS, AI_PROVIDER_KEYS, keyHintOf,
  type AiHealthReport, type AiIntegrationInput, type AiIntegrationView, type AiModelCatalog, type AiTextField, type GenerateProductInput,
  type GenerateProductResult,
} from "../domain/providers";
import { CONNECTION_TEST_PROMPT, PRODUCT_CONTENT_SYSTEM_PROMPTS, buildProductUserPrompt } from "../prompts/system-prompts";
import type { AiClientFactory, AiIntegrationRepository, AiModelRepository, ImageReader, SealedKey, StoredAiIntegration } from "./ports";

const KEY_VERSION = "v1";
/** Room for thinking models (Opus 5.5 / Fable 5.1 always think; Gemini and OpenAI reasoning models count thoughts too). */
const PRODUCT_MAX_TOKENS = 8192;
const TEST_MAX_TOKENS = 1024;

export interface AiDeps {
  db: Database;
  repo: AiIntegrationRepository;
  models: AiModelRepository;
  audit: AuditLog;
  clock: Clock;
  /** SECRETS_MASTER_KEY (base64, 32 bytes). */
  masterKey: string;
  clients: AiClientFactory;
}

const viewOf = (s: StoredAiIntegration): AiIntegrationView => ({
  provider: s.provider, providerLabel: AI_PROVIDERS[s.provider].label, model: s.model, keyHint: s.keyHint, updatedAt: s.updatedAt, updatedBy: s.updatedByName,
});

/** The active integration with its decrypted key (server only). */
async function unlock(deps: AiDeps): Promise<{ stored: StoredAiIntegration; apiKey: string }> {
  const stored = await deps.repo.find();
  if (!stored) throw AiErrors.notConfigured();
  if (!deps.masterKey) throw AiErrors.masterKeyMissing();
  try {
    return { stored, apiKey: await decryptSecret(deps.masterKey, stored.key) };
  } catch {
    throw AiErrors.keyUnreadable(); // master key rotated / row tampered
  }
}

/** Query: the configured provider for the panel (never the key). */
export class GetAiIntegration {
  constructor(private readonly repo: AiIntegrationRepository) {}
  async execute(): Promise<AiIntegrationView | null> {
    const s = await this.repo.find();
    return s ? viewOf(s) : null;
  }
}

/** Query: the model select — catalog rows (db/schema.sql ai_models) per provider, default first, retired left out. */
export class ListAiModels {
  constructor(private readonly models: AiModelRepository) {}
  async execute(): Promise<AiModelCatalog> {
    const catalog = Object.fromEntries(AI_PROVIDER_KEYS.map((p) => [p, []])) as unknown as AiModelCatalog;
    for (const m of await this.models.listSelectable()) catalog[m.provider].push(m);
    return catalog;
  }
}

/**
 * Command: choose the provider, model and key. One integration at a time — choosing another provider replaces
 * it and needs that provider's key; with the same provider an empty key keeps the stored one.
 */
export class SaveAiIntegration {
  constructor(private readonly deps: AiDeps) {}

  async execute(input: AiIntegrationInput, actor: Actor): Promise<AiIntegrationView> {
    const existing = await this.deps.repo.find();
    if ((existing?.updatedAt ?? null) !== input.expectedUpdatedAt) throw AiErrors.changedMeanwhile();
    const apiKey = input.apiKey?.trim();
    if (!apiKey && (!existing || existing.provider !== input.provider)) throw AiErrors.keyRequired();
    if (apiKey && !this.deps.masterKey) throw AiErrors.masterKeyMissing();
    const model = input.model.trim();
    // Only catalog models; the stored one may stay (e.g. key rotation) even after it left the list.
    const keepsModel = existing?.provider === input.provider && existing.model === model;
    const listed = await this.deps.models.find(input.provider, model);
    if (!keepsModel && (!listed || listed.status === "retired")) throw AiErrors.modelNotListed();

    const key: SealedKey | null = apiKey ? { ...(await encryptSecret(this.deps.masterKey, apiKey)), keyVersion: KEY_VERSION } : null;
    const keyHint = apiKey ? keyHintOf(apiKey) : null;
    const now = this.deps.clock.nowIso();
    const row = { provider: input.provider, model, actorId: actor.userId, now };
    const uow = new UnitOfWork(this.deps.db);
    if (existing) uow.add(this.deps.repo.updateStatement({ ...row, key, keyHint }, existing.updatedAt)).expectChanges(1, AiErrors.changedMeanwhile);
    else uow.add(this.deps.repo.insertStatement({ ...row, key: key!, keyHint: keyHint! }));
    await uow
      .add(this.deps.audit.recordStatement({
        actor, action: existing ? "ai_integration.update" : "ai_integration.create", entityType: "ai_integration", entityId: input.provider,
        diff: { provider: input.provider, model: row.model, keyChanged: !!apiKey, ...(existing && existing.provider !== input.provider ? { previousProvider: existing.provider } : {}) },
      }))
      .commit();
    const saved = await this.deps.repo.find();
    return viewOf(saved!);
  }
}

/** Command: remove the integration (and its key). "AI ile ürün ekle" disappears from the product editor. */
export class RemoveAiIntegration {
  constructor(private readonly deps: AiDeps) {}

  async execute(expectedUpdatedAt: string, actor: Actor): Promise<void> {
    const existing = await this.deps.repo.find();
    if (!existing) throw AiErrors.notConfigured();
    await new UnitOfWork(this.deps.db)
      .add(this.deps.repo.deleteStatement(expectedUpdatedAt))
      .expectChanges(1, AiErrors.changedMeanwhile)
      .add(this.deps.audit.recordStatement({ actor, action: "ai_integration.delete", entityType: "ai_integration", entityId: existing.provider, diff: { model: existing.model } }))
      .commit();
  }
}

/**
 * Command: health check of the stored integration. Step 1 asks the provider's models endpoint for the model (free:
 * proves the key and that the account can see the model); step 2 sends a tiny text request (proves the generation
 * path — headers, body, answer parsing — end to end). Failures surface as the mapped AiErrors.
 */
export class TestAiIntegration {
  constructor(private readonly deps: AiDeps) {}

  async execute(): Promise<AiHealthReport> {
    const { stored, apiKey } = await unlock(this.deps);
    const client = this.deps.clients(stored.provider);
    let started = Date.now();
    const info = await client.checkModel(apiKey, stored.model);
    const modelCheckMs = Date.now() - started;
    started = Date.now();
    await client.generate({
      model: stored.model, apiKey, system: CONNECTION_TEST_PROMPT.system, text: CONNECTION_TEST_PROMPT.user, images: [], maxTokens: TEST_MAX_TOKENS, json: false,
    });
    const generationMs = Date.now() - started;
    const listed = await this.deps.models.find(stored.provider, stored.model);
    return {
      provider: AI_PROVIDERS[stored.provider].label, model: stored.model, displayName: info.displayName,
      deprecated: info.deprecated || (listed?.status ?? "active") !== "active", retiresAt: info.retiresAt ?? listed?.retiresAt ?? null,
      modelCheckMs, generationMs,
    };
  }
}

/**
 * Command: "AI ile ürün ekle". Sends the active provider's system prompt (prompts/system-prompts.ts), the admin's
 * photos and description; returns a draft of the requested text fields. Nothing is saved to the product: the
 * editor fills the form and the admin reviews and saves as usual. The call is audited (it costs money).
 */
export class GenerateProductContent {
  constructor(private readonly deps: AiDeps, private readonly images: ImageReader) {}

  async execute(input: GenerateProductInput, actor: Actor): Promise<GenerateProductResult> {
    const { stored, apiKey } = await unlock(this.deps);
    const fields = input.fields.filter((f): f is AiTextField => f !== "images");
    const label = AI_PROVIDERS[stored.provider].label;
    if (!fields.length) return { draft: {}, provider: stored.provider, providerLabel: label, model: stored.model };

    const images = [];
    for (const id of input.mediaIds) {
      const img = await this.images.readImage(id);
      if (!img) throw AiErrors.imageMissing();
      if (!(AI_IMAGE_MIME as readonly string[]).includes(img.mime)) throw AiErrors.imageUnsupported();
      images.push({ mime: img.mime, base64: toBase64(img.bytes) });
    }

    const answer = await this.deps.clients(stored.provider).generate({
      model: stored.model, apiKey, system: PRODUCT_CONTENT_SYSTEM_PROMPTS[stored.provider],
      text: buildProductUserPrompt(fields, input.prompt, images.length), images, maxTokens: PRODUCT_MAX_TOKENS, json: true,
    });
    const draft = parseProductDraft(answer, fields);
    if (!draft) throw AiErrors.badOutput();

    await new UnitOfWork(this.deps.db)
      .add(this.deps.audit.recordStatement({
        actor, action: "ai.product_generate", entityType: "ai_integration", entityId: stored.provider,
        diff: { model: stored.model, fields: input.fields, images: images.length, returned: Object.keys(draft) },
      }))
      .commit();
    return { draft, provider: stored.provider, providerLabel: label, model: stored.model };
  }
}

import { unlock, type AiDeps } from "./ai-use-cases";
import type { AiChat, AiChatMessage, AiChatTurn, AiToolDef } from "./ports";

/** Room for the answer plus the thinking of models that always think. */
const CHAT_MAX_TOKENS = 4096;

/** The shop's AI provider as a tool-use conversation partner for other modules (Social AI Marketing). */
export class ProviderAiChat implements AiChat {
  constructor(private readonly deps: AiDeps) {}

  async status() {
    const stored = await this.deps.repo.find();
    return { ready: !!stored && !!this.deps.masterKey, provider: stored?.provider ?? null, model: stored?.model ?? null };
  }

  async turn(input: { system: string; messages: AiChatMessage[]; tools: AiToolDef[]; maxTokens?: number }): Promise<AiChatTurn> {
    const { stored, apiKey } = await unlock(this.deps);
    return this.deps.clients(stored.provider).converse({
      model: stored.model, apiKey, system: input.system, messages: input.messages, tools: input.tools, maxTokens: input.maxTokens ?? CHAT_MAX_TOKENS,
    });
  }
}

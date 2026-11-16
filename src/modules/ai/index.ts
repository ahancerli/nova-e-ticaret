/** Public surface of the AI module: the shop's single AI provider (OpenAI / Gemini / Claude) and "AI ile ürün ekle". */
export * from "./domain/providers";
export { extractJsonObject, parseProductDraft } from "./domain/product-draft";
export { aiIntegrationDeleteSchema, aiIntegrationSchema, aiProductGenerateSchema } from "./http/schemas";
export type { AiChat, AiChatMessage, AiChatTurn, AiToolCall, AiToolDef } from "./application/ports";
export {
  AiChatToken, AiClientFactoryToken, GenerateProductContentToken, GetAiIntegrationToken, ListAiModelsToken, RemoveAiIntegrationToken, SaveAiIntegrationToken, TestAiIntegrationToken, registerAi,
} from "./module";

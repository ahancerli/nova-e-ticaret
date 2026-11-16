/**
 * Public surface of the Social AI Marketing module: an AI assistant that answers WhatsApp and Instagram messages with
 * the shop's catalog and content (panel: Social AI Marketing › WhatsApp, Instagram, Konuşmalar, Bot ayarları).
 */
export * from "./domain/social-ai";
export { SocialAiErrors } from "./domain/errors";
export { BOT_TOOLS, FIXED_RULES, TOOL_LABELS, TOOL_NAMES, buildSystemPrompt, type ReferralContext, type ToolName } from "./domain/prompt";
export { ChannelSendError, type ChannelAdapter, type ChannelAdapters, type ChannelCredentials, type MetaConnect, type OutboundMessage, type StoreKnowledge } from "./application/ports";
export type { BotReply, ToolTrace } from "./application/bot-brain";
export type { ProcessOutcome } from "./application/conversation-use-cases";
export { INSTAGRAM_CALLBACK_PATH, WEBHOOK_PATH, type MetaAppInput, type PreviewInput, type ReferralMapInput } from "./application/setup-use-cases";
export { FakeChannelAdapter } from "./infrastructure/channels/fake";
export { InstagramAdapter } from "./infrastructure/channels/instagram";
export { WhatsAppAdapter } from "./infrastructure/channels/whatsapp";
export { HttpMetaConnect, INSTAGRAM_SCOPES, INSTAGRAM_WEBHOOK_FIELDS } from "./infrastructure/http-meta-connect";
export { GRAPH_VERSION } from "./infrastructure/meta-http";
export { metaSignatureValid } from "./infrastructure/meta-signature";
export {
  botSettingsSchema, channelUpdateSchema, conversationQuerySchema, conversationStatusSchema, manualConnectSchema, metaAppSchema, previewSchema, referralMapSchema, socialChannelParams,
  socialIdParams, staffReplySchema, whatsappConnectSchema,
} from "./http/schemas";
export {
  BotBrainToken, ChannelAdaptersToken, CompleteInstagramLoginToken, ConnectManuallyToken, ConnectWhatsAppToken, DeleteReferralMapToken, DeliverMessageToken, DisconnectChannelToken,
  GetBotSettingsToken, GetChannelOverviewToken, GetConversationToken, ListConversationsToken, ListReferralMapsToken, MarkConversationReadToken, MetaConnectToken, PreviewBotToken,
  ProcessConversationToken, ProcessDueConversationsToken, ReceiveWebhookToken, RefreshChannelTokensToken, RunRetentionToken, SaveMetaAppToken, SaveReferralMapToken, SendStaffReplyToken,
  SetConversationStatusToken, SocialAiRepositoryToken, StartInstagramLoginToken, StoreKnowledgeToken, TestChannelToken, UpdateBotSettingsToken, UpdateChannelToken, registerSocialAi,
} from "./module";

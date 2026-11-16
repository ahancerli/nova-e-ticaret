import { ClockToken, ConfigToken, DatabaseToken, IdGeneratorToken, LoggerToken, token, type Container, type Resolver } from "@/core";
import { AiChatToken } from "@/modules/ai";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { GetPublishedPageToken, ListPagesToken } from "@/modules/content";
import { GetDeliveryRulesToken } from "@/modules/delivery";
import { NotificationPublisherToken } from "@/modules/notifications";
import { addOutboxHandler } from "@/modules/outbox";
import { GetProductQuestionsToken } from "@/modules/questions";
import { GetPublicSettingsToken } from "@/modules/settings";
import { GetProductSizeChartToken } from "@/modules/size-charts";
import { GetProductCardsToken, GetProductDetailToken, ListCatalogProductsToken } from "@/modules/storefront";
import { BotBrain } from "./application/bot-brain";
import {
  DeliverMessage, GetConversation, ListConversations, MarkConversationRead, ProcessConversation, ProcessDueConversations, ReceiveWebhook, RefreshChannelTokens, RunRetention,
  SendStaffReply, SetConversationStatus,
} from "./application/conversation-use-cases";
import type { ChannelAdapter, ChannelAdapters, MetaConnect, StoreKnowledge } from "./application/ports";
import {
  CompleteInstagramLogin, ConnectManually, ConnectWhatsApp, DeleteReferralMap, DisconnectChannel, GetBotSettings, GetChannelOverview, ListReferralMaps, PreviewBot, SaveMetaApp,
  SaveReferralMap, StartInstagramLogin, TestChannel, UpdateBotSettings, UpdateChannel,
} from "./application/setup-use-cases";
import type { SocialAiDeps } from "./application/shared";
import type { Channel } from "./domain/social-ai";
import { InstagramAdapter } from "./infrastructure/channels/instagram";
import { WhatsAppAdapter } from "./infrastructure/channels/whatsapp";
import { D1SocialAiRepository } from "./infrastructure/d1-social-ai.repository";
import { HttpMetaConnect } from "./infrastructure/http-meta-connect";
import { D1StoreFacts, ModuleStoreKnowledge } from "./infrastructure/store-knowledge";

/** Channel → adapter (Strategy registry). A new channel = one adapter + one line; tests swap in FakeChannelAdapter. */
export const ChannelAdaptersToken = token<ChannelAdapters>("SocialAiChannelAdapters");
/** Meta set-up calls (OAuth exchange, webhook subscription, token refresh); tests replace it with a fake. */
export const MetaConnectToken = token<MetaConnect>("SocialAiMetaConnect");
export const StoreKnowledgeToken = token<StoreKnowledge>("SocialAiStoreKnowledge");
export const SocialAiRepositoryToken = token<D1SocialAiRepository>("SocialAiRepository");
export const BotBrainToken = token<BotBrain>("SocialAiBotBrain");

export const ReceiveWebhookToken = token<ReceiveWebhook>("SocialAiReceiveWebhook");
export const ProcessConversationToken = token<ProcessConversation>("SocialAiProcessConversation");
export const ProcessDueConversationsToken = token<ProcessDueConversations>("SocialAiProcessDueConversations");
export const DeliverMessageToken = token<DeliverMessage>("SocialAiDeliverMessage");
export const RunRetentionToken = token<RunRetention>("SocialAiRunRetention");
export const RefreshChannelTokensToken = token<RefreshChannelTokens>("SocialAiRefreshChannelTokens");

export const GetChannelOverviewToken = token<GetChannelOverview>("SocialAiGetChannelOverview");
export const SaveMetaAppToken = token<SaveMetaApp>("SocialAiSaveMetaApp");
export const ConnectWhatsAppToken = token<ConnectWhatsApp>("SocialAiConnectWhatsApp");
export const StartInstagramLoginToken = token<StartInstagramLogin>("SocialAiStartInstagramLogin");
export const CompleteInstagramLoginToken = token<CompleteInstagramLogin>("SocialAiCompleteInstagramLogin");
export const ConnectManuallyToken = token<ConnectManually>("SocialAiConnectManually");
export const UpdateChannelToken = token<UpdateChannel>("SocialAiUpdateChannel");
export const DisconnectChannelToken = token<DisconnectChannel>("SocialAiDisconnectChannel");
export const TestChannelToken = token<TestChannel>("SocialAiTestChannel");

export const GetBotSettingsToken = token<GetBotSettings>("SocialAiGetBotSettings");
export const UpdateBotSettingsToken = token<UpdateBotSettings>("SocialAiUpdateBotSettings");
export const ListReferralMapsToken = token<ListReferralMaps>("SocialAiListReferralMaps");
export const SaveReferralMapToken = token<SaveReferralMap>("SocialAiSaveReferralMap");
export const DeleteReferralMapToken = token<DeleteReferralMap>("SocialAiDeleteReferralMap");
export const PreviewBotToken = token<PreviewBot>("SocialAiPreviewBot");

export const ListConversationsToken = token<ListConversations>("SocialAiListConversations");
export const GetConversationToken = token<GetConversation>("SocialAiGetConversation");
export const SetConversationStatusToken = token<SetConversationStatus>("SocialAiSetConversationStatus");
export const MarkConversationReadToken = token<MarkConversationRead>("SocialAiMarkConversationRead");
export const SendStaffReplyToken = token<SendStaffReply>("SocialAiSendStaffReply");

export function registerSocialAi(c: Container): void {
  const deps = (r: Resolver): SocialAiDeps => {
    const config = r.resolve(ConfigToken);
    return {
      db: r.resolve(DatabaseToken), repo: r.resolve(SocialAiRepositoryToken), audit: r.resolve(AuditLogToken), notifications: r.resolve(NotificationPublisherToken),
      clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken), logger: r.resolve(LoggerToken), masterKey: config.secretsMasterKey, keyVersion: config.secretsKeyVersion,
      sessionSecret: config.sessionSecret, siteUrl: config.publicSiteUrl, adapters: r.resolve(ChannelAdaptersToken), meta: r.resolve(MetaConnectToken), ai: r.resolve(AiChatToken),
      knowledge: r.resolve(StoreKnowledgeToken), brain: r.resolve(BotBrainToken),
    };
  };
  c.singleton(ChannelAdaptersToken, () => {
    const adapters: Record<Channel, ChannelAdapter> = { whatsapp: new WhatsAppAdapter(), instagram: new InstagramAdapter() };
    return (channel) => adapters[channel];
  });
  c.singleton(MetaConnectToken, () => new HttpMetaConnect());
  c.scoped(SocialAiRepositoryToken, (r) => new D1SocialAiRepository(r.resolve(DatabaseToken)));
  c.scoped(StoreKnowledgeToken, (r) => new ModuleStoreKnowledge({
    listProducts: r.resolve(ListCatalogProductsToken), productDetail: r.resolve(GetProductDetailToken), productCards: r.resolve(GetProductCardsToken), pages: r.resolve(ListPagesToken),
    publishedPage: r.resolve(GetPublishedPageToken), questions: r.resolve(GetProductQuestionsToken), sizeChart: r.resolve(GetProductSizeChartToken),
    deliveryRules: r.resolve(GetDeliveryRulesToken), settings: r.resolve(GetPublicSettingsToken),
  }, new D1StoreFacts(r.resolve(DatabaseToken)), r.resolve(ConfigToken).publicSiteUrl, r.resolve(ClockToken)));
  c.scoped(BotBrainToken, (r) => new BotBrain(r.resolve(AiChatToken), r.resolve(StoreKnowledgeToken), r.resolve(ClockToken), r.resolve(LoggerToken)));

  c.scoped(ReceiveWebhookToken, (r) => new ReceiveWebhook(deps(r)));
  c.scoped(DeliverMessageToken, (r) => new DeliverMessage(deps(r)));
  c.scoped(ProcessConversationToken, (r) => new ProcessConversation(deps(r), r.resolve(DeliverMessageToken)));
  c.scoped(ProcessDueConversationsToken, (r) => new ProcessDueConversations(deps(r), r.resolve(ProcessConversationToken)));
  c.scoped(RunRetentionToken, (r) => new RunRetention(deps(r)));
  c.scoped(RefreshChannelTokensToken, (r) => new RefreshChannelTokens(deps(r)));

  c.scoped(GetChannelOverviewToken, (r) => new GetChannelOverview(deps(r)));
  c.scoped(SaveMetaAppToken, (r) => new SaveMetaApp(deps(r)));
  c.scoped(ConnectWhatsAppToken, (r) => new ConnectWhatsApp(deps(r)));
  c.scoped(StartInstagramLoginToken, (r) => new StartInstagramLogin(deps(r)));
  c.scoped(CompleteInstagramLoginToken, (r) => new CompleteInstagramLogin(deps(r)));
  c.scoped(ConnectManuallyToken, (r) => new ConnectManually(deps(r)));
  c.scoped(UpdateChannelToken, (r) => new UpdateChannel(deps(r)));
  c.scoped(DisconnectChannelToken, (r) => new DisconnectChannel(deps(r)));
  c.scoped(TestChannelToken, (r) => new TestChannel(deps(r)));

  c.scoped(GetBotSettingsToken, (r) => new GetBotSettings(deps(r)));
  c.scoped(UpdateBotSettingsToken, (r) => new UpdateBotSettings(deps(r)));
  c.scoped(ListReferralMapsToken, (r) => new ListReferralMaps(deps(r)));
  c.scoped(SaveReferralMapToken, (r) => new SaveReferralMap(deps(r)));
  c.scoped(DeleteReferralMapToken, (r) => new DeleteReferralMap(deps(r)));
  c.scoped(PreviewBotToken, (r) => new PreviewBot(deps(r)));

  c.scoped(ListConversationsToken, (r) => new ListConversations(deps(r)));
  c.scoped(GetConversationToken, (r) => new GetConversation(deps(r)));
  c.scoped(SetConversationStatusToken, (r) => new SetConversationStatus(deps(r)));
  c.scoped(MarkConversationReadToken, (r) => new MarkConversationRead(deps(r)));
  c.scoped(SendStaffReplyToken, (r) => new SendStaffReply(deps(r), r.resolve(DeliverMessageToken)));

  // Retry path of outgoing messages: the immediate send failed or the process died before it. Idempotent — a message
  // that is no longer `pending` is skipped.
  addOutboxHandler("social_ai.send", (r) => ({
    async handle(payload) {
      const result = await r.resolve(DeliverMessageToken).execute(String(payload.messageId ?? ""));
      return { result: result === "skipped" ? "skipped" : "done", detail: result };
    },
  }));
}

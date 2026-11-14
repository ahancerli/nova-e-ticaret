/** Public surface of the live support module: shop widget (members), panel inbox, settings, live event hub. */
export * from "./domain/support";
export { SupportErrors } from "./domain/errors";
export { PRESENCE_CHANNEL, STAFF_CHANNEL, customerChannel, type SupportHub } from "./application/ports";
export {
  supportConversationRefSchema, supportCustomerMessageSchema, supportCustomerReadSchema, supportInboxQuerySchema, supportMessagesQuerySchema,
  supportReadSchema, supportSettingsSchema, supportStaffMessageSchema, supportStatusSchema, supportStreamQuerySchema,
} from "./http/schemas";
export {
  GetCustomerSupportBadgeToken, GetCustomerSupportToken, GetPublicSupportConfigToken, GetStaffConversationToken, GetSupportSettingsToken, ListSupportInboxToken, MarkCustomerReadToken,
  MarkStaffReadToken, SendCustomerMessageToken, SendStaffMessageToken, SetSupportStatusToken, SignalCustomerTypingToken, SignalStaffTypingToken,
  SupportHubToken, SupportRepositoryToken, UpdateSupportSettingsToken, registerSupport,
} from "./module";

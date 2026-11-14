import { ClockToken, DatabaseToken, IdGeneratorToken, token, type Container, type Resolver } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { NotificationPublisherToken } from "@/modules/notifications";
import type { SupportHub, SupportRepository } from "./application/ports";
import {
  GetCustomerSupport, GetCustomerSupportBadge, GetPublicSupportConfig, GetStaffConversation, GetSupportSettings, ListSupportInbox, MarkCustomerRead, MarkStaffRead,
  SendCustomerMessage, SendStaffMessage, SetSupportStatus, SignalCustomerTyping, SignalStaffTyping, UpdateSupportSettings, type SupportDeps,
} from "./application/support-use-cases";
import { D1SupportRepository } from "./infrastructure/d1-support.repository";
import { supportHub } from "./infrastructure/in-process-hub";

export const SupportRepositoryToken = token<SupportRepository>("SupportRepository");
export const SupportHubToken = token<SupportHub>("SupportHub");
export const GetSupportSettingsToken = token<GetSupportSettings>("GetSupportSettings");
export const UpdateSupportSettingsToken = token<UpdateSupportSettings>("UpdateSupportSettings");
export const GetPublicSupportConfigToken = token<GetPublicSupportConfig>("GetPublicSupportConfig");
export const GetCustomerSupportToken = token<GetCustomerSupport>("GetCustomerSupport");
export const GetCustomerSupportBadgeToken = token<GetCustomerSupportBadge>("GetCustomerSupportBadge");
export const SendCustomerMessageToken = token<SendCustomerMessage>("SendCustomerMessage");
export const MarkCustomerReadToken = token<MarkCustomerRead>("MarkCustomerRead");
export const SignalCustomerTypingToken = token<SignalCustomerTyping>("SignalCustomerTyping");
export const ListSupportInboxToken = token<ListSupportInbox>("ListSupportInbox");
export const GetStaffConversationToken = token<GetStaffConversation>("GetStaffConversation");
export const SendStaffMessageToken = token<SendStaffMessage>("SendStaffMessage");
export const MarkStaffReadToken = token<MarkStaffRead>("MarkStaffRead");
export const SignalStaffTypingToken = token<SignalStaffTyping>("SignalStaffTyping");
export const SetSupportStatusToken = token<SetSupportStatus>("SetSupportStatus");

export function registerSupport(c: Container): void {
  const deps = (r: Resolver): SupportDeps => ({
    db: r.resolve(DatabaseToken), support: r.resolve(SupportRepositoryToken), hub: r.resolve(SupportHubToken),
    notifications: r.resolve(NotificationPublisherToken), audit: r.resolve(AuditLogToken), clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken),
  });
  // the hub holds live listeners: one per process, shared by every route bundle (globalThis)
  c.singleton(SupportHubToken, () => supportHub());
  c.scoped(SupportRepositoryToken, (r) => new D1SupportRepository(r.resolve(DatabaseToken)));
  c.scoped(GetSupportSettingsToken, (r) => new GetSupportSettings(r.resolve(SupportRepositoryToken)));
  c.scoped(UpdateSupportSettingsToken, (r) => new UpdateSupportSettings(deps(r)));
  c.scoped(GetPublicSupportConfigToken, (r) => new GetPublicSupportConfig(r.resolve(SupportRepositoryToken)));
  c.scoped(GetCustomerSupportToken, (r) => new GetCustomerSupport(r.resolve(SupportRepositoryToken), r.resolve(SupportHubToken)));
  c.scoped(GetCustomerSupportBadgeToken, (r) => new GetCustomerSupportBadge(r.resolve(SupportRepositoryToken)));
  c.scoped(SendCustomerMessageToken, (r) => new SendCustomerMessage(deps(r)));
  c.scoped(MarkCustomerReadToken, (r) => new MarkCustomerRead(deps(r)));
  c.scoped(SignalCustomerTypingToken, (r) => new SignalCustomerTyping(r.resolve(SupportRepositoryToken), r.resolve(SupportHubToken)));
  c.scoped(ListSupportInboxToken, (r) => new ListSupportInbox(r.resolve(SupportRepositoryToken)));
  c.scoped(GetStaffConversationToken, (r) => new GetStaffConversation(r.resolve(SupportRepositoryToken)));
  c.scoped(SendStaffMessageToken, (r) => new SendStaffMessage(deps(r)));
  c.scoped(MarkStaffReadToken, (r) => new MarkStaffRead(deps(r)));
  c.scoped(SignalStaffTypingToken, (r) => new SignalStaffTyping(r.resolve(SupportRepositoryToken), r.resolve(SupportHubToken)));
  c.scoped(SetSupportStatusToken, (r) => new SetSupportStatus(deps(r)));
}

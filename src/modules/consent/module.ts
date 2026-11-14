import { ClockToken, ConfigToken, DatabaseToken, IdGeneratorToken, LoggerToken, token, type Container, type Resolver } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { GetCookiePolicyToken } from "@/modules/content";
import { addOutboxHandler } from "@/modules/outbox";
import {
  GetConsentAdmin, GetConsentConfig, ListConsentRecords, RecordConsent, RemoveTrackingTag, RenewConsent, SaveTrackingTag, UpdateConsentSettings,
  type ConsentDeps,
} from "./application/consent-use-cases";
import type { ConsentRepository, CookiePolicySource } from "./application/ports";
import { CaptureOrderTracking, SendServerPurchase, fetchTrackingHttp, type TrackingHttp } from "./application/server-tracking";
import { D1ConsentRepository } from "./infrastructure/d1-consent.repository";

export const ConsentRepositoryToken = token<ConsentRepository>("ConsentRepository");
/** Storefront layout: banner + tags to load after consent. */
export const GetConsentConfigToken = token<GetConsentConfig>("GetConsentConfig");
export const GetConsentAdminToken = token<GetConsentAdmin>("GetConsentAdmin");
export const UpdateConsentSettingsToken = token<UpdateConsentSettings>("UpdateConsentSettings");
export const RenewConsentToken = token<RenewConsent>("RenewConsent");
export const SaveTrackingTagToken = token<SaveTrackingTag>("SaveTrackingTag");
export const RemoveTrackingTagToken = token<RemoveTrackingTag>("RemoveTrackingTag");
export const RecordConsentToken = token<RecordConsent>("RecordConsent");
export const ListConsentRecordsToken = token<ListConsentRecords>("ListConsentRecords");
/** Checkout confirm: consent + vendor cookies for the server-side purchase. */
export const CaptureOrderTrackingToken = token<CaptureOrderTracking>("CaptureOrderTracking");
/** HTTP client of the vendors' server APIs (tests swap it). */
export const TrackingHttpToken = token<TrackingHttp>("TrackingHttp");

export function registerConsent(c: Container): void {
  const policy = (r: Resolver): CookiePolicySource => () => r.resolve(GetCookiePolicyToken).execute();
  const deps = (r: Resolver): ConsentDeps => ({
    db: r.resolve(DatabaseToken), repo: r.resolve(ConsentRepositoryToken), audit: r.resolve(AuditLogToken), clock: r.resolve(ClockToken),
    ids: r.resolve(IdGeneratorToken), policy: policy(r), masterKey: r.resolve(ConfigToken).secretsMasterKey,
  });
  c.scoped(ConsentRepositoryToken, (r) => new D1ConsentRepository(r.resolve(DatabaseToken)));
  c.scoped(GetConsentConfigToken, (r) => new GetConsentConfig(r.resolve(ConsentRepositoryToken), policy(r)));
  c.scoped(GetConsentAdminToken, (r) => new GetConsentAdmin(r.resolve(ConsentRepositoryToken), policy(r), r.resolve(ClockToken)));
  c.scoped(UpdateConsentSettingsToken, (r) => new UpdateConsentSettings(deps(r)));
  c.scoped(RenewConsentToken, (r) => new RenewConsent(deps(r)));
  c.scoped(SaveTrackingTagToken, (r) => new SaveTrackingTag(deps(r)));
  c.scoped(RemoveTrackingTagToken, (r) => new RemoveTrackingTag(deps(r)));
  c.scoped(RecordConsentToken, (r) => new RecordConsent(deps(r)));
  c.scoped(ListConsentRecordsToken, (r) => new ListConsentRecords(r.resolve(ConsentRepositoryToken)));
  c.scoped(CaptureOrderTrackingToken, (r) => new CaptureOrderTracking({ db: r.resolve(DatabaseToken), repo: r.resolve(ConsentRepositoryToken), policy: policy(r), clock: r.resolve(ClockToken) }));
  c.singleton(TrackingHttpToken, () => fetchTrackingHttp);
  // purchase from the server once the payment is confirmed (card settled / bank transfer reconciled)
  addOutboxHandler("order.paid", (r) => new SendServerPurchase({
    db: r.resolve(DatabaseToken), repo: r.resolve(ConsentRepositoryToken), clock: r.resolve(ClockToken), logger: r.resolve(LoggerToken),
    http: r.resolve(TrackingHttpToken), masterKey: r.resolve(ConfigToken).secretsMasterKey,
  }));
}

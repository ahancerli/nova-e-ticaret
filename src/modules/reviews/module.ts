import { ClockToken, ConfigToken, DatabaseToken, IdGeneratorToken, LoggerToken, token, type Container, type Resolver } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { MailSenderToken } from "@/modules/mail";
import { NotificationPublisherToken } from "@/modules/notifications";
import { GetPublicSettingsToken } from "@/modules/settings";
import type { ReviewRepository } from "./application/ports";
import {
  ContactReviewer, GetProductReviews, GetReview, GetReviewEligibility, GetReviewSettings, ListMyReviews, ListReviews, ModerateReviews, ReplyToReview,
  SetReviewContactStatus, SubmitReview, UpdateReviewSettings, VoteReview, type ReviewDeps,
} from "./application/review-use-cases";
import { D1ReviewRepository } from "./infrastructure/d1-review.repository";

export const ReviewRepositoryToken = token<ReviewRepository>("ReviewRepository");
export const GetProductReviewsToken = token<GetProductReviews>("GetProductReviews");
export const GetReviewEligibilityToken = token<GetReviewEligibility>("GetReviewEligibility");
export const SubmitReviewToken = token<SubmitReview>("SubmitReview");
export const VoteReviewToken = token<VoteReview>("VoteReview");
export const ListMyReviewsToken = token<ListMyReviews>("ListMyReviews");
export const ListReviewsToken = token<ListReviews>("ListReviews");
export const GetReviewToken = token<GetReview>("GetReview");
export const ModerateReviewsToken = token<ModerateReviews>("ModerateReviews");
export const ReplyToReviewToken = token<ReplyToReview>("ReplyToReview");
export const ContactReviewerToken = token<ContactReviewer>("ContactReviewer");
export const SetReviewContactStatusToken = token<SetReviewContactStatus>("SetReviewContactStatus");
export const GetReviewSettingsToken = token<GetReviewSettings>("GetReviewSettings");
export const UpdateReviewSettingsToken = token<UpdateReviewSettings>("UpdateReviewSettings");

export function registerReviews(c: Container): void {
  const deps = (r: Resolver): ReviewDeps => ({
    db: r.resolve(DatabaseToken), reviews: r.resolve(ReviewRepositoryToken), notifications: r.resolve(NotificationPublisherToken),
    audit: r.resolve(AuditLogToken), clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken),
  });
  c.scoped(ReviewRepositoryToken, (r) => new D1ReviewRepository(r.resolve(DatabaseToken)));
  c.scoped(GetProductReviewsToken, (r) => new GetProductReviews(r.resolve(ReviewRepositoryToken)));
  c.scoped(GetReviewEligibilityToken, (r) => new GetReviewEligibility(r.resolve(ReviewRepositoryToken)));
  c.scoped(SubmitReviewToken, (r) => new SubmitReview(deps(r)));
  c.scoped(VoteReviewToken, (r) => new VoteReview(r.resolve(DatabaseToken), r.resolve(ReviewRepositoryToken)));
  c.scoped(ListMyReviewsToken, (r) => new ListMyReviews(r.resolve(ReviewRepositoryToken)));
  c.scoped(ListReviewsToken, (r) => new ListReviews(r.resolve(ReviewRepositoryToken)));
  c.scoped(GetReviewToken, (r) => new GetReview(r.resolve(ReviewRepositoryToken)));
  c.scoped(ModerateReviewsToken, (r) => new ModerateReviews(deps(r)));
  c.scoped(ReplyToReviewToken, (r) => new ReplyToReview(deps(r)));
  c.scoped(ContactReviewerToken, (r) => new ContactReviewer(
    deps(r), r.resolve(MailSenderToken), async () => (await r.resolve(GetPublicSettingsToken).execute()).siteName, r.resolve(ConfigToken).publicSiteUrl, r.resolve(LoggerToken),
  ));
  c.scoped(SetReviewContactStatusToken, (r) => new SetReviewContactStatus(deps(r)));
  c.scoped(GetReviewSettingsToken, (r) => new GetReviewSettings(r.resolve(ReviewRepositoryToken)));
  c.scoped(UpdateReviewSettingsToken, (r) => new UpdateReviewSettings(deps(r)));
}

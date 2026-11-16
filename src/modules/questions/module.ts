import { ClockToken, ConfigToken, DatabaseToken, IdGeneratorToken, LoggerToken, token, type Container, type Resolver } from "@/core";
import { AuditLogToken } from "@/modules/audit/audit-log";
import { MailSenderToken } from "@/modules/mail";
import { NotificationPublisherToken } from "@/modules/notifications";
import { GetPublicSettingsToken } from "@/modules/settings";
import type { QuestionRepository } from "./application/ports";
import { AnswerQuestion, AskQuestion, GetProductQuestions, GetQuestion, ListQuestions, RejectQuestion, type QuestionDeps } from "./application/question-use-cases";
import { D1QuestionRepository } from "./infrastructure/d1-question.repository";

export const QuestionRepositoryToken = token<QuestionRepository>("QuestionRepository");
export const GetProductQuestionsToken = token<GetProductQuestions>("GetProductQuestions");
export const AskQuestionToken = token<AskQuestion>("AskQuestion");
export const ListQuestionsToken = token<ListQuestions>("ListQuestions");
export const GetQuestionToken = token<GetQuestion>("GetQuestion");
export const AnswerQuestionToken = token<AnswerQuestion>("AnswerQuestion");
export const RejectQuestionToken = token<RejectQuestion>("RejectQuestion");

export function registerQuestions(c: Container): void {
  const deps = (r: Resolver): QuestionDeps => ({
    db: r.resolve(DatabaseToken), questions: r.resolve(QuestionRepositoryToken), notifications: r.resolve(NotificationPublisherToken),
    audit: r.resolve(AuditLogToken), clock: r.resolve(ClockToken), ids: r.resolve(IdGeneratorToken),
  });
  c.scoped(QuestionRepositoryToken, (r) => new D1QuestionRepository(r.resolve(DatabaseToken)));
  c.scoped(GetProductQuestionsToken, (r) => new GetProductQuestions(r.resolve(QuestionRepositoryToken)));
  c.scoped(AskQuestionToken, (r) => new AskQuestion(deps(r)));
  c.scoped(ListQuestionsToken, (r) => new ListQuestions(r.resolve(QuestionRepositoryToken)));
  c.scoped(GetQuestionToken, (r) => new GetQuestion(r.resolve(QuestionRepositoryToken)));
  c.scoped(AnswerQuestionToken, (r) => new AnswerQuestion(deps(r), {
    mail: r.resolve(MailSenderToken), brand: async () => (await r.resolve(GetPublicSettingsToken).execute()).siteName,
    siteUrl: r.resolve(ConfigToken).publicSiteUrl, logger: r.resolve(LoggerToken),
  }));
  c.scoped(RejectQuestionToken, (r) => new RejectQuestion(deps(r)));
}

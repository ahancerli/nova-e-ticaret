/** Public surface of the payments module (card payments through the provider gateway). */
export { TOKEN_PATTERN, detailMatchesPayment, type CheckoutFormDetail } from "./domain/payment";
export type { PaymentGateway } from "./application/ports";
export type { VerifyResult } from "./application/card-payments";
export { PaymentGatewayToken, ProcessCardRefundToken, StartCardPaymentToken, VerifyCardPaymentToken, registerPayments } from "./module";

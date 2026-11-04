import type { PaymentOptions } from "@/modules/payments";

/** IBANs to pay a bank-transfer order into (checkout and the order result page). */
export function BankAccounts({ accounts, orderNo }: { accounts: PaymentOptions["bankAccounts"]; orderNo?: string | null }) {
  if (accounts.length === 0) return null;
  return (
    <ul className="space-y-2 text-left">
      {accounts.map((a) => (
        <li key={a.iban} className="rounded-xl border border-line bg-white p-4 text-sm">
          <p className="font-semibold">{a.bankName}</p>
          <p className="text-ink-soft">{a.accountHolder}</p>
          <p className="mt-1 select-all break-all font-mono text-base tracking-wide">{a.iban}</p>
          {(a.instructions || orderNo) && (
            <p className="mt-2 text-xs text-ink-soft">{a.instructions}{a.instructions && orderNo ? " " : ""}{orderNo ? <>Açıklama: <strong className="text-ink">{orderNo}</strong></> : null}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

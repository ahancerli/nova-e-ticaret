"use client";

import Link from "next/link";
import { Suspense } from "react";
import { LoginForm } from "@/features/auth/LoginForm";

/**
 * First step of checkout for a visitor who is not signed in: sign in (the cart merges into the account), continue
 * as a guest, or create an account — all three come back to the payment step.
 */
export function CheckoutGate({ onGuest, itemCount }: { onGuest: () => void; itemCount: number }) {
  return (
    <div className="container-page max-w-5xl py-10">
      <h1 className="text-2xl font-bold">Ödeme</h1>
      <p className="mt-1 text-sm text-ink-soft">Sepetinizde {itemCount} ürün var. Nasıl devam etmek istersiniz?</p>
      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <section className="card p-5 lg:col-span-1" aria-labelledby="gate-login">
          <h2 id="gate-login" className="text-lg font-semibold">Üye girişi</h2>
          <p className="mb-4 text-sm text-ink-soft">Bilgileriniz dolu gelsin, siparişinizi hesabınızdan takip edin.</p>
          <Suspense><LoginForm audience="storefront" fallbackTarget="/odeme" card={false} submitLabel="Giriş yap ve devam et" /></Suspense>
          <p className="mt-3 text-center text-sm"><Link href="/sifremi-unuttum" className="text-ink-soft hover:text-brand">Şifremi unuttum</Link></p>
        </section>
        <section className="card flex flex-col p-5" aria-labelledby="gate-guest">
          <h2 id="gate-guest" className="text-lg font-semibold">Misafir olarak devam et</h2>
          <p className="mb-4 text-sm text-ink-soft">Üye olmadan sipariş verin. Sipariş bilgileri e-posta adresinize gönderilir.</p>
          <ul className="mb-5 space-y-1.5 text-sm text-ink-soft">
            <li>✓ Hızlı ödeme</li><li>✓ Kayıt gerekmez</li><li>✓ Sipariş numarasıyla takip</li>
          </ul>
          <button type="button" onClick={onGuest} className="btn btn-ghost mt-auto w-full">Misafir olarak devam et</button>
        </section>
        <section className="card flex flex-col p-5" aria-labelledby="gate-signup">
          <h2 id="gate-signup" className="text-lg font-semibold">Üye ol</h2>
          <p className="mb-4 text-sm text-ink-soft">Bir dakikada üye olun; sepetiniz korunur, sonraki alışverişlerinizde bilgileriniz hazır olur.</p>
          <ul className="mb-5 space-y-1.5 text-sm text-ink-soft">
            <li>✓ Sipariş geçmişi ve kargo takibi</li><li>✓ Üyelere özel kampanyalar</li><li>✓ Daha hızlı ödeme</li>
          </ul>
          <Link href="/uye-ol?next=%2Fodeme" className="btn btn-primary mt-auto w-full">Üye ol ve devam et</Link>
        </section>
      </div>
    </div>
  );
}

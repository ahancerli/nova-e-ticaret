import Link from "next/link";
import { AdminCard, AdminPageHeader } from "@/components/admin/ui";
import { linksOf, visibleNav } from "@/features/admin-shell/nav";
import { requireAdminPage } from "@/server/app";

export const metadata = { title: "Kullanım kılavuzu" };
export const dynamic = "force-dynamic";

/** The order a new shop is set up in: each step needs the one before it. */
const SETUP: Array<{ title: string; text: string; href: string; perm?: string }> = [
  { title: "Mağaza kimliği", text: "Firma bilgilerini, logoyu ve marka rengini girin. Fatura ve e-postalarda bu bilgiler kullanılır.", href: "/admin/ayarlar", perm: "settings.write" },
  { title: "Ödeme yöntemleri", text: "iyzico anahtarlarını girin veya havale hesabı ekleyin. En az bir yöntem açık değilse müşteri siparişi tamamlayamaz.", href: "/admin/odemeler", perm: "payments.secrets" },
  { title: "Kargo", text: "Kargo seçeneklerini ve ücretlerini tanımlayın. İsterseniz kargo firmanızı bağlayın, takip numarası otomatik gelsin.", href: "/admin/kargo-ucretleri", perm: "settings.write" },
  { title: "E-posta hesabı", text: "SMTP hesabını bağlayın. Sipariş onayı, şifre sıfırlama ve davet e-postaları bu hesaptan gider.", href: "/admin/entegrasyonlar/e-posta", perm: "integrations.write" },
  { title: "Yasal metinler", text: "Mesafeli satış sözleşmesi, ön bilgilendirme, KVKK ve iade koşullarını yayınlayın. Ödeme adımında müşteriye bunlar onaylatılır.", href: "/admin/icerik", perm: "content.write" },
  { title: "Katalog yapısı", text: "Önce kategorileri, markaları ve varyant özelliklerini (renk, beden) oluşturun.", href: "/admin/kategoriler", perm: "catalog.write" },
  { title: "Ürünler", text: "Ürünleri tek tek veya Toplu işlemler ile Excel'den ekleyin, fiyat ve stok girin, yayına alın.", href: "/admin/urunler", perm: "catalog.read" },
  { title: "Vitrin", text: "Ana sayfadaki slider'ı, ürün bloklarını ve üst menüyü düzenleyin.", href: "/admin/vitrin", perm: "storefront.write" },
  { title: "Ekip", text: "Çalışma arkadaşlarınızı davet edin ve her birine işine uygun rolü verin.", href: "/admin/kullanicilar", perm: "users.manage" },
];

const TASKS: Array<{ title: string; perm?: string; steps: string[] }> = [
  {
    title: "Bir siparişi kargoya vermek", perm: "orders.write",
    steps: [
      "Siparişler sayfasında siparişi açın. Ödemesi alınmış siparişler “Ödendi” durumundadır.",
      "“Hazırlanıyor” adımına alın, ürünleri paketleyin.",
      "“Kargoya ver” ile kargo firmasını ve takip numarasını girin. Kargo entegrasyonu bağlıysa numara kendiliğinden oluşur.",
      "Müşteriye kargo bilgisi e-posta (ve açıksa SMS) ile gider. Teslim edildiğinde sipariş “Teslim edildi” olur.",
    ],
  },
  {
    title: "Havale ile ödenen siparişi onaylamak", perm: "payments.reconcile",
    steps: [
      "Dashboard'daki “Havale onayı bekliyor” kutusuna tıklayın.",
      "Banka hesabınıza gelen tutarı ve açıklamadaki referans kodunu siparişle karşılaştırın.",
      "Tutar doğruysa havaleyi onaylayın. Sipariş “Ödendi” olur ve hazırlamaya başlayabilirsiniz.",
    ],
  },
  {
    title: "Yeni ürün eklemek", perm: "catalog.write",
    steps: [
      "Ürünler sayfasında “Yeni ürün” ile başlayın (veya üst çubuktaki “Yeni” düğmesi).",
      "Adı, kategoriyi ve markayı seçin, görselleri yükleyin. İlk görsel kapak olur.",
      "Renk veya beden varsa varyant eksenlerini seçin. Her varyant için barkod, fiyat ve stok girin.",
      "“Yayınla” dediğinizde ürün mağazada görünür. Taslak ürünler yalnızca panelde durur.",
    ],
  },
  {
    title: "İndirim kampanyası açmak", perm: "campaigns.write",
    steps: [
      "Kampanyalar ve kuponlar sayfasında “Yeni kampanya”yı açın.",
      "İndirim türünü seçin: yüzde, sabit tutar, 3 al 2 öde, sepette indirim veya ücretsiz kargo.",
      "Hangi ürün, kategori veya markada geçerli olacağını ve tarih aralığını belirleyin.",
      "Kupon koduyla çalışmasını istiyorsanız kupon ekleyin. Kampanyayı etkinleştirin.",
    ],
  },
  {
    title: "Kısmi iptal ve para iadesi", perm: "orders.write",
    steps: [
      "Sipariş detayında “Ürün iptal et”i açın ve iptal edilecek adetleri seçin.",
      "Panel iade edilecek tutarı gösterir: kampanya koşulu bozuluyorsa fark düşülür.",
      "Onayladığınızda kart ödemelerinde iade iyzico üzerinden başlar, stok geri eklenir.",
    ],
  },
  {
    title: "Panele yeni kullanıcı eklemek", perm: "users.manage",
    steps: [
      "Sistem › Ekip ve yetkiler › Kullanıcılar sayfasında “Kullanıcı davet et”e tıklayın.",
      "Ad, e-posta ve rol seçin. Ürün Sorumlusu yalnızca kataloğu, Sipariş Sorumlusu siparişleri ve müşterileri, Reklam ve Pazarlama kampanya ve vitrini görür. Yönetici her şeyi görür.",
      "Oluşan tek kullanımlık davet bağlantısını kişiye iletin. Bağlantıyı açan kişi kendi parolasını belirler.",
      "Hazır roller yetmezse Roller ve yetkiler sayfasında kendi rolünüzü oluşturun.",
    ],
  },
];

export default async function AdminGuidePage() {
  const user = await requireAdminPage();
  const has = (p?: string) => !p || user.permissions.has(p);
  const groups = visibleNav((p) => user.permissions.has(p));
  const setup = SETUP.filter((s) => has(s.perm));
  const tasks = TASKS.filter((t) => has(t.perm));
  const jump = "rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:border-[#7367f0] hover:text-[#5b4fe0]";

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <AdminPageHeader title="Kullanım kılavuzu" subtitle="Panelin bölümleri ve sık yapılan işler. Yalnızca yetkiniz olan bölümler listelenir." />

      <nav aria-label="Kılavuz bölümleri" className="flex flex-wrap gap-2">
        {setup.length > 0 ? <a href="#kurulum" className={jump}>İlk kurulum</a> : null}
        {tasks.length > 0 ? <a href="#isler" className={jump}>Sık yapılan işler</a> : null}
        {groups.map((g) => <a key={g.title} href={`#${encodeURIComponent(g.title)}`} className={jump}>{g.title}</a>)}
        <a href="#ipuclari" className={jump}>İpuçları</a>
      </nav>

      {setup.length > 0 ? (
        <section id="kurulum" className="scroll-mt-24">
          <h2 className="font-display text-xl font-semibold text-[#191640]">İlk kurulum</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">Mağazayı satışa açmadan önce bu sırayı izleyin. Her adım bir öncekine dayanır.</p>
          <AdminCard className="mt-4">
            <ol className="divide-y divide-slate-100">
              {setup.map((s, i) => (
                <li key={s.href} className="flex items-start gap-4 px-5 py-4">
                  <span className="grid size-8 flex-none place-items-center rounded-full bg-[#191640] text-sm font-semibold tabular-nums text-white">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900">{s.title}</p>
                    <p className="mt-0.5 max-w-2xl text-sm leading-6 text-slate-600">{s.text}</p>
                  </div>
                  <Link href={s.href} className="flex-none self-center rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-[#7367f0] hover:text-[#5b4fe0]">Sayfayı aç</Link>
                </li>
              ))}
            </ol>
          </AdminCard>
        </section>
      ) : null}

      {tasks.length > 0 ? (
        <section id="isler" className="scroll-mt-24">
          <h2 className="font-display text-xl font-semibold text-[#191640]">Sık yapılan işler</h2>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {tasks.map((t) => (
              <AdminCard key={t.title} className="p-5">
                <h3 className="font-semibold text-slate-900">{t.title}</h3>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-slate-600 marker:font-semibold marker:text-[#7367f0]">
                  {t.steps.map((step) => <li key={step}>{step}</li>)}
                </ol>
              </AdminCard>
            ))}
          </div>
        </section>
      ) : null}

      {groups.map((g) => (
        <section key={g.title} id={encodeURIComponent(g.title)} className="scroll-mt-24">
          <h2 className="flex items-center gap-2.5 font-display text-xl font-semibold text-[#191640]">
            <span aria-hidden className="size-3 rounded-full" style={{ backgroundColor: g.tone }} />
            {g.title}
          </h2>
          <p className="mt-1 text-sm text-slate-600">{g.info}</p>
          <AdminCard className="mt-4 divide-y divide-slate-100">
            {g.items.map((item) => (
              <div key={item.type === "link" ? item.href : item.label} className="px-5 py-4">
                {item.type === "nest" ? (
                  <p className="mb-3 text-sm"><span className="font-semibold text-slate-900">{item.label}</span> <span className="text-slate-500">{item.info}</span></p>
                ) : null}
                <dl className={item.type === "nest" ? "space-y-3 border-l-2 border-slate-100 pl-4" : ""}>
                  {linksOf(item).map((l) => (
                    <div key={l.href} id={encodeURIComponent(l.href)} className="scroll-mt-24 target:rounded-lg target:bg-indigo-50/70 target:outline target:outline-8 target:outline-indigo-50/70">
                      <dt><Link href={l.href} className="font-medium text-[#5b4fe0] underline-offset-2 hover:underline">{l.label}</Link></dt>
                      <dd className="mt-0.5 max-w-2xl text-sm leading-6 text-slate-600">{l.info}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </AdminCard>
        </section>
      ))}

      <section id="ipuclari" className="scroll-mt-24">
        <h2 className="font-display text-xl font-semibold text-[#191640]">İpuçları</h2>
        <AdminCard className="mt-4 p-5">
          <ul className="max-w-2xl list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600">
            <li><kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs font-medium text-slate-700">Ctrl</kbd> veya <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs font-medium text-slate-700">⌘</kbd> + <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs font-medium text-slate-700">K</kbd> ile her sayfaya adını yazarak gidebilirsiniz.</li>
            <li>Üst çubukta sayfa adının yanındaki bilgi düğmesi, o sayfanın ne işe yaradığını söyler.</li>
            <li>Listelerde sütun başlığına tıklayarak sıralayabilir, filtreleyebilir ve Excel dosyası olarak indirebilirsiniz.</li>
            <li>Aynı kaydı iki kişi aynı anda düzenlerse ikinci kayıt reddedilir ve sayfayı yenilemeniz istenir. Böylece kimsenin değişikliği sessizce silinmez.</li>
            <li>Yaptığınız her değişiklik Denetim kayıtlarına adınızla yazılır.</li>
            <li>Menüde görmediğiniz bir bölüm için yöneticinizden rolünüze yetki eklemesini isteyin.</li>
          </ul>
        </AdminCard>
      </section>
    </div>
  );
}

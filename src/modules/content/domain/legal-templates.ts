import type { LegalType } from "./page";

/**
 * Starting texts for legal pages. {{placeholders}} are filled from Site ayarları when the page is shown, so the
 * same template fits any company. These are generic samples — the admin shows a reminder that they must be
 * reviewed by the company's legal counsel before publishing.
 */
export const LEGAL_TEMPLATES: Record<LegalType, { title: string; summary: string; bodyHtml: string }> = {
  distance_sales: {
    title: "Mesafeli Satış Sözleşmesi",
    summary: "6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği kapsamında taraflar arasındaki satış sözleşmesi.",
    bodyHtml: `<h2>1. Taraflar</h2>
<p><strong>Satıcı:</strong> {{firma.unvan}}<br>Adres: {{firma.adres}}<br>Vergi dairesi / no: {{firma.vergi_dairesi}} / {{firma.vergi_no}}<br>MERSİS no: {{firma.mersis_no}}<br>Telefon: {{iletisim.telefon}} · E-posta: {{iletisim.eposta}} · KEP: {{firma.kep}}</p>
<p><strong>Alıcı:</strong> {{site.adres}} üzerinden sipariş veren ve sipariş sırasında bilgileri alınan kişidir. Alıcının adı, teslimat ve fatura adresi, telefon ve e-posta bilgileri sipariş özetinde yer alır.</p>
<h2>2. Konu</h2>
<p>Bu sözleşmenin konusu, Alıcının {{site.adres}} internet sitesinden elektronik ortamda siparişini verdiği, nitelikleri ve satış fiyatı sipariş özetinde belirtilen ürünün satışı ve teslimine ilişkin tarafların hak ve yükümlülüklerinin belirlenmesidir.</p>
<h2>3. Ürün, fiyat ve ödeme</h2>
<p>Ürünün türü, miktarı, marka/modeli, rengi, KDV dahil satış bedeli, kargo ücreti ve ödeme şekli sipariş özetinde ve Alıcıya gönderilen sipariş onayı e-postasında yer alır. Listelenen fiyatlar satış fiyatıdır ve güncelleme yapılana kadar geçerlidir.</p>
<h2>4. Teslimat</h2>
<ul><li>Ürün, Alıcının sipariş sırasında belirttiği teslimat adresine kargo ile gönderilir.</li><li>Teslimat, yasal 30 günlük süreyi aşmamak kaydıyla sipariş onayından itibaren en kısa sürede yapılır.</li><li>Teslim anında Alıcının adreste bulunmaması hâlinde Satıcı edimini yerine getirmiş sayılır; kargo firmasının bildirimine göre ürün teslim alınmalıdır.</li></ul>
<h2>5. Cayma hakkı</h2>
<p>Alıcı, ürünü teslim aldığı tarihten itibaren <strong>14 gün</strong> içinde herhangi bir gerekçe göstermeksizin ve cezai şart ödemeksizin sözleşmeden cayabilir. Cayma bildirimi {{iletisim.eposta}} adresine veya {{iletisim.telefon}} numaralı telefona yapılabilir. Ayrıntılar İade ve Cayma Koşulları sayfasında açıklanmıştır.</p>
<h2>6. Cayma hakkının kullanılamayacağı hâller</h2>
<p>Mesafeli Sözleşmeler Yönetmeliğinin 15. maddesinde sayılan; Alıcının istekleri doğrultusunda kişiselleştirilen, çabuk bozulabilen, ambalajı açılmış hijyenik ürünler ile elektronik ortamda anında ifa edilen hizmetlerde cayma hakkı kullanılamaz.</p>
<h2>7. Uyuşmazlıkların çözümü</h2>
<p>Bu sözleşmeden doğan uyuşmazlıklarda, Ticaret Bakanlığınca ilan edilen parasal sınırlar dahilinde Alıcının yerleşim yerindeki veya işlemin yapıldığı yerdeki Tüketici Hakem Heyetleri, bu sınırları aşan durumlarda Tüketici Mahkemeleri yetkilidir.</p>
<h2>8. Yürürlük</h2>
<p>Alıcı, siparişi onaylamadan önce bu sözleşmeyi ve Ön Bilgilendirme Formunu okuduğunu ve elektronik ortamda onayladığını kabul eder. Sözleşme, siparişin onaylandığı anda yürürlüğe girer.</p>`,
  },
  pre_information: {
    title: "Ön Bilgilendirme Formu",
    summary: "Mesafeli sözleşme kurulmadan önce tüketiciye verilmesi gereken bilgiler.",
    bodyHtml: `<h2>1. Satıcı bilgileri</h2>
<p>Unvan: {{firma.unvan}}<br>Adres: {{firma.adres}}<br>Telefon: {{iletisim.telefon}}<br>E-posta: {{iletisim.eposta}}<br>MERSİS no: {{firma.mersis_no}}</p>
<h2>2. Ürünün temel nitelikleri ve fiyatı</h2>
<p>Satın alınan ürünlerin temel nitelikleri, adedi ve vergiler dahil toplam fiyatı ödeme sayfasındaki sipariş özetinde gösterilir. Kargo ücreti varsa ayrıca belirtilir ve toplam tutara eklenir.</p>
<h2>3. Ödeme ve teslimat</h2>
<ul><li>Ödeme; kredi/banka kartı veya havale/EFT ile yapılır.</li><li>Havale/EFT ile verilen siparişlerde ödeme, sipariş sonrasında bildirilen süre içinde yapılmalıdır; aksi hâlde sipariş iptal edilir.</li><li>Ürün, sipariş özetinde belirtilen adrese en geç 30 gün içinde teslim edilir.</li></ul>
<h2>4. Cayma hakkı</h2>
<p>Tüketici, malı teslim aldığı tarihten itibaren 14 gün içinde cayma hakkına sahiptir. Cayma hakkının kullanılması hâlinde ürün bedeli, cayma bildiriminin Satıcıya ulaşmasından itibaren 14 gün içinde ödemenin yapıldığı yönteme uygun şekilde iade edilir.</p>
<h2>5. Şikâyet ve itiraz</h2>
<p>Şikâyet ve itirazlarınızı {{iletisim.eposta}} adresine iletebilirsiniz ({{iletisim.calisma_saatleri}}). Tüketici, parasal sınırlar dahilinde Tüketici Hakem Heyetine veya Tüketici Mahkemesine başvurabilir.</p>`,
  },
  kvkk: {
    title: "KVKK Aydınlatma Metni",
    summary: "6698 sayılı Kişisel Verilerin Korunması Kanunu uyarınca kişisel verilerinizin işlenmesine ilişkin aydınlatma.",
    bodyHtml: `<p>{{firma.unvan}} (“Şirket”) olarak, veri sorumlusu sıfatıyla kişisel verilerinizi 6698 sayılı Kişisel Verilerin Korunması Kanunu (“KVKK”) ve ilgili mevzuata uygun şekilde işlemekteyiz.</p>
<h2>1. İşlenen kişisel veriler</h2>
<ul><li>Kimlik ve iletişim: ad soyad, e-posta, telefon</li><li>Teslimat ve fatura adresi</li><li>Sipariş ve işlem bilgileri (ödeme kartı bilgileri Şirketimizce saklanmaz; ödeme kuruluşu tarafından işlenir)</li><li>İşlem güvenliği: IP adresi, oturum ve log kayıtları</li></ul>
<h2>2. İşleme amaçları</h2>
<p>Kişisel verileriniz; siparişlerinizin alınması, ödemenin tahsili, ürünlerin teslimi, fatura düzenlenmesi, müşteri hizmetleri, yasal yükümlülüklerin yerine getirilmesi ve işlem güvenliğinin sağlanması amaçlarıyla işlenir.</p>
<h2>3. Aktarım</h2>
<p>Verileriniz bu amaçlarla sınırlı olarak kargo firmalarına, ödeme kuruluşlarına, mali müşavirlik ve bilgi teknolojisi hizmet sağlayıcılarımıza ve kanunen yetkili kamu kurumlarına aktarılabilir.</p>
<h2>4. Toplama yöntemi ve hukuki sebep</h2>
<p>Verileriniz {{site.adres}} üzerindeki formlar aracılığıyla elektronik ortamda; sözleşmenin kurulması ve ifası, hukuki yükümlülük ve meşru menfaat hukuki sebeplerine dayanılarak toplanır.</p>
<h2>5. Haklarınız</h2>
<p>KVKK’nın 11. maddesi uyarınca verilerinizin işlenip işlenmediğini öğrenme, düzeltilmesini veya silinmesini isteme ve itiraz etme haklarına sahipsiniz. Başvurularınızı {{firma.kvkk_eposta}} adresine veya {{firma.adres}} adresine yazılı olarak iletebilirsiniz.</p>
<p>Son güncelleme: {{sayfa.guncelleme}}</p>`,
  },
  privacy: {
    title: "Gizlilik Politikası",
    summary: "Sitemizi kullanırken bilgilerinizin nasıl korunduğu.",
    bodyHtml: `<p>{{site.adi}} olarak gizliliğinize önem veriyoruz. Bu politika, {{site.adres}} adresini ziyaret ettiğinizde ve alışveriş yaptığınızda bilgilerinizin nasıl toplandığını, kullanıldığını ve korunduğunu açıklar.</p>
<h2>Güvenlik</h2>
<p>Sitemizdeki tüm bağlantılar şifrelidir (HTTPS). Kart bilgileriniz sistemlerimizde saklanmaz; ödeme, lisanslı ödeme kuruluşunun güvenli sayfasında tamamlanır.</p>
<h2>Kullanım</h2>
<p>Bilgileriniz yalnızca siparişlerinizi yerine getirmek, sizinle iletişim kurmak ve yasal yükümlülüklerimizi yerine getirmek için kullanılır. İzniniz olmadan pazarlama iletisi gönderilmez.</p>
<h2>İletişim</h2>
<p>Sorularınız için {{iletisim.eposta}} adresinden bize ulaşabilirsiniz. Kişisel verilerinize ilişkin ayrıntılar KVKK Aydınlatma Metninde yer alır.</p>`,
  },
  cookies: {
    title: "Çerez Politikası",
    summary: "Sitemizde kullanılan çerezler ve tercihleriniz.",
    bodyHtml: `<p>{{site.adres}} adresinde, sitenin çalışması için gerekli çerezler kullanılır.</p>
<h2>Zorunlu çerezler</h2>
<table><thead><tr><th>Çerez</th><th>Amaç</th><th>Süre</th></tr></thead><tbody><tr><td>Oturum</td><td>Giriş yapan kullanıcının oturumunu sürdürmek</td><td>Oturum boyunca</td></tr><tr><td>Sepet</td><td>Sepetinizdeki ürünleri hatırlamak</td><td>30 gün</td></tr><tr><td>Güvenlik</td><td>Form gönderimlerini sahteciliğe karşı korumak</td><td>Oturum boyunca</td></tr></tbody></table>
<h2>Tercihleriniz</h2>
<p>Tarayıcınızın ayarlarından çerezleri silebilir veya engelleyebilirsiniz; zorunlu çerezler engellenirse sepet ve ödeme adımları çalışmayabilir.</p>
<p>Sorularınız için: {{iletisim.eposta}}</p>`,
  },
  return_policy: {
    title: "İade ve Cayma Koşulları",
    summary: "14 gün içinde koşulsuz iade hakkınız ve iade süreci.",
    bodyHtml: `<p>Satın aldığınız ürünü teslim aldığınız tarihten itibaren <strong>14 gün</strong> içinde gerekçe göstermeden iade edebilirsiniz.</p>
<h2>İade nasıl yapılır?</h2>
<ol><li>{{iletisim.eposta}} adresine sipariş numaranızla birlikte iade talebinizi iletin veya {{iletisim.telefon}} numarasından bize ulaşın.</li><li>Ürünü, faturası ve tüm aksesuarlarıyla birlikte, mümkünse orijinal ambalajında paketleyin.</li><li>Size iletilen iade kodu ile ürünü anlaşmalı kargo firmasına teslim edin.</li></ol>
<h2>Ücret iadesi</h2>
<p>İade edilen ürün depomuza ulaşıp kontrol edildikten sonra ödemeniz en geç 14 gün içinde, ödeme yaptığınız yönteme iade edilir. Kartla yapılan ödemelerin hesabınıza yansıma süresi bankanıza bağlıdır.</p>
<h2>İade edilemeyen ürünler</h2>
<ul><li>Ambalajı açılmış iç giyim, kozmetik ve kişisel bakım ürünleri</li><li>Size özel üretilen veya kişiselleştirilen ürünler</li><li>Çabuk bozulabilen ürünler</li></ul>
<p>Çalışma saatlerimiz: {{iletisim.calisma_saatleri}}</p>`,
  },
  terms_of_use: {
    title: "Kullanım Koşulları",
    summary: "Sitenin kullanımına ilişkin kurallar.",
    bodyHtml: `<p>{{site.adres}} internet sitesi {{firma.unvan}} tarafından işletilmektedir. Siteyi kullanan herkes aşağıdaki koşulları kabul etmiş sayılır.</p>
<h2>Fikri mülkiyet</h2>
<p>Sitedeki tüm içerik, görsel, logo ve tasarımların hakları {{firma.unvan}} veya ilgili hak sahiplerine aittir; izinsiz kopyalanamaz ve kullanılamaz.</p>
<h2>Fiyat ve stok bilgileri</h2>
<p>Ürün fiyatları ve stok durumu önceden haber verilmeksizin değişebilir. Açık bir hata içeren fiyatla verilen siparişler iptal edilebilir; bu durumda ödemeniz iade edilir.</p>
<h2>Değişiklikler</h2>
<p>Bu koşullar gerektiğinde güncellenir; güncel metin her zaman bu sayfada yayımlanır.</p>`,
  },
  membership: {
    title: "Üyelik Sözleşmesi",
    summary: "Üye hesabı oluşturan kullanıcılarla yapılan sözleşme.",
    bodyHtml: `<h2>1. Taraflar</h2>
<p>Bu sözleşme, {{firma.unvan}} (“{{site.adi}}”) ile {{site.adres}} üzerinde üye hesabı oluşturan kullanıcı (“Üye”) arasında, üyelik kaydının tamamlanmasıyla kurulur.</p>
<h2>2. Üyenin yükümlülükleri</h2>
<ul><li>Üyelik bilgilerinin doğru ve güncel olması Üyenin sorumluluğundadır.</li><li>Hesap şifresinin gizliliğini korumak Üyeye aittir.</li><li>Site, hukuka aykırı amaçlarla kullanılamaz.</li></ul>
<h2>3. Fesih</h2>
<p>Üye, dilediği zaman {{iletisim.eposta}} adresine başvurarak üyeliğini sonlandırabilir. Yasal saklama yükümlülükleri saklıdır.</p>`,
  },
};

-- =============================================================================
-- NOVA — DEVELOPMENT / DEMO SEED (no real customer data, no secrets, no IBAN)
-- Apply after schema.sql:  npm run db:seed:remote
-- Safe to re-run: INSERT OR IGNORE everywhere.
-- Demo users' passwords are not documented: create your own admin with
--   npm run admin:create:local -- you@example.com "Name"     (remote: npm run admin:create)
-- In production delete or re-password admin@nova.local / musteri@nova.local.
-- =============================================================================

-- RBAC ------------------------------------------------------------------------
INSERT OR IGNORE INTO roles (id, code, name, description, is_system) VALUES
 ('role_customer','customer','Müşteri','Mağaza üyeleri. Personele atanamaz.',1),
 ('role_catalog','catalog_manager','Katalog Yöneticisi','Ürün, kategori, marka ve vitrin içeriklerini yönetir.',1),
 ('role_order','order_manager','Sipariş Yöneticisi','Siparişleri hazırlar, kargolar, iade ve havale onayı yapar.',1),
 ('role_marketing','marketing_manager','Pazarlama','Kampanya, vitrin ve içerik sayfalarını yönetir.',1),
 ('role_admin','admin','Yönetici','Tüm yetkiler. Kullanıcı ve rol yönetimi dahil.',1);

INSERT OR IGNORE INTO permissions (id, code, description) VALUES
 ('perm_01','catalog.read','Katalog görüntüleme (panel)'),
 ('perm_02','catalog.write','Ürün/varyant/kategori/marka düzenleme'),
 ('perm_03','catalog.publish','Ürün yayına alma'),
 ('perm_04','orders.read','Sipariş liste/detay'),
 ('perm_05','orders.write','Sipariş durum, sevkiyat, iade'),
 ('perm_06','payments.reconcile','Havale mutabakat onayı'),
 ('perm_07','storefront.write','Slider, hikaye, ana sayfa blokları'),
 ('perm_08','campaigns.write','Kampanya ve kupon yönetimi'),
 ('perm_09','integrations.write','Entegrasyon yapılandırma'),
 ('perm_10','payments.secrets','Ödeme anahtarı değiştirme (MFA)'),
 ('perm_11','users.manage','Kullanıcı ve rol ataması'),
 ('perm_12','audit.read','Denetim kaydı okuma'),
 ('perm_13','settings.write','Genel site ve SEO ayarları'),
 ('perm_14','customers.read','Müşteri bilgisi görüntüleme'),
 ('perm_15','content.write','İçerik yönetimi: yasal metinler, kurumsal ve yardım sayfaları'),
 ('perm_16','customers.write','Müşteri hesabı düzenleme, askıya alma, şifre sıfırlama bağlantısı'),
 ('perm_17','reviews.moderate','Ürün yorumlarını onaylama, yanıtlama, müşteriyle iletişim'),
 ('perm_18','support.chat','Canlı destek konuşmalarını yanıtlama');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
 ('role_catalog','perm_01'),('role_catalog','perm_02'),('role_catalog','perm_07'),
 ('role_order','perm_04'),('role_order','perm_05'),('role_order','perm_06'),('role_order','perm_14'),('role_order','perm_16'),
 ('role_marketing','perm_01'),('role_marketing','perm_07'),('role_marketing','perm_08'),('role_marketing','perm_15'),('role_marketing','perm_17');
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) SELECT 'role_admin', id FROM permissions;

-- Core config -------------------------------------------------------------------
INSERT OR IGNORE INTO warehouses (id, code, name) VALUES ('wh_main','MAIN','Ana Depo');
INSERT OR IGNORE INTO price_lists (id, code, name, currency, tax_inclusive) VALUES ('pl_retail','RETAIL_TRY','Perakende TRY','TRY',1);

-- Site configuration (sample company — fictitious; replace from Panel → Site ayarları). Keys: src/modules/settings/domain/registry.ts
INSERT OR IGNORE INTO site_settings (key, group_name, value_json, is_public) VALUES
 ('site.name','general','"nova."',1),
 ('site.tagline','general','"Her gün yeni bir keşif."',1),
 ('site.announcement','general','{"text":"Yeni sezonun iyi gelen keşifleri NOVA''da.","href":"/kampanyalar"}',1),
 ('company.legal_name','company','"Nova Elektronik Ticaret A.Ş."',1),
 ('company.address','company','"Maslak Mah. Büyükdere Cad. No: 255 Kat: 4\n34485 Sarıyer / İstanbul"',1),
 ('company.tax_office','company','"Maslak"',1),
 ('company.tax_number','company','"1234567890"',1),
 ('company.mersis_no','company','"0123456789000015"',1),
 ('company.trade_registry_no','company','"123456-5"',1),
 ('company.kep_address','company','"nova@hs01.kep.tr"',1),
 ('company.data_controller_contact','company','"kvkk@example.com"',1),
 ('contact.email','contact','"destek@example.com"',1),
 ('contact.phone','contact','"+90 212 000 00 00"',1),
 ('contact.whatsapp','contact','"+90 555 000 00 00"',1),
 ('contact.hours','contact','"Hafta içi 09:00–18:00"',1),
 ('branding.accent_color','branding','"#f26a1b"',1),
 ('seo.default_title','seo','"nova. | Her gün yeni bir keşif"',1),
 ('seo.title_template','seo','"%s | nova."',1),
 ('seo.default_description','seo','"Modadan elektroniğe, evden kitaba binlerce ürün."',1),
 ('seo.allow_indexing','seo','true',1),
 ('social.instagram','social','"https://www.instagram.com/example"',1),
 ('social.x','social','"https://x.com/example"',1),
 ('social.youtube','social','"https://www.youtube.com/@example"',1),
 ('footer.copyright','footer','"© {{yil}} nova. Tüm hakları saklıdır."',1),
 ('footer.trust_badges','footer','["Güvenli ödeme","Özenli teslimat","Seçilmiş markalar","Kolay destek"]',1),
 ('footer.payment_note','footer','"iyzico · Havale / EFT · TL"',1);

INSERT OR IGNORE INTO payment_configs (id, provider, name, environment, is_active) VALUES
 ('pc_iyzico_sbx','iyzico','iyzico (sandbox)','sandbox',0),
 ('pc_bank','bank_transfer','Havale / EFT','production',0);

INSERT OR IGNORE INTO shipping_methods (id, code, name, fee_minor, free_above_minor) VALUES
 ('sm_std','STANDARD','Standart Teslimat',3990,50000);

-- Media (placeholder paths under /public/demo) ---------------------------------
INSERT OR IGNORE INTO media_assets (id, storage_key, public_url, mime_type, byte_size, width, height, alt_text, rights_note) VALUES
 ('m_hero1','demo/hero-1.svg','/demo/hero-1.svg','image/svg+xml',1200,1600,640,'Yeni sezon seçkisi','demo'),
 ('m_p1','demo/p-knit.svg','/demo/p-knit.svg','image/svg+xml',800,800,800,'Siyah balıkçı yaka triko','demo'),
 ('m_p2','demo/p-bedding.svg','/demo/p-bedding.svg','image/svg+xml',800,800,800,'Pamuklu nevresim takımı','demo'),
 ('m_p3','demo/p-speaker.svg','/demo/p-speaker.svg','image/svg+xml',800,800,800,'Turuncu kablosuz hoparlör','demo'),
 ('m_p4','demo/p-pan.svg','/demo/p-pan.svg','image/svg+xml',800,800,800,'Granit tava seti','demo'),
 ('m_p5','demo/p-atlas.svg','/demo/p-atlas.svg','image/svg+xml',800,800,800,'Çocuklar için dünya atlası','demo');

-- Brands & categories -------------------------------------------------------------
INSERT OR IGNORE INTO brands (id, name, slug) VALUES
 ('b_atelier','Atelier','atelier'),('b_linen','Linen Home','linen-home'),
 ('b_sound','Sound Studio','sound-studio'),('b_daily','Daily Living','daily-living'),
 ('b_kitap','Renkli Kitap','renkli-kitap');

INSERT OR IGNORE INTO categories (id, parent_id, name, slug, sort_order) VALUES
 ('c_elektronik',NULL,'Elektronik','elektronik',1),
 ('c_moda',NULL,'Moda','moda',2),
 ('c_evyasam',NULL,'Ev & Yaşam','ev-yasam',3),
 ('c_kitap',NULL,'Kitap & Hobi','kitap-hobi',4);
INSERT OR IGNORE INTO categories (id, parent_id, name, slug, sort_order) VALUES
 ('c_erkek','c_moda','Erkek','erkek',1),
 ('c_ses','c_elektronik','Ses Sistemleri','ses-sistemleri',1),
 ('c_mutfak','c_evyasam','Mutfak','mutfak',1),
 ('c_tekstil','c_evyasam','Ev Tekstili','ev-tekstili',2);
INSERT OR IGNORE INTO categories (id, parent_id, name, slug, sort_order) VALUES
 ('c_erkek_kazak','c_erkek','Kazak','erkek-kazak',1);

-- Attributes ----------------------------------------------------------------------
INSERT OR IGNORE INTO attribute_definitions (id, code, label, data_type, unit, is_variant_axis, is_filterable) VALUES
 ('a_color','color','Renk','select',NULL,1,1),
 ('a_size','size','Beden','select',NULL,1,1),
 ('a_material','material','Materyal','text',NULL,0,1),
 ('a_weight','weight','Ağırlık','number','g',0,0),
 ('a_wireless','wireless','Kablosuz','boolean',NULL,0,1);
INSERT OR IGNORE INTO attribute_options (id, attribute_id, value_code, label, color_hex, sort_order) VALUES
 ('o_black','a_color','black','Siyah',NULL,1),('o_navy','a_color','navy','Lacivert',NULL,2),
 ('o_orange','a_color','orange','Turuncu',NULL,3),
 ('o_s','a_size','s','S',NULL,1),('o_m','a_size','m','M',NULL,2),('o_l','a_size','l','L',NULL,3);
INSERT OR IGNORE INTO category_attributes (category_id, attribute_id, is_required, show_in_filter, sort_order) VALUES
 ('c_moda','a_color',1,1,1),('c_moda','a_size',1,1,2),('c_moda','a_material',0,1,3),
 ('c_elektronik','a_wireless',0,1,1),('c_elektronik','a_color',0,1,2);

-- Products ------------------------------------------------------------------------
INSERT OR IGNORE INTO products (id, brand_id, name, slug, short_description, status, tax_rate_bps, published_at) VALUES
 ('p_knit','b_atelier','Yarım Balıkçı Yaka Triko','yarim-balikci-yaka-triko','Yumuşak dokulu günlük triko.','published',1000,'2026-10-01T00:00:00.000Z'),
 ('p_bed','b_linen','Pamuklu Nevresim Takımı','pamuklu-nevresim-takimi','%100 pamuk çift kişilik.','published',1000,'2026-10-02T00:00:00.000Z'),
 ('p_speaker','b_sound','Mini Kablosuz Hoparlör','mini-kablosuz-hoparlor','Taşınabilir, 12 saat pil.','published',2000,'2026-10-03T00:00:00.000Z'),
 ('p_pan','b_daily','Granit Tava & Sahan Seti','granit-tava-sahan-seti','3 parça granit set.','published',2000,'2026-10-04T00:00:00.000Z'),
 ('p_atlas','b_kitap','Çocuklar İçin Dünya Atlası','cocuklar-icin-dunya-atlasi','Resimli atlas.','published',0,'2026-10-05T00:00:00.000Z');

INSERT OR IGNORE INTO product_categories (product_id, category_id, is_primary) VALUES
 ('p_knit','c_erkek_kazak',1),('p_bed','c_tekstil',1),('p_speaker','c_ses',1),('p_pan','c_mutfak',1),('p_atlas','c_kitap',1);

INSERT OR IGNORE INTO product_variant_axes (product_id, attribute_id, sort_order) VALUES
 ('p_knit','a_color',1),('p_knit','a_size',2);

INSERT OR IGNORE INTO product_variants (id, product_id, sku, barcode, combination_key, is_default) VALUES
 ('v_knit_bk_m','p_knit','ATL-KNT-BK-M','8690000000011','color=black;size=m',1),
 ('v_knit_bk_l','p_knit','ATL-KNT-BK-L','8690000000012','color=black;size=l',0),
 ('v_knit_nv_m','p_knit','ATL-KNT-NV-M','8690000000013','color=navy;size=m',0),
 ('v_bed','p_bed','LNH-BED-01','8690000000021','default',1),
 ('v_speaker','p_speaker','SND-MINI-OR','8690000000031','default',1),
 ('v_pan','p_pan','DLY-PAN-SET3','8690000000041','default',1),
 ('v_atlas','p_atlas','RKT-ATLAS-01','8690000000051','default',1);

INSERT OR IGNORE INTO variant_options (variant_id, attribute_id, option_id) VALUES
 ('v_knit_bk_m','a_color','o_black'),('v_knit_bk_m','a_size','o_m'),
 ('v_knit_bk_l','a_color','o_black'),('v_knit_bk_l','a_size','o_l'),
 ('v_knit_nv_m','a_color','o_navy'),('v_knit_nv_m','a_size','o_m');

INSERT OR IGNORE INTO product_attribute_values (id, product_id, attribute_id, value_index, text_value, number_value, boolean_value, option_id) VALUES
 ('pav_1','p_knit','a_material',0,'%100 Akrilik',NULL,NULL,NULL),
 ('pav_2','p_speaker','a_wireless',0,NULL,NULL,1,NULL),
 ('pav_3','p_speaker','a_color',0,NULL,NULL,NULL,'o_orange'),
 ('pav_4','p_speaker','a_weight',0,NULL,420.0,NULL,NULL);

INSERT OR IGNORE INTO product_media (id, product_id, variant_id, media_id, sort_order, is_primary) VALUES
 ('pm_1','p_knit',NULL,'m_p1',0,1),('pm_2','p_bed',NULL,'m_p2',0,1),('pm_3','p_speaker',NULL,'m_p3',0,1),
 ('pm_4','p_pan',NULL,'m_p4',0,1),('pm_5','p_atlas',NULL,'m_p5',0,1);

INSERT OR IGNORE INTO variant_prices (variant_id, price_list_id, unit_price_minor, compare_at_minor) VALUES
 ('v_knit_bk_m','pl_retail',109999,129999),('v_knit_bk_l','pl_retail',109999,129999),('v_knit_nv_m','pl_retail',109999,129999),
 ('v_bed','pl_retail',149900,179900),('v_speaker','pl_retail',109900,149900),
 ('v_pan','pl_retail',89990,109990),('v_atlas','pl_retail',24990,29990);

INSERT OR IGNORE INTO inventory_balances (variant_id, warehouse_id, on_hand, reserved) VALUES
 ('v_knit_bk_m','wh_main',25,0),('v_knit_bk_l','wh_main',10,0),('v_knit_nv_m','wh_main',1,0),
 ('v_bed','wh_main',40,0),('v_speaker','wh_main',15,0),('v_pan','wh_main',30,0),('v_atlas','wh_main',100,0);

INSERT OR IGNORE INTO product_relations (product_id, related_product_id, relation_type, sort_order) VALUES
 ('p_bed','p_pan','complementary',1),('p_knit','p_bed','curated',1);

-- Storefront ----------------------------------------------------------------------
INSERT OR IGNORE INTO navigation_menus (id, code, name) VALUES
 ('nav_header','header','Header ana menü'),('nav_footer','footer','Footer');
INSERT OR IGNORE INTO navigation_items (id, menu_id, parent_id, label, href, category_id, sort_order) VALUES
 ('ni_1','nav_header',NULL,'Elektronik',NULL,'c_elektronik',1),
 ('ni_2','nav_header',NULL,'Moda',NULL,'c_moda',2),
 ('ni_3','nav_header',NULL,'Ev & Yaşam',NULL,'c_evyasam',3),
 ('ni_4','nav_header',NULL,'Kitap & Hobi',NULL,'c_kitap',4),
 ('ni_5','nav_header',NULL,'Fırsatlar','/kampanyalar',NULL,9),
 ('nf_1','nav_footer',NULL,'Keşfet',NULL,NULL,1);
INSERT OR IGNORE INTO navigation_items (id, menu_id, parent_id, label, href, sort_order) VALUES
 ('nf_11','nav_footer','nf_1','Markalar','/markalar',1),
 ('nf_12','nav_footer','nf_1','Kategoriler','/kategoriler',2),
 ('nf_13','nav_footer','nf_1','Fırsatlar','/kampanyalar',3);

INSERT OR IGNORE INTO story_collections (id, name, slug) VALUES ('sc_home','Markaları keşfet','markalari-kesfet');
INSERT OR IGNORE INTO stories (id, collection_id, brand_id, title, cover_media_id, sort_order) VALUES
 ('st_1','sc_home','b_atelier','Atelier','m_p1',1),('st_2','sc_home','b_linen','Linen Home','m_p2',2),
 ('st_3','sc_home','b_sound','Sound Studio','m_p3',3),('st_4','sc_home','b_daily','Daily Living','m_p4',4),
 ('st_5','sc_home','b_kitap','Renkli Kitap','m_p5',5);
INSERT OR IGNORE INTO story_frames (id, story_id, media_id, target_url, sort_order) VALUES
 ('sf_1','st_1','m_p1','/marka/atelier',1),('sf_2','st_2','m_p2','/marka/linen-home',1),
 ('sf_3','st_3','m_p3','/marka/sound-studio',1),('sf_4','st_4','m_p4','/marka/daily-living',1),
 ('sf_5','st_5','m_p5','/marka/renkli-kitap',1);

INSERT OR IGNORE INTO sliders (id, code, name) VALUES ('sl_home','home_hero','Ana sayfa hero');
INSERT OR IGNORE INTO slides (id, slider_id, title, subtitle, desktop_media_id, cta_label, target_url, sort_order) VALUES
 ('sd_1','sl_home','İyi hissettiren küçük keşifler.','Stiline, evine ve gününe ilham veren favoriler tek bir yerde.','m_hero1','Seçkiyi keşfet','/kampanyalar',1);

INSERT OR IGNORE INTO home_sections (id, title, subtitle, section_type, slider_id, story_collection_id, selection_mode, item_limit, media_id, target_url, cta_label, sort_order) VALUES
 ('hs_stories','Markaları keşfet',NULL,'story_strip',NULL,'sc_home','manual',12,NULL,NULL,NULL,1),
 ('hs_hero','Hero',NULL,'hero_slider','sl_home',NULL,'manual',12,NULL,NULL,NULL,2),
 ('hs_categories','Kategorilere göz at','Aradığını hızlıca bul','category_tiles',NULL,NULL,'manual',8,NULL,NULL,NULL,3),
 ('hs_popular','Popüler ürünlerden seçtik','Sana özel vitrin','product_carousel',NULL,NULL,'manual',12,NULL,NULL,NULL,4),
 ('hs_banner','Ev & Yaşam haftası','Seçili ev ürünlerinde özel fiyatlar','banner',NULL,NULL,'manual',12,'m_hero1','/kategori/ev-yasam','Ürünleri gör',5),
 ('hs_new','Yeni gelenler','Bu hafta eklenenler','product_grid',NULL,NULL,'new',10,NULL,NULL,NULL,6),
 ('hs_brands','Markalarımız',NULL,'brand_strip',NULL,NULL,'manual',12,NULL,NULL,NULL,7);
INSERT OR IGNORE INTO home_section_categories (section_id, category_id, sort_order) VALUES
 ('hs_categories','c_elektronik',1),('hs_categories','c_moda',2),('hs_categories','c_evyasam',3),('hs_categories','c_kitap',4);
INSERT OR IGNORE INTO home_section_brands (section_id, brand_id, sort_order) VALUES
 ('hs_brands','b_atelier',1),('hs_brands','b_linen',2),('hs_brands','b_sound',3),('hs_brands','b_daily',4),('hs_brands','b_kitap',5);
INSERT OR IGNORE INTO home_section_products (section_id, product_id, sort_order) VALUES
 ('hs_popular','p_knit',1),('hs_popular','p_bed',2),('hs_popular','p_speaker',3),('hs_popular','p_pan',4),('hs_popular','p_atlas',5);

-- Content pages: legal texts from src/modules/content/domain/legal-templates.ts ({{placeholders}} = Site ayarları), corporate + help.
-- Published pages with footer_column appear in the storefront footer automatically.
INSERT OR IGNORE INTO content_pages
 (id, slug, title, kind, legal_type, summary, body_html, status, footer_column, footer_order, version, published_at, created_at, updated_at)
 VALUES
 ('pg_distance_sales','mesafeli-satis-sozlesmesi','Mesafeli Satış Sözleşmesi','legal','distance_sales','6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği kapsamında taraflar arasındaki satış sözleşmesi.','<h2>1. Taraflar</h2>
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
<p>Alıcı, siparişi onaylamadan önce bu sözleşmeyi ve Ön Bilgilendirme Formunu okuduğunu ve elektronik ortamda onayladığını kabul eder. Sözleşme, siparişin onaylandığı anda yürürlüğe girer.</p>','published','legal',1,1,'2026-10-01T09:00:00.000Z','2026-10-01T09:00:00.000Z','2026-10-01T09:00:00.000Z'),
 ('pg_pre_information','on-bilgilendirme-formu','Ön Bilgilendirme Formu','legal','pre_information','Mesafeli sözleşme kurulmadan önce tüketiciye verilmesi gereken bilgiler.','<h2>1. Satıcı bilgileri</h2>
<p>Unvan: {{firma.unvan}}<br>Adres: {{firma.adres}}<br>Telefon: {{iletisim.telefon}}<br>E-posta: {{iletisim.eposta}}<br>MERSİS no: {{firma.mersis_no}}</p>
<h2>2. Ürünün temel nitelikleri ve fiyatı</h2>
<p>Satın alınan ürünlerin temel nitelikleri, adedi ve vergiler dahil toplam fiyatı ödeme sayfasındaki sipariş özetinde gösterilir. Kargo ücreti varsa ayrıca belirtilir ve toplam tutara eklenir.</p>
<h2>3. Ödeme ve teslimat</h2>
<ul><li>Ödeme; kredi/banka kartı veya havale/EFT ile yapılır.</li><li>Havale/EFT ile verilen siparişlerde ödeme, sipariş sonrasında bildirilen süre içinde yapılmalıdır; aksi hâlde sipariş iptal edilir.</li><li>Ürün, sipariş özetinde belirtilen adrese en geç 30 gün içinde teslim edilir.</li></ul>
<h2>4. Cayma hakkı</h2>
<p>Tüketici, malı teslim aldığı tarihten itibaren 14 gün içinde cayma hakkına sahiptir. Cayma hakkının kullanılması hâlinde ürün bedeli, cayma bildiriminin Satıcıya ulaşmasından itibaren 14 gün içinde ödemenin yapıldığı yönteme uygun şekilde iade edilir.</p>
<h2>5. Şikâyet ve itiraz</h2>
<p>Şikâyet ve itirazlarınızı {{iletisim.eposta}} adresine iletebilirsiniz ({{iletisim.calisma_saatleri}}). Tüketici, parasal sınırlar dahilinde Tüketici Hakem Heyetine veya Tüketici Mahkemesine başvurabilir.</p>','published','legal',2,1,'2026-10-01T09:00:00.000Z','2026-10-01T09:00:00.000Z','2026-10-01T09:00:00.000Z'),
 ('pg_kvkk','kvkk-aydinlatma-metni','KVKK Aydınlatma Metni','legal','kvkk','6698 sayılı Kişisel Verilerin Korunması Kanunu uyarınca kişisel verilerinizin işlenmesine ilişkin aydınlatma.','<p>{{firma.unvan}} (“Şirket”) olarak, veri sorumlusu sıfatıyla kişisel verilerinizi 6698 sayılı Kişisel Verilerin Korunması Kanunu (“KVKK”) ve ilgili mevzuata uygun şekilde işlemekteyiz.</p>
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
<p>Son güncelleme: {{sayfa.guncelleme}}</p>','published','legal',3,1,'2026-10-01T09:00:00.000Z','2026-10-01T09:00:00.000Z','2026-10-01T09:00:00.000Z'),
 ('pg_privacy','gizlilik-politikasi','Gizlilik Politikası','legal','privacy','Sitemizi kullanırken bilgilerinizin nasıl korunduğu.','<p>{{site.adi}} olarak gizliliğinize önem veriyoruz. Bu politika, {{site.adres}} adresini ziyaret ettiğinizde ve alışveriş yaptığınızda bilgilerinizin nasıl toplandığını, kullanıldığını ve korunduğunu açıklar.</p>
<h2>Güvenlik</h2>
<p>Sitemizdeki tüm bağlantılar şifrelidir (HTTPS). Kart bilgileriniz sistemlerimizde saklanmaz; ödeme, lisanslı ödeme kuruluşunun güvenli sayfasında tamamlanır.</p>
<h2>Kullanım</h2>
<p>Bilgileriniz yalnızca siparişlerinizi yerine getirmek, sizinle iletişim kurmak ve yasal yükümlülüklerimizi yerine getirmek için kullanılır. İzniniz olmadan pazarlama iletisi gönderilmez.</p>
<h2>İletişim</h2>
<p>Sorularınız için {{iletisim.eposta}} adresinden bize ulaşabilirsiniz. Kişisel verilerinize ilişkin ayrıntılar KVKK Aydınlatma Metninde yer alır.</p>','published','legal',4,1,'2026-10-01T09:00:00.000Z','2026-10-01T09:00:00.000Z','2026-10-01T09:00:00.000Z'),
 ('pg_cookies','cerez-politikasi','Çerez Politikası','legal','cookies','Sitemizde kullanılan çerezler ve tercihleriniz.','<p>{{site.adres}} adresinde, sitenin çalışması için gerekli çerezler kullanılır.</p>
<h2>Zorunlu çerezler</h2>
<table><thead><tr><th>Çerez</th><th>Amaç</th><th>Süre</th></tr></thead><tbody><tr><td>Oturum</td><td>Giriş yapan kullanıcının oturumunu sürdürmek</td><td>Oturum boyunca</td></tr><tr><td>Sepet</td><td>Sepetinizdeki ürünleri hatırlamak</td><td>30 gün</td></tr><tr><td>Güvenlik</td><td>Form gönderimlerini sahteciliğe karşı korumak</td><td>Oturum boyunca</td></tr></tbody></table>
<h2>Tercihleriniz</h2>
<p>Tarayıcınızın ayarlarından çerezleri silebilir veya engelleyebilirsiniz; zorunlu çerezler engellenirse sepet ve ödeme adımları çalışmayabilir.</p>
<p>Sorularınız için: {{iletisim.eposta}}</p>','published','legal',5,1,'2026-10-01T09:00:00.000Z','2026-10-01T09:00:00.000Z','2026-10-01T09:00:00.000Z'),
 ('pg_return_policy','iade-ve-cayma-kosullari','İade ve Cayma Koşulları','legal','return_policy','14 gün içinde koşulsuz iade hakkınız ve iade süreci.','<p>Satın aldığınız ürünü teslim aldığınız tarihten itibaren <strong>14 gün</strong> içinde gerekçe göstermeden iade edebilirsiniz.</p>
<h2>İade nasıl yapılır?</h2>
<ol><li>{{iletisim.eposta}} adresine sipariş numaranızla birlikte iade talebinizi iletin veya {{iletisim.telefon}} numarasından bize ulaşın.</li><li>Ürünü, faturası ve tüm aksesuarlarıyla birlikte, mümkünse orijinal ambalajında paketleyin.</li><li>Size iletilen iade kodu ile ürünü anlaşmalı kargo firmasına teslim edin.</li></ol>
<h2>Ücret iadesi</h2>
<p>İade edilen ürün depomuza ulaşıp kontrol edildikten sonra ödemeniz en geç 14 gün içinde, ödeme yaptığınız yönteme iade edilir. Kartla yapılan ödemelerin hesabınıza yansıma süresi bankanıza bağlıdır.</p>
<h2>İade edilemeyen ürünler</h2>
<ul><li>Ambalajı açılmış iç giyim, kozmetik ve kişisel bakım ürünleri</li><li>Size özel üretilen veya kişiselleştirilen ürünler</li><li>Çabuk bozulabilen ürünler</li></ul>
<p>Çalışma saatlerimiz: {{iletisim.calisma_saatleri}}</p>','published','help',6,1,'2026-10-01T09:00:00.000Z','2026-10-01T09:00:00.000Z','2026-10-01T09:00:00.000Z'),
 ('pg_terms_of_use','kullanim-kosullari','Kullanım Koşulları','legal','terms_of_use','Sitenin kullanımına ilişkin kurallar.','<p>{{site.adres}} internet sitesi {{firma.unvan}} tarafından işletilmektedir. Siteyi kullanan herkes aşağıdaki koşulları kabul etmiş sayılır.</p>
<h2>Fikri mülkiyet</h2>
<p>Sitedeki tüm içerik, görsel, logo ve tasarımların hakları {{firma.unvan}} veya ilgili hak sahiplerine aittir; izinsiz kopyalanamaz ve kullanılamaz.</p>
<h2>Fiyat ve stok bilgileri</h2>
<p>Ürün fiyatları ve stok durumu önceden haber verilmeksizin değişebilir. Açık bir hata içeren fiyatla verilen siparişler iptal edilebilir; bu durumda ödemeniz iade edilir.</p>
<h2>Değişiklikler</h2>
<p>Bu koşullar gerektiğinde güncellenir; güncel metin her zaman bu sayfada yayımlanır.</p>','draft','legal',7,1,NULL,'2026-10-01T09:00:00.000Z','2026-10-01T09:00:00.000Z'),
 ('pg_membership','uyelik-sozlesmesi','Üyelik Sözleşmesi','legal','membership','Üye hesabı oluşturan kullanıcılarla yapılan sözleşme.','<h2>1. Taraflar</h2>
<p>Bu sözleşme, {{firma.unvan}} (“{{site.adi}}”) ile {{site.adres}} üzerinde üye hesabı oluşturan kullanıcı (“Üye”) arasında, üyelik kaydının tamamlanmasıyla kurulur.</p>
<h2>2. Üyenin yükümlülükleri</h2>
<ul><li>Üyelik bilgilerinin doğru ve güncel olması Üyenin sorumluluğundadır.</li><li>Hesap şifresinin gizliliğini korumak Üyeye aittir.</li><li>Site, hukuka aykırı amaçlarla kullanılamaz.</li></ul>
<h2>3. Fesih</h2>
<p>Üye, dilediği zaman {{iletisim.eposta}} adresine başvurarak üyeliğini sonlandırabilir. Yasal saklama yükümlülükleri saklıdır.</p>','draft','legal',8,1,NULL,'2026-10-01T09:00:00.000Z','2026-10-01T09:00:00.000Z'),
 ('pg_about','hakkimizda','Hakkımızda','corporate',NULL,'Biz kimiz, neden varız?','<p>{{site.adi}}, günlük hayatı kolaylaştıran ve iyi hissettiren ürünleri tek bir yerde buluşturmak için kuruldu. Modadan elektroniğe, evden kitaba özenle seçilmiş markalarla çalışıyoruz.</p>
<h2>Değerlerimiz</h2>
<ul><li><strong>Seçicilik:</strong> Satışa sunduğumuz her markayı ve ürünü tek tek değerlendiriyoruz.</li><li><strong>Şeffaflık:</strong> Fiyat, kargo ve iade koşullarını açıkça paylaşıyoruz.</li><li><strong>Erişilebilir destek:</strong> {{iletisim.calisma_saatleri}} arasında {{iletisim.telefon}} numarasından bize ulaşabilirsiniz.</li></ul>
<p>{{firma.unvan}} · {{firma.adres}}</p>','published','corporate',9,1,'2026-10-01T09:00:00.000Z','2026-10-01T09:00:00.000Z','2026-10-01T09:00:00.000Z'),
 ('pg_contact','iletisim','İletişim','corporate',NULL,'Bize ulaşmanın yolları.','<h2>Müşteri hizmetleri</h2>
<p>Telefon: {{iletisim.telefon}}<br>E-posta: {{iletisim.eposta}}<br>Çalışma saatleri: {{iletisim.calisma_saatleri}}</p>
<h2>Merkez adres</h2>
<p>{{firma.unvan}}<br>{{firma.adres}}</p>
<p>KEP adresi: {{firma.kep}}</p>','published','corporate',10,1,'2026-10-01T09:00:00.000Z','2026-10-01T09:00:00.000Z','2026-10-01T09:00:00.000Z'),
 ('pg_faq','sikca-sorulan-sorular','Sıkça Sorulan Sorular','help',NULL,'Sipariş, ödeme, kargo ve iade hakkında merak edilenler.','<h3>Siparişim ne zaman kargoya verilir?</h3>
<p>Ödemesi onaylanan siparişler genellikle 1–2 iş günü içinde kargoya verilir. Kargoya verildiğinde e-posta ile takip numarası gönderilir.</p>
<h3>Hangi ödeme yöntemlerini kullanabilirim?</h3>
<p>Kredi/banka kartı ve havale/EFT ile ödeme yapabilirsiniz. Havale ile verilen siparişler, ödeme hesabımıza ulaştığında onaylanır.</p>
<h3>Ürünü nasıl iade ederim?</h3>
<p>Teslimattan itibaren 14 gün içinde iade edebilirsiniz. Ayrıntılar İade ve Cayma Koşulları sayfasındadır.</p>
<h3>Size nasıl ulaşırım?</h3>
<p>{{iletisim.eposta}} adresine yazabilir veya {{iletisim.telefon}} numarasını arayabilirsiniz.</p>','published','help',11,1,'2026-10-01T09:00:00.000Z','2026-10-01T09:00:00.000Z','2026-10-01T09:00:00.000Z'),
 ('pg_shipping','kargo-ve-teslimat','Kargo ve Teslimat','help',NULL,'Gönderim süreleri ve kargo ücretleri.','<p>Siparişleriniz anlaşmalı kargo firmalarımızla Türkiye’nin her yerine gönderilir.</p>
<ul><li>Ödemesi onaylanan siparişler 1–2 iş günü içinde kargoya verilir.</li><li>Teslimat süresi bulunduğunuz ile göre genellikle 1–3 iş günüdür.</li><li>Belirli tutarın üzerindeki siparişlerde kargo ücretsizdir; güncel tutar sepette gösterilir.</li></ul>
<p>Teslimatla ilgili sorularınız için: {{iletisim.eposta}}</p>','published','help',12,1,'2026-10-01T09:00:00.000Z','2026-10-01T09:00:00.000Z','2026-10-01T09:00:00.000Z');

INSERT OR IGNORE INTO content_page_revisions (id, page_id, version, title, body_html, status, created_at) VALUES
 ('pgr_distance_sales_1','pg_distance_sales',1,'Mesafeli Satış Sözleşmesi','<h2>1. Taraflar</h2>
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
<p>Alıcı, siparişi onaylamadan önce bu sözleşmeyi ve Ön Bilgilendirme Formunu okuduğunu ve elektronik ortamda onayladığını kabul eder. Sözleşme, siparişin onaylandığı anda yürürlüğe girer.</p>','published','2026-10-01T09:00:00.000Z'),
 ('pgr_pre_information_1','pg_pre_information',1,'Ön Bilgilendirme Formu','<h2>1. Satıcı bilgileri</h2>
<p>Unvan: {{firma.unvan}}<br>Adres: {{firma.adres}}<br>Telefon: {{iletisim.telefon}}<br>E-posta: {{iletisim.eposta}}<br>MERSİS no: {{firma.mersis_no}}</p>
<h2>2. Ürünün temel nitelikleri ve fiyatı</h2>
<p>Satın alınan ürünlerin temel nitelikleri, adedi ve vergiler dahil toplam fiyatı ödeme sayfasındaki sipariş özetinde gösterilir. Kargo ücreti varsa ayrıca belirtilir ve toplam tutara eklenir.</p>
<h2>3. Ödeme ve teslimat</h2>
<ul><li>Ödeme; kredi/banka kartı veya havale/EFT ile yapılır.</li><li>Havale/EFT ile verilen siparişlerde ödeme, sipariş sonrasında bildirilen süre içinde yapılmalıdır; aksi hâlde sipariş iptal edilir.</li><li>Ürün, sipariş özetinde belirtilen adrese en geç 30 gün içinde teslim edilir.</li></ul>
<h2>4. Cayma hakkı</h2>
<p>Tüketici, malı teslim aldığı tarihten itibaren 14 gün içinde cayma hakkına sahiptir. Cayma hakkının kullanılması hâlinde ürün bedeli, cayma bildiriminin Satıcıya ulaşmasından itibaren 14 gün içinde ödemenin yapıldığı yönteme uygun şekilde iade edilir.</p>
<h2>5. Şikâyet ve itiraz</h2>
<p>Şikâyet ve itirazlarınızı {{iletisim.eposta}} adresine iletebilirsiniz ({{iletisim.calisma_saatleri}}). Tüketici, parasal sınırlar dahilinde Tüketici Hakem Heyetine veya Tüketici Mahkemesine başvurabilir.</p>','published','2026-10-01T09:00:00.000Z'),
 ('pgr_kvkk_1','pg_kvkk',1,'KVKK Aydınlatma Metni','<p>{{firma.unvan}} (“Şirket”) olarak, veri sorumlusu sıfatıyla kişisel verilerinizi 6698 sayılı Kişisel Verilerin Korunması Kanunu (“KVKK”) ve ilgili mevzuata uygun şekilde işlemekteyiz.</p>
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
<p>Son güncelleme: {{sayfa.guncelleme}}</p>','published','2026-10-01T09:00:00.000Z'),
 ('pgr_privacy_1','pg_privacy',1,'Gizlilik Politikası','<p>{{site.adi}} olarak gizliliğinize önem veriyoruz. Bu politika, {{site.adres}} adresini ziyaret ettiğinizde ve alışveriş yaptığınızda bilgilerinizin nasıl toplandığını, kullanıldığını ve korunduğunu açıklar.</p>
<h2>Güvenlik</h2>
<p>Sitemizdeki tüm bağlantılar şifrelidir (HTTPS). Kart bilgileriniz sistemlerimizde saklanmaz; ödeme, lisanslı ödeme kuruluşunun güvenli sayfasında tamamlanır.</p>
<h2>Kullanım</h2>
<p>Bilgileriniz yalnızca siparişlerinizi yerine getirmek, sizinle iletişim kurmak ve yasal yükümlülüklerimizi yerine getirmek için kullanılır. İzniniz olmadan pazarlama iletisi gönderilmez.</p>
<h2>İletişim</h2>
<p>Sorularınız için {{iletisim.eposta}} adresinden bize ulaşabilirsiniz. Kişisel verilerinize ilişkin ayrıntılar KVKK Aydınlatma Metninde yer alır.</p>','published','2026-10-01T09:00:00.000Z'),
 ('pgr_cookies_1','pg_cookies',1,'Çerez Politikası','<p>{{site.adres}} adresinde, sitenin çalışması için gerekli çerezler kullanılır.</p>
<h2>Zorunlu çerezler</h2>
<table><thead><tr><th>Çerez</th><th>Amaç</th><th>Süre</th></tr></thead><tbody><tr><td>Oturum</td><td>Giriş yapan kullanıcının oturumunu sürdürmek</td><td>Oturum boyunca</td></tr><tr><td>Sepet</td><td>Sepetinizdeki ürünleri hatırlamak</td><td>30 gün</td></tr><tr><td>Güvenlik</td><td>Form gönderimlerini sahteciliğe karşı korumak</td><td>Oturum boyunca</td></tr></tbody></table>
<h2>Tercihleriniz</h2>
<p>Tarayıcınızın ayarlarından çerezleri silebilir veya engelleyebilirsiniz; zorunlu çerezler engellenirse sepet ve ödeme adımları çalışmayabilir.</p>
<p>Sorularınız için: {{iletisim.eposta}}</p>','published','2026-10-01T09:00:00.000Z'),
 ('pgr_return_policy_1','pg_return_policy',1,'İade ve Cayma Koşulları','<p>Satın aldığınız ürünü teslim aldığınız tarihten itibaren <strong>14 gün</strong> içinde gerekçe göstermeden iade edebilirsiniz.</p>
<h2>İade nasıl yapılır?</h2>
<ol><li>{{iletisim.eposta}} adresine sipariş numaranızla birlikte iade talebinizi iletin veya {{iletisim.telefon}} numarasından bize ulaşın.</li><li>Ürünü, faturası ve tüm aksesuarlarıyla birlikte, mümkünse orijinal ambalajında paketleyin.</li><li>Size iletilen iade kodu ile ürünü anlaşmalı kargo firmasına teslim edin.</li></ol>
<h2>Ücret iadesi</h2>
<p>İade edilen ürün depomuza ulaşıp kontrol edildikten sonra ödemeniz en geç 14 gün içinde, ödeme yaptığınız yönteme iade edilir. Kartla yapılan ödemelerin hesabınıza yansıma süresi bankanıza bağlıdır.</p>
<h2>İade edilemeyen ürünler</h2>
<ul><li>Ambalajı açılmış iç giyim, kozmetik ve kişisel bakım ürünleri</li><li>Size özel üretilen veya kişiselleştirilen ürünler</li><li>Çabuk bozulabilen ürünler</li></ul>
<p>Çalışma saatlerimiz: {{iletisim.calisma_saatleri}}</p>','published','2026-10-01T09:00:00.000Z'),
 ('pgr_terms_of_use_1','pg_terms_of_use',1,'Kullanım Koşulları','<p>{{site.adres}} internet sitesi {{firma.unvan}} tarafından işletilmektedir. Siteyi kullanan herkes aşağıdaki koşulları kabul etmiş sayılır.</p>
<h2>Fikri mülkiyet</h2>
<p>Sitedeki tüm içerik, görsel, logo ve tasarımların hakları {{firma.unvan}} veya ilgili hak sahiplerine aittir; izinsiz kopyalanamaz ve kullanılamaz.</p>
<h2>Fiyat ve stok bilgileri</h2>
<p>Ürün fiyatları ve stok durumu önceden haber verilmeksizin değişebilir. Açık bir hata içeren fiyatla verilen siparişler iptal edilebilir; bu durumda ödemeniz iade edilir.</p>
<h2>Değişiklikler</h2>
<p>Bu koşullar gerektiğinde güncellenir; güncel metin her zaman bu sayfada yayımlanır.</p>','draft','2026-10-01T09:00:00.000Z'),
 ('pgr_membership_1','pg_membership',1,'Üyelik Sözleşmesi','<h2>1. Taraflar</h2>
<p>Bu sözleşme, {{firma.unvan}} (“{{site.adi}}”) ile {{site.adres}} üzerinde üye hesabı oluşturan kullanıcı (“Üye”) arasında, üyelik kaydının tamamlanmasıyla kurulur.</p>
<h2>2. Üyenin yükümlülükleri</h2>
<ul><li>Üyelik bilgilerinin doğru ve güncel olması Üyenin sorumluluğundadır.</li><li>Hesap şifresinin gizliliğini korumak Üyeye aittir.</li><li>Site, hukuka aykırı amaçlarla kullanılamaz.</li></ul>
<h2>3. Fesih</h2>
<p>Üye, dilediği zaman {{iletisim.eposta}} adresine başvurarak üyeliğini sonlandırabilir. Yasal saklama yükümlülükleri saklıdır.</p>','draft','2026-10-01T09:00:00.000Z'),
 ('pg_about_r1','pg_about',1,'Hakkımızda','<p>{{site.adi}}, günlük hayatı kolaylaştıran ve iyi hissettiren ürünleri tek bir yerde buluşturmak için kuruldu. Modadan elektroniğe, evden kitaba özenle seçilmiş markalarla çalışıyoruz.</p>
<h2>Değerlerimiz</h2>
<ul><li><strong>Seçicilik:</strong> Satışa sunduğumuz her markayı ve ürünü tek tek değerlendiriyoruz.</li><li><strong>Şeffaflık:</strong> Fiyat, kargo ve iade koşullarını açıkça paylaşıyoruz.</li><li><strong>Erişilebilir destek:</strong> {{iletisim.calisma_saatleri}} arasında {{iletisim.telefon}} numarasından bize ulaşabilirsiniz.</li></ul>
<p>{{firma.unvan}} · {{firma.adres}}</p>','published','2026-10-01T09:00:00.000Z'),
 ('pg_contact_r1','pg_contact',1,'İletişim','<h2>Müşteri hizmetleri</h2>
<p>Telefon: {{iletisim.telefon}}<br>E-posta: {{iletisim.eposta}}<br>Çalışma saatleri: {{iletisim.calisma_saatleri}}</p>
<h2>Merkez adres</h2>
<p>{{firma.unvan}}<br>{{firma.adres}}</p>
<p>KEP adresi: {{firma.kep}}</p>','published','2026-10-01T09:00:00.000Z'),
 ('pg_faq_r1','pg_faq',1,'Sıkça Sorulan Sorular','<h3>Siparişim ne zaman kargoya verilir?</h3>
<p>Ödemesi onaylanan siparişler genellikle 1–2 iş günü içinde kargoya verilir. Kargoya verildiğinde e-posta ile takip numarası gönderilir.</p>
<h3>Hangi ödeme yöntemlerini kullanabilirim?</h3>
<p>Kredi/banka kartı ve havale/EFT ile ödeme yapabilirsiniz. Havale ile verilen siparişler, ödeme hesabımıza ulaştığında onaylanır.</p>
<h3>Ürünü nasıl iade ederim?</h3>
<p>Teslimattan itibaren 14 gün içinde iade edebilirsiniz. Ayrıntılar İade ve Cayma Koşulları sayfasındadır.</p>
<h3>Size nasıl ulaşırım?</h3>
<p>{{iletisim.eposta}} adresine yazabilir veya {{iletisim.telefon}} numarasını arayabilirsiniz.</p>','published','2026-10-01T09:00:00.000Z'),
 ('pg_shipping_r1','pg_shipping',1,'Kargo ve Teslimat','<p>Siparişleriniz anlaşmalı kargo firmalarımızla Türkiye’nin her yerine gönderilir.</p>
<ul><li>Ödemesi onaylanan siparişler 1–2 iş günü içinde kargoya verilir.</li><li>Teslimat süresi bulunduğunuz ile göre genellikle 1–3 iş günüdür.</li><li>Belirli tutarın üzerindeki siparişlerde kargo ücretsizdir; güncel tutar sepette gösterilir.</li></ul>
<p>Teslimatla ilgili sorularınız için: {{iletisim.eposta}}</p>','published','2026-10-01T09:00:00.000Z');

-- Campaign: 3 al 2 öde on the kitchen category (active, with a storefront badge) ----
INSERT OR IGNORE INTO campaigns (id, name, kind, offer_type, buy_quantity, pay_quantity, target_mode, starts_at, priority, is_active, badge_emoji, badge_label) VALUES
 ('cmp_3al2','Mutfakta 3 al 2 öde','buy_x_pay_y','buy_x_pay_y',3,2,'selected','2026-10-01T00:00:00.000Z',10,1,'🔥','3 Al 2 Öde');
INSERT OR IGNORE INTO campaign_categories (campaign_id, category_id, mode) VALUES ('cmp_3al2','c_mutfak','include');

-- Identity, auth and profile seeds -------------------------------------------------
INSERT OR IGNORE INTO users (id, email_normalized, phone_e164, display_name, email_verified_at, phone_verified_at, created_at) VALUES
 ('u_admin','admin@nova.local','+905551110001','NOVA Admin','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z'),
 ('u_customer','musteri@nova.local','+905551110002','Demo Musteri','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z'),
 ('u_cust_2','zeynep.kaya@example.com','+905551110003','Zeynep Kaya','2026-10-12T08:30:00.000Z',NULL,'2026-10-12T08:30:00.000Z'),
 ('u_cust_3','mehmet.yilmaz@example.com',NULL,'Mehmet Yılmaz',NULL,NULL,'2026-10-20T17:45:00.000Z'),
 ('u_cust_4','elif.sahin@example.com','+905551110005','Elif Şahin','2026-10-28T11:05:00.000Z',NULL,'2026-10-28T11:05:00.000Z');

INSERT OR IGNORE INTO customer_profiles (user_id, first_name, last_name, company_name, locale, notes_internal) VALUES
 ('u_customer','Ayse','Demir',NULL,'tr-TR','Demo musteri hesabi'),
 ('u_cust_2','Zeynep','Kaya',NULL,'tr-TR',NULL),
 ('u_cust_3','Mehmet','Yılmaz','Yılmaz Mimarlık','tr-TR',NULL),
 ('u_cust_4','Elif','Şahin',NULL,'tr-TR',NULL);

INSERT OR IGNORE INTO staff_profiles (user_id, employee_code, department, mfa_required) VALUES
 ('u_admin','EMP-0001','operations',1);

INSERT OR IGNORE INTO auth_credentials (user_id, password_hash, password_changed_at, failed_attempts) VALUES
 ('u_admin','$2b$12$Br2R7e4P/EmofYYf8iHLSexvwQNyVqUkS5VcTgP4TOTpG74SrZHKa','2026-10-01T00:00:00.000Z',0),
 ('u_customer','$2b$12$Br2R7e4P/EmofYYf8iHLSexvwQNyVqUkS5VcTgP4TOTpG74SrZHKa','2026-10-01T00:00:00.000Z',0),
 ('u_cust_2','$2b$12$Br2R7e4P/EmofYYf8iHLSexvwQNyVqUkS5VcTgP4TOTpG74SrZHKa','2026-10-12T08:30:00.000Z',0),
 ('u_cust_3','$2b$12$Br2R7e4P/EmofYYf8iHLSexvwQNyVqUkS5VcTgP4TOTpG74SrZHKa','2026-10-20T17:45:00.000Z',0),
 ('u_cust_4','$2b$12$Br2R7e4P/EmofYYf8iHLSexvwQNyVqUkS5VcTgP4TOTpG74SrZHKa','2026-10-28T11:05:00.000Z',0);

INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES
 ('u_admin','role_admin'),
 ('u_customer','role_customer'),('u_cust_2','role_customer'),('u_cust_3','role_customer'),('u_cust_4','role_customer');

INSERT OR IGNORE INTO sessions (id, user_id, token_hash, expires_at, ip_hash, user_agent_hash, mfa_verified_at) VALUES
 ('ses_demo_admin','u_admin','tokhash_admin_demo_01','2099-01-01T00:00:00.000Z','iphash_demo_admin','uahash_demo_admin','2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO verification_tokens (id, user_id, purpose, token_hash, expires_at, consumed_at) VALUES
 ('vt_demo_mail','u_customer','email_verify','vtoken_demo_mail_01','2099-01-01T00:00:00.000Z','2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO user_consents (id, user_id, purpose, document_version, granted, recorded_at) VALUES
 ('consent_demo_1','u_customer','kvkk_notice','v1',1,'2026-10-01T00:00:00.000Z'),
 ('consent_demo_2','u_customer','distance_sales','v1',1,'2026-10-01T00:00:00.000Z'),
 ('consent_demo_3','u_cust_2','kvkk_notice','v1',1,'2026-10-12T08:30:00.000Z'),
 ('consent_demo_4','u_cust_2','marketing_email','v1',1,'2026-10-12T08:30:00.000Z'),
 ('consent_demo_5','u_cust_3','kvkk_notice','v1',1,'2026-10-20T17:45:00.000Z'),
 ('consent_demo_6','u_cust_4','kvkk_notice','v1',1,'2026-10-28T11:05:00.000Z'),
 ('consent_demo_7','u_cust_4','marketing_sms','v1',1,'2026-10-28T11:05:00.000Z');

INSERT OR IGNORE INTO addresses
 (id, user_id, label, recipient_name, phone_e164, country_code, province, district, line1, postal_code, is_default_shipping, is_default_billing)
 VALUES
 ('adr_demo_1','u_customer','Ev','Ayse Demir','+905551110002','TR','Istanbul','Kadikoy','Moda Mah. Demo Sok. No:1','34710',1,1);

-- Supplier and inventory operations seeds -----------------------------------------
INSERT OR IGNORE INTO suppliers (id, code, name, contact_email, phone, is_active) VALUES
 ('sup_demo_1','SUP-DEMO-1','Demo Tedarik A.S.','satin-alma@demo.tedarik','+902120000001',1);

INSERT OR IGNORE INTO supplier_variants (supplier_id, variant_id, supplier_product_code, cost_minor, currency, lead_time_days, is_preferred) VALUES
 ('sup_demo_1','v_bed','SUPBED-0001',95000,'TRY',3,1);

INSERT OR IGNORE INTO inventory_movements
 (id, variant_id, warehouse_id, kind, on_hand_delta, reserved_delta, reference_type, reference_id, reason, actor_id, idempotency_key)
 VALUES
 ('im_demo_1','v_bed','wh_main','receipt',5,0,'supplier','sup_demo_1','seed stock receipt','u_admin','idem_inv_move_1');

-- SEO seeds ----------------------------------------------------------------------
INSERT OR IGNORE INTO seo_documents
 (id, product_id, category_id, brand_id, page_id, route_path, meta_title, meta_description, canonical_url, og_media_id, noindex)
 VALUES
 ('seo_cat_moda',NULL,'c_moda',NULL,NULL,NULL,'Moda | nova.','Moda kategorisinde one cikan urunleri kesfedin.',NULL,'m_hero1',0),
 ('seo_brand_atelier',NULL,NULL,'b_atelier',NULL,NULL,'Atelier | nova.','Atelier markasinin tum urunleri.',NULL,'m_p1',0),
 ('seo_product_knit','p_knit',NULL,NULL,NULL,NULL,'Yarim Balikci Yaka Triko | nova.','Yumusak dokulu triko urun detay sayfasi.',NULL,'m_p1',0),
 ('seo_page_about',NULL,NULL,NULL,'pg_about',NULL,'Hakkimizda | nova.','nova. markasi ve yaklasimimiz.',NULL,'m_hero1',0),
 ('seo_route_campaigns',NULL,NULL,NULL,NULL,'/kampanyalar','Kampanyalar | nova.','Guncel kampanyalar ve firsatlar.',NULL,'m_hero1',0);

-- Campaign, coupon and checkout seeds --------------------------------------------
INSERT OR IGNORE INTO campaign_reward_products (campaign_id, variant_id) VALUES
 ('cmp_3al2','v_pan');

INSERT OR IGNORE INTO coupons
 (id, campaign_id, code_normalized, max_redemptions, per_customer_limit, starts_at, ends_at, is_active)
 VALUES
 ('cpn_demo_1','cmp_3al2','NOVA3AL2ODE',500,1,'2026-10-01T00:00:00.000Z','2099-01-01T00:00:00.000Z',1);

INSERT OR IGNORE INTO carts (id, user_id, currency, status, version, expires_at) VALUES
 ('cart_demo_1','u_customer','TRY','active',1,'2099-01-01T00:00:00.000Z');

INSERT OR IGNORE INTO cart_items (id, cart_id, variant_id, quantity) VALUES
 ('ci_demo_1','cart_demo_1','v_knit_bk_m',1),
 ('ci_demo_2','cart_demo_1','v_pan',2);

INSERT OR IGNORE INTO cart_coupons (cart_id, coupon_id) VALUES
 ('cart_demo_1','cpn_demo_1');

INSERT OR IGNORE INTO checkout_sessions
 (id, cart_id, user_id, quote_hash, quote_json, cart_version, currency, total_minor, status, expires_at, idempotency_key)
 VALUES
 ('co_demo_1','cart_demo_1','u_customer','quotehash_demo_1','{"items":2,"currency":"TRY"}',1,'TRY',103989,'confirmed','2099-01-01T00:00:00.000Z','idem_checkout_1');

INSERT OR IGNORE INTO orders
 (id, order_number, checkout_id, user_id, customer_email, customer_phone, currency, status, payment_status,
	subtotal_minor, discount_minor, shipping_minor, tax_minor, total_minor, customer_note, placed_at)
 VALUES
 ('ord_demo_1','NOVA-2026-0001','co_demo_1','u_customer','musteri@nova.local','+905551110002','TRY','awaiting_transfer','pending',
	109999,10000,3990,17332,103989,'Demo siparis kaydi','2026-10-10T10:00:00.000Z');

INSERT OR IGNORE INTO order_addresses
 (id, order_id, kind, recipient_name, phone_e164, country_code, province, district, line1, postal_code, company_name, tax_office)
 VALUES
 ('ord_addr_ship_1','ord_demo_1','shipping','Ayse Demir','+905551110002','TR','Istanbul','Kadikoy','Moda Mah. Demo Sok. No:1','34710',NULL,NULL),
 ('ord_addr_bill_1','ord_demo_1','billing','Ayse Demir','+905551110002','TR','Istanbul','Kadikoy','Moda Mah. Demo Sok. No:1','34710',NULL,NULL);

INSERT OR IGNORE INTO order_items
 (id, order_id, variant_id, sku_snapshot, product_name_snapshot, variant_snapshot_json, quantity, unit_price_minor,
	subtotal_minor, discount_minor, tax_rate_bps, tax_minor, total_minor)
 VALUES
 ('oi_demo_1','ord_demo_1','v_knit_bk_m','ATL-KNT-BK-M','Yarim Balikci Yaka Triko','{"color":"black","size":"m"}',1,109999,
	109999,10000,1000,10000,99999);

INSERT OR IGNORE INTO order_adjustments
 (id, order_id, order_item_id, campaign_id, coupon_id, label_snapshot, rule_snapshot_json, amount_minor, target)
 VALUES
 ('oadj_demo_1','ord_demo_1',NULL,'cmp_3al2','cpn_demo_1','Kampanya indirimi','{"kind":"buy_x_pay_y"}',10000,'order');

INSERT OR IGNORE INTO order_events
 (id, order_id, event_type, from_status, to_status, note, actor_id, idempotency_key)
 VALUES
 ('oe_demo_1','ord_demo_1','placed',NULL,'awaiting_transfer','Siparis olusturuldu.','u_customer','idem_order_event_1');

-- re-runnable: a BEFORE INSERT trigger would fire (and may abort) even for a row OR IGNORE then skips
INSERT OR IGNORE INTO stock_reservations
 (id, checkout_id, order_id, variant_id, warehouse_id, quantity, status, expires_at, idempotency_key)
 SELECT 'sr_demo_1','co_demo_1','ord_demo_1','v_pan','wh_main',1,'reserved','2099-01-01T00:00:00.000Z','idem_stock_res_1'
 WHERE NOT EXISTS (SELECT 1 FROM stock_reservations WHERE id = 'sr_demo_1');

-- re-runnable: a BEFORE INSERT trigger would fire (and may abort) even for a row OR IGNORE then skips
INSERT OR IGNORE INTO campaign_allocations
 (id, campaign_id, checkout_id, order_id, units, discount_minor, status, expires_at)
 SELECT 'ca_demo_1','cmp_3al2','co_demo_1','ord_demo_1',1,10000,'reserved','2099-01-01T00:00:00.000Z'
 WHERE NOT EXISTS (SELECT 1 FROM campaign_allocations WHERE id = 'ca_demo_1');

-- re-runnable: a BEFORE INSERT trigger would fire (and may abort) even for a row OR IGNORE then skips
INSERT OR IGNORE INTO coupon_redemptions
 (id, coupon_id, checkout_id, order_id, customer_key_hash, status, expires_at)
 SELECT 'cr_demo_1','cpn_demo_1','co_demo_1','ord_demo_1','cust_hash_demo_1','reserved','2099-01-01T00:00:00.000Z'
 WHERE NOT EXISTS (SELECT 1 FROM coupon_redemptions WHERE id = 'cr_demo_1');

-- Payments and logistics seeds ----------------------------------------------------
INSERT OR IGNORE INTO bank_accounts
 (id, payment_config_id, bank_name, account_holder, iban_normalized, currency, instructions, is_active)
 VALUES
 ('ba_demo_1','pc_bank','Demo Bank','NOVA TICARET A.S.','TR000000000000000000000001','TRY','Aciklamaya siparis numarasini yaziniz.',1);

INSERT OR IGNORE INTO payments
 (id, order_id, payment_config_id, provider, provider_payment_id, conversation_id, idempotency_key, amount_minor, currency, status)
 VALUES
 ('pay_demo_1','ord_demo_1','pc_bank','bank_transfer',NULL,'conv_demo_1','idem_payment_1',103989,'TRY','pending');

INSERT OR IGNORE INTO payment_events
 (id, payment_id, provider, provider_event_id, event_type, payload_sha256, signature_valid, processing_status, processed_at)
 VALUES
 ('pev_demo_1','pay_demo_1','bank_transfer','evt_demo_1','payment.pending','sha256-demo-001',1,'processed','2026-10-10T10:05:00.000Z');

INSERT OR IGNORE INTO bank_transfers
 (id, payment_id, bank_account_id, reference_code, expected_minor, received_minor, status, matched_by, matched_at, expires_at)
 VALUES
 ('bt_demo_1','pay_demo_1','ba_demo_1','REF-NOVA-2026-0001',103989,NULL,'awaiting',NULL,NULL,'2099-01-01T00:00:00.000Z');

INSERT OR IGNORE INTO refunds
 (id, payment_id, amount_minor, reason, provider_refund_id, idempotency_key, status, requested_by)
 VALUES
 ('rf_demo_1','pay_demo_1',5000,'musteri talebi',NULL,'idem_refund_1','requested','u_admin');

INSERT OR IGNORE INTO integrations (id, kind, provider_code, name, public_config_json, is_active) VALUES
 ('int_ship_demo','shipping','demo_cargo','Demo Kargo','{"supportsTracking":true}',1);

INSERT OR IGNORE INTO integration_secrets
 (id, integration_id, payment_config_id, secret_name, ciphertext, nonce, auth_tag, key_version)
 VALUES
 ('sec_demo_1','int_ship_demo',NULL,'api_key','ciphertext-demo','nonce-demo','authtag-demo','v1');

INSERT OR IGNORE INTO shipments
 (id, order_id, shipping_method_id, tracking_number, tracking_url, status, shipped_at)
 VALUES
 ('sh_demo_1','ord_demo_1','sm_std','TRK123456789','https://kargo.example.com/TRK123456789','shipped','2026-10-11T08:00:00.000Z');

INSERT OR IGNORE INTO shipment_items (shipment_id, order_id, order_item_id, quantity) VALUES
 ('sh_demo_1','ord_demo_1','oi_demo_1',1);

INSERT OR IGNORE INTO shipment_events
 (id, shipment_id, provider_event_id, status, description, occurred_at)
 VALUES
 ('she_demo_1','sh_demo_1','trk_evt_1','in_transit','Kargo transfer merkezine ulasti.','2026-10-11T12:00:00.000Z');

-- Engagement and operations seeds -------------------------------------------------
INSERT OR IGNORE INTO wishlists (id, user_id, name) VALUES
 ('wl_demo_1','u_customer','Favorilerim');

INSERT OR IGNORE INTO wishlist_items (wishlist_id, product_id) VALUES
 ('wl_demo_1','p_speaker');

INSERT OR IGNORE INTO recent_views (visitor_key_hash, product_id, viewed_at) VALUES
 ('visitor_demo_1','p_knit','2026-10-12T09:00:00.000Z');

INSERT OR IGNORE INTO reviews
 (id, product_id, user_id, order_item_id, variant_id, rating, title, body, status, is_anonymous, verified_purchase, helpful_count,
  reject_reason, moderated_by, moderated_at, published_at, reply_body, reply_by, replied_at, contact_status, created_at, updated_at)
 VALUES
 ('rev_demo_1','p_knit','u_customer','oi_demo_1','v_knit_bk_m',5,'Çok iyi','Kumaş kalitesi ve kalıp beklentimin üstünde.','approved',0,1,2,
  NULL,'u_admin','2026-10-13T09:00:00.000Z','2026-10-13T09:00:00.000Z','Güzel yorumunuz için teşekkür ederiz, iyi günlerde giymenizi dileriz!','u_admin','2026-10-13T09:05:00.000Z','none',
  '2026-10-12T18:00:00.000Z','2026-10-13T09:05:00.000Z'),
 ('rev_demo_2','p_knit','u_cust_2',NULL,NULL,4,'Rengi fotoğraftaki gibi','Bir beden büyük almanızı öneririm, onun dışında çok memnunum.','approved',0,0,1,
  NULL,'u_admin','2026-10-21T10:00:00.000Z','2026-10-21T10:00:00.000Z',NULL,NULL,NULL,'none','2026-10-20T20:15:00.000Z','2026-10-21T10:00:00.000Z'),
 ('rev_demo_3','p_speaker','u_cust_3',NULL,NULL,2,'Ses beklediğim gibi değil','Bas sesler zayıf, pil süresi de 12 saat değil.','pending',0,0,0,
  NULL,NULL,NULL,NULL,NULL,NULL,NULL,'none','2026-11-06T14:30:00.000Z','2026-11-06T14:30:00.000Z'),
 ('rev_demo_4','p_pan','u_cust_4',NULL,NULL,5,NULL,'Yapışmaz yüzeyi gerçekten çok iyi, kolay temizleniyor.','pending',1,0,0,
  NULL,NULL,NULL,NULL,NULL,NULL,NULL,'none','2026-11-07T08:10:00.000Z','2026-11-07T08:10:00.000Z'),
 ('rev_demo_5','p_bed','u_cust_2',NULL,NULL,1,'Reklam','En ucuzu burada: http://ornek-site.example','rejected',0,0,0,
  'advertising','u_admin','2026-11-02T09:00:00.000Z',NULL,NULL,NULL,NULL,'none','2026-11-01T22:00:00.000Z','2026-11-02T09:00:00.000Z');

INSERT OR IGNORE INTO review_votes (review_id, user_id) VALUES ('rev_demo_1','u_cust_2'),('rev_demo_1','u_cust_3'),('rev_demo_2','u_customer');

INSERT OR IGNORE INTO review_contacts (id, review_id, channel, subject, body, delivery, visible_to_customer, created_by, created_at) VALUES
 ('rc_demo_1','rev_demo_5','note',NULL,'Bağlantı içeren reklam yorumu, reddedildi.','logged',0,'u_admin','2026-11-02T09:00:00.000Z');

INSERT OR IGNORE INTO review_settings (id) VALUES (1);

INSERT OR IGNORE INTO admin_notifications (id, type, severity, title, body, href, permission, entity_type, entity_id, dedupe_key, created_at) VALUES
 ('an_demo_1','review.pending','info','Yeni ürün yorumu onay bekliyor','Mini Kablosuz Hoparlör · 2 yıldız · “Ses beklediğim gibi değil”','/admin/yorumlar?durum=pending&yorum=rev_demo_3','reviews.moderate','review','rev_demo_3','review.pending:rev_demo_3','2026-11-06T14:30:00.000Z'),
 ('an_demo_2','review.pending','info','Yeni ürün yorumu onay bekliyor','Granit Tava & Sahan Seti · 5 yıldız','/admin/yorumlar?durum=pending&yorum=rev_demo_4','reviews.moderate','review','rev_demo_4','review.pending:rev_demo_4','2026-11-07T08:10:00.000Z'),
 ('an_demo_3','order.placed','success','Yeni sipariş: NOVA-2026-0001','1.039,89 ₺ · Havale/EFT','/admin/siparisler/ord_demo_1','orders.read','order','ord_demo_1','order.placed:ord_demo_1','2026-10-11T10:00:00.000Z');

INSERT OR IGNORE INTO admin_notification_states (notification_id, user_id, read_at) VALUES ('an_demo_3','u_admin','2026-10-11T10:30:00.000Z');

INSERT OR IGNORE INTO comparison_sessions (id, visitor_key_hash, expires_at) VALUES
 ('cmp_session_1','visitor_demo_1','2099-01-01T00:00:00.000Z');

INSERT OR IGNORE INTO comparison_items (comparison_id, product_id, sort_order) VALUES
 ('cmp_session_1','p_knit',1),
 ('cmp_session_1','p_speaker',2);

INSERT OR IGNORE INTO external_search_jobs
 (id, product_id, media_id, integration_id, status, error_code, attempts, next_attempt_at)
 VALUES
 ('esj_demo_1','p_speaker','m_p3','int_ship_demo','queued',NULL,0,'2026-10-12T10:00:00.000Z');

INSERT OR IGNORE INTO external_offers
 (id, search_job_id, product_id, variant_id, merchant_name, offer_url, price_minor, currency, shipping_minor,
	availability, match_confidence, match_basis, observed_at, expires_at)
 VALUES
 ('eoff_demo_1','esj_demo_1','p_speaker','v_speaker','PazarYeri Demo','https://market.example.com/offers/123',104900,'TRY',0,
	'in_stock',0.93,'title','2026-10-12T10:05:00.000Z','2026-11-12T10:05:00.000Z');

INSERT OR IGNORE INTO idempotency_keys
 (scope, key, request_hash, response_status, response_json, status, expires_at)
 VALUES
 ('checkout.confirm','idem_checkout_1','reqhash_demo_1',200,'{"ok":true}','completed','2099-01-01T00:00:00.000Z');

INSERT OR IGNORE INTO outbox_events
 (id, aggregate_type, aggregate_id, event_type, payload_json, status, attempts, next_attempt_at, locked_until, dedupe_key)
 VALUES
 ('out_demo_1','order','ord_demo_1','order.placed','{"orderId":"ord_demo_1"}','pending',0,NULL,NULL,'dedupe_order_placed_1');

INSERT OR IGNORE INTO audit_logs
 (id, actor_id, action, entity_type, entity_id, diff_redacted_json, request_id, ip_hash)
 VALUES
 ('audit_demo_1','u_admin','seed.insert','order','ord_demo_1','{"source":"seed.sql"}','req-seed-1','iphash_demo_admin');

INSERT OR IGNORE INTO rate_limit_buckets (bucket_key, window_start, attempts, expires_at) VALUES
 ('login:127.0.0.1','2026-10-12T10:00:00.000Z',1,'2026-10-12T10:15:00.000Z');

-- Variant display (2026-11-07): colours are picked with swatches.
UPDATE attribute_definitions SET display_style = 'swatch' WHERE id = 'a_color' AND display_style = 'button';

-- Variant images + model code (2026-11-09): colours change the photos; the knit's variants share one model code.
UPDATE attribute_definitions SET varies_media = 1 WHERE id = 'a_color' AND varies_media = 0;
UPDATE attribute_options SET color_hex = CASE id WHEN 'o_black' THEN '#111111' WHEN 'o_navy' THEN '#1E2A5A' ELSE '#F97316' END
 WHERE id IN ('o_black','o_navy','o_orange') AND color_hex IS NULL;
UPDATE products SET model_code = 'ATL-TRK-01' WHERE id = 'p_knit' AND model_code IS NULL;

-- =============================================================================
-- NOVA — DEVELOPMENT / DEMO SEED (no real customer data, no secrets, no IBAN)
-- Apply after schema.sql:  npm run db:seed:remote
-- Safe to re-run: INSERT OR IGNORE everywhere.
-- Demo users' passwords are not documented: create your own admin with
--   npm run admin:create:local -- you@example.com "Name"     (remote: npm run admin:create)
-- In production delete or re-password admin@nova.local / musteri@nova.local.
-- =============================================================================

-- RBAC ------------------------------------------------------------------------
INSERT OR IGNORE INTO roles (id, code, name, is_system) VALUES
 ('role_customer','customer','Müşteri',1),
 ('role_catalog','catalog_manager','Katalog Yöneticisi',1),
 ('role_order','order_manager','Sipariş Yöneticisi',1),
 ('role_marketing','marketing_manager','Pazarlama',1),
 ('role_admin','admin','Yönetici',1);

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
 ('perm_14','customers.read','Müşteri bilgisi görüntüleme');

INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
 ('role_catalog','perm_01'),('role_catalog','perm_02'),('role_catalog','perm_07'),
 ('role_order','perm_04'),('role_order','perm_05'),('role_order','perm_06'),('role_order','perm_14'),
 ('role_marketing','perm_01'),('role_marketing','perm_07'),('role_marketing','perm_08');
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) SELECT 'role_admin', id FROM permissions;

-- Core config -------------------------------------------------------------------
INSERT OR IGNORE INTO warehouses (id, code, name) VALUES ('wh_main','MAIN','Ana Depo');
INSERT OR IGNORE INTO price_lists (id, code, name, currency, tax_inclusive) VALUES ('pl_retail','RETAIL_TRY','Perakende TRY','TRY',1);

INSERT OR IGNORE INTO site_settings (key, group_name, value_json, is_public) VALUES
 ('site.name','general','"nova."',1),
 ('site.tagline','general','"Her gün yeni bir keşif."',1),
 ('site.announcement','general','{"text":"Yeni sezonun iyi gelen keşifleri NOVA''da.","href":"/kampanyalar"}',1),
 ('contact.email','contact','"destek@example.com"',1),
 ('contact.phone','contact','"+90 000 000 00 00"',1),
 ('seo.default_title','seo','"nova. | Her gün yeni bir keşif"',1),
 ('seo.default_description','seo','"Modadan elektroniğe binlerce ürün."',1),
 ('checkout.reservation_minutes','checkout','15',0),
 ('checkout.bank_transfer_hours','checkout','48',0),
 ('shipping.free_above_minor','shipping','50000',1);

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
 ('nf_1','nav_footer',NULL,'Keşfet',NULL,NULL,1),
 ('nf_2','nav_footer',NULL,'Yardım',NULL,NULL,2),
 ('nf_3','nav_footer',NULL,'Kurumsal',NULL,NULL,3);
INSERT OR IGNORE INTO navigation_items (id, menu_id, parent_id, label, href, sort_order) VALUES
 ('nf_11','nav_footer','nf_1','Markalar','/markalar',1),
 ('nf_12','nav_footer','nf_1','Kategoriler','/kategoriler',2),
 ('nf_21','nav_footer','nf_2','Sipariş takibi','/hesabim/siparisler',1),
 ('nf_22','nav_footer','nf_2','İade ve destek','/sayfa/iade',2),
 ('nf_31','nav_footer','nf_3','Hakkımızda','/sayfa/hakkimizda',1),
 ('nf_32','nav_footer','nf_3','Gizlilik','/sayfa/gizlilik',2);

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

INSERT OR IGNORE INTO home_sections (id, title, section_type, slider_id, story_collection_id, selection_mode, sort_order) VALUES
 ('hs_stories','Markaları keşfet','story_strip',NULL,'sc_home','manual',1),
 ('hs_hero','Hero','hero_slider','sl_home',NULL,'manual',2),
 ('hs_popular','Popüler ürünlerden seçtik','product_carousel',NULL,NULL,'manual',3);
INSERT OR IGNORE INTO home_section_products (section_id, product_id, sort_order) VALUES
 ('hs_popular','p_knit',1),('hs_popular','p_bed',2),('hs_popular','p_speaker',3),('hs_popular','p_pan',4),('hs_popular','p_atlas',5);

INSERT OR IGNORE INTO content_pages (id, slug, title, body_html, is_published) VALUES
 ('pg_about','hakkimizda','Hakkımızda','<p>nova. tasarım konseptidir.</p>',1),
 ('pg_privacy','gizlilik','Gizlilik','<p>Hukuk ekibi tarafından hazırlanacaktır.</p>',0);

-- Campaign: 3 al 2 öde on kitchen category (inactive by default) -------------------
INSERT OR IGNORE INTO campaigns (id, name, kind, buy_quantity, pay_quantity, target_mode, starts_at, priority) VALUES
 ('cmp_3al2','Mutfakta 3 al 2 öde','buy_x_pay_y',3,2,'selected','2026-10-01T00:00:00.000Z',10);
INSERT OR IGNORE INTO campaign_categories (campaign_id, category_id, mode) VALUES ('cmp_3al2','c_mutfak','include');

-- Identity, auth and profile seeds -------------------------------------------------
INSERT OR IGNORE INTO users (id, email_normalized, phone_e164, display_name, email_verified_at, phone_verified_at) VALUES
 ('u_admin','admin@nova.local','+905551110001','NOVA Admin','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z'),
 ('u_customer','musteri@nova.local','+905551110002','Demo Musteri','2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO customer_profiles (user_id, first_name, last_name, company_name, locale, notes_internal) VALUES
 ('u_customer','Ayse','Demir',NULL,'tr-TR','Demo musteri hesabi');

INSERT OR IGNORE INTO staff_profiles (user_id, employee_code, department, mfa_required) VALUES
 ('u_admin','EMP-0001','operations',1);

INSERT OR IGNORE INTO auth_credentials (user_id, password_hash, password_changed_at, failed_attempts) VALUES
 ('u_admin','$2b$12$Br2R7e4P/EmofYYf8iHLSexvwQNyVqUkS5VcTgP4TOTpG74SrZHKa','2026-10-01T00:00:00.000Z',0),
 ('u_customer','$2b$12$Br2R7e4P/EmofYYf8iHLSexvwQNyVqUkS5VcTgP4TOTpG74SrZHKa','2026-10-01T00:00:00.000Z',0);

INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES
 ('u_admin','role_admin'),
 ('u_customer','role_customer');

INSERT OR IGNORE INTO sessions (id, user_id, token_hash, expires_at, ip_hash, user_agent_hash, mfa_verified_at) VALUES
 ('ses_demo_admin','u_admin','tokhash_admin_demo_01','2099-01-01T00:00:00.000Z','iphash_demo_admin','uahash_demo_admin','2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO verification_tokens (id, user_id, purpose, token_hash, expires_at, consumed_at) VALUES
 ('vt_demo_mail','u_customer','email_verify','vtoken_demo_mail_01','2099-01-01T00:00:00.000Z','2026-10-01T00:00:00.000Z');

INSERT OR IGNORE INTO user_consents (id, user_id, purpose, document_version, granted, recorded_at) VALUES
 ('consent_demo_1','u_customer','kvkk_notice','v1',1,'2026-10-01T00:00:00.000Z'),
 ('consent_demo_2','u_customer','distance_sales','v1',1,'2026-10-01T00:00:00.000Z');

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
INSERT OR IGNORE INTO campaign_products (campaign_id, product_id, mode) VALUES
 ('cmp_3al2','p_pan','include');

INSERT OR IGNORE INTO campaign_brands (campaign_id, brand_id, mode) VALUES
 ('cmp_3al2','b_daily','include');

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

INSERT OR IGNORE INTO stock_reservations
 (id, checkout_id, order_id, variant_id, warehouse_id, quantity, status, expires_at, idempotency_key)
 VALUES
 ('sr_demo_1','co_demo_1','ord_demo_1','v_pan','wh_main',1,'reserved','2099-01-01T00:00:00.000Z','idem_stock_res_1');

INSERT OR IGNORE INTO campaign_allocations
 (id, campaign_id, checkout_id, order_id, units, discount_minor, status, expires_at)
 VALUES
 ('ca_demo_1','cmp_3al2','co_demo_1','ord_demo_1',1,10000,'reserved','2099-01-01T00:00:00.000Z');

INSERT OR IGNORE INTO coupon_redemptions
 (id, coupon_id, checkout_id, order_id, customer_key_hash, status, expires_at)
 VALUES
 ('cr_demo_1','cpn_demo_1','co_demo_1','ord_demo_1','cust_hash_demo_1','reserved','2099-01-01T00:00:00.000Z');

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

INSERT OR IGNORE INTO reviews (id, product_id, user_id, order_item_id, rating, title, body, status) VALUES
 ('rev_demo_1','p_knit','u_customer','oi_demo_1',5,'Cok iyi','Kumas kalitesi ve kalip beklentimin ustunde.','approved');

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


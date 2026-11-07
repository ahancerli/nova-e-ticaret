-- probe: SELECT verified_purchase, contact_status, version FROM reviews LIMIT 0
-- Product reviews moderation + panel notifications (2026-11-08): moderation / store reply / contact columns on
-- reviews and the `reviews.moderate` permission. New tables (review_votes, review_contacts, review_settings,
-- admin_notifications, admin_notification_states, admin_notification_rules, admin_notification_mutes) come from
-- schema.sql. Applied by `npm run db:migrate:<local|remote>` after `npm run db:schema:<local|remote>`.

ALTER TABLE reviews ADD COLUMN variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL;
ALTER TABLE reviews ADD COLUMN is_anonymous INTEGER NOT NULL DEFAULT 0 CHECK (is_anonymous IN (0,1));
ALTER TABLE reviews ADD COLUMN verified_purchase INTEGER NOT NULL DEFAULT 0 CHECK (verified_purchase IN (0,1));
ALTER TABLE reviews ADD COLUMN helpful_count INTEGER NOT NULL DEFAULT 0 CHECK (helpful_count >= 0);
ALTER TABLE reviews ADD COLUMN reject_reason TEXT CHECK (reject_reason IS NULL OR reject_reason IN ('spam','offensive','personal_data','irrelevant','advertising','other'));
ALTER TABLE reviews ADD COLUMN moderation_note TEXT CHECK (moderation_note IS NULL OR length(moderation_note) <= 1000);
ALTER TABLE reviews ADD COLUMN moderated_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE reviews ADD COLUMN moderated_at TEXT;
ALTER TABLE reviews ADD COLUMN published_at TEXT;
ALTER TABLE reviews ADD COLUMN reply_body TEXT CHECK (reply_body IS NULL OR length(reply_body) BETWEEN 1 AND 2000);
ALTER TABLE reviews ADD COLUMN reply_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE reviews ADD COLUMN replied_at TEXT;
ALTER TABLE reviews ADD COLUMN contact_status TEXT NOT NULL DEFAULT 'none' CHECK (contact_status IN ('none','contacted','resolved'));
ALTER TABLE reviews ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);

-- Reviews approved before moderation existed count as published at their creation time.
UPDATE reviews SET published_at = created_at WHERE status = 'approved' AND published_at IS NULL;

-- Verified-buyer flag for existing reviews (same rule as SubmitReview: a paid, not cancelled/refunded order).
UPDATE reviews SET verified_purchase = 1
 WHERE EXISTS (SELECT 1 FROM orders o JOIN order_items oi ON oi.order_id = o.id JOIN product_variants v ON v.id = oi.variant_id
                WHERE o.user_id = reviews.user_id AND v.product_id = reviews.product_id
                  AND o.status IN ('paid','preparing','shipped','delivered','completed','partially_refunded'));

INSERT OR IGNORE INTO permissions (id, code, description) VALUES ('perm_17','reviews.moderate','Ürün yorumlarını onaylama, yanıtlama, müşteriyle iletişim');
INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r, permissions p WHERE r.code IN ('admin','marketing_manager') AND p.code = 'reviews.moderate';

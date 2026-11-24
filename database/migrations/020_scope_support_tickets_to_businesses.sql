USE classic_club_ph;

-- The public Contact form belongs to the main storefront (business 1).
-- Keep existing inquiries in that queue and scope owner-created tickets separately.
ALTER TABLE contact_inquiries
    ADD COLUMN IF NOT EXISTS business_id BIGINT UNSIGNED NOT NULL DEFAULT 1,
    ADD INDEX IF NOT EXISTS idx_inquiries_business_created (business_id, created_at, id);

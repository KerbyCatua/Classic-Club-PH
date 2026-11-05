USE classic_club_ph;

-- Add scheduled_delivery_at and delivered_at columns to orders if not exist
ALTER TABLE orders
    ADD COLUMN scheduled_delivery_at DATETIME NULL AFTER placed_at,
    ADD COLUMN delivered_at DATETIME NULL AFTER scheduled_delivery_at;

-- Create product_reviews table
CREATE TABLE IF NOT EXISTS product_reviews (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    variant_id BIGINT UNSIGNED NOT NULL,
    rating TINYINT UNSIGNED NOT NULL,
    title VARCHAR(150) NOT NULL,
    content TEXT NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    email VARCHAR(190) NOT NULL,
    size_purchased VARCHAR(20) NOT NULL,
    fit_feedback VARCHAR(40) NOT NULL,
    images JSON NULL,
    is_verified_purchase TINYINT(1) NOT NULL DEFAULT 1,
    status ENUM('published', 'pending', 'hidden') NOT NULL DEFAULT 'published',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_order_product_review (order_id, variant_id),
    INDEX idx_reviews_user (user_id),
    INDEX idx_reviews_variant (variant_id),
    INDEX idx_reviews_status (status),
    INDEX idx_reviews_created_at (created_at),

    CONSTRAINT fk_reviews_order
        FOREIGN KEY (order_id) REFERENCES orders(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_reviews_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_reviews_variant
        FOREIGN KEY (variant_id) REFERENCES product_variants(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

USE classic_club_ph;

CREATE TABLE orders (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_number VARCHAR(30) NOT NULL UNIQUE,
    user_id BIGINT UNSIGNED NULL,
    guest_email VARCHAR(190) NULL,
    status ENUM('pending','confirmed','preparing','shipped','delivered','cancelled','refunded')
        NOT NULL DEFAULT 'confirmed',
    payment_status ENUM('unpaid','illustrative','paid','failed','refunded')
        NOT NULL DEFAULT 'illustrative',
    currency CHAR(3) NOT NULL DEFAULT 'PHP',
    subtotal DECIMAL(10,2) NOT NULL,
    shipping_amount DECIMAL(10,2) NOT NULL,
    discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    total_amount DECIMAL(10,2) NOT NULL,
    placed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_orders_user (user_id),
    INDEX idx_orders_status (status),
    INDEX idx_orders_created_at (created_at),

    CONSTRAINT fk_orders_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE order_items (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT UNSIGNED NOT NULL,
    variant_size_id BIGINT UNSIGNED NULL,
    sku_snapshot VARCHAR(50) NOT NULL,
    product_name_snapshot VARCHAR(160) NOT NULL,
    color_snapshot VARCHAR(80) NOT NULL,
    size_snapshot VARCHAR(20) NOT NULL,
    quantity INT UNSIGNED NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    line_total DECIMAL(10,2) NOT NULL,

    INDEX idx_order_items_order (order_id),

    CONSTRAINT fk_order_items_order
        FOREIGN KEY (order_id) REFERENCES orders(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_order_items_variant_size
        FOREIGN KEY (variant_size_id) REFERENCES variant_sizes(id)
        ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE order_addresses (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT UNSIGNED NOT NULL UNIQUE,
    recipient_first_name VARCHAR(100) NOT NULL,
    recipient_last_name VARCHAR(100) NOT NULL,
    mobile VARCHAR(40) NOT NULL,
    country VARCHAR(80) NOT NULL,
    street_address VARCHAR(255) NOT NULL,
    apartment VARCHAR(255) NULL,
    barangay VARCHAR(120) NOT NULL,
    city VARCHAR(120) NOT NULL,
    province VARCHAR(120) NOT NULL,
    postal_code VARCHAR(20) NOT NULL,

    CONSTRAINT fk_order_addresses_order
        FOREIGN KEY (order_id) REFERENCES orders(id)
        ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE promotion_redemptions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    promotion_id BIGINT UNSIGNED NOT NULL,
    order_id BIGINT UNSIGNED NOT NULL UNIQUE,
    user_id BIGINT UNSIGNED NULL,
    discount_amount DECIMAL(10,2) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_redemptions_promotion
        FOREIGN KEY (promotion_id) REFERENCES promotions(id)
        ON DELETE RESTRICT,
    CONSTRAINT fk_redemptions_order
        FOREIGN KEY (order_id) REFERENCES orders(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_redemptions_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE SET NULL
) ENGINE=InnoDB;

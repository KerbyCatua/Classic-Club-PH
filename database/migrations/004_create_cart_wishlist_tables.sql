USE classic_club_ph;

ALTER TABLE product_variants
    ADD COLUMN catalog_key VARCHAR(100) NULL UNIQUE AFTER product_id;

UPDATE product_variants
SET catalog_key = CASE id
    WHEN 1 THEN 'essential-hw-tee-obsidian'
    WHEN 2 THEN 'structured-overshirt-graphite'
    WHEN 3 THEN 'relaxed-trouser-charcoal'
    WHEN 4 THEN 'textured-knit-polo-oat'
    WHEN 5 THEN 'essential-hw-tee-chalk'
    WHEN 6 THEN 'loopback-hoodie-obsidian'
    WHEN 7 THEN 'everyday-poplin-shirt-ivory'
    WHEN 8 THEN 'pleated-city-short-stone'
    WHEN 9 THEN 'ls-jersey-tee-graphite'
    WHEN 10 THEN 'ribbed-tank-chalk'
    WHEN 11 THEN 'collarless-jacket-obsidian'
    WHEN 12 THEN 'double-zip-hoodie-ash'
    WHEN 13 THEN 'understated-cap-obsidian'
    WHEN 14 THEN 'daily-canvas-tote-natural'
    WHEN 15 THEN 'slim-leather-belt-black'
    WHEN 16 THEN 'drawstring-pant-stone'
END
WHERE catalog_key IS NULL;

CREATE TABLE carts (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NULL,
    session_token_hash CHAR(64) NULL UNIQUE,
    status ENUM('active', 'converted', 'abandoned')
        NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_carts_user_status (user_id, status),
    INDEX idx_carts_session_status (session_token_hash, status),

    CONSTRAINT fk_carts_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE cart_items (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    cart_id BIGINT UNSIGNED NOT NULL,
    variant_size_id BIGINT UNSIGNED NOT NULL,
    quantity INT UNSIGNED NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_cart_variant_size (cart_id, variant_size_id),
    INDEX idx_cart_items_cart (cart_id),

    CONSTRAINT fk_cart_items_cart
        FOREIGN KEY (cart_id) REFERENCES carts(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_cart_items_variant_size
        FOREIGN KEY (variant_size_id) REFERENCES variant_sizes(id)
        ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE wishlists (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL UNIQUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_wishlists_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE wishlist_items (
    wishlist_id BIGINT UNSIGNED NOT NULL,
    variant_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (wishlist_id, variant_id),

    CONSTRAINT fk_wishlist_items_wishlist
        FOREIGN KEY (wishlist_id) REFERENCES wishlists(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_wishlist_items_variant
        FOREIGN KEY (variant_id) REFERENCES product_variants(id)
        ON DELETE CASCADE
) ENGINE=InnoDB;

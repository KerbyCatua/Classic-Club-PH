USE classic_club_ph;

-- 1. Businesses Table
CREATE TABLE IF NOT EXISTS businesses (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    slug VARCHAR(150) NOT NULL UNIQUE,
    email VARCHAR(190) NULL,
    phone VARCHAR(50) NULL,
    location VARCHAR(150) NULL,
    address TEXT NULL,
    description TEXT NULL,
    status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Business Staff Table
CREATE TABLE IF NOT EXISTS business_users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL DEFAULT 1,
    user_id BIGINT UNSIGNED NULL,
    name VARCHAR(150) NOT NULL,
    email VARCHAR(190) NOT NULL,
    role_title VARCHAR(100) NOT NULL,
    permission_set VARCHAR(100) NOT NULL,
    status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    can_manage_products TINYINT(1) NOT NULL DEFAULT 0,
    can_adjust_stock TINYINT(1) NOT NULL DEFAULT 0,
    can_view_reports TINYINT(1) NOT NULL DEFAULT 0,
    can_reply_reviews TINYINT(1) NOT NULL DEFAULT 0,
    can_view_notifications TINYINT(1) NOT NULL DEFAULT 1,
    can_manage_staff TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_busers_biz (business_id),
    INDEX idx_busers_email (email),
    INDEX idx_busers_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Business Notifications Table
CREATE TABLE IF NOT EXISTS business_notifications (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    business_id BIGINT UNSIGNED NOT NULL DEFAULT 1,
    title VARCHAR(160) NOT NULL,
    type VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    reference_type VARCHAR(50) NULL,
    reference_id VARCHAR(100) NULL,
    action_url VARCHAR(255) NULL,
    is_read TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_bnotif_biz (business_id),
    INDEX idx_bnotif_type (type),
    INDEX idx_bnotif_read (is_read),
    INDEX idx_bnotif_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

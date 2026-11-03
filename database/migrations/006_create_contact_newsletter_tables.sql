USE classic_club_ph;

CREATE TABLE contact_inquiries (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NULL,
    full_name VARCHAR(160) NOT NULL,
    email VARCHAR(190) NOT NULL,
    topic ENUM('sizing', 'order', 'return', 'other') NOT NULL,
    order_number VARCHAR(30) NULL,
    message TEXT NOT NULL,
    status ENUM('open', 'in_progress', 'resolved', 'closed') NOT NULL DEFAULT 'open',
    assigned_to BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_inquiries_status_created (status, created_at),
    INDEX idx_inquiries_email (email),
    CONSTRAINT fk_inquiries_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_inquiries_assigned FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE inquiry_attachments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    inquiry_id BIGINT UNSIGNED NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    stored_name VARCHAR(100) NOT NULL UNIQUE,
    mime_type VARCHAR(100) NOT NULL,
    file_size INT UNSIGNED NOT NULL,
    storage_path VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_attachments_inquiry (inquiry_id),
    CONSTRAINT fk_attachments_inquiry FOREIGN KEY (inquiry_id)
        REFERENCES contact_inquiries(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE newsletter_subscriptions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(190) NOT NULL UNIQUE,
    status ENUM('subscribed', 'unsubscribed') NOT NULL DEFAULT 'subscribed',
    source VARCHAR(50) NOT NULL DEFAULT 'footer',
    subscribed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    unsubscribed_at DATETIME NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_newsletter_status (status)
) ENGINE=InnoDB;

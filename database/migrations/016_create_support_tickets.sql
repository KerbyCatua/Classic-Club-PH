USE classic_club_ph;

-- contact_inquiries remains the canonical queue used by Contact and dashboards.
CREATE TABLE IF NOT EXISTS support_ticket_details (
    inquiry_id BIGINT UNSIGNED PRIMARY KEY,
    subject VARCHAR(200) NOT NULL,
    category VARCHAR(80) NOT NULL,
    priority ENUM('Critical','High','Medium','Low') NOT NULL DEFAULT 'Medium',
    resolution_summary TEXT NULL,
    first_response_at DATETIME NULL,
    resolved_at DATETIME NULL,
    closed_at DATETIME NULL,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    FOREIGN KEY (inquiry_id) REFERENCES contact_inquiries(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS support_ticket_entries (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    inquiry_id BIGINT UNSIGNED NOT NULL,
    actor_id BIGINT UNSIGNED NULL,
    kind ENUM('reply','note','history') NOT NULL,
    body TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_support_entries (inquiry_id, id),
    FOREIGN KEY (inquiry_id) REFERENCES contact_inquiries(id) ON DELETE CASCADE,
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS support_ticket_drafts (
    inquiry_id BIGINT UNSIGNED NOT NULL,
    actor_id BIGINT UNSIGNED NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY (inquiry_id, actor_id),
    FOREIGN KEY (inquiry_id) REFERENCES contact_inquiries(id) ON DELETE CASCADE,
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

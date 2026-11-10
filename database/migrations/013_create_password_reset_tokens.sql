USE classic_club_ph;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    requested_by BIGINT UNSIGNED NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_password_reset_user (user_id),
    INDEX idx_password_reset_expires (expires_at),

    CONSTRAINT fk_password_reset_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    CONSTRAINT fk_password_reset_requested_by
        FOREIGN KEY (requested_by) REFERENCES users(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE
) ENGINE=InnoDB;

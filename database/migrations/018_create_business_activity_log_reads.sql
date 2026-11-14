USE classic_club_ph;

-- Per-administrator read receipts leave the original audit trail intact.
CREATE TABLE IF NOT EXISTS business_activity_log_reads (
    user_id BIGINT UNSIGNED NOT NULL,
    log_id BIGINT UNSIGNED NOT NULL,
    read_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, log_id),
    CONSTRAINT fk_business_log_read_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_business_log_read_log FOREIGN KEY (log_id) REFERENCES audit_logs(id) ON DELETE CASCADE
) ENGINE=InnoDB;

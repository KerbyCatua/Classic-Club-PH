USE classic_club_ph;

CREATE TABLE IF NOT EXISTS error_groups (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    fingerprint CHAR(64) NOT NULL UNIQUE,
    summary VARCHAR(255) NOT NULL,
    module VARCHAR(80) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    state VARCHAR(20) NOT NULL DEFAULT 'Unresolved',
    occurrences BIGINT UNSIGNED NOT NULL DEFAULT 0,
    first_seen DATETIME NOT NULL,
    last_seen DATETIME NOT NULL,
    reviewer_id BIGINT UNSIGNED NULL,
    incident_id BIGINT UNSIGNED NULL,
    reviewed_at DATETIME NULL,
    version INT UNSIGNED NOT NULL DEFAULT 1,
    INDEX idx_errors_latest (last_seen),
    INDEX idx_errors_state (state, last_seen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS error_events (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    group_id BIGINT UNSIGNED NOT NULL,
    request_id CHAR(32) NOT NULL,
    occurred_at DATETIME NOT NULL,
    method VARCHAR(12) NOT NULL,
    endpoint VARCHAR(255) NOT NULL,
    http_status SMALLINT UNSIGNED NOT NULL,
    duration_ms DECIMAL(12,3) NOT NULL,
    source VARCHAR(255) NOT NULL,
    stack TEXT NOT NULL,
    INDEX idx_error_events_group (group_id, id),
    INDEX idx_error_events_request (request_id),
    INDEX idx_error_events_time (occurred_at),
    CONSTRAINT fk_error_event_group FOREIGN KEY (group_id) REFERENCES error_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

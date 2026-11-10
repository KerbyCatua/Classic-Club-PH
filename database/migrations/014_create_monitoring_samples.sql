USE classic_club_ph;

CREATE TABLE IF NOT EXISTS monitoring_samples (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    checked_at DATETIME NOT NULL,
    service VARCHAR(20) NOT NULL,
    healthy TINYINT(1) NOT NULL,
    latency_ms DECIMAL(12,3) NOT NULL,
    status VARCHAR(40) NOT NULL,
    context VARCHAR(255) NOT NULL,
    resource_value DOUBLE NULL,
    resource_label VARCHAR(80) NULL,
    INDEX idx_monitoring_time (checked_at),
    INDEX idx_monitoring_service_time (service, checked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

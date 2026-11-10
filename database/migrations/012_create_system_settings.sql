USE classic_club_ph;

-- Read-only settings consumed by the Module 21.1 System Dashboard Overview.
-- Other modules remain untouched; this table simply gives the overview a
-- database-backed source for the application version and maintenance state.
CREATE TABLE IF NOT EXISTS system_settings (
    setting_key VARCHAR(80) NOT NULL PRIMARY KEY,
    setting_value TEXT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES
    ('application_version', '2.6.1'),
    ('maintenance_mode', '0'),
    ('maintenance_next_at', '');

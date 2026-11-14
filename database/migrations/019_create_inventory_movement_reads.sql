USE classic_club_ph;

-- Inventory-only read receipts; retain stock movements and other administrators' lists.
CREATE TABLE IF NOT EXISTS inventory_movement_reads (
    user_id BIGINT UNSIGNED NOT NULL,
    movement_id BIGINT UNSIGNED NOT NULL,
    read_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, movement_id),
    CONSTRAINT fk_inventory_read_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_inventory_read_movement FOREIGN KEY (movement_id) REFERENCES inventory_movements(id) ON DELETE CASCADE
) ENGINE=InnoDB;

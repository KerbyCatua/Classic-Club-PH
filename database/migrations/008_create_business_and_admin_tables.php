<?php
declare(strict_types=1);

require_once __DIR__ . '/../../app/Database/Connection.php';

try {
    $pdo->beginTransaction();

    // 1. Create businesses table
    $pdo->exec(<<<SQL
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
    SQL);

    // Insert initial business 'Classic Club PH' if not exists
    $stmt = $pdo->prepare("SELECT id FROM businesses WHERE slug = 'classic-club-ph' LIMIT 1");
    $stmt->execute();
    $businessId = $stmt->fetchColumn();
    if (!$businessId) {
        $stmtInsert = $pdo->prepare(<<<SQL
            INSERT INTO businesses (id, name, slug, email, phone, location, address, description, status)
            VALUES (1, 'Classic Club PH', 'classic-club-ph', 'hello@classicclub.example', '+63 917 000 0100', 'Makati City, Metro Manila', '18 Sample Street, Poblacion, Makati City, Metro Manila 1210', 'Considered essentials. Everyday, refined. Clothing and accessories for the everyday rotation.', 'active')
        SQL);
        $stmtInsert->execute();
        $businessId = 1;
    }

    // 2. Add business_id and min_stock_threshold to products if not exists
    $columns = $pdo->query("SHOW COLUMNS FROM products")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('business_id', $columns, true)) {
        $pdo->exec("ALTER TABLE products ADD COLUMN business_id BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER id");
    }
    if (!in_array('min_stock_threshold', $columns, true)) {
        $pdo->exec("ALTER TABLE products ADD COLUMN min_stock_threshold INT UNSIGNED NOT NULL DEFAULT 10 AFTER is_active");
    }

    // 3. Add extra tracking columns to inventory_movements if not exists
    $invCols = $pdo->query("SHOW COLUMNS FROM inventory_movements")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('product_id', $invCols, true)) {
        $pdo->exec("ALTER TABLE inventory_movements ADD COLUMN product_id BIGINT UNSIGNED NULL AFTER variant_size_id");
    }
    if (!in_array('previous_quantity', $invCols, true)) {
        $pdo->exec("ALTER TABLE inventory_movements ADD COLUMN previous_quantity INT NULL AFTER quantity_delta");
    }
    if (!in_array('new_quantity', $invCols, true)) {
        $pdo->exec("ALTER TABLE inventory_movements ADD COLUMN new_quantity INT NULL AFTER previous_quantity");
    }
    if (!in_array('reason', $invCols, true)) {
        $pdo->exec("ALTER TABLE inventory_movements ADD COLUMN reason VARCHAR(255) NULL AFTER notes");
    }
    if (!in_array('admin_name', $invCols, true)) {
        $pdo->exec("ALTER TABLE inventory_movements ADD COLUMN admin_name VARCHAR(100) NULL AFTER created_by");
    }

    // 4. Create business_staff / business_users table
    $pdo->exec(<<<SQL
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
    SQL);

    // 5. Create business_notifications table
    $pdo->exec(<<<SQL
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
    SQL);

    // 6. Add moderation and reply fields to product_reviews
    $revCols = $pdo->query("SHOW COLUMNS FROM product_reviews")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('business_reply', $revCols, true)) {
        $pdo->exec("ALTER TABLE product_reviews ADD COLUMN business_reply TEXT NULL AFTER fit_feedback");
    }
    if (!in_array('business_reply_by', $revCols, true)) {
        $pdo->exec("ALTER TABLE product_reviews ADD COLUMN business_reply_by VARCHAR(100) NULL AFTER business_reply");
    }
    if (!in_array('business_replied_at', $revCols, true)) {
        $pdo->exec("ALTER TABLE product_reviews ADD COLUMN business_replied_at DATETIME NULL AFTER business_reply_by");
    }
    if (!in_array('is_flagged', $revCols, true)) {
        $pdo->exec("ALTER TABLE product_reviews ADD COLUMN is_flagged TINYINT(1) NOT NULL DEFAULT 0 AFTER business_replied_at");
    }
    if (!in_array('flag_reason', $revCols, true)) {
        $pdo->exec("ALTER TABLE product_reviews ADD COLUMN flag_reason VARCHAR(255) NULL AFTER is_flagged");
    }
    if (!in_array('flagged_at', $revCols, true)) {
        $pdo->exec("ALTER TABLE product_reviews ADD COLUMN flagged_at DATETIME NULL AFTER flag_reason");
    }

    // 7. Add business_id and responsible_name to audit_logs if not exists
    $auditCols = $pdo->query("SHOW COLUMNS FROM audit_logs")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('business_id', $auditCols, true)) {
        $pdo->exec("ALTER TABLE audit_logs ADD COLUMN business_id BIGINT UNSIGNED NULL AFTER user_id");
    }
    if (!in_array('responsible_name', $auditCols, true)) {
        $pdo->exec("ALTER TABLE audit_logs ADD COLUMN responsible_name VARCHAR(100) NULL AFTER business_id");
    }

    // 8. Create Admin / Business Owner Account
    // Email: adminadmin@gmail.com
    // Password: Pogi123@Classic
    // Role: Admin
    // Status: Active
    $adminEmail = 'adminadmin@gmail.com';
    $adminPasswordPlain = 'Pogi123@Classic';
    $stmtUser = $pdo->prepare("SELECT id FROM users WHERE email = :email LIMIT 1");
    $stmtUser->execute(['email' => $adminEmail]);
    $adminId = $stmtUser->fetchColumn();

    if (!$adminId) {
        $passwordHash = password_hash($adminPasswordPlain, PASSWORD_DEFAULT);
        $stmtCreateAdmin = $pdo->prepare(<<<SQL
            INSERT INTO users (email, password_hash, first_name, last_name, mobile, status, email_verified_at, created_at)
            VALUES (:email, :hash, 'Mara', 'Santos', '+63 917 000 0140', 'active', NOW(), NOW())
        SQL);
        $stmtCreateAdmin->execute([
            'email' => $adminEmail,
            'hash' => $passwordHash,
        ]);
        $adminId = (int)$pdo->lastInsertId();
        echo "Created Admin user ID: $adminId\n";
    } else {
        echo "Admin user already exists with ID: $adminId\n";
    }

    // Ensure Admin has role 'admin' (role_id = 2) in user_roles
    $stmtRole = $pdo->prepare("SELECT 1 FROM user_roles WHERE user_id = :user_id AND role_id = 2 LIMIT 1");
    $stmtRole->execute(['user_id' => $adminId]);
    if (!$stmtRole->fetchColumn()) {
        $stmtAssign = $pdo->prepare("INSERT INTO user_roles (user_id, role_id) VALUES (:user_id, 2)");
        $stmtAssign->execute(['user_id' => $adminId]);
        echo "Assigned 'admin' role to user ID: $adminId\n";
    }

    // Seed staff records in business_users if empty
    $staffCount = (int)$pdo->query("SELECT count(*) FROM business_users WHERE business_id = 1")->fetchColumn();
    if ($staffCount === 0) {
        $staffData = [
            [
                'user_id' => $adminId,
                'name' => 'Mara Santos',
                'email' => 'adminadmin@gmail.com',
                'role_title' => 'Business owner',
                'permission_set' => 'owner',
                'status' => 'active',
                'can_manage_products' => 1,
                'can_adjust_stock' => 1,
                'can_view_reports' => 1,
                'can_reply_reviews' => 1,
                'can_view_notifications' => 1,
                'can_manage_staff' => 1,
                'created_at' => '2026-10-01 09:00:00'
            ],
            [
                'user_id' => null,
                'name' => 'Nico Cruz',
                'email' => 'nico.cruz@example.com',
                'role_title' => 'Inventory manager',
                'permission_set' => 'inventory_manager',
                'status' => 'active',
                'can_manage_products' => 1,
                'can_adjust_stock' => 1,
                'can_view_reports' => 1,
                'can_reply_reviews' => 0,
                'can_view_notifications' => 1,
                'can_manage_staff' => 0,
                'created_at' => '2026-10-08 10:00:00'
            ],
            [
                'user_id' => null,
                'name' => 'Lea Lim',
                'email' => 'lea.lim@example.com',
                'role_title' => 'Review & reports staff',
                'permission_set' => 'reports_staff',
                'status' => 'active',
                'can_manage_products' => 0,
                'can_adjust_stock' => 0,
                'can_view_reports' => 1,
                'can_reply_reviews' => 1,
                'can_view_notifications' => 1,
                'can_manage_staff' => 0,
                'created_at' => '2026-10-12 11:30:00'
            ],
            [
                'user_id' => null,
                'name' => 'Rafi Tan',
                'email' => 'rafi.tan@example.com',
                'role_title' => 'Inventory viewer',
                'permission_set' => 'inventory_viewer',
                'status' => 'inactive',
                'can_manage_products' => 0,
                'can_adjust_stock' => 0,
                'can_view_reports' => 0,
                'can_reply_reviews' => 0,
                'can_view_notifications' => 1,
                'can_manage_staff' => 0,
                'created_at' => '2026-10-15 14:00:00'
            ]
        ];

        $stmtStaff = $pdo->prepare(<<<SQL
            INSERT INTO business_users
            (business_id, user_id, name, email, role_title, permission_set, status, can_manage_products, can_adjust_stock, can_view_reports, can_reply_reviews, can_view_notifications, can_manage_staff, created_at)
            VALUES
            (1, :user_id, :name, :email, :role_title, :permission_set, :status, :can_manage_products, :can_adjust_stock, :can_view_reports, :can_reply_reviews, :can_view_notifications, :can_manage_staff, :created_at)
        SQL);

        foreach ($staffData as $s) {
            $stmtStaff->execute($s);
        }
        echo "Seeded 4 business staff members.\n";
    }

    // Seed business notifications if empty
    $notifCount = (int)$pdo->query("SELECT count(*) FROM business_notifications WHERE business_id = 1")->fetchColumn();
    if ($notifCount === 0) {
        $notifs = [
            [
                'title' => 'Restock confirmed · Tee',
                'type' => 'restock',
                'message' => 'Tee · 64 +20 = 84 · Mara Santos',
                'reference_type' => 'movement',
                'reference_id' => '1',
                'action_url' => '#section-inventory-history',
                'is_read' => 1,
                'created_at' => '2026-11-05 14:10:00'
            ],
            [
                'title' => 'Low stock · Hoodie, 6 units',
                'type' => 'low_stock',
                'message' => 'Hoodie · 6 units / minimum 10',
                'reference_type' => 'product',
                'reference_id' => '5',
                'action_url' => '#section-inventory',
                'is_read' => 0,
                'created_at' => '2026-11-05 13:40:00'
            ],
            [
                'title' => 'Out of stock · Club Cap',
                'type' => 'out_of_stock',
                'message' => 'Club Cap · 0 units / minimum 8',
                'reference_type' => 'product',
                'reference_id' => '12',
                'action_url' => '#section-inventory',
                'is_read' => 0,
                'created_at' => '2026-11-05 12:25:00'
            ],
            [
                'title' => 'Unusual inventory change',
                'type' => 'unusual_change',
                'message' => 'Club Cap · −5 units / 100% decrease · damaged units by Nico Cruz',
                'reference_type' => 'activity',
                'reference_id' => 'cap-decrease',
                'action_url' => '#section-activity-logs',
                'is_read' => 0,
                'created_at' => '2026-11-05 12:25:00'
            ],
            [
                'title' => 'New customer review',
                'type' => 'new_review',
                'message' => 'Robin S. · Club Cap · 3 / 5 · Neat finish, but the crown feels shallow.',
                'reference_type' => 'review',
                'reference_id' => 'R-108',
                'action_url' => '#section-reviews',
                'is_read' => 0,
                'created_at' => '2026-11-04 11:10:00'
            ],
            [
                'title' => 'Sales milestone',
                'type' => 'milestone',
                'message' => 'October closed: 240 units / ₱647,800 merchandise revenue',
                'reference_type' => 'report',
                'reference_id' => 'oct-2026',
                'action_url' => '#section-analytics',
                'is_read' => 1,
                'created_at' => '2026-11-01 09:00:00'
            ],
            [
                'title' => 'Declining sales',
                'type' => 'declining_sales',
                'message' => 'Tote: 6 October units vs 10 September units · −40%',
                'reference_type' => 'report',
                'reference_id' => 'tote-sales',
                'action_url' => '#section-analytics',
                'is_read' => 0,
                'created_at' => '2026-11-01 09:00:00'
            ],
            [
                'title' => 'Important business activity',
                'type' => 'activity',
                'message' => 'Tote deactivated · stock 40 retained · Mara Santos',
                'reference_type' => 'activity',
                'reference_id' => 'tote-deactivated',
                'action_url' => '#section-activity-logs',
                'is_read' => 1,
                'created_at' => '2026-11-04 09:10:00'
            ],
        ];

        $stmtNotif = $pdo->prepare(<<<SQL
            INSERT INTO business_notifications
            (business_id, title, type, message, reference_type, reference_id, action_url, is_read, created_at)
            VALUES
            (1, :title, :type, :message, :reference_type, :reference_id, :action_url, :is_read, :created_at)
        SQL);

        foreach ($notifs as $n) {
            $stmtNotif->execute($n);
        }
        echo "Seeded 8 business notifications.\n";
    }

    if ($pdo->inTransaction()) {
        $pdo->commit();
    }
    echo "Migration completed successfully!\n";
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    echo "Migration error: " . $e->getMessage() . "\n";
    exit(1);
}

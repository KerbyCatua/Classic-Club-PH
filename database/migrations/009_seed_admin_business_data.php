<?php
declare(strict_types=1);

require_once __DIR__ . '/../../app/Database/Connection.php';

try {
    // 1. Ensure Categories exist
    $pdo->exec(<<<SQL
        INSERT IGNORE INTO categories (id, name, slug, description, is_active)
        VALUES 
            (1, 'Tops & tees', 'tops-tees', 'Tees, shirts, tanks, and knitwear', 1),
            (2, 'Outerwear & hoodies', 'outerwear-hoodies', 'Jackets, overshirts, and hoodies', 1),
            (3, 'Bottoms & accessories', 'bottoms-accessories', 'Trousers, shorts, pants, and accessories', 1);
    SQL);

    // 2. Setup the 6 core business products
    $productsConfig = [
        [
            'id' => 1,
            'name' => 'Essential Heavyweight Tee',
            'slug' => 'essential-heavyweight-tee',
            'category_id' => 1,
            'sku' => 'CC-TEE-001',
            'price' => 1890.00,
            'stock' => 84,
            'min_stock' => 20,
            'status' => 'active',
            'is_active' => 1,
            'description' => 'Obsidian · 240 GSM cotton jersey. A relaxed unisex fit, structured crew neckline and clean everyday proportions.'
        ],
        [
            'id' => 2,
            'name' => 'Structured Overshirt',
            'slug' => 'structured-overshirt',
            'category_id' => 2,
            'sku' => 'CC-OSH-002',
            'price' => 4890.00,
            'stock' => 18,
            'min_stock' => 10,
            'status' => 'active',
            'is_active' => 1,
            'description' => 'A clean shoulder and an open collar. Cut from structured cotton twill to frame your base layer with purposeful weight.'
        ],
        [
            'id' => 3,
            'name' => 'Relaxed Pleated Trouser',
            'slug' => 'relaxed-pleated-trouser',
            'category_id' => 3,
            'sku' => 'CC-TRS-004',
            'price' => 3290.00,
            'stock' => 32,
            'min_stock' => 12,
            'status' => 'active',
            'is_active' => 1,
            'description' => 'Relaxed through the hip and clean through the leg. Tailored for everyday movement and effortless pairing.'
        ],
        [
            'id' => 5,
            'name' => 'Everyday Loopback Hoodie',
            'slug' => 'everyday-loopback-hoodie',
            'category_id' => 2,
            'sku' => 'CC-HOD-003',
            'price' => 3890.00,
            'stock' => 6,
            'min_stock' => 10,
            'status' => 'active',
            'is_active' => 1,
            'description' => 'Heavyweight 380 GSM loopback cotton fleece with a double-layered hood, relaxed body and structured ribbed cuffs.'
        ],
        [
            'id' => 12,
            'name' => 'Understated Club Cap',
            'slug' => 'understated-club-cap',
            'category_id' => 3,
            'sku' => 'CC-CAP-005',
            'price' => 1190.00,
            'stock' => 0,
            'min_stock' => 8,
            'status' => 'active',
            'is_active' => 1,
            'description' => 'Unstructured six-panel silhouette in brushed cotton twill with a tonal back strap and minimal detailing.'
        ],
        [
            'id' => 13,
            'name' => 'Everyday Canvas Tote',
            'slug' => 'everyday-canvas-tote',
            'category_id' => 3,
            'sku' => 'CC-TOT-006',
            'price' => 990.00,
            'stock' => 40,
            'min_stock' => 10,
            'status' => 'inactive',
            'is_active' => 0,
            'description' => 'Heavyweight unbleached cotton canvas with reinforced shoulder straps and an internal slip pocket for daily essentials.'
        ],
    ];

    // Ensure sizes table has at least one default size (e.g. S, M, L, or One Size)
    $stmtSize = $pdo->query("SELECT id FROM sizes WHERE code = 'OS' OR code = 'M' LIMIT 1");
    $defaultSizeId = $stmtSize->fetchColumn();
    if (!$defaultSizeId) {
        $pdo->exec("INSERT IGNORE INTO sizes (id, code, size_type, sort_order, is_active) VALUES (1, 'OS', 'one_size', 1, 1)");
        $defaultSizeId = 1;
    }

    foreach ($productsConfig as $pc) {
        // Upsert product
        $stmtP = $pdo->prepare(<<<SQL
            INSERT INTO products (id, business_id, category_id, name, slug, description, min_stock_threshold, is_active)
            VALUES (:id, 1, :cat_id, :name, :slug, :desc, :min_stock, :is_active)
            ON DUPLICATE KEY UPDATE
                business_id = 1,
                name = VALUES(name),
                category_id = VALUES(category_id),
                description = VALUES(description),
                min_stock_threshold = VALUES(min_stock_threshold),
                is_active = VALUES(is_active)
        SQL);
        $stmtP->execute([
            'id' => $pc['id'],
            'cat_id' => $pc['category_id'],
            'name' => $pc['name'],
            'slug' => $pc['slug'],
            'desc' => $pc['description'],
            'min_stock' => $pc['min_stock'],
            'is_active' => $pc['is_active']
        ]);

        // Upsert product variant
        $stmtV = $pdo->prepare(<<<SQL
            SELECT id FROM product_variants WHERE product_id = :pid LIMIT 1
        SQL);
        $stmtV->execute(['pid' => $pc['id']]);
        $variantId = $stmtV->fetchColumn();

        if ($variantId) {
            $stmtUpdV = $pdo->prepare(<<<SQL
                UPDATE product_variants 
                SET sku = :sku, price = :price, availability_status = :status
                WHERE id = :id
            SQL);
            $stmtUpdV->execute([
                'sku' => $pc['sku'],
                'price' => $pc['price'],
                'status' => $pc['status'] === 'inactive' ? 'draft' : 'active',
                'id' => $variantId
            ]);
        } else {
            $stmtInsV = $pdo->prepare(<<<SQL
                INSERT INTO product_variants (product_id, sku, color_name, price, availability_status)
                VALUES (:pid, :sku, 'Standard', :price, :status)
            SQL);
            $stmtInsV->execute([
                'pid' => $pc['id'],
                'sku' => $pc['sku'],
                'price' => $pc['price'],
                'status' => $pc['status'] === 'inactive' ? 'draft' : 'active'
            ]);
            $variantId = (int)$pdo->lastInsertId();
        }

        // Upsert variant_sizes
        $stmtVS = $pdo->prepare("SELECT id FROM variant_sizes WHERE variant_id = :vid LIMIT 1");
        $stmtVS->execute(['vid' => $variantId]);
        $vsId = $stmtVS->fetchColumn();
        if ($vsId) {
            $stmtUpdVS = $pdo->prepare("UPDATE variant_sizes SET quantity_on_hand = :qty WHERE id = :id");
            $stmtUpdVS->execute(['qty' => $pc['stock'], 'id' => $vsId]);
        } else {
            $stmtInsVS = $pdo->prepare("INSERT INTO variant_sizes (variant_id, size_id, quantity_on_hand) VALUES (:vid, :sid, :qty)");
            $stmtInsVS->execute(['vid' => $variantId, 'sid' => $defaultSizeId, 'qty' => $pc['stock']]);
        }
    }

    // Set other products (if any exist above id 15) to business_id = 1 or keep them
    $pdo->exec("UPDATE products SET business_id = 1 WHERE business_id IS NULL OR business_id = 0");

    // 3. Seed stock movements if fewer than 5
    $movCount = (int)$pdo->query("SELECT count(*) FROM inventory_movements WHERE reason IS NOT NULL")->fetchColumn();
    if ($movCount < 5) {
        $movements = [
            [
                'product_id' => 1,
                'quantity_delta' => 20,
                'previous_quantity' => 64,
                'new_quantity' => 84,
                'movement_type' => 'receipt',
                'notes' => 'Restock · supplier delivery',
                'reason' => 'Supplier delivery',
                'admin_name' => 'Mara Santos',
                'created_at' => '2026-11-05 14:10:00'
            ],
            [
                'product_id' => 5,
                'quantity_delta' => -2,
                'previous_quantity' => 8,
                'new_quantity' => 6,
                'movement_type' => 'adjustment',
                'notes' => 'Manual decrease · damaged units',
                'reason' => 'Damaged units found during quality check',
                'admin_name' => 'Nico Cruz',
                'created_at' => '2026-11-05 13:40:00'
            ],
            [
                'product_id' => 12,
                'quantity_delta' => -5,
                'previous_quantity' => 5,
                'new_quantity' => 0,
                'movement_type' => 'adjustment',
                'notes' => 'Manual decrease · damaged units',
                'reason' => 'Damaged units found during quality check',
                'admin_name' => 'Nico Cruz',
                'created_at' => '2026-11-05 12:25:00'
            ],
            [
                'product_id' => 2,
                'quantity_delta' => -4,
                'previous_quantity' => 22,
                'new_quantity' => 18,
                'movement_type' => 'adjustment',
                'notes' => 'Manual decrease · sample transfer',
                'reason' => 'Sample transfer for showroom showcase',
                'admin_name' => 'Mara Santos',
                'created_at' => '2026-11-04 16:10:00'
            ],
            [
                'product_id' => 3,
                'quantity_delta' => 2,
                'previous_quantity' => 30,
                'new_quantity' => 32,
                'movement_type' => 'adjustment',
                'notes' => 'Manual increase · count correction',
                'reason' => 'Count correction following monthly audit',
                'admin_name' => 'Nico Cruz',
                'created_at' => '2026-11-04 10:20:00'
            ],
        ];

        // find variant_size_id for variant 1
        $stmtFirstVS = $pdo->query("SELECT id FROM variant_sizes LIMIT 1");
        $anyVsId = (int)$stmtFirstVS->fetchColumn();

        $stmtInsMov = $pdo->prepare(<<<SQL
            INSERT INTO inventory_movements 
            (variant_size_id, product_id, quantity_delta, previous_quantity, new_quantity, movement_type, notes, reason, admin_name, created_at)
            VALUES
            (:vsid, :pid, :delta, :prev, :new, :mtype, :notes, :reason, :admin_name, :created_at)
        SQL);

        foreach ($movements as $m) {
            // find variant_size_id for this product
            $stmtFindVS = $pdo->prepare("SELECT vs.id FROM variant_sizes vs JOIN product_variants pv ON pv.id = vs.variant_id WHERE pv.product_id = :pid LIMIT 1");
            $stmtFindVS->execute(['pid' => $m['product_id']]);
            $foundVsId = $stmtFindVS->fetchColumn() ?: $anyVsId;

            $stmtInsMov->execute([
                'vsid' => $foundVsId,
                'pid' => $m['product_id'],
                'delta' => $m['quantity_delta'],
                'prev' => $m['previous_quantity'],
                'new' => $m['new_quantity'],
                'mtype' => $m['movement_type'],
                'notes' => $m['notes'],
                'reason' => $m['reason'],
                'admin_name' => $m['admin_name'],
                'created_at' => $m['created_at'],
            ]);
        }
        echo "Seeded stock movements.\n";
    }

    // 4. Seed reviews if fewer than 8
    $revCount = (int)$pdo->query("SELECT count(*) FROM product_reviews")->fetchColumn();
    if ($revCount < 8) {
        $reviews = [
            [
                'title' => 'Neat finish, but the crown feels shallow',
                'content' => 'Neat finish, but the crown feels shallow. The silhouette is clean and minimal, but deeper structure would suit larger heads.',
                'rating' => 3,
                'display_name' => 'Robin S.',
                'email' => 'robin.s@example.com',
                'product_id' => 12, // Cap
                'size' => 'OS',
                'fit' => 'Slightly shallow',
                'created_at' => '2026-11-04 11:10:00'
            ],
            [
                'title' => 'Soft loopback; relaxed at the shoulders',
                'content' => 'Soft loopback; relaxed at the shoulders. Very comfortable everyday piece with substantial weight.',
                'rating' => 5,
                'display_name' => 'Taylor A.',
                'email' => 'taylor.a@example.com',
                'product_id' => 5, // Hoodie
                'size' => 'L',
                'fit' => 'True to size',
                'created_at' => '2026-11-03 14:20:00'
            ],
            [
                'title' => 'The weight makes the difference',
                'content' => 'The weight makes the difference. 240 GSM gives it structure that cheap tees completely lack.',
                'rating' => 5,
                'display_name' => 'Alex R.',
                'email' => 'alex.r@example.com',
                'product_id' => 1, // Tee
                'size' => 'M',
                'fit' => 'True to size',
                'created_at' => '2026-10-30 16:45:00'
            ],
            [
                'title' => 'Clean proportions, no extra effort',
                'content' => 'Clean proportions, no extra effort. Holds its shape well after several washes.',
                'rating' => 5,
                'display_name' => 'Jamie L.',
                'email' => 'jamie.l@example.com',
                'product_id' => 1, // Tee
                'size' => 'L',
                'fit' => 'True to size',
                'created_at' => '2026-10-28 09:15:00'
            ],
            [
                'title' => 'Substantial fabric, a generous cut',
                'content' => 'Substantial fabric, a generous cut. Very pleased with the collar thickness.',
                'rating' => 4,
                'display_name' => 'Sam C.',
                'email' => 'sam.c@example.com',
                'product_id' => 1, // Tee
                'size' => 'XL',
                'fit' => 'Slightly roomy',
                'created_at' => '2026-10-25 18:30:00'
            ],
            [
                'title' => 'A neckline that feels considered',
                'content' => 'A neckline that feels considered. Does not sag or bacon-neck.',
                'rating' => 5,
                'display_name' => 'Morgan D.',
                'email' => 'morgan.d@example.com',
                'product_id' => 1, // Tee
                'size' => 'S',
                'fit' => 'True to size',
                'created_at' => '2026-10-22 13:00:00'
            ],
            [
                'title' => 'Best for cooler days and indoor wear',
                'content' => 'Best for cooler days and indoor wear. Good heavy cotton that keeps drape.',
                'rating' => 4,
                'display_name' => 'Drew P.',
                'email' => 'drew.p@example.com',
                'product_id' => 1, // Tee
                'size' => 'M',
                'fit' => 'True to size',
                'created_at' => '2026-10-19 11:20:00'
            ],
            [
                'title' => 'Good construction; not my preferred fit',
                'content' => 'The stitching is tidy and the collar feels durable, but M is wider through the body than I personally like. I was hoping for a closer fit. The garment measurements would have helped me choose better; I would try S next time for a less relaxed shape.',
                'rating' => 3,
                'display_name' => 'Casey M.',
                'email' => 'casey.m@example.com',
                'product_id' => 1, // Tee
                'size' => 'M',
                'fit' => 'Roomy',
                'created_at' => '2026-10-16 10:00:00'
            ],
        ];

        // Find or create a dummy order for FK in product_reviews
        $stmtOrder = $pdo->query("SELECT id FROM orders LIMIT 1");
        $anyOrderId = $stmtOrder->fetchColumn();
        if (!$anyOrderId) {
            $pdo->exec("INSERT INTO orders (id, order_number, status, subtotal, shipping_amount, total_amount, placed_at) VALUES (1, 'ORD-SEED-001', 'delivered', 1890, 180, 2070, '2026-10-01 10:00:00')");
            $anyOrderId = 1;
        }

        // Find any user id for FK
        $stmtU = $pdo->query("SELECT id FROM users LIMIT 1");
        $anyUserId = (int)$stmtU->fetchColumn();

        $stmtInsRev = $pdo->prepare(<<<SQL
            INSERT INTO product_reviews 
            (order_id, user_id, variant_id, rating, title, content, display_name, email, size_purchased, fit_feedback, status, created_at)
            VALUES
            (:oid, :uid, :vid, :rating, :title, :content, :dname, :email, :size, :fit, 'published', :created_at)
        SQL);

        foreach ($reviews as $idx => $r) {
            // Find variant id for product
            $stmtVid = $pdo->prepare("SELECT id FROM product_variants WHERE product_id = :pid LIMIT 1");
            $stmtVid->execute(['pid' => $r['product_id']]);
            $vid = (int)$stmtVid->fetchColumn();

            // We ensure unique (order_id, variant_id)
            $revOrderId = (int)$anyOrderId + $idx;
            // create dummy order row if not exists
            $pdo->exec("INSERT IGNORE INTO orders (id, order_number, status, subtotal, shipping_amount, total_amount, placed_at) VALUES ($revOrderId, 'ORD-REV-$revOrderId', 'delivered', 1890, 180, 2070, '{$r['created_at']}')");

            try {
                $stmtInsRev->execute([
                    'oid' => $revOrderId,
                    'uid' => $anyUserId,
                    'vid' => $vid,
                    'rating' => $r['rating'],
                    'title' => $r['title'],
                    'content' => $r['content'],
                    'dname' => $r['display_name'],
                    'email' => $r['email'],
                    'size' => $r['size'],
                    'fit' => $r['fit'],
                    'created_at' => $r['created_at'],
                ]);
            } catch (Throwable $e) {
                // Ignore unique constraint collision
            }
        }
        echo "Seeded product reviews.\n";
    }

    // 5. Seed activity logs if empty
    $actCount = (int)$pdo->query("SELECT count(*) FROM audit_logs WHERE business_id = 1")->fetchColumn();
    if ($actCount < 8) {
        $activities = [
            [
                'action' => 'Restocked product',
                'entity_type' => 'Essential Heavyweight Tee',
                'responsible_name' => 'Mara Santos',
                'details' => json_encode(['change' => '64 → 84 units · +20 · Supplier delivery', 'role' => 'Business owner']),
                'created_at' => '2026-11-05 14:10:00'
            ],
            [
                'action' => 'Manual stock decrease',
                'entity_type' => 'Everyday Loopback Hoodie',
                'responsible_name' => 'Nico Cruz',
                'details' => json_encode(['change' => '8 → 6 units · −2 · Damaged units', 'role' => 'Inventory manager']),
                'created_at' => '2026-11-05 13:40:00'
            ],
            [
                'action' => 'Manual stock decrease',
                'entity_type' => 'Understated Club Cap',
                'responsible_name' => 'Nico Cruz',
                'details' => json_encode(['change' => '5 → 0 units · −5 · Damaged units', 'role' => 'Inventory manager']),
                'created_at' => '2026-11-05 12:25:00'
            ],
            [
                'action' => 'Stock adjustment',
                'entity_type' => 'Structured Overshirt',
                'responsible_name' => 'Mara Santos',
                'details' => json_encode(['change' => '22 → 18 units · −4 · Sample transfer', 'role' => 'Business owner']),
                'created_at' => '2026-11-04 16:10:00'
            ],
            [
                'action' => 'Manual stock increase',
                'entity_type' => 'Relaxed Pleated Trouser',
                'responsible_name' => 'Nico Cruz',
                'details' => json_encode(['change' => '30 → 32 units · +2 · Count correction', 'role' => 'Inventory manager']),
                'created_at' => '2026-11-04 10:20:00'
            ],
            [
                'action' => 'Product modification',
                'entity_type' => 'Essential Heavyweight Tee',
                'responsible_name' => 'Mara Santos',
                'details' => json_encode(['change' => 'Description updated · Price unchanged: ₱1,890', 'role' => 'Business owner']),
                'created_at' => '2026-11-04 09:30:00'
            ],
            [
                'action' => 'Product deactivated',
                'entity_type' => 'Everyday Canvas Tote',
                'responsible_name' => 'Mara Santos',
                'details' => json_encode(['change' => 'Active → Inactive · 40 units retained', 'role' => 'Business owner']),
                'created_at' => '2026-11-04 09:10:00'
            ],
            [
                'action' => 'Product activated',
                'entity_type' => 'Structured Overshirt',
                'responsible_name' => 'Mara Santos',
                'details' => json_encode(['change' => 'Inactive → Active · 22 units at event time', 'role' => 'Business owner']),
                'created_at' => '2026-11-04 09:00:00'
            ],
        ];

        $stmtInsAct = $pdo->prepare(<<<SQL
            INSERT INTO audit_logs 
            (business_id, responsible_name, action, entity_type, metadata, created_at)
            VALUES
            (1, :rname, :action, :etype, :meta, :created_at)
        SQL);

        foreach ($activities as $a) {
            $stmtInsAct->execute([
                'rname' => $a['responsible_name'],
                'action' => $a['action'],
                'etype' => $a['entity_type'],
                'meta' => $a['details'],
                'created_at' => $a['created_at'],
            ]);
        }
        echo "Seeded activity logs.\n";
    }

    echo "Admin baseline data successfully prepared!\n";
} catch (Throwable $e) {
    echo "Seeding error: " . $e->getMessage() . "\n";
    exit(1);
}

<?php

declare(strict_types=1);

namespace ClassicClub\Services;

use PDO;
use RuntimeException;
use Throwable;

final class AdminBusinessService
{
    public function __construct(
        private readonly PDO $pdo
    ) {
    }

    /**
     * Verify user is authorized for business admin.
     * Returns array with user details and assigned business ID.
     */
    public function authorizeAdmin(int $userId): array
    {
        $stmt = $this->pdo->prepare(<<<SQL
            SELECT u.id, u.email, u.first_name, u.last_name, u.mobile, u.status
            FROM users u
            WHERE u.id = :id AND u.status = 'active' AND u.deleted_at IS NULL
            LIMIT 1
        SQL);
        $stmt->execute(['id' => $userId]);
        $user = $stmt->fetch();

        if (!$user) {
            throw new RuntimeException('Admin account not found or inactive.');
        }

        // Check user roles
        $stmtRoles = $this->pdo->prepare(<<<SQL
            SELECT r.name
            FROM roles r
            JOIN user_roles ur ON ur.role_id = r.id
            WHERE ur.user_id = :uid
        SQL);
        $stmtRoles->execute(['uid' => $userId]);
        $roles = $stmtRoles->fetchAll(PDO::FETCH_COLUMN);

        $isAdmin = in_array('admin', $roles, true) || in_array('super_admin', $roles, true);

        // Also check if user is in business_users
        $stmtBizUser = $this->pdo->prepare(<<<SQL
            SELECT *
            FROM business_users
            WHERE user_id = :uid AND status = 'active'
            LIMIT 1
        SQL);
        $stmtBizUser->execute(['uid' => $userId]);
        $bizStaff = $stmtBizUser->fetch();

        if (!$isAdmin && !$bizStaff) {
            throw new RuntimeException('You do not have administrative access to this business.');
        }

        $businessId = $bizStaff ? (int)$bizStaff['business_id'] : 1;

        // Verify business exists and is active
        $stmtBiz = $this->pdo->prepare("SELECT * FROM businesses WHERE id = :bid AND status = 'active' LIMIT 1");
        $stmtBiz->execute(['bid' => $businessId]);
        $business = $stmtBiz->fetch();

        if (!$business) {
            throw new RuntimeException('Assigned business was not found.');
        }

        $user['roles'] = $roles;
        $user['business'] = $business;

        // Global admins have full access. Business staff are limited by the
        // per-module flags stored on their business_users record.
        $isGlobalAdmin = in_array('admin', $roles, true) || in_array('super_admin', $roles, true);
        $permissions = [
            'can_manage_products' => $isGlobalAdmin ? true : !empty($bizStaff['can_manage_products']),
            'can_adjust_stock' => $isGlobalAdmin ? true : !empty($bizStaff['can_adjust_stock']),
            'can_view_reports' => $isGlobalAdmin ? true : !empty($bizStaff['can_view_reports']),
            'can_reply_reviews' => $isGlobalAdmin ? true : !empty($bizStaff['can_reply_reviews']),
            'can_view_notifications' => $isGlobalAdmin ? true : !empty($bizStaff['can_view_notifications']),
            'can_manage_staff' => $isGlobalAdmin ? true : !empty($bizStaff['can_manage_staff']),
        ];

        return [
            'user' => $user,
            'business_id' => $businessId,
            'business' => $business,
            'permissions' => $permissions,
            'staff_role' => $bizStaff['role_title'] ?? null,
        ];
    }

    /**
     * Dashboard Overview Metrics & Highlights
     */
    public function getDashboardOverview(int $businessId): array
    {
        // 1. Total products, active vs inactive
        $stmtProd = $this->pdo->prepare(<<<SQL
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_count,
                SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS inactive_count
            FROM products
            WHERE business_id = :bid
        SQL);
        $stmtProd->execute(['bid' => $businessId]);
        $prodStats = $stmtProd->fetch();

        // 2. Physical & purchasable stock, low stock count, out of stock count
        $stmtStock = $this->pdo->prepare(<<<SQL
            SELECT
                p.id,
                p.name,
                p.is_active,
                p.min_stock_threshold,
                COALESCE((
                    SELECT SUM(vs.quantity_on_hand)
                    FROM product_variants pv
                    JOIN variant_sizes vs ON vs.variant_id = pv.id
                    WHERE pv.product_id = p.id
                ), 0) AS stock_qty
            FROM products p
            WHERE p.business_id = :bid
        SQL);
        $stmtStock->execute(['bid' => $businessId]);
        $productList = $stmtStock->fetchAll();

        $totalPhysicalStock = 0;
        $totalPurchasableStock = 0;
        $lowStockCount = 0;
        $outOfStockCount = 0;
        $lowStockItems = [];
        $outOfStockItems = [];

        foreach ($productList as $p) {
            $qty = (int)$p['stock_qty'];
            $min = (int)$p['min_stock_threshold'];
            $isActive = (int)$p['is_active'] === 1;

            $totalPhysicalStock += $qty;
            if ($isActive) {
                $totalPurchasableStock += $qty;
            }

            if ($qty === 0) {
                $outOfStockCount++;
                $outOfStockItems[] = ['id' => $p['id'], 'name' => $p['name'], 'qty' => $qty, 'min' => $min];
            } elseif ($qty <= $min) {
                $lowStockCount++;
                $lowStockItems[] = ['id' => $p['id'], 'name' => $p['name'], 'qty' => $qty, 'min' => $min];
            }
        }

        $businessScope = <<<SQL
            AND EXISTS (
                SELECT 1
                FROM variant_sizes bvs
                JOIN product_variants bpv ON bpv.id = bvs.variant_id
                JOIN products bp ON bp.id = bpv.product_id
                WHERE bvs.id = oi.variant_size_id AND bp.business_id = :bid
            )
        SQL;

        // 3. Sales statistics from real, non-cancelled orders
        $stmtSales = $this->pdo->prepare(<<<SQL
            SELECT
                COALESCE(SUM(oi.quantity), 0) AS units,
                COALESCE(SUM(oi.line_total), 0) AS revenue
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            WHERE o.status NOT IN ('cancelled', 'refunded')
            $businessScope
        SQL);
        $stmtSales->execute(['bid' => $businessId]);
        $sales = $stmtSales->fetch();
        $totalSoldUnits = (int)($sales['units'] ?? 0);
        $totalRevenue = (float)($sales['revenue'] ?? 0);

        // 4. Best sellers & least sellers based on actual product sales
        $stmtPatterns = $this->pdo->prepare(<<<SQL
            SELECT
                p.id,
                p.name,
                COALESCE(SUM(CASE WHEN o.status NOT IN ('cancelled', 'refunded') THEN oi.quantity ELSE 0 END), 0) AS units,
                COALESCE(SUM(CASE WHEN o.status NOT IN ('cancelled', 'refunded') THEN oi.line_total ELSE 0 END), 0) AS revenue
            FROM products p
            LEFT JOIN product_variants pv ON pv.product_id = p.id
            LEFT JOIN variant_sizes vs ON vs.variant_id = pv.id
            LEFT JOIN order_items oi ON oi.variant_size_id = vs.id
            LEFT JOIN orders o ON o.id = oi.order_id
            WHERE p.business_id = :bid
            GROUP BY p.id, p.name
        SQL);
        $stmtPatterns->execute(['bid' => $businessId]);
        $patternRows = $stmtPatterns->fetchAll();

        usort($patternRows, static fn (array $a, array $b): int => (int)$b['units'] <=> (int)$a['units']);
        $bestSellers = array_map(static fn (array $row): array => [
            'name' => $row['name'],
            'units' => (int)$row['units'],
            'revenue' => (float)$row['revenue'],
        ], array_slice($patternRows, 0, 3));

        $leastRows = $patternRows;
        usort($leastRows, static fn (array $a, array $b): int => (int)$a['units'] <=> (int)$b['units']);
        $leastSellers = array_map(static fn (array $row): array => [
            'name' => $row['name'],
            'units' => (int)$row['units'],
            'revenue' => (float)$row['revenue'],
        ], array_slice($leastRows, 0, 3));

        // 5. Last four sales weeks (real data, not a demo series)
        $stmtWeekly = $this->pdo->prepare(<<<SQL
            SELECT
                YEARWEEK(o.placed_at, 3) AS week_key,
                MIN(o.placed_at) AS period_start,
                MAX(o.placed_at) AS period_end,
                COALESCE(SUM(oi.quantity), 0) AS units,
                COALESCE(SUM(oi.line_total), 0) AS revenue
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            WHERE o.status NOT IN ('cancelled', 'refunded')
            $businessScope
            GROUP BY week_key
            ORDER BY week_key DESC
            LIMIT 4
        SQL);
        $stmtWeekly->execute(['bid' => $businessId]);
        $weeklyRows = array_reverse($stmtWeekly->fetchAll());
        $weeklyRevenue = array_map(static function (array $row): array {
            $start = strtotime((string)$row['period_start']);
            $end = strtotime((string)$row['period_end']);
            $label = date('d M', $start);
            if (date('Y-m-d', $start) !== date('Y-m-d', $end)) {
                $label .= ' – ' . date('d M', $end);
            }
            return [
                'period' => $label,
                'units' => (int)$row['units'],
                'revenue' => (float)$row['revenue'],
            ];
        }, $weeklyRows);

        // Month-over-month revenue movement for the KPI caption.
        $monthStart = new \DateTimeImmutable('first day of this month 00:00:00');
        $nextMonthStart = $monthStart->modify('first day of next month');
        $previousMonthStart = $monthStart->modify('first day of previous month');
        $stmtCompare = $this->pdo->prepare(<<<SQL
            SELECT
                COALESCE(SUM(CASE WHEN o.placed_at >= :current_start THEN oi.line_total ELSE 0 END), 0) AS current_revenue,
                COALESCE(SUM(CASE WHEN o.placed_at >= :previous_start AND o.placed_at < :current_start_2 THEN oi.line_total ELSE 0 END), 0) AS previous_revenue
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            WHERE o.status NOT IN ('cancelled', 'refunded')
              AND o.placed_at >= :previous_start_2
              AND o.placed_at < :next_start
              $businessScope
        SQL);
        $stmtCompare->execute([
            'current_start' => $monthStart->format('Y-m-d H:i:s'),
            'current_start_2' => $monthStart->format('Y-m-d H:i:s'),
            'previous_start' => $previousMonthStart->format('Y-m-d H:i:s'),
            'previous_start_2' => $previousMonthStart->format('Y-m-d H:i:s'),
            'next_start' => $nextMonthStart->format('Y-m-d H:i:s'),
            'bid' => $businessId,
        ]);
        $compare = $stmtCompare->fetch();
        $previousRevenue = (float)($compare['previous_revenue'] ?? 0);
        $currentRevenue = (float)($compare['current_revenue'] ?? 0);
        $revenueChangePct = $previousRevenue > 0
            ? round((($currentRevenue - $previousRevenue) / $previousRevenue) * 100, 1)
            : null;

        // 6. Recent inventory activities (last 5)
        $stmtAct = $this->pdo->prepare(<<<SQL
            SELECT
                im.id,
                im.quantity_delta,
                im.previous_quantity,
                im.new_quantity,
                im.movement_type,
                im.notes,
                im.reason,
                im.admin_name,
                im.created_at,
                p.name AS product_name
            FROM inventory_movements im
            LEFT JOIN products p ON p.id = im.product_id
            WHERE p.business_id = :bid
            ORDER BY im.created_at DESC, im.id DESC
            LIMIT 5
        SQL);
        $stmtAct->execute(['bid' => $businessId]);
        $recentActivities = array_map(static function (array $row): array {
            $delta = (int)$row['quantity_delta'];
            $deltaLabel = ($delta >= 0 ? '+' : '') . $delta;
            $reason = $row['reason'] ?: ($row['notes'] ?: ucfirst((string)$row['movement_type']));
            return [
                'summary' => ($row['product_name'] ?: 'Inventory') . ' · ' . $deltaLabel . ' units · ' . $reason,
                'meta' => date('M j, Y · H:i', strtotime((string)$row['created_at'])) . ' · ' . ($row['admin_name'] ?: 'System'),
                'created_at' => $row['created_at'],
            ];
        }, $stmtAct->fetchAll());

        // 7. Recent customer reviews (last 3)
        $stmtRev = $this->pdo->prepare(<<<SQL
            SELECT
                pr.id,
                pr.rating,
                pr.title,
                pr.content,
                pr.display_name,
                pr.created_at,
                pr.business_reply,
                p.name AS product_name
            FROM product_reviews pr
            JOIN product_variants pv ON pv.id = pr.variant_id
            JOIN products p ON p.id = pv.product_id
            WHERE pr.status != 'hidden' AND p.business_id = :bid
            ORDER BY pr.created_at DESC, pr.id DESC
            LIMIT 3
        SQL);
        $stmtRev->execute(['bid' => $businessId]);
        $recentReviews = array_map(static fn (array $row): array => [
            'author' => $row['display_name'] ?: 'Customer',
            'product' => $row['product_name'] ?: 'Product',
            'rating' => (int)$row['rating'],
            'meta' => date('M j, Y', strtotime((string)$row['created_at'])) . ' · ' . ($row['title'] ?: 'Verified review'),
            'created_at' => $row['created_at'],
        ], $stmtRev->fetchAll());

        // 8. Recent business notifications (last 3)
        $stmtNotif = $this->pdo->prepare(<<<SQL
            SELECT *
            FROM business_notifications
            WHERE business_id = :bid
            ORDER BY created_at DESC, id DESC
            LIMIT 3
        SQL);
        $stmtNotif->execute(['bid' => $businessId]);
        $recentNotifications = array_map(static fn (array $row): array => [
            'title' => $row['title'],
            'meta' => $row['message'] . ' · ' . date('M j, Y · H:i', strtotime((string)$row['created_at'])),
            'created_at' => $row['created_at'],
        ], $stmtNotif->fetchAll());

        return [
            'total_products' => (int)($prodStats['total'] ?? 0),
            'active_products' => (int)($prodStats['active_count'] ?? 0),
            'inactive_products' => (int)($prodStats['inactive_count'] ?? 0),
            'total_available_stock' => $totalPurchasableStock,
            'total_physical_stock' => $totalPhysicalStock,
            'total_products_sold' => $totalSoldUnits,
            'total_revenue' => $totalRevenue,
            'revenue_change_pct' => $revenueChangePct,
            'low_stock_count' => $lowStockCount,
            'out_of_stock_count' => $outOfStockCount,
            'low_stock_items' => $lowStockItems,
            'out_of_stock_items' => $outOfStockItems,
            'best_sellers' => $bestSellers,
            'least_sellers' => $leastSellers,
            'weekly_revenue' => $weeklyRevenue,
            'recent_activities' => $recentActivities,
            'recent_reviews' => $recentReviews,
            'recent_notifications' => $recentNotifications,
        ];
    }

    /**
     * Get Products for the assigned business
     */
    public function getProducts(int $businessId, array $filters = []): array
    {
        // Products may have several colour variants. The admin workspace works
        // at product level, so return one row per product with aggregated stock
        // and the first variant's SKU/price as the catalogue identity.
        $sql = <<<SQL
            SELECT
                p.id,
                p.business_id,
                p.category_id,
                p.name,
                p.slug,
                p.description,
                (SELECT pi.image_url FROM product_images pi WHERE pi.variant_id = (SELECT pv0.id FROM product_variants pv0 WHERE pv0.product_id = p.id ORDER BY pv0.id LIMIT 1) ORDER BY pi.sort_order, pi.id LIMIT 1) AS image_url,
                p.min_stock_threshold,
                p.is_active,
                p.created_at,
                p.updated_at,
                c.name AS category_name,
                (SELECT pv1.id FROM product_variants pv1 WHERE pv1.product_id = p.id ORDER BY pv1.id LIMIT 1) AS variant_id,
                COALESCE((SELECT pv2.sku FROM product_variants pv2 WHERE pv2.product_id = p.id ORDER BY pv2.id LIMIT 1), CONCAT('CC-PRD-00', p.id)) AS sku,
                COALESCE((SELECT pv3.price FROM product_variants pv3 WHERE pv3.product_id = p.id ORDER BY pv3.id LIMIT 1), 0.00) AS price,
                COALESCE((SELECT pv4.availability_status FROM product_variants pv4 WHERE pv4.product_id = p.id ORDER BY pv4.id LIMIT 1), 'active') AS availability_status,
                COALESCE((
                    SELECT SUM(vs.quantity_on_hand)
                    FROM product_variants pv5
                    JOIN variant_sizes vs ON vs.variant_id = pv5.id
                    WHERE pv5.product_id = p.id
                ), 0) AS stock_qty
            FROM products p
            JOIN categories c ON c.id = p.category_id
            WHERE p.business_id = :bid
        SQL;

        $params = ['bid' => $businessId];

        if (!empty($filters['search'])) {
            $sql .= " AND (p.name LIKE :search_name OR p.description LIKE :search_description OR EXISTS (
                SELECT 1 FROM product_variants pvs WHERE pvs.product_id = p.id AND pvs.sku LIKE :search_sku
            ))";
            $search = '%' . trim($filters['search']) . '%';
            $params['search_name'] = $search;
            $params['search_description'] = $search;
            $params['search_sku'] = $search;
        }

        if (!empty($filters['category']) && $filters['category'] !== 'all') {
            $sql .= " AND c.name = :category";
            $params['category'] = $filters['category'];
        }

        if (!empty($filters['availability']) && $filters['availability'] !== 'all') {
            $stockSubquery = "(SELECT COALESCE(SUM(vs.quantity_on_hand), 0)
                FROM product_variants pvf
                JOIN variant_sizes vs ON vs.variant_id = pvf.id
                WHERE pvf.product_id = p.id)";

            if ($filters['availability'] === 'active') {
                $sql .= " AND p.is_active = 1";
            } elseif ($filters['availability'] === 'inactive') {
                $sql .= " AND p.is_active = 0";
            } elseif ($filters['availability'] === 'low_stock') {
                $sql .= " AND $stockSubquery > 0 AND $stockSubquery <= p.min_stock_threshold";
            } elseif ($filters['availability'] === 'out_of_stock') {
                $sql .= " AND $stockSubquery = 0";
            }
        }

        $sort = $filters['sort'] ?? 'name_asc';
        if ($sort === 'name_desc') {
            $sql .= " ORDER BY p.name DESC";
        } elseif ($sort === 'price_asc') {
            $sql .= " ORDER BY price ASC";
        } elseif ($sort === 'price_desc') {
            $sql .= " ORDER BY price DESC";
        } elseif ($sort === 'stock_asc') {
            $sql .= " ORDER BY stock_qty ASC";
        } elseif ($sort === 'stock_desc') {
            $sql .= " ORDER BY stock_qty DESC";
        } else {
            $sql .= " ORDER BY p.name ASC";
        }

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        $products = $stmt->fetchAll();

        foreach ($products as &$p) {
            $qty = (int)$p['stock_qty'];
            $min = (int)$p['min_stock_threshold'];
            $isActive = (int)$p['is_active'] === 1;

            if (!$isActive) {
                $p['stock_status'] = 'Inactive · Unavailable';
            } elseif ($qty === 0) {
                $p['stock_status'] = 'Active · Out of stock';
            } elseif ($qty <= $min) {
                $p['stock_status'] = 'Active · Low stock';
            } else {
                $p['stock_status'] = 'Active · Available';
            }
        }
        unset($p);

        return $products;
    }

    /**
     * Create new product for the business
     */
    public function createProduct(int $businessId, array $data, int $adminUserId, string $adminName): array
    {
        $image = $this->prepareProductImage($data['image'] ?? null, true);
        $name = trim($data['name'] ?? '');
        $sku = strtoupper(trim($data['sku'] ?? ''));
        $price = (float)($data['price'] ?? 0);
        $categoryId = (int)($data['category_id'] ?? 1);
        $description = trim($data['description'] ?? '');
        $stock = max(0, (int)($data['initial_stock'] ?? $data['stock'] ?? 0));
        $minThreshold = max(1, (int)($data['min_stock_threshold'] ?? $data['min_threshold'] ?? 10));
        $isActive = !empty($data['is_active']) ? 1 : 0;

        if ($name === '') {
            throw new RuntimeException('Product name is required.');
        }
        if ($sku === '') {
            throw new RuntimeException('SKU is required.');
        }
        if (!is_finite($price) || $price <= 0) {
            throw new RuntimeException('Price must be greater than zero.');
        }

        $stmtCategory = $this->pdo->prepare("SELECT id FROM categories WHERE id = :id AND is_active = 1 LIMIT 1");
        $stmtCategory->execute(['id' => $categoryId]);
        if (!$stmtCategory->fetchColumn()) {
            throw new RuntimeException('Please choose a valid product category.');
        }

        $stmtSku = $this->pdo->prepare("SELECT id FROM product_variants WHERE sku = :sku LIMIT 1");
        $stmtSku->execute(['sku' => $sku]);
        if ($stmtSku->fetchColumn()) {
            throw new RuntimeException('That SKU is already assigned to another product.');
        }

        // Slug
        $slug = strtolower(preg_replace('/[^A-Za-z0-9-]+/', '-', $name));
        $slug = trim($slug, '-') . '-' . substr(md5(uniqid('', true)), 0, 4);

        $this->pdo->beginTransaction();
        try {
            // Insert product
            $stmtP = $this->pdo->prepare(<<<SQL
                INSERT INTO products 
                (business_id, category_id, name, slug, description, min_stock_threshold, is_active)
                VALUES 
                (:bid, :cid, :name, :slug, :desc, :min, :active)
            SQL);
            $stmtP->execute([
                'bid' => $businessId,
                'cid' => $categoryId,
                'name' => $name,
                'slug' => $slug,
                'desc' => $description,
                'min' => $minThreshold,
                'active' => $isActive,
            ]);
            $productId = (int)$this->pdo->lastInsertId();

            // Insert product variant
            $stmtV = $this->pdo->prepare(<<<SQL
                INSERT INTO product_variants 
                (product_id, sku, color_name, price, availability_status)
                VALUES 
                (:pid, :sku, 'Standard', :price, :status)
            SQL);
            $stmtV->execute([
                'pid' => $productId,
                'sku' => $sku,
                'price' => $price,
                'status' => $isActive ? 'active' : 'draft',
            ]);
            $variantId = (int)$this->pdo->lastInsertId();
            $this->saveProductImage($variantId, $image, $name);

            // Get default size
            $stmtSize = $this->pdo->query("SELECT id FROM sizes WHERE is_active = 1 LIMIT 1");
            $sizeId = (int)$stmtSize->fetchColumn() ?: 1;

            // Insert variant_sizes
            $stmtVS = $this->pdo->prepare(<<<SQL
                INSERT INTO variant_sizes (variant_id, size_id, quantity_on_hand)
                VALUES (:vid, :sid, :qty)
            SQL);
            $stmtVS->execute([
                'vid' => $variantId,
                'sid' => $sizeId,
                'qty' => $stock,
            ]);
            $vsId = (int)$this->pdo->lastInsertId();

            // Record initial movement if stock > 0
            if ($stock > 0) {
                $stmtMov = $this->pdo->prepare(<<<SQL
                    INSERT INTO inventory_movements 
                    (variant_size_id, product_id, quantity_delta, previous_quantity, new_quantity, movement_type, notes, reason, admin_name, created_by)
                    VALUES 
                    (:vsid, :pid, :delta, 0, :new, 'receipt', 'Initial stock creation', 'Initial catalog setup', :aname, :uid)
                SQL);
                $stmtMov->execute([
                    'vsid' => $vsId,
                    'pid' => $productId,
                    'delta' => $stock,
                    'new' => $stock,
                    'aname' => $adminName,
                    'uid' => $adminUserId,
                ]);
            }

            // Log activity
            $this->logActivity(
                $businessId,
                $adminName,
                'Product created',
                $name,
                "Created product $name ($sku) · ₱" . number_format($price, 2) . " · $stock units",
                $adminUserId
            );

            $this->pdo->commit();

            return ['product_id' => $productId, 'message' => 'Product created successfully.'];
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }

    /**
     * Update an existing product
     */
    public function updateProduct(int $businessId, int $productId, array $data, int $adminUserId, string $adminName): array
    {
        $image = $this->prepareProductImage($data['image'] ?? null, true);
        $stmtFind = $this->pdo->prepare(<<<SQL
            SELECT p.*, pv.id as variant_id, pv.sku, pv.price 
            FROM products p
            LEFT JOIN product_variants pv ON pv.product_id = p.id
            WHERE p.id = :pid AND p.business_id = :bid
            LIMIT 1
        SQL);
        $stmtFind->execute(['pid' => $productId, 'bid' => $businessId]);
        $prod = $stmtFind->fetch();

        if (!$prod) {
            throw new RuntimeException('Product not found in this business.');
        }

        $name = trim($data['name'] ?? $prod['name']);
        $categoryId = (int)($data['category_id'] ?? $prod['category_id']);
        $description = trim($data['description'] ?? $prod['description']);
        $price = isset($data['price']) ? (float)$data['price'] : (float)$prod['price'];
        $minThreshold = isset($data['min_stock_threshold'])
            ? (int)$data['min_stock_threshold']
            : (isset($data['min_threshold']) ? (int)$data['min_threshold'] : (int)$prod['min_stock_threshold']);
        $isActive = isset($data['is_active']) ? ((int)$data['is_active'] === 1 ? 1 : 0) : (int)$prod['is_active'];

        if ($name === '') {
            throw new RuntimeException('Product name is required.');
        }
        if (!is_finite($price) || $price <= 0) {
            throw new RuntimeException('Price must be greater than zero.');
        }
        if ($minThreshold < 0) {
            throw new RuntimeException('Minimum stock threshold cannot be negative.');
        }

        $stmtCategory = $this->pdo->prepare("SELECT id FROM categories WHERE id = :id AND is_active = 1 LIMIT 1");
        $stmtCategory->execute(['id' => $categoryId]);
        if (!$stmtCategory->fetchColumn()) {
            throw new RuntimeException('Please choose a valid product category.');
        }

        $this->pdo->beginTransaction();
        try {
            $stmtUpdP = $this->pdo->prepare(<<<SQL
                UPDATE products 
                SET name = :name, category_id = :cid, description = :desc, min_stock_threshold = :min, is_active = :active
                WHERE id = :id AND business_id = :bid
            SQL);
            $stmtUpdP->execute([
                'name' => $name,
                'cid' => $categoryId,
                'desc' => $description,
                'min' => $minThreshold,
                'active' => $isActive,
                'id' => $productId,
                'bid' => $businessId,
            ]);

            if ($prod['variant_id']) {
                $stmtUpdV = $this->pdo->prepare(<<<SQL
                    UPDATE product_variants 
                    SET price = :price, availability_status = :status
                    WHERE product_id = :pid
                SQL);
                $stmtUpdV->execute([
                    'price' => $price,
                    'status' => $isActive ? 'active' : 'draft',
                    'pid' => $productId,
                ]);
                $this->saveProductImage((int)$prod['variant_id'], $image, $name);
            }

            // Log activity
            $this->logActivity(
                $businessId,
                $adminName,
                'Product modification',
                $name,
                "Updated details for $name · Price: ₱" . number_format($price, 2) . " · Status: " . ($isActive ? 'Active' : 'Inactive'),
                $adminUserId
            );

            $this->pdo->commit();

            return ['product_id' => $productId, 'message' => 'Product updated successfully.'];
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }

    private function prepareProductImage(mixed $value, bool $required): array
    {
            if (!is_string($value) || !preg_match('#^data:(image/jpeg|image/png|image/webp);base64,([A-Za-z0-9+/=]+)$#', $value, $matches)) {
                if ($required) {
                    throw new RuntimeException('A square product image is required.');
                }
                return [];
            }
            $mime = $matches[1];
            $binary = base64_decode($matches[2], true);
            if ($binary === false || strlen($binary) > 5 * 1024 * 1024) {
                throw new RuntimeException('Product image must be a valid image up to 5 MB.');
            }
            $size = @getimagesizefromstring($binary);
            if ($size === false || $size[0] !== $size[1]) {
                throw new RuntimeException('Product image must be exactly 1:1 square.');
            }
            return [$mime, $binary];
    }

    private function saveProductImage(int $variantId, array $image, string $name): void
    {
            if (count($image) !== 2) {
                throw new RuntimeException('Product image is required.');
            }
            $extension = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'][$image[0]];
            $directory = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'public' . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . 'products';
            if (!is_dir($directory) && !mkdir($directory, 0755, true) && !is_dir($directory)) {
                throw new RuntimeException('Unable to prepare product image storage.');
            }
            $filename = bin2hex(random_bytes(16)) . '.' . $extension;
            if (file_put_contents($directory . DIRECTORY_SEPARATOR . $filename, $image[1], LOCK_EX) === false) {
                throw new RuntimeException('Unable to save product image.');
            }
            $url = 'public/uploads/products/' . $filename;
            $stmt = $this->pdo->prepare("DELETE FROM product_images WHERE variant_id = :variant_id AND image_role = 'primary'");
            $stmt->execute(['variant_id' => $variantId]);
            $stmt = $this->pdo->prepare("INSERT INTO product_images (variant_id, image_url, alt_text, image_role, sort_order) VALUES (:variant_id, :url, :alt, 'primary', 0)");
            $stmt->execute(['variant_id' => $variantId, 'url' => $url, 'alt' => $name]);
    }

    /**
     * Activate, Deactivate, or Archive product
     */
    public function setProductStatus(int $businessId, int $productId, string $action, int $adminUserId, string $adminName): array
    {
        $stmt = $this->pdo->prepare("SELECT * FROM products WHERE id = :id AND business_id = :bid LIMIT 1");
        $stmt->execute(['id' => $productId, 'bid' => $businessId]);
        $prod = $stmt->fetch();
        if (!$prod) {
            throw new RuntimeException('Product not found.');
        }

        $this->pdo->beginTransaction();
        try {
            if ($action === 'activate') {
                $this->pdo->prepare("UPDATE products SET is_active = 1 WHERE id = ?")->execute([$productId]);
                $this->pdo->prepare("UPDATE product_variants SET availability_status = 'active' WHERE product_id = ?")->execute([$productId]);
                $msg = "Activated {$prod['name']}";
                $this->logActivity($businessId, $adminName, 'Product activated', $prod['name'], "Inactive → Active", $adminUserId);
            } elseif ($action === 'deactivate') {
                $this->pdo->prepare("UPDATE products SET is_active = 0 WHERE id = ?")->execute([$productId]);
                $this->pdo->prepare("UPDATE product_variants SET availability_status = 'draft' WHERE product_id = ?")->execute([$productId]);
                $msg = "Deactivated {$prod['name']}";
                $this->logActivity($businessId, $adminName, 'Product deactivated', $prod['name'], "Active → Inactive", $adminUserId);
            } elseif ($action === 'archive') {
                $this->pdo->prepare("UPDATE products SET is_active = 0 WHERE id = ?")->execute([$productId]);
                $this->pdo->prepare("UPDATE product_variants SET availability_status = 'archived' WHERE product_id = ?")->execute([$productId]);
                $msg = "Archived {$prod['name']}";
                $this->logActivity($businessId, $adminName, 'Product archived', $prod['name'], "Archived listing, retained stock", $adminUserId);
            } else {
                throw new RuntimeException('Invalid action.');
            }

            $this->pdo->commit();

            return ['message' => $msg];
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }

    /**
     * Get inventory list
     */
    public function getInventory(int $businessId, array $filters = []): array
    {
        $products = $this->getProducts($businessId, $filters);
        $totalPhysical = 0;
        $totalAvailable = 0;
        $lowCount = 0;
        $outCount = 0;

        foreach ($products as $p) {
            $qty = (int)$p['stock_qty'];
            $isActive = (int)$p['is_active'] === 1;
            $totalPhysical += $qty;
            if ($isActive) {
                $totalAvailable += $qty;
            }
            if ($qty === 0) {
                $outCount++;
            } elseif ($qty <= (int)$p['min_stock_threshold']) {
                $lowCount++;
            }
        }

        return [
            'products' => $products,
            'summary' => [
                'total_physical_stock' => $totalPhysical,
                'total_available_stock' => $totalAvailable,
                'low_stock_count' => $lowCount,
                'out_of_stock_count' => $outCount,
            ]
        ];
    }

    /**
     * Restock inventory (Increase stock)
     */
    public function restockProduct(int $businessId, int $productId, int $quantity, string $reason, int $adminUserId, string $adminName): array
    {
        if ($quantity <= 0) {
            throw new RuntimeException('Quantity to add must be greater than zero.');
        }

        $reason = trim($reason);
        if ($reason === '') {
            $reason = 'Supplier delivery';
        }

        $this->pdo->beginTransaction();
        try {
            $stmt = $this->pdo->prepare(<<<SQL
                SELECT p.name, p.min_stock_threshold
                FROM products p
                WHERE p.id = :pid AND p.business_id = :bid
                LIMIT 1
            SQL);
            $stmt->execute(['pid' => $productId, 'bid' => $businessId]);
            $item = $stmt->fetch();

            if (!$item) {
                throw new RuntimeException('Product not found in this business.');
            }

            // Lock every size row so concurrent stock operations cannot lose updates.
            $stmtSizes = $this->pdo->prepare(<<<SQL
                SELECT vs.id AS vs_id, vs.quantity_on_hand
                FROM product_variants pv
                JOIN variant_sizes vs ON vs.variant_id = pv.id
                WHERE pv.product_id = :pid
                ORDER BY vs.id
                FOR UPDATE
            SQL);
            $stmtSizes->execute(['pid' => $productId]);
            $sizeRows = $stmtSizes->fetchAll();

            if (!$sizeRows) {
                throw new RuntimeException('Product stock record not found.');
            }

            $prevQty = 0;
            foreach ($sizeRows as $row) {
                $prevQty += (int)$row['quantity_on_hand'];
            }
            $newQty = $prevQty + $quantity;
            $primaryVsId = (int)$sizeRows[0]['vs_id'];

            // Spread the delivery across every size bucket so per-size
            // availability stays usable and the product total grows by exactly
            // the entered quantity.
            $this->spreadStockIncrease($sizeRows, $quantity);

            // Insert inventory movement
            $stmtMov = $this->pdo->prepare(<<<SQL
                INSERT INTO inventory_movements
                (variant_size_id, product_id, quantity_delta, previous_quantity, new_quantity, movement_type, notes, reason, admin_name, created_by)
                VALUES
                (:vsid, :pid, :delta, :prev, :new, 'receipt', :notes, :reason, :aname, :uid)
            SQL);
            $stmtMov->execute([
                'vsid' => $primaryVsId,
                'pid' => $productId,
                'delta' => $quantity,
                'prev' => $prevQty,
                'new' => $newQty,
                'notes' => "Restock · +$quantity units",
                'reason' => $reason,
                'aname' => $adminName,
                'uid' => $adminUserId,
            ]);

            // Log activity
            $this->logActivity(
                $businessId,
                $adminName,
                'Restocked product',
                $item['name'],
                "$prevQty → $newQty units · +$quantity · $reason",
                $adminUserId
            );

            // Create notification
            $this->createNotification(
                $businessId,
                "Restock confirmed · {$item['name']}",
                'restock',
                "{$item['name']} · $prevQty +$quantity = $newQty · $adminName",
                'movement',
                (string)$productId,
                '#section-inventory-history'
            );

            $this->pdo->commit();

            return [
                'previous_quantity' => $prevQty,
                'new_quantity' => $newQty,
                'message' => "Successfully restocked {$item['name']}. Updated stock: $newQty units."
            ];
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }

    /**
     * Manual Stock Adjustment (Increase or Decrease with reason)
     */
    public function adjustStock(int $businessId, int $productId, string $type, int $quantity, string $reason, int $adminUserId, string $adminName): array
    {
        $type = strtolower(trim($type));
        if ($quantity < 0) {
            throw new RuntimeException('Stock quantity cannot be negative.');
        }
        if ($type !== 'set' && $quantity <= 0) {
            throw new RuntimeException('Adjustment quantity must be greater than zero.');
        }

        $reason = trim($reason);
        if ($reason === '') {
            throw new RuntimeException('A valid reason is required for manual stock adjustments.');
        }

        $this->pdo->beginTransaction();
        try {
            $stmt = $this->pdo->prepare(<<<SQL
                SELECT p.name, p.min_stock_threshold
                FROM products p
                WHERE p.id = :pid AND p.business_id = :bid
                LIMIT 1
            SQL);
            $stmt->execute(['pid' => $productId, 'bid' => $businessId]);
            $item = $stmt->fetch();

            if (!$item) {
                throw new RuntimeException('Product not found in this business.');
            }

            $stmtSizes = $this->pdo->prepare(<<<SQL
                SELECT vs.id AS vs_id, vs.quantity_on_hand
                FROM product_variants pv
                JOIN variant_sizes vs ON vs.variant_id = pv.id
                WHERE pv.product_id = :pid
                ORDER BY vs.id
                FOR UPDATE
            SQL);
            $stmtSizes->execute(['pid' => $productId]);
            $sizeRows = $stmtSizes->fetchAll();

            if (!$sizeRows) {
                throw new RuntimeException('Product stock record not found.');
            }

            $prevQty = 0;
            foreach ($sizeRows as $row) {
                $prevQty += (int)$row['quantity_on_hand'];
            }
            $minThreshold = (int)$item['min_stock_threshold'];
            $primaryVsId = (int)$sizeRows[0]['vs_id'];

            if ($type === 'decrease') {
                if ($prevQty - $quantity < 0) {
                    throw new RuntimeException("Invalid adjustment: Quantity cannot be reduced below zero. Current stock is $prevQty.");
                }
                $delta = -$quantity;
                $newQty = $prevQty - $quantity;
                $actionLabel = 'Manual stock decrease';
                $this->reduceStock($sizeRows, $quantity);
            } elseif ($type === 'increase') {
                $delta = $quantity;
                $newQty = $prevQty + $quantity;
                $actionLabel = 'Manual stock increase';
                $this->spreadStockIncrease($sizeRows, $quantity);
            } elseif ($type === 'set') {
                // Manual adjustment corrects stock to the entered quantity.
                $newQty = $quantity;
                $delta = $newQty - $prevQty;
                $actionLabel = 'Manual stock adjustment';

                // A recount replaces the product total, so redistribute it
                // evenly across size buckets instead of draining the first ones.
                $this->setStockEvenly($sizeRows, $newQty);
            } else {
                throw new RuntimeException('Invalid adjustment type.');
            }

            // Insert inventory movement
            $stmtMov = $this->pdo->prepare(<<<SQL
                INSERT INTO inventory_movements
                (variant_size_id, product_id, quantity_delta, previous_quantity, new_quantity, movement_type, notes, reason, admin_name, created_by)
                VALUES
                (:vsid, :pid, :delta, :prev, :new, 'adjustment', :notes, :reason, :aname, :uid)
            SQL);
            $stmtMov->execute([
                'vsid' => $primaryVsId,
                'pid' => $productId,
                'delta' => $delta,
                'prev' => $prevQty,
                'new' => $newQty,
                'notes' => "$actionLabel · " . ($delta > 0 ? "+$delta" : "$delta") . " units",
                'reason' => $reason,
                'aname' => $adminName,
                'uid' => $adminUserId,
            ]);

            // Log activity
            $this->logActivity(
                $businessId,
                $adminName,
                $actionLabel,
                $item['name'],
                "$prevQty → $newQty units · " . ($delta > 0 ? "+$delta" : "$delta") . " · $reason",
                $adminUserId
            );

            // Create notification if low or out of stock
            if ($newQty === 0) {
                $this->createNotification(
                    $businessId,
                    "Out of stock · {$item['name']}",
                    'out_of_stock',
                    "{$item['name']} · 0 units / minimum $minThreshold",
                    'product',
                    (string)$productId,
                    '#section-inventory'
                );
            } elseif ($newQty <= $minThreshold) {
                $this->createNotification(
                    $businessId,
                    "Low stock · {$item['name']}, $newQty units",
                    'low_stock',
                    "{$item['name']} · $newQty units / minimum $minThreshold",
                    'product',
                    (string)$productId,
                    '#section-inventory'
                );
            }

            // Check if unusual change (e.g. 50%+ reduction or decrease by 5+)
            if ($type === 'decrease' && ($quantity >= 5 || ($prevQty > 0 && ($quantity / $prevQty) >= 0.5))) {
                $this->createNotification(
                    $businessId,
                    "Unusual inventory change",
                    'unusual_change',
                    "{$item['name']} · -$quantity units / reduction · $reason by $adminName",
                    'activity',
                    (string)$productId,
                    '#section-activity-logs'
                );
            }

            $this->pdo->commit();

            return [
                'previous_quantity' => $prevQty,
                'new_quantity' => $newQty,
                'message' => "Successfully adjusted {$item['name']} stock to $newQty units."
            ];
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }

    /**
     * Add units to a product's size buckets, in order, so per-size
     * availability remains usable while the product total grows by exactly
     * the requested quantity.
     *
     * @param array<int,array{vs_id:int|string,quantity_on_hand:int|string}> $sizeRows
     */
    private function spreadStockIncrease(array $sizeRows, int $quantity): void
    {
        if ($quantity <= 0 || $sizeRows === []) {
            return;
        }

        $stmtUpd = $this->pdo->prepare(
            'UPDATE variant_sizes SET quantity_on_hand = quantity_on_hand + :qty WHERE id = :vsid'
        );

        $remaining = $quantity;
        $count = count($sizeRows);

        while ($remaining > 0) {
            $perBucket = (int) ceil($remaining / $count);
            foreach ($sizeRows as $row) {
                if ($remaining <= 0) {
                    break;
                }
                $add = min($perBucket, $remaining);
                $stmtUpd->execute(['qty' => $add, 'vsid' => (int) $row['vs_id']]);
                $remaining -= $add;
            }
        }
    }

    /**
     * Replace a product's stock with an exact total, split evenly across its
     * size buckets (remainder goes to the first buckets).
     *
     * @param array<int,array{vs_id:int|string,quantity_on_hand:int|string}> $sizeRows
     */
    private function setStockEvenly(array $sizeRows, int $total): void
    {
        if ($sizeRows === []) {
            return;
        }

        $total = max(0, $total);
        $count = count($sizeRows);
        $base = intdiv($total, $count);
        $remainder = $total % $count;

        $stmtSet = $this->pdo->prepare(
            'UPDATE variant_sizes SET quantity_on_hand = :qty WHERE id = :vsid'
        );

        foreach (array_values($sizeRows) as $index => $row) {
            $stmtSet->execute([
                'qty' => $base + ($index < $remainder ? 1 : 0),
                'vsid' => (int) $row['vs_id'],
            ]);
        }
    }

    /**
     * Remove units from a product's size buckets without ever pushing an
     * individual bucket below zero.
     *
     * @param array<int,array{vs_id:int|string,quantity_on_hand:int|string}> $sizeRows
     */
    private function reduceStock(array $sizeRows, int $quantity): void
    {
        if ($quantity <= 0) {
            return;
        }

        $stmtDeduct = $this->pdo->prepare(
            'UPDATE variant_sizes SET quantity_on_hand = quantity_on_hand - :deduct WHERE id = :vsid AND quantity_on_hand >= :deduct2'
        );

        $remaining = $quantity;
        foreach ($sizeRows as $row) {
            if ($remaining <= 0) {
                break;
            }
            $available = (int) $row['quantity_on_hand'];
            if ($available <= 0) {
                continue;
            }
            $deduct = min($available, $remaining);
            $stmtDeduct->execute([
                'deduct' => $deduct,
                'deduct2' => $deduct,
                'vsid' => (int) $row['vs_id'],
            ]);
            $remaining -= $deduct;
        }

        if ($remaining > 0) {
            throw new RuntimeException('Not enough stock to complete this adjustment.');
        }
    }

    /**
     * Update Minimum Stock Threshold
     */
    public function updateStockThreshold(int $businessId, int $productId, int $minThreshold, int $adminUserId, string $adminName): array
    {
        if ($minThreshold < 0) {
            throw new RuntimeException('Minimum threshold must be zero or positive.');
        }

        $stmtFind = $this->pdo->prepare("SELECT name FROM products WHERE id = :id AND business_id = :bid LIMIT 1");
        $stmtFind->execute(['id' => $productId, 'bid' => $businessId]);
        $productName = $stmtFind->fetchColumn();

        if (!$productName) {
            throw new RuntimeException('Product not found in this business.');
        }

        $stmt = $this->pdo->prepare("UPDATE products SET min_stock_threshold = :min WHERE id = :id AND business_id = :bid");
        $stmt->execute(['min' => $minThreshold, 'id' => $productId, 'bid' => $businessId]);

        $this->logActivity(
            $businessId,
            $adminName,
            'Stock threshold updated',
            (string)$productName,
            "Minimum stock threshold set to $minThreshold units",
            $adminUserId
        );

        return ['message' => 'Minimum stock threshold updated successfully.'];
    }

    /**
     * Get stock movement history
     */
    public function getMovements(int $businessId, array $filters = [], ?int $readerId = null): array
    {
        $sql = <<<SQL
            SELECT
                im.id,
                im.product_id,
                im.quantity_delta,
                im.previous_quantity,
                im.new_quantity,
                im.movement_type,
                im.notes,
                im.reason,
                im.admin_name,
                im.created_at,
                p.name AS product_name,
                (SELECT pv.sku FROM product_variants pv WHERE pv.product_id = p.id ORDER BY pv.id LIMIT 1) AS sku
            FROM inventory_movements im
            LEFT JOIN variant_sizes movement_size ON movement_size.id = im.variant_size_id
            LEFT JOIN product_variants movement_variant ON movement_variant.id = movement_size.variant_id
            JOIN products p ON p.id = COALESCE(im.product_id, movement_variant.product_id)
            WHERE p.business_id = :bid
        SQL;

        $params = ['bid' => $businessId];

        if ($readerId !== null) {
            $sql .= ' AND NOT EXISTS (SELECT 1 FROM inventory_movement_reads mr WHERE mr.movement_id = im.id AND mr.user_id = :reader_id)';
            $params['reader_id'] = $readerId;
        }

        if (!empty($filters['search'])) {
            $sql .= " AND (p.name LIKE :search_name OR im.reason LIKE :search_reason OR im.admin_name LIKE :search_admin)";
            $search = '%' . trim($filters['search']) . '%';
            $params['search_name'] = $search;
            $params['search_reason'] = $search;
            $params['search_admin'] = $search;
        }

        if (!empty($filters['movement']) && $filters['movement'] !== 'all') {
            if ($filters['movement'] === 'restock') {
                $sql .= " AND im.movement_type = 'receipt'";
            } elseif ($filters['movement'] === 'adjustment') {
                $sql .= " AND im.movement_type = 'adjustment'";
            } elseif ($filters['movement'] === 'decrease') {
                $sql .= " AND im.quantity_delta < 0";
            } elseif ($filters['movement'] === 'increase') {
                $sql .= " AND im.quantity_delta > 0";
            }
        }

        if (!empty($filters['admin']) && $filters['admin'] !== 'all') {
            $sql .= " AND im.admin_name LIKE :admin";
            $params['admin'] = '%' . trim($filters['admin']) . '%';
        }

        $sql .= " ORDER BY im.created_at DESC, im.id DESC";

        // Inventory's scrollable unread list must include every matching record.
        if ($readerId === null || isset($filters['limit'])) {
            $limit = isset($filters['limit']) ? max(1, min(100, (int)$filters['limit'])) : 50;
            $sql .= " LIMIT $limit";
        }

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);

        return $stmt->fetchAll();
    }

    public function markMovementRead(int $businessId, int $userId, int $movementId): bool
    {
        $exists = $this->pdo->prepare(<<<SQL
            SELECT im.id
            FROM inventory_movements im
            LEFT JOIN variant_sizes vs ON vs.id = im.variant_size_id
            LEFT JOIN product_variants pv ON pv.id = vs.variant_id
            JOIN products p ON p.id = COALESCE(im.product_id, pv.product_id)
            WHERE im.id = :id AND p.business_id = :bid
        SQL);
        $exists->execute(['id' => $movementId, 'bid' => $businessId]);
        if (!$exists->fetchColumn()) {
            return false;
        }
        $stmt = $this->pdo->prepare(<<<SQL
            INSERT INTO inventory_movement_reads (user_id, movement_id)
            VALUES (:uid, :id)
            ON DUPLICATE KEY UPDATE read_at = read_at
        SQL);
        $stmt->execute(['uid' => $userId, 'id' => $movementId]);
        return true;
    }

    /**
     * Get Sales Reports & Analytics
     */
    public function getReports(int $businessId, array $filters = []): array
    {
        $period = $filters['period'] ?? 'monthly';
        if (!in_array($period, ['daily', 'weekly', 'monthly', 'yearly'], true)) {
            $period = 'monthly';
        }

        $today = new \DateTimeImmutable('today');
        $ranges = [
            'daily' => [
                'start' => $today,
                'end' => $today->modify('+1 day'),
                'label' => 'Daily',
            ],
            'weekly' => [
                'start' => $today->modify('-6 days'),
                'end' => $today->modify('+1 day'),
                'label' => 'Weekly / last 7 days',
            ],
            'monthly' => [
                'start' => $today->modify('first day of this month'),
                'end' => $today->modify('first day of next month'),
                'label' => 'Monthly · selected',
            ],
            'yearly' => [
                'start' => new \DateTimeImmutable($today->format('Y') . '-01-01 00:00:00'),
                'end' => new \DateTimeImmutable(((int)$today->format('Y') + 1) . '-01-01 00:00:00'),
                'label' => 'Yearly',
            ],
        ];

        $rangeTotals = function (\DateTimeImmutable $start, \DateTimeImmutable $end) use ($businessId): array {
            $stmt = $this->pdo->prepare(<<<SQL
                SELECT
                    COUNT(DISTINCT o.id) AS orders,
                    COALESCE(SUM(oi.quantity), 0) AS units,
                    COALESCE(SUM(oi.line_total), 0) AS revenue
                FROM order_items oi
                JOIN orders o ON o.id = oi.order_id
                WHERE o.status NOT IN ('cancelled', 'refunded')
                  AND o.placed_at >= :start_at
                  AND o.placed_at < :end_at
                  AND EXISTS (
                      SELECT 1
                      FROM variant_sizes vs
                      JOIN product_variants pv ON pv.id = vs.variant_id
                      JOIN products p ON p.id = pv.product_id
                      WHERE vs.id = oi.variant_size_id AND p.business_id = :bid
                  )
            SQL);
            $stmt->execute([
                'start_at' => $start->format('Y-m-d H:i:s'),
                'end_at' => $end->format('Y-m-d H:i:s'),
                'bid' => $businessId,
            ]);
            $row = $stmt->fetch();

            return [
                'orders' => (int)($row['orders'] ?? 0),
                'units' => (int)($row['units'] ?? 0),
                'revenue' => (float)($row['revenue'] ?? 0),
            ];
        };

        $rangeLabel = static function (\DateTimeImmutable $start, \DateTimeImmutable $end): string {
            $lastDay = $end->modify('-1 day');
            if ($start->format('Y-m-d') === $lastDay->format('Y-m-d')) {
                return $start->format('d M Y');
            }
            if ($start->format('Y-m') === $lastDay->format('Y-m')) {
                return $start->format('d') . '–' . $lastDay->format('d M Y');
            }
            return $start->format('d M Y') . ' – ' . $lastDay->format('d M Y');
        };

        $reportViews = [];
        $totalsByPeriod = [];
        foreach ($ranges as $key => $range) {
            $totals = $rangeTotals($range['start'], $range['end']);
            $totalsByPeriod[$key] = $totals;
            $reportViews[] = [
                'view' => $range['label'],
                'period' => $rangeLabel($range['start'], $range['end']),
                'revenue' => $totals['revenue'],
                'units' => $totals['units'],
                'context' => $totals['orders'] . ' order' . ($totals['orders'] === 1 ? '' : 's') . ' · PHP merchandise sales',
            ];
        }

        $selected = $ranges[$period];
        $selectedTotals = $totalsByPeriod[$period];
        $from = $selected['start']->format('Y-m-d');
        $to = $selected['end']->modify('-1 day')->format('Y-m-d');

        // Stock map used for real turnover calculations.
        $stmtStock = $this->pdo->prepare(<<<SQL
            SELECT p.name, COALESCE(SUM(vs.quantity_on_hand), 0) AS stock_qty
            FROM products p
            LEFT JOIN product_variants pv ON pv.product_id = p.id
            LEFT JOIN variant_sizes vs ON vs.variant_id = pv.id
            WHERE p.business_id = :bid
            GROUP BY p.id, p.name
        SQL);
        $stmtStock->execute(['bid' => $businessId]);
        $stockByName = [];
        $totalStock = 0;
        foreach ($stmtStock->fetchAll() as $row) {
            $stockByName[strtolower((string)$row['name'])] = (int)$row['stock_qty'];
            $totalStock += (int)$row['stock_qty'];
        }

        // Detailed product sales for the selected period.
        $stmtDetailed = $this->pdo->prepare(<<<SQL
            SELECT
                oi.product_name_snapshot AS name,
                oi.sku_snapshot AS sku,
                COALESCE(SUM(oi.quantity), 0) AS sold,
                COALESCE(SUM(oi.line_total), 0) AS revenue
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            WHERE o.status NOT IN ('cancelled', 'refunded')
              AND o.placed_at >= :start_at
              AND o.placed_at < :end_at
              AND EXISTS (
                  SELECT 1
                  FROM variant_sizes vs
                  JOIN product_variants pv ON pv.id = vs.variant_id
                  JOIN products p ON p.id = pv.product_id
                  WHERE vs.id = oi.variant_size_id AND p.business_id = :bid
              )
            GROUP BY oi.product_name_snapshot, oi.sku_snapshot
            ORDER BY revenue DESC, name ASC
        SQL);
        $stmtDetailed->execute([
            'start_at' => $selected['start']->format('Y-m-d H:i:s'),
            'end_at' => $selected['end']->format('Y-m-d H:i:s'),
            'bid' => $businessId,
        ]);
        $detailedRows = $stmtDetailed->fetchAll();
        $totalRevenue = (float)$selectedTotals['revenue'];

        $detailedProducts = [];
        foreach ($detailedRows as $row) {
            $sold = (int)$row['sold'];
            $revenue = (float)$row['revenue'];
            $stock = $stockByName[strtolower((string)$row['name'])] ?? null;
            $share = $totalRevenue > 0 ? round(($revenue / $totalRevenue) * 100, 1) : 0;
            $turnover = ($stock !== null && $stock > 0) ? $sold / $stock : null;

            $detailedProducts[] = [
                'name' => $row['name'],
                'sku' => $row['sku'],
                'unit_price' => $sold > 0 ? round($revenue / $sold, 2) : 0.0,
                'sold' => $sold,
                'revenue' => $revenue,
                'revenue_share' => number_format($share, 1) . '%',
                'turnover_rate' => $turnover !== null ? number_format($turnover, 2) . '×' : '—',
            ];
        }

        // Reconciliation: weekly category breakdown within the selected range.
        $stmtRecon = $this->pdo->prepare(<<<SQL
            SELECT
                YEARWEEK(o.placed_at, 3) AS week_key,
                MIN(o.placed_at) AS week_start,
                MAX(o.placed_at) AS week_end,
                c.name AS category_name,
                COALESCE(SUM(oi.quantity), 0) AS units,
                COALESCE(SUM(oi.line_total), 0) AS revenue
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            JOIN variant_sizes vs ON vs.id = oi.variant_size_id
            JOIN product_variants pv ON pv.id = vs.variant_id
            JOIN products p ON p.id = pv.product_id
            JOIN categories c ON c.id = p.category_id
            WHERE o.status NOT IN ('cancelled', 'refunded')
              AND o.placed_at >= :start_at
              AND o.placed_at < :end_at
              AND p.business_id = :bid
            GROUP BY week_key, c.name
            ORDER BY week_key ASC
        SQL);
        $stmtRecon->execute([
            'start_at' => $selected['start']->format('Y-m-d H:i:s'),
            'end_at' => $selected['end']->format('Y-m-d H:i:s'),
            'bid' => $businessId,
        ]);

        $weeks = [];
        foreach ($stmtRecon->fetchAll() as $row) {
            $key = (string)$row['week_key'];
            if (!isset($weeks[$key])) {
                $weeks[$key] = [
                    'period' => $rangeLabel(
                        new \DateTimeImmutable((string)$row['week_start']),
                        (new \DateTimeImmutable((string)$row['week_end']))->modify('+1 day')
                    ),
                    'tops_tees' => 0,
                    'outerwear_hoodies' => 0,
                    'bottoms_accessories' => 0,
                    'total_units' => 0,
                    'revenue' => 0.0,
                ];
            }
            $category = strtolower((string)$row['category_name']);
            $units = (int)$row['units'];
            if (str_contains($category, 'top')) {
                $weeks[$key]['tops_tees'] += $units;
            } elseif (str_contains($category, 'outerwear')) {
                $weeks[$key]['outerwear_hoodies'] += $units;
            } else {
                $weeks[$key]['bottoms_accessories'] += $units;
            }
            $weeks[$key]['total_units'] += $units;
            $weeks[$key]['revenue'] += (float)$row['revenue'];
        }
        $reconciliation = array_values($weeks);

        $highestProduct = '—';
        $lowestProduct = '—';
        if ($detailedProducts) {
            $highest = $detailedProducts[0];
            $lowest = $detailedProducts[count($detailedProducts) - 1];
            $highestProduct = $highest['name'] . ' (' . $highest['sold'] . ' units · ₱' . number_format($highest['revenue'], 2) . ')';
            $lowestProduct = $lowest['name'] . ' (' . $lowest['sold'] . ' units · ₱' . number_format($lowest['revenue'], 2) . ')';
        }

        $inventoryTurnover = $totalStock > 0
            ? number_format((float)$selectedTotals['units'] / $totalStock, 2) . '×'
            : '—';

        return [
            'period' => $period,
            'from' => $from,
            'to' => $to,
            'total_units' => $selectedTotals['units'],
            'total_revenue' => $selectedTotals['revenue'],
            'inventory_turnover' => $inventoryTurnover,
            'highest_product' => $highestProduct,
            'lowest_product' => $lowestProduct,
            'report_views' => $reportViews,
            'detailed_products' => $detailedProducts,
            'reconciliation' => $reconciliation,
        ];
    }

    /**
     * Customer Reviews
     */
    public function getReviews(int $businessId, array $filters = []): array
    {
        $sql = <<<SQL
            SELECT 
                pr.id,
                pr.order_id,
                pr.user_id,
                pr.variant_id,
                pr.rating,
                pr.title,
                pr.content,
                pr.content AS comment,
                pr.display_name,
                pr.display_name AS author_name,
                pr.email,
                pr.size_purchased,
                pr.fit_feedback,
                pr.business_reply,
                pr.business_reply_by,
                pr.business_replied_at,
                pr.is_flagged,
                pr.flag_reason,
                pr.status,
                pr.created_at,
                p.id as product_id,
                p.name as product_name,
                pv.sku
            FROM product_reviews pr
            JOIN product_variants pv ON pv.id = pr.variant_id
            JOIN products p ON p.id = pv.product_id
            WHERE p.business_id = :bid AND pr.status != 'hidden'
        SQL;

        $params = ['bid' => $businessId];

        if (!empty($filters['search'])) {
            $sql .= " AND (pr.display_name LIKE :search_author OR pr.content LIKE :search_content OR pr.title LIKE :search_title OR p.name LIKE :search_product)";
            $search = '%' . trim($filters['search']) . '%';
            $params['search_author'] = $search;
            $params['search_content'] = $search;
            $params['search_title'] = $search;
            $params['search_product'] = $search;
        }

        if (!empty($filters['product']) && $filters['product'] !== 'all') {
            $sql .= " AND p.name LIKE :prod";
            $params['prod'] = '%' . trim($filters['product']) . '%';
        }

        if (!empty($filters['rating']) && $filters['rating'] !== 'all') {
            $sql .= " AND pr.rating = :rating";
            $params['rating'] = (int)$filters['rating'];
        }

        $sql .= " ORDER BY pr.created_at DESC, pr.id DESC";

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        $reviews = $stmt->fetchAll();

        foreach ($reviews as &$review) {
            $review['rating'] = (int)$review['rating'];
            $review['is_flagged'] = (int)$review['is_flagged'];
            $review['author_name'] = $review['display_name'] ?: 'Customer';
            $review['comment'] = $review['content'] ?: '';
        }
        unset($review);

        // Calculate statistics from the review rows instead of demo values.
        $ratingsByProduct = [];
        foreach ($reviews as $review) {
            $product = (string)($review['product_name'] ?? 'Product');
            $ratingsByProduct[$product][] = (int)$review['rating'];
        }

        $productAverages = [];
        foreach ($ratingsByProduct as $product => $ratings) {
            $productAverages[$product] = [
                'average' => array_sum($ratings) / max(1, count($ratings)),
                'count' => count($ratings),
            ];
        }

        $highestRated = '—';
        $lowestRated = '—';
        $highestProduct = 'No reviews yet';
        $lowestProduct = 'No reviews yet';
        if ($productAverages) {
            uasort($productAverages, static fn (array $a, array $b): int => $b['average'] <=> $a['average']);
            $highestName = (string)array_key_first($productAverages);
            $lowestName = (string)array_key_last($productAverages);
            $highestRated = number_format($productAverages[$highestName]['average'], 1) . ' / 5';
            $lowestRated = number_format($productAverages[$lowestName]['average'], 1) . ' / 5';
            $highestProduct = $highestName;
            $lowestProduct = $lowestName;
        }

        $teeRating = 'No reviews yet';
        $teeProduct = 'Essential Heavyweight Tee';
        $teeReviewCount = 0;
        foreach ($ratingsByProduct as $product => $ratings) {
            if (stripos($product, 'tee') !== false && stripos($product, 'tank') === false) {
                $teeReviewCount = count($ratings);
                $teeRating = number_format(array_sum($ratings) / max(1, $teeReviewCount), 1) . ' / 5';
                $teeProduct = $product;
                break;
            }
        }

        return [
            'reviews' => $reviews,
            'summary' => [
                'total_reviews' => count($reviews),
                'highest_rated' => $highestRated,
                'highest_product' => $highestProduct,
                'lowest_rated' => $lowestRated,
                'lowest_product' => $lowestProduct,
                'tee_rating' => $teeRating,
                'tee_product' => $teeProduct,
                'tee_review_count' => $teeReviewCount,
            ]
        ];
    }

    /**
     * Submit Business Reply to Customer Review
     */
    public function replyReview(int $businessId, int $reviewId, string $replyText, string $replierName, int $adminUserId): array
    {
        $replyText = trim($replyText);
        if ($replyText === '') {
            throw new RuntimeException('Reply text cannot be empty.');
        }

        // Verify review belongs to business product
        $stmtCheck = $this->pdo->prepare(<<<SQL
            SELECT pr.id, pr.display_name, p.name as product_name
            FROM product_reviews pr
            JOIN product_variants pv ON pv.id = pr.variant_id
            JOIN products p ON p.id = pv.product_id
            WHERE pr.id = :rid AND p.business_id = :bid
            LIMIT 1
        SQL);
        $stmtCheck->execute(['rid' => $reviewId, 'bid' => $businessId]);
        $rev = $stmtCheck->fetch();

        if (!$rev) {
            throw new RuntimeException('Review not found in this business.');
        }

        $stmtUpd = $this->pdo->prepare(<<<SQL
            UPDATE product_reviews 
            SET business_reply = :reply, business_reply_by = :replier, business_replied_at = NOW()
            WHERE id = :rid
        SQL);
        $stmtUpd->execute([
            'reply' => $replyText,
            'replier' => $replierName,
            'rid' => $reviewId,
        ]);

        $this->logActivity(
            $businessId,
            $replierName,
            'Review reply published',
            "Review #$reviewId",
            "Published public business reply to review by {$rev['display_name']} on {$rev['product_name']}",
            $adminUserId
        );

        return ['message' => 'Business reply published successfully.'];
    }

    /**
     * Flag review for moderation
     */
    public function flagReview(int $businessId, int $reviewId, string $reason, int $adminUserId, string $adminName): array
    {
        $reason = trim($reason);
        if ($reason === '') {
            throw new RuntimeException('Please select or specify a reason for flagging this review.');
        }

        $stmtCheck = $this->pdo->prepare(<<<SQL
            SELECT pr.id
            FROM product_reviews pr
            JOIN product_variants pv ON pv.id = pr.variant_id
            JOIN products p ON p.id = pv.product_id
            WHERE pr.id = :rid AND p.business_id = :bid
            LIMIT 1
        SQL);
        $stmtCheck->execute(['rid' => $reviewId, 'bid' => $businessId]);
        if (!$stmtCheck->fetchColumn()) {
            throw new RuntimeException('Review not found in this business.');
        }

        $stmtUpd = $this->pdo->prepare(<<<SQL
            UPDATE product_reviews 
            SET is_flagged = 1, flag_reason = :reason, flagged_at = NOW()
            WHERE id = :rid
        SQL);
        $stmtUpd->execute(['reason' => $reason, 'rid' => $reviewId]);

        $this->logActivity(
            $businessId,
            $adminName,
            'Review flagged for moderation',
            "Review #$reviewId",
            "Flagged review for moderation · Reason: $reason",
            $adminUserId
        );

        return ['message' => 'Review successfully flagged for moderation review.'];
    }

    /**
     * Business Notifications
     */
    public function getNotifications(int $businessId, array $filters = []): array
    {
        $sql = "SELECT * FROM business_notifications WHERE business_id = :bid";
        $params = ['bid' => $businessId];

        if (!empty($filters['type']) && $filters['type'] !== 'all') {
            $sql .= " AND type = :type";
            $params['type'] = $filters['type'];
        }

        if (isset($filters['read_status']) && $filters['read_status'] !== 'all') {
            if ($filters['read_status'] === 'unread') {
                $sql .= " AND is_read = 0";
            } elseif ($filters['read_status'] === 'read') {
                $sql .= " AND is_read = 1";
            }
        }

        if (!empty($filters['search'])) {
            $sql .= " AND (title LIKE :search_title OR message LIKE :search_message)";
            $search = '%' . trim($filters['search']) . '%';
            $params['search_title'] = $search;
            $params['search_message'] = $search;
        }

        $sql .= " ORDER BY created_at DESC, id DESC";

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        $notifs = $stmt->fetchAll();

        $unreadCount = 0;
        foreach ($notifs as $n) {
            if ((int)$n['is_read'] === 0) {
                $unreadCount++;
            }
        }

        return [
            'notifications' => $notifs,
            'total' => count($notifs),
            'unread_count' => $unreadCount,
        ];
    }

    public function markNotificationRead(int $businessId, int $notificationId): bool
    {
        $stmt = $this->pdo->prepare("UPDATE business_notifications SET is_read = 1 WHERE id = :id AND business_id = :bid");
        $stmt->execute(['id' => $notificationId, 'bid' => $businessId]);
        return $stmt->rowCount() > 0;
    }

    public function markAllNotificationsRead(int $businessId): bool
    {
        $stmt = $this->pdo->prepare("UPDATE business_notifications SET is_read = 1 WHERE business_id = :bid");
        $stmt->execute(['bid' => $businessId]);
        return true;
    }

    public function createNotification(
        int $businessId,
        string $title,
        string $type,
        string $message,
        string $referenceType = '',
        string $referenceId = '',
        string $actionUrl = ''
    ): void {
        $stmt = $this->pdo->prepare(<<<SQL
            INSERT INTO business_notifications 
            (business_id, title, type, message, reference_type, reference_id, action_url, is_read, created_at)
            VALUES 
            (:bid, :title, :type, :msg, :rtype, :rid, :url, 0, NOW())
        SQL);
        $stmt->execute([
            'bid' => $businessId,
            'title' => $title,
            'type' => $type,
            'msg' => $message,
            'rtype' => $referenceType,
            'rid' => $referenceId,
            'url' => $actionUrl,
        ]);
    }

    /**
     * Business Staff Management
     */
    public function getStaff(int $businessId, array $filters = []): array
    {
        $sql = "SELECT * FROM business_users WHERE business_id = :bid";
        $params = ['bid' => $businessId];

        if (!empty($filters['search'])) {
            $sql .= " AND (name LIKE :search_name OR email LIKE :search_email OR role_title LIKE :search_role)";
            $search = '%' . trim($filters['search']) . '%';
            $params['search_name'] = $search;
            $params['search_email'] = $search;
            $params['search_role'] = $search;
        }

        if (!empty($filters['permission']) && $filters['permission'] !== 'all') {
            $sql .= " AND permission_set = :perm";
            $params['perm'] = $filters['permission'];
        }

        if (!empty($filters['status']) && $filters['status'] !== 'all') {
            $sql .= " AND status = :status";
            $params['status'] = $filters['status'];
        }

        $sql .= " ORDER BY (role_title = 'Business owner') DESC, id ASC";

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        $staff = $stmt->fetchAll();

        foreach ($staff as &$member) {
            $member['joined_date'] = !empty($member['created_at'])
                ? date('M j, Y', strtotime((string)$member['created_at']))
                : '';
        }
        unset($member);

        return $staff;
    }

    public function inviteStaff(int $businessId, array $data, int $adminUserId, string $adminName): array
    {
        $name = trim($data['name'] ?? '');
        $email = strtolower(trim($data['email'] ?? ''));
        $roleTitle = trim($data['role_title'] ?? 'Inventory manager');
        $permissionSet = trim($data['permission_set'] ?? 'inventory_manager');

        if ($name === '' || $email === '') {
            throw new RuntimeException('Staff name and email are required.');
        }

        $canProducts = !empty($data['can_manage_products']) ? 1 : 0;
        $canStock = !empty($data['can_adjust_stock']) ? 1 : 0;
        $canReports = !empty($data['can_view_reports']) ? 1 : 0;
        $canReviews = !empty($data['can_reply_reviews']) ? 1 : 0;
        $canStaff = 0; // Only business owner can manage staff

        $stmtCheck = $this->pdo->prepare("SELECT id FROM business_users WHERE email = :email AND business_id = :bid LIMIT 1");
        $stmtCheck->execute(['email' => $email, 'bid' => $businessId]);
        if ($stmtCheck->fetchColumn()) {
            throw new RuntimeException('A staff account with this email already exists for this business.');
        }

        $stmtIns = $this->pdo->prepare(<<<SQL
            INSERT INTO business_users 
            (business_id, name, email, role_title, permission_set, status, can_manage_products, can_adjust_stock, can_view_reports, can_reply_reviews, can_view_notifications, can_manage_staff, created_at)
            VALUES 
            (:bid, :name, :email, :role, :perm, 'active', :cp, :cs, :cr, :crev, 1, 0, NOW())
        SQL);
        $stmtIns->execute([
            'bid' => $businessId,
            'name' => $name,
            'email' => $email,
            'role' => $roleTitle,
            'perm' => $permissionSet,
            'cp' => $canProducts,
            'cs' => $canStock,
            'cr' => $canReports,
            'crev' => $canReviews,
        ]);
        $staffId = (int)$this->pdo->lastInsertId();

        $this->logActivity(
            $businessId,
            $adminName,
            'Staff invited',
            $name,
            "Invited $name ($email) as $roleTitle with $permissionSet permissions",
            $adminUserId
        );

        return ['staff_id' => $staffId, 'message' => "Staff invitation sent to $email."];
    }

    public function updateStaff(int $businessId, int $staffId, array $data, int $adminUserId, string $adminName): array
    {
        $stmtFind = $this->pdo->prepare("SELECT * FROM business_users WHERE id = :id AND business_id = :bid LIMIT 1");
        $stmtFind->execute(['id' => $staffId, 'bid' => $businessId]);
        $staff = $stmtFind->fetch();

        if (!$staff) {
            throw new RuntimeException('Staff member not found.');
        }

        $name = trim($data['name'] ?? $staff['name']);
        $roleTitle = trim($data['role_title'] ?? $staff['role_title']);
        $permissionSet = trim($data['permission_set'] ?? $staff['permission_set']);
        $status = in_array($data['status'] ?? '', ['active', 'inactive'], true) ? $data['status'] : $staff['status'];

        $canProducts = isset($data['can_manage_products']) ? (int)$data['can_manage_products'] : (int)$staff['can_manage_products'];
        $canStock = isset($data['can_adjust_stock']) ? (int)$data['can_adjust_stock'] : (int)$staff['can_adjust_stock'];
        $canReports = isset($data['can_view_reports']) ? (int)$data['can_view_reports'] : (int)$staff['can_view_reports'];
        $canReviews = isset($data['can_reply_reviews']) ? (int)$data['can_reply_reviews'] : (int)$staff['can_reply_reviews'];

        $stmtUpd = $this->pdo->prepare(<<<SQL
            UPDATE business_users 
            SET name = :name, role_title = :role, permission_set = :perm, status = :status,
                can_manage_products = :cp, can_adjust_stock = :cs, can_view_reports = :cr, can_reply_reviews = :crev
            WHERE id = :id AND business_id = :bid
        SQL);
        $stmtUpd->execute([
            'name' => $name,
            'role' => $roleTitle,
            'perm' => $permissionSet,
            'status' => $status,
            'cp' => $canProducts,
            'cs' => $canStock,
            'cr' => $canReports,
            'crev' => $canReviews,
            'id' => $staffId,
            'bid' => $businessId,
        ]);

        $this->logActivity(
            $businessId,
            $adminName,
            'Staff access updated',
            $name,
            "Updated staff permissions and details for $name",
            $adminUserId
        );

        return ['message' => 'Staff details updated successfully.'];
    }

    public function setStaffStatus(int $businessId, int $staffId, string $status, int $adminUserId, string $adminName): array
    {
        $stmtFind = $this->pdo->prepare("SELECT * FROM business_users WHERE id = :id AND business_id = :bid LIMIT 1");
        $stmtFind->execute(['id' => $staffId, 'bid' => $businessId]);
        $staff = $stmtFind->fetch();

        if (!$staff) {
            throw new RuntimeException('Staff member not found.');
        }

        if ($staff['role_title'] === 'Business owner') {
            throw new RuntimeException('The primary Business Owner account cannot be deactivated.');
        }

        $stmtUpd = $this->pdo->prepare("UPDATE business_users SET status = :status WHERE id = :id AND business_id = :bid");
        $stmtUpd->execute(['status' => $status, 'id' => $staffId, 'bid' => $businessId]);

        $actName = $status === 'active' ? 'Staff activated' : 'Staff deactivated';
        $this->logActivity(
            $businessId,
            $adminName,
            $actName,
            $staff['name'],
            "$actName · {$staff['name']} ({$staff['email']})",
            $adminUserId
        );

        return ['message' => "Staff {$staff['name']} is now $status."];
    }

    /**
     * Activity Logs
     */
    public function getActivityLogs(int $businessId, array $filters = [], ?int $readerId = null): array
    {
        $sql = <<<SQL
            SELECT 
                al.id,
                al.action,
                al.entity_type,
                al.entity_type AS affected_resource,
                al.responsible_name,
                al.responsible_name AS responsible_person,
                al.metadata,
                al.created_at,
                COALESCE((
                    SELECT r.name
                    FROM roles r
                    JOIN user_roles ur ON ur.role_id = r.id
                    WHERE ur.user_id = al.user_id
                    ORDER BY (r.name = 'super_admin') DESC, r.name ASC
                    LIMIT 1
                ), 'Administrator') AS role_name
            FROM audit_logs al
            WHERE al.business_id = :bid
        SQL;

        $params = ['bid' => $businessId];

        if ($readerId !== null) {
            $sql .= ' AND NOT EXISTS (SELECT 1 FROM business_activity_log_reads lr WHERE lr.log_id = al.id AND lr.user_id = :reader_id)';
            $params['reader_id'] = $readerId;
        }

        if (!empty($filters['search'])) {
            $sql .= " AND (al.action LIKE :search_action OR al.entity_type LIKE :search_resource OR al.responsible_name LIKE :search_person OR al.metadata LIKE :search_metadata)";
            $search = '%' . trim($filters['search']) . '%';
            $params['search_action'] = $search;
            $params['search_resource'] = $search;
            $params['search_person'] = $search;
            $params['search_metadata'] = $search;
        }

        if (!empty($filters['responsible']) && $filters['responsible'] !== 'all') {
            $sql .= " AND al.responsible_name LIKE :resp";
            $params['resp'] = '%' . trim($filters['responsible']) . '%';
        }

        if (!empty($filters['activity']) && $filters['activity'] !== 'all') {
            $sql .= " AND al.action LIKE :act";
            $params['act'] = '%' . trim($filters['activity']) . '%';
        }

        $sql .= " ORDER BY al.created_at DESC, al.id DESC LIMIT 100";

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        $logs = $stmt->fetchAll();

        foreach ($logs as &$log) {
            $meta = json_decode((string)$log['metadata'], true);
            $log['change_details'] = is_array($meta)
                ? ($meta['change'] ?? '')
                : (is_string($meta) ? $meta : '');
            $log['role'] = $log['role_name'] ?: 'Administrator';
        }
        unset($log);

        return $logs;
    }

    public function markActivityLogRead(int $businessId, int $userId, int $logId): bool
    {
        $exists = $this->pdo->prepare('SELECT id FROM audit_logs WHERE id = ? AND business_id = ?');
        $exists->execute([$logId, $businessId]);
        if (!$exists->fetchColumn()) {
            return false;
        }
        $stmt = $this->pdo->prepare(<<<SQL
            INSERT INTO business_activity_log_reads (user_id, log_id)
            SELECT :uid, id FROM audit_logs WHERE id = :id AND business_id = :bid
            ON DUPLICATE KEY UPDATE read_at = read_at
        SQL);
        $stmt->execute(['uid' => $userId, 'id' => $logId, 'bid' => $businessId]);
        return true;
    }

    public function logActivity(
        int $businessId,
        string $responsibleName,
        string $action,
        string $affectedResource,
        string $changeDetails,
        ?int $userId = null
    ): void {
        $stmt = $this->pdo->prepare(<<<SQL
            INSERT INTO audit_logs 
            (user_id, business_id, responsible_name, action, entity_type, metadata, created_at)
            VALUES 
            (:uid, :bid, :rname, :action, :resource, :meta, NOW())
        SQL);
        $stmt->execute([
            'uid' => $userId,
            'bid' => $businessId,
            'rname' => $responsibleName,
            'action' => $action,
            'resource' => $affectedResource,
            'meta' => json_encode(['change' => $changeDetails]),
        ]);
    }

    /**
     * Account & Business Settings
     */
    public function getBusinessProfile(int $businessId, int $userId): array
    {
        $stmtBiz = $this->pdo->prepare("SELECT * FROM businesses WHERE id = :bid LIMIT 1");
        $stmtBiz->execute(['bid' => $businessId]);
        $biz = $stmtBiz->fetch();

        $stmtUser = $this->pdo->prepare(<<<SQL
            SELECT id, email, first_name, last_name, mobile, status, created_at, last_login_at
            FROM users 
            WHERE id = :uid
            LIMIT 1
        SQL);
        $stmtUser->execute(['uid' => $userId]);
        $user = $stmtUser->fetch();

        return [
            'business' => $biz,
            'admin' => $user,
        ];
    }

    public function updateBusinessProfile(int $businessId, array $data, int $adminUserId, string $adminName): array
    {
        $name = trim($data['name'] ?? '');
        $email = trim($data['email'] ?? '');
        $phone = trim($data['phone'] ?? '');
        $location = trim($data['location'] ?? '');
        $address = trim($data['address'] ?? '');
        $description = trim($data['description'] ?? '');

        if ($name === '') {
            throw new RuntimeException('Business display name is required.');
        }
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new RuntimeException('Please provide a valid business contact email.');
        }

        $stmt = $this->pdo->prepare(<<<SQL
            UPDATE businesses 
            SET name = :name, email = :email, phone = :phone, location = :loc, address = :addr, description = :desc
            WHERE id = :bid
        SQL);
        $stmt->execute([
            'name' => $name,
            'email' => $email,
            'phone' => $phone,
            'loc' => $location,
            'addr' => $address,
            'desc' => $description,
            'bid' => $businessId,
        ]);

        $this->logActivity(
            $businessId,
            $adminName,
            'Business profile updated',
            'Business Profile',
            "Updated business details for $name",
            $adminUserId
        );

        return ['message' => 'Business profile saved successfully.'];
    }

    public function updateAdminProfile(int $userId, array $data): array
    {
        $firstName = trim($data['first_name'] ?? '');
        $lastName = trim($data['last_name'] ?? '');
        $mobile = trim($data['mobile'] ?? '');

        if ($firstName === '' || $lastName === '') {
            throw new RuntimeException('First name and last name are required.');
        }

        $stmt = $this->pdo->prepare("UPDATE users SET first_name = :fn, last_name = :ln, mobile = :mob WHERE id = :uid");
        $stmt->execute([
            'fn' => $firstName,
            'ln' => $lastName,
            'mob' => $mobile,
            'uid' => $userId,
        ]);

        return ['message' => 'Administrator profile saved successfully.'];
    }

    public function updatePassword(int $userId, string $currentPassword, string $newPassword): void
    {
        $stmt = $this->pdo->prepare("SELECT password_hash FROM users WHERE id = :uid LIMIT 1");
        $stmt->execute(['uid' => $userId]);
        $hash = $stmt->fetchColumn();

        if (!$hash || !password_verify($currentPassword, $hash)) {
            throw new RuntimeException('Current password does not match our records.');
        }

        require_once __DIR__ . '/SystemConfigurationService.php';
        $minimum = SystemConfigurationService::value('password_min_length');
        if (strlen($newPassword) < $minimum) {
            throw new RuntimeException('New password must be at least ' . $minimum . ' characters long.');
        }
        if (!preg_match('/[A-Za-z]/', $newPassword) || !preg_match('/\d/', $newPassword)) {
            throw new RuntimeException('New password must contain at least one letter and one number.');
        }

        $newHash = password_hash($newPassword, PASSWORD_DEFAULT);
        $stmtUpd = $this->pdo->prepare("UPDATE users SET password_hash = :hash WHERE id = :uid");
        $stmtUpd->execute(['hash' => $newHash, 'uid' => $userId]);
        // Keep the session that performed the password change; other sessions
        // are rejected by SessionManager on their next authenticated request.
        if ((int) ($_SESSION['user_id'] ?? 0) === $userId) {
            \ClassicClub\Auth\SessionManager::start();
            $_SESSION['password_fingerprint'] = hash('sha256', $newHash);
            session_write_close();
        }
    }
}

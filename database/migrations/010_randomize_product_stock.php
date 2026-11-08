<?php

declare(strict_types=1);

/**
 * One-off maintenance script: give every product a realistic total stock
 * between 20 and 30 units, distributed across all of its variant/size
 * records.
 *
 * Single-colour products end up exactly on that number, e.g.
 * structured-overshirt-graphite = 22.
 *
 * Run with: php database/migrations/010_randomize_product_stock.php
 */

require_once __DIR__ . '/../../app/Database/Connection.php';

const MIN_PRODUCT_STOCK = 20;
const MAX_PRODUCT_STOCK = 30;

try {
    $pdo->beginTransaction();

    $products = $pdo->query(<<<SQL
        SELECT p.id, p.name
        FROM products p
        ORDER BY p.id
    SQL)->fetchAll();

    $stmtSizes = $pdo->prepare(<<<SQL
        SELECT vs.id AS vs_id
        FROM product_variants pv
        JOIN variant_sizes vs ON vs.variant_id = pv.id
        WHERE pv.product_id = :pid
        ORDER BY pv.id, vs.id
    SQL);
    $stmtSet = $pdo->prepare('UPDATE variant_sizes SET quantity_on_hand = :qty WHERE id = :vsid');
    $defaultSize = (int) $pdo->query(
        'SELECT id FROM sizes WHERE is_active = 1 ORDER BY sort_order, id LIMIT 1'
    )->fetchColumn();

    $report = [];

    foreach ($products as $product) {
        $productId = (int) $product['id'];

        $stmtSizes->execute(['pid' => $productId]);
        $sizeIds = $stmtSizes->fetchAll(PDO::FETCH_COLUMN);

        // Products created through the admin panel may not have a size record
        // yet; create one so the product is sellable and stockable.
        if ($sizeIds === []) {
            $stmtVariant = $pdo->prepare('SELECT id FROM product_variants WHERE product_id = :pid ORDER BY id LIMIT 1');
            $stmtVariant->execute(['pid' => $productId]);
            $variantId = $stmtVariant->fetchColumn();

            if ($variantId === false) {
                continue;
            }

            $insert = $pdo->prepare(
                'INSERT INTO variant_sizes (variant_id, size_id, quantity_on_hand) VALUES (:vid, :sid, 0)'
            );
            $insert->execute(['vid' => (int) $variantId, 'sid' => $defaultSize]);
            $sizeIds = [(int) $pdo->lastInsertId()];
        }

        $total = random_int(MIN_PRODUCT_STOCK, MAX_PRODUCT_STOCK);
        $bucketCount = count($sizeIds);

        // Even split: each bucket gets at least one unit, and the first
        // ($total % $bucketCount) buckets receive one extra so the product
        // total is exactly the randomized amount.
        $base = intdiv($total, $bucketCount);
        $remainder = $total % $bucketCount;

        foreach ($sizeIds as $index => $sizeId) {
            $quantity = $base + ($index < $remainder ? 1 : 0);
            $stmtSet->execute(['qty' => $quantity, 'vsid' => (int) $sizeId]);
        }

        $report[] = sprintf('#%d %s = %d', $productId, $product['name'], $total);
    }

    $pdo->commit();

    echo 'Product stock randomized between ' . MIN_PRODUCT_STOCK . '-' . MAX_PRODUCT_STOCK . " units:\n";
    echo implode("\n", $report) . "\n";
} catch (Throwable $exception) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fwrite(STDERR, 'Stock seeding failed: ' . $exception->getMessage() . "\n");
    exit(1);
}
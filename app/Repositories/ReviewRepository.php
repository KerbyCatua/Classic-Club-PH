<?php

declare(strict_types=1);

namespace ClassicClub\Repositories;

use PDO;

final class ReviewRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * Check if a specific product variant in an order is eligible for review by a given user.
     * User must own the order, the order must be 'delivered', and not already reviewed.
     */
    public function checkEligibility(int $userId, int $orderId, int $variantId): array
    {
        $statement = $this->pdo->prepare(
            <<<'SQL'
                SELECT o.id AS order_id, o.order_number, o.user_id, o.status,
                       v.id AS variant_id, v.product_id, v.catalog_key, v.sku, v.color_name,
                       p.name AS product_name, p.slug AS product_slug,
                       c.name AS category_name, c.slug AS category_slug,
                       img.image_url,
                       oi.size_snapshot, oi.color_snapshot,
                       (SELECT COUNT(*) FROM product_reviews pr WHERE pr.order_id = o.id AND pr.variant_id = v.id) AS has_review
                FROM orders o
                INNER JOIN order_items oi ON oi.order_id = o.id
                INNER JOIN variant_sizes vs ON vs.id = oi.variant_size_id
                INNER JOIN product_variants v ON v.id = vs.variant_id
                INNER JOIN products p ON p.id = v.product_id
                LEFT JOIN categories c ON c.id = p.category_id
                LEFT JOIN product_images img ON img.variant_id = v.id AND img.image_role = 'primary' AND img.sort_order = 0
                WHERE o.id = :order_id AND o.user_id = :user_id AND v.id = :variant_id
                LIMIT 1
            SQL
        );
        $statement->execute([
            'order_id' => $orderId,
            'user_id' => $userId,
            'variant_id' => $variantId,
        ]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);

        if (!$row) {
            return [
                'eligible' => false,
                'reason' => 'Order item not found or does not belong to your account.',
                'item' => null
            ];
        }

        if (strtolower((string) $row['status']) !== 'delivered') {
            return [
                'eligible' => false,
                'reason' => 'This product cannot be reviewed until your order has been delivered.',
                'item' => $row
            ];
        }

        if ((int) $row['has_review'] > 0) {
            return [
                'eligible' => false,
                'reason' => 'You have already reviewed this product for this order.',
                'item' => $row
            ];
        }

        return [
            'eligible' => true,
            'reason' => '',
            'item' => $row
        ];
    }

    public function createReview(array $data): int
    {
        $statement = $this->pdo->prepare(
            <<<'SQL'
                INSERT INTO product_reviews
                    (order_id, user_id, variant_id, rating, title, content, display_name, email, size_purchased, fit_feedback, images, is_verified_purchase, status)
                VALUES
                    (:order_id, :user_id, :variant_id, :rating, :title, :content, :display_name, :email, :size_purchased, :fit_feedback, :images, 1, 'published')
            SQL
        );
        $statement->execute([
            'order_id' => $data['order_id'],
            'user_id' => $data['user_id'],
            'variant_id' => $data['variant_id'],
            'rating' => $data['rating'],
            'title' => $data['title'],
            'content' => $data['content'],
            'display_name' => $data['display_name'],
            'email' => $data['email'],
            'size_purchased' => $data['size_purchased'],
            'fit_feedback' => $data['fit_feedback'],
            'images' => !empty($data['images']) ? json_encode($data['images']) : null,
        ]);

        return (int) $this->pdo->lastInsertId();
    }

    public function getReviewsForVariant(int $variantId): array
    {
        $statement = $this->pdo->prepare(
            <<<'SQL'
                SELECT id, order_id, user_id, variant_id, rating, title, content,
                       display_name, size_purchased, fit_feedback, images,
                       is_verified_purchase, created_at
                FROM product_reviews
                WHERE variant_id = :variant_id AND status = 'published'
                ORDER BY created_at DESC
            SQL
        );
        $statement->execute(['variant_id' => $variantId]);
        return $statement->fetchAll(PDO::FETCH_ASSOC);
    }

    public function findVariantByCatalogKey(string $key): ?array
    {
        $statement = $this->pdo->prepare(
            <<<'SQL'
                SELECT v.id AS variant_id, v.product_id, v.catalog_key, v.sku, v.color_name, v.price,
                       p.name AS product_name, p.slug AS product_slug, p.description,
                       c.name AS category_name, c.slug AS category_slug,
                       img.image_url
                FROM product_variants v
                INNER JOIN products p ON p.id = v.product_id
                LEFT JOIN categories c ON c.id = p.category_id
                LEFT JOIN product_images img ON img.variant_id = v.id AND img.image_role = 'primary' AND img.sort_order = 0
                WHERE v.catalog_key = :key OR v.sku = :sku
                LIMIT 1
            SQL
        );
        $statement->execute(['key' => $key, 'sku' => $key]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    public function findVariantById(int $variantId): ?array
    {
        $statement = $this->pdo->prepare(
            <<<'SQL'
                SELECT v.id AS variant_id, v.product_id, v.catalog_key, v.sku, v.color_name, v.price,
                       p.name AS product_name, p.slug AS product_slug, p.description,
                       c.name AS category_name, c.slug AS category_slug,
                       img.image_url
                FROM product_variants v
                INNER JOIN products p ON p.id = v.product_id
                LEFT JOIN categories c ON c.id = p.category_id
                LEFT JOIN product_images img ON img.variant_id = v.id AND img.image_role = 'primary' AND img.sort_order = 0
                WHERE v.id = :id
                LIMIT 1
            SQL
        );
        $statement->execute(['id' => $variantId]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    public function findOrderByNumber(string $orderNumber): ?array
    {
        $statement = $this->pdo->prepare('SELECT id, order_number, user_id, status FROM orders WHERE order_number = :order_number LIMIT 1');
        $statement->execute(['order_number' => $orderNumber]);
        $row = $statement->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }
}

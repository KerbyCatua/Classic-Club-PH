<?php

declare(strict_types=1);

namespace ClassicClub\Repositories;

use PDO;

final class WishlistRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function ensure(int $userId): int
    {
        $statement = $this->pdo->prepare(
            'INSERT INTO wishlists (user_id) VALUES (:user_id) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)'
        );
        $statement->execute(['user_id' => $userId]);

        return (int) $this->pdo->lastInsertId();
    }

    public function variantId(string $catalogKey): ?int
    {
        $statement = $this->pdo->prepare(
            "SELECT id FROM product_variants WHERE catalog_key = :catalog_key AND availability_status = 'active' LIMIT 1"
        );
        $statement->execute(['catalog_key' => $catalogKey]);
        $id = $statement->fetchColumn();

        return $id === false ? null : (int) $id;
    }

    public function toggle(int $wishlistId, int $variantId): bool
    {
        $statement = $this->pdo->prepare(
            'SELECT 1 FROM wishlist_items WHERE wishlist_id = :wishlist_id AND variant_id = :variant_id'
        );
        $statement->execute([
            'wishlist_id' => $wishlistId,
            'variant_id' => $variantId,
        ]);

        if ($statement->fetchColumn() !== false) {
            $statement = $this->pdo->prepare(
                'DELETE FROM wishlist_items WHERE wishlist_id = :wishlist_id AND variant_id = :variant_id'
            );
            $statement->execute([
                'wishlist_id' => $wishlistId,
                'variant_id' => $variantId,
            ]);
            return false;
        }

        $statement = $this->pdo->prepare(
            'INSERT INTO wishlist_items (wishlist_id, variant_id) VALUES (:wishlist_id, :variant_id)'
        );
        $statement->execute([
            'wishlist_id' => $wishlistId,
            'variant_id' => $variantId,
        ]);

        return true;
    }

    public function items(int $wishlistId): array
    {
        $statement = $this->pdo->prepare(
            <<<'SQL'
                SELECT
                    v.catalog_key AS id,
                    p.name,
                    v.color_name AS color,
                    v.price,
                    v.sku,
                    v.is_new,
                    image.image_url AS image
                FROM wishlist_items wi
                INNER JOIN product_variants v ON v.id = wi.variant_id
                INNER JOIN products p ON p.id = v.product_id
                LEFT JOIN product_images image
                    ON image.variant_id = v.id
                   AND image.image_role = 'primary'
                   AND image.sort_order = 0
                WHERE wi.wishlist_id = :wishlist_id
                ORDER BY wi.created_at DESC
            SQL
        );
        $statement->execute(['wishlist_id' => $wishlistId]);

        return $statement->fetchAll();
    }
}

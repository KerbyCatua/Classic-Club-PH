<?php

declare(strict_types=1);

namespace ClassicClub\Repositories;

use PDO;
use RuntimeException;

final class CartRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function findOrCreate(?int $userId, string $sessionHash): int
    {
        if ($userId !== null) {
            $statement = $this->pdo->prepare(
                "SELECT id FROM carts WHERE user_id = :user_id AND status = 'active' LIMIT 1"
            );
            $statement->execute(['user_id' => $userId]);
        } else {
            $statement = $this->pdo->prepare(
                "SELECT id FROM carts WHERE session_token_hash = :session_hash AND status = 'active' LIMIT 1"
            );
            $statement->execute(['session_hash' => $sessionHash]);
        }

        $cartId = $statement->fetchColumn();
        if ($cartId !== false) {
            return (int) $cartId;
        }

        $statement = $this->pdo->prepare(
            <<<'SQL'
                INSERT INTO carts (user_id, session_token_hash, status)
                VALUES (:user_id, :session_hash, 'active')
            SQL
        );
        $statement->execute([
            'user_id' => $userId,
            'session_hash' => $userId === null ? $sessionHash : null,
        ]);

        return (int) $this->pdo->lastInsertId();
    }

    public function findVariantSize(
        string $catalogKey,
        string $sizeCode
    ): ?array {
        $statement = $this->pdo->prepare(
            <<<'SQL'
                SELECT
                    vs.id AS variant_size_id,
                    v.catalog_key,
                    v.sku,
                    v.color_name,
                    v.price,
                    p.name,
                    s.code AS size_code,
                    image.image_url
                FROM variant_sizes vs
                INNER JOIN product_variants v ON v.id = vs.variant_id
                INNER JOIN products p ON p.id = v.product_id
                INNER JOIN sizes s ON s.id = vs.size_id
                LEFT JOIN product_images image
                    ON image.variant_id = v.id
                   AND image.image_role = 'primary'
                   AND image.sort_order = 0
                WHERE v.catalog_key = :catalog_key
                  AND s.code = :size_code
                  AND v.availability_status = 'active'
                  AND p.is_active = 1
                  AND vs.is_active = 1
                LIMIT 1
            SQL
        );
        $statement->execute([
            'catalog_key' => $catalogKey,
            'size_code' => $sizeCode,
        ]);

        $variant = $statement->fetch();
        return $variant ?: null;
    }

    public function addItem(
        int $cartId,
        int $variantSizeId,
        int $quantity,
        string $unitPrice
    ): void {
        $statement = $this->pdo->prepare(
            <<<'SQL'
                INSERT INTO cart_items
                    (cart_id, variant_size_id, quantity, unit_price)
                VALUES
                    (:cart_id, :variant_size_id, :quantity, :unit_price)
                ON DUPLICATE KEY UPDATE
                    quantity = quantity + VALUES(quantity),
                    unit_price = VALUES(unit_price)
            SQL
        );
        $statement->execute([
            'cart_id' => $cartId,
            'variant_size_id' => $variantSizeId,
            'quantity' => $quantity,
            'unit_price' => $unitPrice,
        ]);
    }

    public function updateItem(
        int $cartId,
        int $variantSizeId,
        int $quantity
    ): void {
        if ($quantity <= 0) {
            $this->removeItem($cartId, $variantSizeId);
            return;
        }

        $statement = $this->pdo->prepare(
            <<<'SQL'
                UPDATE cart_items
                SET quantity = :quantity
                WHERE cart_id = :cart_id
                  AND variant_size_id = :variant_size_id
            SQL
        );
        $statement->execute([
            'quantity' => $quantity,
            'cart_id' => $cartId,
            'variant_size_id' => $variantSizeId,
        ]);
    }

    public function removeItem(int $cartId, int $variantSizeId): void
    {
        $statement = $this->pdo->prepare(
            'DELETE FROM cart_items WHERE cart_id = :cart_id AND variant_size_id = :variant_size_id'
        );
        $statement->execute([
            'cart_id' => $cartId,
            'variant_size_id' => $variantSizeId,
        ]);
    }

    public function items(int $cartId): array
    {
        $statement = $this->pdo->prepare(
            <<<'SQL'
                SELECT
                    ci.id,
                    ci.variant_size_id,
                    ci.quantity,
                    ci.unit_price AS price,
                    v.catalog_key AS id,
                    v.sku,
                    v.color_name AS color,
                    s.code AS size,
                    p.name,
                    image.image_url AS image
                FROM cart_items ci
                INNER JOIN variant_sizes vs ON vs.id = ci.variant_size_id
                INNER JOIN product_variants v ON v.id = vs.variant_id
                INNER JOIN products p ON p.id = v.product_id
                INNER JOIN sizes s ON s.id = vs.size_id
                LEFT JOIN product_images image
                    ON image.variant_id = v.id
                   AND image.image_role = 'primary'
                   AND image.sort_order = 0
                WHERE ci.cart_id = :cart_id
                ORDER BY ci.id ASC
            SQL
        );
        $statement->execute(['cart_id' => $cartId]);

        return $statement->fetchAll();
    }
}

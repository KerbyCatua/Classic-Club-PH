<?php

declare(strict_types=1);

namespace ClassicClub\Repositories;

use PDO;

final class ProductRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function countActive(?string $categorySlug = null): int
    {
        $sql = <<<'SQL'
            SELECT COUNT(*)
            FROM products p
            INNER JOIN categories c ON c.id = p.category_id
            WHERE p.is_active = 1
              AND c.is_active = 1
        SQL;

        if ($categorySlug !== null) {
            $sql .= ' AND c.slug = :category';
        }

        $statement = $this->pdo->prepare($sql);
        if ($categorySlug !== null) {
            $statement->bindValue(':category', $categorySlug);
        }
        $statement->execute();

        return (int) $statement->fetchColumn();
    }

    public function findActive(int $page, int $perPage, ?string $categorySlug = null): array
    {
        $offset = ($page - 1) * $perPage;
        $sql = <<<'SQL'
            SELECT
                p.id,
                p.name,
                p.slug,
                p.description,
                c.name AS category_name,
                c.slug AS category_slug,
                v.id AS variant_id,
                v.sku,
                v.color_name,
                v.price,
                v.is_new,
                image.image_url
            FROM products p
            INNER JOIN categories c ON c.id = p.category_id
            INNER JOIN product_variants v ON v.product_id = p.id
                AND v.availability_status = 'active'
            LEFT JOIN product_images image ON image.variant_id = v.id
                AND image.image_role = 'primary'
                AND image.sort_order = 0
            WHERE p.is_active = 1
              AND c.is_active = 1
        SQL;

        if ($categorySlug !== null) {
            $sql .= ' AND c.slug = :category';
        }

        $sql .= ' ORDER BY p.id ASC, v.id ASC LIMIT :limit OFFSET :offset';

        $statement = $this->pdo->prepare($sql);
        if ($categorySlug !== null) {
            $statement->bindValue(':category', $categorySlug);
        }
        $statement->bindValue(':limit', $perPage, PDO::PARAM_INT);
        $statement->bindValue(':offset', $offset, PDO::PARAM_INT);
        $statement->execute();

        return $statement->fetchAll();
    }

    public function findActiveById(int $id): ?array
    {
        $statement = $this->pdo->prepare(
            <<<'SQL'
                SELECT
                    p.id,
                    p.name,
                    p.slug,
                    p.description,
                    c.name AS category_name,
                    c.slug AS category_slug,
                    v.id AS variant_id,
                    v.sku,
                    v.color_name,
                    v.price,
                    v.is_new,
                    image.image_url
                FROM products p
                INNER JOIN categories c ON c.id = p.category_id
                INNER JOIN product_variants v ON v.product_id = p.id
                    AND v.availability_status = 'active'
                LEFT JOIN product_images image ON image.variant_id = v.id
                    AND image.image_role = 'primary'
                    AND image.sort_order = 0
                WHERE p.id = :id
                  AND p.is_active = 1
                  AND c.is_active = 1
                ORDER BY v.id ASC
            SQL
        );
        $statement->bindValue(':id', $id, PDO::PARAM_INT);
        $statement->execute();

        $rows = $statement->fetchAll();
        return $rows === [] ? null : [
            'id' => $rows[0]['id'],
            'name' => $rows[0]['name'],
            'slug' => $rows[0]['slug'],
            'description' => $rows[0]['description'],
            'category' => [
                'name' => $rows[0]['category_name'],
                'slug' => $rows[0]['category_slug'],
            ],
            'variants' => array_map(
                static fn (array $row): array => [
                    'id' => $row['variant_id'],
                    'sku' => $row['sku'],
                    'color' => $row['color_name'],
                    'price' => $row['price'],
                    'is_new' => (bool) $row['is_new'],
                    'image_url' => $row['image_url'],
                ],
                $rows
            ),
        ];
    }
}

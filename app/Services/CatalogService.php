<?php

declare(strict_types=1);

namespace ClassicClub\Services;

use ClassicClub\Repositories\ProductRepository;
use RuntimeException;

final class CatalogService
{
    public function __construct(private readonly ProductRepository $products)
    {
    }

    public function listProducts(array $query): array
    {
        $total = $this->products->countActive($query['category']);
        $items = $this->products->findActive(
            $query['page'],
            $query['per_page'],
            $query['category']
        );

        return [
            'items' => $items,
            'pagination' => [
                'page' => $query['page'],
                'per_page' => $query['per_page'],
                'total' => $total,
                'total_pages' => $total === 0
                    ? 0
                    : (int) ceil($total / $query['per_page']),
            ],
        ];
    }

    public function getProduct(int $id): array
    {
        $product = $this->products->findActiveById($id);
        if ($product === null) {
            throw new RuntimeException('Product not found.');
        }

        return $product;
    }
}

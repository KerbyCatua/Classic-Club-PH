<?php

declare(strict_types=1);

namespace ClassicClub\Services;

use ClassicClub\Cart\CartIdentity;
use ClassicClub\Repositories\CartRepository;
use RuntimeException;

final class CartService
{
    public function __construct(private readonly CartRepository $carts)
    {
    }

    public function view(?int $userId): array
    {
        $cartId = $this->cartId($userId);
        $items = $this->carts->items($cartId);

        $totalItems = array_sum(array_map(
            static fn (array $item): int => (int) $item['quantity'],
            $items
        ));
        $subtotal = array_sum(array_map(
            static fn (array $item): float => (float) $item['price'] * (int) $item['quantity'],
            $items
        ));

        return [
            'items' => $items,
            'total_items' => $totalItems,
            'subtotal' => number_format($subtotal, 2, '.', ''),
        ];
    }

    public function add(?int $userId, string $catalogKey, string $size, int $quantity): array
    {
        if ($quantity < 1 || $quantity > 20) {
            throw new RuntimeException('Quantity must be between 1 and 20.');
        }

        $variant = $this->carts->findVariantSize($catalogKey, $size);
        if ($variant === null) {
            throw new RuntimeException('Product or size is not available.');
        }

            $cartId = $this->cartId($userId);
            $available = (int) $variant['quantity_on_hand'];
            $alreadyInCart = $this->carts->quantityInCart($cartId, (int) $variant['variant_size_id']);

            if ($alreadyInCart + $quantity > $available) {
                throw new RuntimeException(
                    $available > 0
                        ? "Only $available unit(s) of this item remain in stock."
                        : 'This item is out of stock.'
                );
            }

            $this->carts->addItem(
                $cartId,
                (int) $variant['variant_size_id'],
                $quantity,
                (string) $variant['price']
            );

            return $this->view($userId);
        }

        public function update(?int $userId, string $catalogKey, string $size, int $quantity): array
        {
            $variant = $this->carts->findVariantSize($catalogKey, $size);
            if ($variant === null) {
                throw new RuntimeException('Product or size is not available.');
            }

            $available = (int) $variant['quantity_on_hand'];
            if ($quantity > $available) {
                throw new RuntimeException(
                    $available > 0
                        ? "Only $available unit(s) of this item remain in stock."
                        : 'This item is out of stock.'
                );
            }

            $this->carts->updateItem(
                $this->cartId($userId),
                (int) $variant['variant_size_id'],
                $quantity
            );

            return $this->view($userId);
        }

    public function remove(?int $userId, string $catalogKey, string $size): array
    {
        $variant = $this->carts->findVariantSize($catalogKey, $size);
        if ($variant === null) {
            throw new RuntimeException('Product or size is not available.');
        }

        $this->carts->removeItem(
            $this->cartId($userId),
            (int) $variant['variant_size_id']
        );

        return $this->view($userId);
    }

    private function cartId(?int $userId): int
    {
        return $this->carts->findOrCreate(
            $userId,
            CartIdentity::sessionHash()
        );
    }
}

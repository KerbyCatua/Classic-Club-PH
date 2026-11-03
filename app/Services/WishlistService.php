<?php

declare(strict_types=1);

namespace ClassicClub\Services;

use ClassicClub\Repositories\WishlistRepository;
use RuntimeException;

final class WishlistService
{
    public function __construct(private readonly WishlistRepository $wishlists)
    {
    }

    public function view(int $userId): array
    {
        return ['items' => $this->wishlists->items($this->wishlists->ensure($userId))];
    }

    public function toggle(int $userId, string $catalogKey): array
    {
        $variantId = $this->wishlists->variantId($catalogKey);
        if ($variantId === null) {
            throw new RuntimeException('Product not found.');
        }

        $saved = $this->wishlists->toggle(
            $this->wishlists->ensure($userId),
            $variantId
        );

        return [
            'saved' => $saved,
            'items' => $this->view($userId)['items'],
        ];
    }
}

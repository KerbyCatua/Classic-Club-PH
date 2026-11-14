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

    public function toggle(int $userId, string $catalogKey, ?bool $saved = null): array
    {
        $variantId = $this->wishlists->variantId($catalogKey, $saved !== false);
        if ($variantId === null) {
            if ($saved === false) {
                return ['saved' => false, 'items' => $this->view($userId)['items']];
            }
            throw new RuntimeException('Product not found.');
        }

        $wishlistId = $this->wishlists->ensure($userId);
        if ($saved === null) {
            // Preserve the existing API for clients that still send a toggle.
            $saved = $this->wishlists->toggle($wishlistId, $variantId);
        } else {
            $this->wishlists->setSaved($wishlistId, $variantId, $saved);
        }

        return [
            'saved' => $saved,
            'items' => $this->view($userId)['items'],
        ];
    }
}

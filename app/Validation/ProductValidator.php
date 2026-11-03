<?php

declare(strict_types=1);

namespace ClassicClub\Validation;

use ClassicClub\Support\Input;

final class ProductValidator
{
    public function catalogQuery(array $query): array
    {
        $page = Input::integer($query['page'] ?? 1, 1);
        $perPage = Input::integer($query['per_page'] ?? 12, 12);
        $category = Input::string($query['category'] ?? '');

        if ($page < 1) {
            throw new ValidationException('Page must be at least 1.', [
                'page' => 'Use a positive integer.',
            ]);
        }

        if ($perPage < 1 || $perPage > 50) {
            throw new ValidationException('Per-page value is invalid.', [
                'per_page' => 'Use a value between 1 and 50.',
            ]);
        }

        if ($category !== '' && !preg_match('/^[a-z0-9-]+$/', $category)) {
            throw new ValidationException('Category is invalid.', [
                'category' => 'Use a category slug.',
            ]);
        }

        return [
            'page' => $page,
            'per_page' => $perPage,
            'category' => $category !== '' ? $category : null,
        ];
    }

    public function productId(string $id): int
    {
        if (!ctype_digit($id) || (int) $id < 1) {
            throw new ValidationException('Product ID is invalid.', [
                'id' => 'Use a positive numeric product ID.',
            ]);
        }

        return (int) $id;
    }
}

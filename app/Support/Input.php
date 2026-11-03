<?php

declare(strict_types=1);

namespace ClassicClub\Support;

final class Input
{
    public static function string(mixed $value, string $default = ''): string
    {
        if (!is_string($value) && !is_numeric($value)) {
            return $default;
        }

        return trim((string) $value);
    }

    public static function integer(mixed $value, int $default = 0): int
    {
        if (filter_var($value, FILTER_VALIDATE_INT) === false) {
            return $default;
        }

        return (int) $value;
    }
}

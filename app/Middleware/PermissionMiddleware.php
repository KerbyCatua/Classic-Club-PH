<?php

declare(strict_types=1);

namespace ClassicClub\Middleware;

use ClassicClub\Authorization\PermissionChecker;
use ClassicClub\Http\JsonResponse;
use PDO;

final class PermissionMiddleware
{
    public static function require(
        PDO $pdo,
        string $permission
    ): int {
        $userId = AuthMiddleware::requireUser();

        $checker = new PermissionChecker($pdo);

        if (!$checker->allows($userId, $permission)) {
            JsonResponse::error(
                'You do not have permission to perform this action.',
                403
            )->send();
        }

        return $userId;
    }
}
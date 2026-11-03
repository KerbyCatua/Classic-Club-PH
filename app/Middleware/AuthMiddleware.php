<?php

declare(strict_types=1);

namespace ClassicClub\Middleware;

use ClassicClub\Auth\SessionManager;
use ClassicClub\Http\JsonResponse;

final class AuthMiddleware
{
    public static function requireUser(): int
    {
        $userId = SessionManager::userId();

        if ($userId === null) {
            JsonResponse::error('Authentication required.', 401)->send();
        }

        return $userId;
    }
}
<?php

declare(strict_types=1);

namespace ClassicClub\Middleware;

use ClassicClub\Auth\SessionManager;
use ClassicClub\Http\JsonResponse;

final class CsrfMiddleware
{
    public static function require(): void
    {
        try {
            SessionManager::requireCsrf();
        } catch (\RuntimeException $exception) {
            JsonResponse::error($exception->getMessage(), 403)->send();
        }
    }
}

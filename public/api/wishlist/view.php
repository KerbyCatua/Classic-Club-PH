<?php

declare(strict_types=1);

use ClassicClub\Http\JsonResponse;
use ClassicClub\Middleware\AuthMiddleware;
use ClassicClub\Repositories\WishlistRepository;
use ClassicClub\Services\WishlistService;

require_once __DIR__ . '/../../../app/Http/Response.php';
require_once __DIR__ . '/../../../app/Http/JsonResponse.php';
require_once __DIR__ . '/../../../app/Auth/SessionManager.php';
require_once __DIR__ . '/../../../app/Middleware/AuthMiddleware.php';
require_once __DIR__ . '/../../../app/Database/Connection.php';
require_once __DIR__ . '/../../../app/Repositories/WishlistRepository.php';
require_once __DIR__ . '/../../../app/Services/WishlistService.php';

try {
    if (strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
        JsonResponse::error('Method not allowed.', 405)->send();
    }

    $userId = AuthMiddleware::requireUser();
    JsonResponse::success(
        (new WishlistService(new WishlistRepository($pdo)))->view($userId)
    )->send();
} catch (Throwable $exception) {
    error_log($exception->getMessage());
    JsonResponse::error('Unable to load the wishlist.', 500)->send();
}

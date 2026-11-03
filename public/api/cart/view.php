<?php

declare(strict_types=1);

use ClassicClub\Auth\SessionManager;
use ClassicClub\Http\JsonResponse;
use ClassicClub\Repositories\CartRepository;
use ClassicClub\Services\CartService;

require_once __DIR__ . '/../../../app/Database/Connection.php';
require_once __DIR__ . '/../../../app/Http/Response.php';
require_once __DIR__ . '/../../../app/Http/JsonResponse.php';
require_once __DIR__ . '/../../../app/Auth/SessionManager.php';
require_once __DIR__ . '/../../../app/Cart/CartIdentity.php';
require_once __DIR__ . '/../../../app/Repositories/CartRepository.php';
require_once __DIR__ . '/../../../app/Services/CartService.php';

try {
    if (strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
        JsonResponse::error('Method not allowed.', 405)->send();
    }

    JsonResponse::success(
        (new CartService(new CartRepository($pdo)))->view(SessionManager::userId())
    )->send();
} catch (Throwable $exception) {
    error_log($exception->getMessage());
    JsonResponse::error('Unable to load the cart.', 500)->send();
}

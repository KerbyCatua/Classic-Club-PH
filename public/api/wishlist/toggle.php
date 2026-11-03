<?php

declare(strict_types=1);

use ClassicClub\Http\JsonResponse;
use ClassicClub\Http\Request;
use ClassicClub\Middleware\AuthMiddleware;
use ClassicClub\Repositories\WishlistRepository;
use ClassicClub\Services\WishlistService;

require_once __DIR__ . '/../../../app/Support/Input.php';
require_once __DIR__ . '/../../../app/Http/Request.php';
require_once __DIR__ . '/../../../app/Http/Response.php';
require_once __DIR__ . '/../../../app/Http/JsonResponse.php';
require_once __DIR__ . '/../../../app/Auth/SessionManager.php';
require_once __DIR__ . '/../../../app/Middleware/CsrfMiddleware.php';
require_once __DIR__ . '/../../../app/Middleware/AuthMiddleware.php';
require_once __DIR__ . '/../../../app/Database/Connection.php';
require_once __DIR__ . '/../../../app/Repositories/WishlistRepository.php';
require_once __DIR__ . '/../../../app/Services/WishlistService.php';

try {
    $request = new Request();
    if ($request->method() !== 'POST') {
        JsonResponse::error('Method not allowed.', 405)->send();
    }
    \ClassicClub\Middleware\CsrfMiddleware::require();

    $catalogKey = trim((string) ($request->json()['catalog_key'] ?? ''));
    if ($catalogKey === '') {
        JsonResponse::error('catalog_key is required.', 422)->send();
    }

    JsonResponse::success(
        (new WishlistService(new WishlistRepository($pdo)))->toggle(
            AuthMiddleware::requireUser(),
            $catalogKey
        )
    )->send();
} catch (RuntimeException $exception) {
    JsonResponse::error($exception->getMessage(), 422)->send();
} catch (Throwable $exception) {
    error_log($exception->getMessage());
    JsonResponse::error('Unable to update the wishlist.', 500)->send();
}

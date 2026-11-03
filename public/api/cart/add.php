<?php

declare(strict_types=1);

use ClassicClub\Auth\SessionManager;
use ClassicClub\Http\JsonResponse;
use ClassicClub\Http\Request;
use ClassicClub\Repositories\CartRepository;
use ClassicClub\Services\CartService;

require_once __DIR__ . '/../../../app/Database/Connection.php';
require_once __DIR__ . '/../../../app/Support/Input.php';
require_once __DIR__ . '/../../../app/Http/Request.php';
require_once __DIR__ . '/../../../app/Http/Response.php';
require_once __DIR__ . '/../../../app/Http/JsonResponse.php';
require_once __DIR__ . '/../../../app/Auth/SessionManager.php';
require_once __DIR__ . '/../../../app/Middleware/CsrfMiddleware.php';
require_once __DIR__ . '/../../../app/Cart/CartIdentity.php';
require_once __DIR__ . '/../../../app/Repositories/CartRepository.php';
require_once __DIR__ . '/../../../app/Services/CartService.php';

try {
    $request = new Request();
    if ($request->method() !== 'POST') {
        JsonResponse::error('Method not allowed.', 405)->send();
    }
    \ClassicClub\Middleware\CsrfMiddleware::require();

    $body = $request->json();
    $catalogKey = trim((string) ($body['catalog_key'] ?? ''));
    $size = trim((string) ($body['size'] ?? ''));
    $quantity = filter_var($body['quantity'] ?? null, FILTER_VALIDATE_INT);

    if ($catalogKey === '' || $size === '' || $quantity === false) {
        JsonResponse::error('catalog_key, size, and quantity are required.', 422)->send();
    }

    JsonResponse::success(
        (new CartService(new CartRepository($pdo)))->add(
            SessionManager::userId(),
            $catalogKey,
            $size,
            (int) $quantity
        ),
        201
    )->send();
} catch (RuntimeException $exception) {
    JsonResponse::error($exception->getMessage(), 422)->send();
} catch (Throwable $exception) {
    error_log($exception->getMessage());
    JsonResponse::error('Unable to add the item to the cart.', 500)->send();
}

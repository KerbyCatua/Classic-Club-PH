<?php

declare(strict_types=1);

use ClassicClub\Auth\SessionManager;
use ClassicClub\Http\JsonResponse;
use ClassicClub\Http\Request;
use ClassicClub\Repositories\CartRepository;
use ClassicClub\Repositories\OrderRepository;
use ClassicClub\Services\CheckoutService;
use ClassicClub\Validation\CheckoutValidator;
use ClassicClub\Validation\ValidationException;

require_once __DIR__ . '/../../../app/Database/Connection.php';
require_once __DIR__ . '/../../../app/Support/Input.php';
require_once __DIR__ . '/../../../app/Http/Request.php';
require_once __DIR__ . '/../../../app/Http/Response.php';
require_once __DIR__ . '/../../../app/Http/JsonResponse.php';
require_once __DIR__ . '/../../../app/Auth/SessionManager.php';
require_once __DIR__ . '/../../../app/Middleware/CsrfMiddleware.php';
require_once __DIR__ . '/../../../app/Cart/CartIdentity.php';
require_once __DIR__ . '/../../../app/Repositories/CartRepository.php';
require_once __DIR__ . '/../../../app/Repositories/OrderRepository.php';
require_once __DIR__ . '/../../../app/Services/CheckoutService.php';
require_once __DIR__ . '/../../../app/Validation/ValidationException.php';
require_once __DIR__ . '/../../../app/Validation/CheckoutValidator.php';

try {
    $request = new Request();
    if ($request->method() !== 'POST') {
        JsonResponse::error('Method not allowed.', 405)->send();
    }
    \ClassicClub\Middleware\CsrfMiddleware::require();

    $data = (new CheckoutValidator())->validate($request->json());
    $service = new CheckoutService(
        $pdo,
        new CartRepository($pdo),
        new OrderRepository($pdo)
    );

    JsonResponse::success(
        $service->create(SessionManager::userId(), $data),
        201
    )->send();
} catch (ValidationException $exception) {
    JsonResponse::error($exception->getMessage(), 422, $exception->errors())->send();
} catch (RuntimeException $exception) {
    JsonResponse::error($exception->getMessage(), 409)->send();
} catch (Throwable $exception) {
    error_log($exception->getMessage());
    JsonResponse::error('Unable to create the order.', 500)->send();
}

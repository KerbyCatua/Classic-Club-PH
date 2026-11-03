<?php

declare(strict_types=1);

use ClassicClub\Auth\SessionManager;
use ClassicClub\Http\JsonResponse;
use ClassicClub\Repositories\OrderRepository;

require_once __DIR__ . '/../../../app/Database/Connection.php';
require_once __DIR__ . '/../../../app/Http/Response.php';
require_once __DIR__ . '/../../../app/Http/JsonResponse.php';
require_once __DIR__ . '/../../../app/Auth/SessionManager.php';
require_once __DIR__ . '/../../../app/Repositories/OrderRepository.php';

try {
    $number = trim((string) ($_GET['order_number'] ?? ''));
    $userId = SessionManager::userId();
    if ($number === '') {
        JsonResponse::error('order_number is required.', 422)->send();
    }

    $order = (new OrderRepository($pdo))->findForUserOrNumber($userId, $number);
    if ($order === null) {
        JsonResponse::error('Order not found.', 404)->send();
    }

    JsonResponse::success($order)->send();
} catch (Throwable $exception) {
    error_log($exception->getMessage());
    JsonResponse::error('Unable to load the order.', 500)->send();
}

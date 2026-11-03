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
    $userId = SessionManager::userId();
    if ($userId === null) {
        JsonResponse::error('Authentication is required.', 401)->send();
    }

    $order = (new OrderRepository($pdo))->latestForUser($userId);
    JsonResponse::success($order)->send();
} catch (Throwable $exception) {
    error_log($exception->getMessage());
    JsonResponse::error('Unable to load order history.', 500)->send();
}

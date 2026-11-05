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
    $orderNumber = trim((string) ($_POST['order_number'] ?? $_GET['order_number'] ?? ''));

    if ($orderNumber === '') {
        JsonResponse::error('order_number is required.', 422)->send();
    }

    $statement = $pdo->prepare('SELECT id, user_id, status FROM orders WHERE order_number = :order_number LIMIT 1');
    $statement->execute(['order_number' => $orderNumber]);
    $order = $statement->fetch(PDO::FETCH_ASSOC);

    if (!$order) {
        JsonResponse::error('Order not found.', 404)->send();
    }

    if ($userId !== null && (int) $order['user_id'] !== $userId) {
        JsonResponse::error('Unauthorized access to this order.', 403)->send();
    }

    $update = $pdo->prepare(
        "UPDATE orders SET status = 'delivered', delivered_at = NOW(), scheduled_delivery_at = NOW() WHERE id = :id"
    );
    $update->execute(['id' => $order['id']]);

    JsonResponse::success([
        'message' => 'Simulated delivery marked as delivered.',
        'order_number' => $orderNumber,
        'status' => 'delivered',
        'delivered_at' => date('c'),
    ])->send();
} catch (Throwable $e) {
    error_log($e->getMessage());
    JsonResponse::error('Failed to trigger delivery simulation: ' . $e->getMessage(), 500)->send();
}

<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

use ClassicClub\Http\JsonResponse;
use ClassicClub\Http\Request;

$request = new Request();

try {
    if ($request->method() === 'GET') {
        $ctx = getAdminContext($pdo, false);
        $filters = [
            'search' => $request->queryString('search') ?? '',
            'category' => $request->queryString('category') ?? '',
            'availability' => $request->queryString('availability') ?? '',
            'sort' => $request->queryString('sort') ?? '',
        ];
        $inventory = $ctx['service']->getInventory($ctx['business_id'], $filters);
        JsonResponse::success($inventory)->send();
    }

    if ($request->method() === 'POST') {
        $ctx = getAdminContext($pdo, true);
        requireAdminPermission($ctx, 'can_adjust_stock');
        $body = $request->json();
        $action = $body['action'] ?? '';
        $productId = (int)($body['product_id'] ?? 0);

        if ($action === 'restock') {
            $qty = (int)($body['quantity'] ?? 0);
            $reason = (string)($body['reason'] ?? 'Routine restocking');
            $result = $ctx['service']->restockProduct(
                $ctx['business_id'],
                $productId,
                $qty,
                $reason,
                $ctx['user_id'],
                $ctx['admin_name']
            );
            JsonResponse::success($result)->send();
        }

        if ($action === 'adjust') {
            $type = (string)($body['type'] ?? 'increase');
            $qty = (int)($body['quantity'] ?? 0);
            $reason = (string)($body['reason'] ?? 'Manual stock adjustment');
            $result = $ctx['service']->adjustStock(
                $ctx['business_id'],
                $productId,
                $type,
                $qty,
                $reason,
                $ctx['user_id'],
                $ctx['admin_name']
            );
            JsonResponse::success($result)->send();
        }

        if ($action === 'update_threshold') {
            $threshold = (int)($body['min_threshold'] ?? 10);
            $result = $ctx['service']->updateStockThreshold(
                $ctx['business_id'],
                $productId,
                $threshold,
                $ctx['user_id'],
                $ctx['admin_name']
            );
            JsonResponse::success($result)->send();
        }

        JsonResponse::error('Invalid inventory action.', 422)->send();
    }

    JsonResponse::error('Method not allowed.', 405)->send();
} catch (Throwable $e) {
    JsonResponse::error($e->getMessage(), 400)->send();
}

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
        $products = $ctx['service']->getProducts($ctx['business_id'], $filters);
        JsonResponse::success(['products' => $products])->send();
    }

    if ($request->method() === 'POST') {
        $ctx = getAdminContext($pdo, true);
        requireAdminPermission($ctx, 'can_manage_products');
        $body = $request->json();
        $action = $body['action'] ?? 'create';

        if ($action === 'create') {
            $result = $ctx['service']->createProduct(
                $ctx['business_id'],
                $body['product'] ?? $body,
                $ctx['user_id'],
                $ctx['admin_name']
            );
            JsonResponse::success($result, 201)->send();
        }

        if ($action === 'update') {
            $productId = (int)($body['product_id'] ?? 0);
            $result = $ctx['service']->updateProduct(
                $ctx['business_id'],
                $productId,
                $body['data'] ?? $body,
                $ctx['user_id'],
                $ctx['admin_name']
            );
            JsonResponse::success($result)->send();
        }

        if (in_array($action, ['activate', 'deactivate', 'archive'], true)) {
            $productId = (int)($body['product_id'] ?? 0);
            $result = $ctx['service']->setProductStatus(
                $ctx['business_id'],
                $productId,
                $action,
                $ctx['user_id'],
                $ctx['admin_name']
            );
            JsonResponse::success($result)->send();
        }

        JsonResponse::error('Invalid product action.', 422)->send();
    }

    JsonResponse::error('Method not allowed.', 405)->send();
} catch (Throwable $e) {
    JsonResponse::error($e->getMessage(), 400)->send();
}

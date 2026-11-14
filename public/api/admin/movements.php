<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

use ClassicClub\Http\JsonResponse;
use ClassicClub\Http\Request;

$request = new Request();

try {
    if (!in_array($request->method(), ['GET', 'POST'], true)) {
        JsonResponse::error('Method not allowed.', 405)->send();
    }
    $ctx = getAdminContext($pdo, $request->method() === 'POST');
    if ($request->method() === 'POST') {
        $body = $request->json();
        $movementId = filter_var($body['movement_id'] ?? null, FILTER_VALIDATE_INT);
        if (!$movementId || $movementId < 1) {
            JsonResponse::error('A valid stock movement is required.', 422)->send();
        }
        if (!$ctx['service']->markMovementRead($ctx['business_id'], $ctx['user_id'], $movementId)) {
            JsonResponse::error('Stock movement not found.', 404)->send();
        }
        JsonResponse::success(['movement_id' => $movementId, 'is_read' => true])->send();
    }
    $filters = [
        'search' => $request->queryString('search') ?? '',
        'movement' => $request->queryString('movement') ?? '',
        'admin' => $request->queryString('admin') ?? '',
    ];
    $movements = $ctx['service']->getMovements($ctx['business_id'], $filters, $ctx['user_id']);
    JsonResponse::success(['movements' => $movements])->send();
} catch (Throwable $e) {
    JsonResponse::error($e->getMessage(), 400)->send();
}

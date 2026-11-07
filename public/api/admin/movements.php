<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

use ClassicClub\Http\JsonResponse;
use ClassicClub\Http\Request;

$request = new Request();

try {
    $ctx = getAdminContext($pdo, false);
    $filters = [
        'search' => $request->queryString('search') ?? '',
        'movement' => $request->queryString('movement') ?? '',
        'admin' => $request->queryString('admin') ?? '',
    ];
    $movements = $ctx['service']->getMovements($ctx['business_id'], $filters);
    JsonResponse::success(['movements' => $movements])->send();
} catch (Throwable $e) {
    JsonResponse::error($e->getMessage(), 400)->send();
}

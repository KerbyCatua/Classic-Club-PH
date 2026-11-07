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
        'responsible' => $request->queryString('responsible') ?? '',
        'activity' => $request->queryString('activity') ?? '',
    ];
    $logs = $ctx['service']->getActivityLogs($ctx['business_id'], $filters);
    JsonResponse::success(['logs' => $logs])->send();
} catch (Throwable $e) {
    JsonResponse::error($e->getMessage(), 400)->send();
}

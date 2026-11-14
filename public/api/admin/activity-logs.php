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
        $logId = filter_var($body['log_id'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if (!$logId) {
            JsonResponse::error('A valid activity log is required.', 422)->send();
        }
        if (!$ctx['service']->markActivityLogRead($ctx['business_id'], $ctx['user_id'], $logId)) {
            JsonResponse::error('Activity log not found.', 404)->send();
        }
        JsonResponse::success(['message' => 'Activity marked as read.'])->send();
    }
    $filters = [
        'search' => $request->queryString('search') ?? '',
        'responsible' => $request->queryString('responsible') ?? '',
        'activity' => $request->queryString('activity') ?? '',
    ];
    $logs = $ctx['service']->getActivityLogs($ctx['business_id'], $filters, $ctx['user_id']);
    JsonResponse::success(['logs' => $logs])->send();
} catch (Throwable $e) {
    JsonResponse::error($e->getMessage(), 400)->send();
}

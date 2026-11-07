<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

use ClassicClub\Http\JsonResponse;
use ClassicClub\Http\Request;

$request = new Request();

try {
    $ctx = getAdminContext($pdo, false);
    $overview = $ctx['service']->getDashboardOverview($ctx['business_id']);

    JsonResponse::success($overview)->send();
} catch (Throwable $e) {
    JsonResponse::error($e->getMessage(), 500)->send();
}

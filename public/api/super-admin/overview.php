<?php

declare(strict_types=1);

/**
 * Module 21.1 — System Dashboard Overview.
 *
 * Returns live, application-wide metrics for an authenticated Super Admin.
 * The response is read-only and intentionally separate from the business
 * administration endpoints in public/api/admin/.
 */

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/../../../app/Services/SystemOverviewService.php';

use ClassicClub\Http\JsonResponse;
use ClassicClub\Services\SystemOverviewService;

try {
    getSuperAdminContext($pdo);

    $overview = (new SystemOverviewService($pdo))->getOverview();
    JsonResponse::success($overview)->send();
} catch (Throwable $exception) {
    error_log('System overview failed: ' . $exception->getMessage());
    JsonResponse::error('Unable to load the system overview.', 500)->send();
}

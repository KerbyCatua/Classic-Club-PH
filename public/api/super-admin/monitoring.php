<?php

declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/../../../app/Services/MaintenanceService.php';
require_once __DIR__ . '/../../../app/Services/SystemMonitoringService.php';

use ClassicClub\Http\JsonResponse;
use ClassicClub\Services\SystemMonitoringService;

try {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    getSuperAdminContext($pdo, $method === 'POST');
    if (!in_array($method, ['GET', 'POST'], true)) {
        header('Allow: GET, POST');
        JsonResponse::error('Method not allowed.', 405)->send();
    }
    $range = $_GET['range'] ?? '7d';
    $service = $_GET['service'] ?? 'all';
    if (!is_string($range) || !in_array($range, ['24h', '7d', '30d'], true)
        || !is_string($service) || !in_array($service, ['all', 'application', 'api', 'database', 'server'], true)) {
        JsonResponse::error('Choose a valid monitoring range and service.', 422)->send();
    }
    $monitor = new SystemMonitoringService($pdo);
    if ($method === 'POST') {
        // Fixed loopback target avoids SSRF through Host or query parameters.
        $monitor->collect('http://127.0.0.1/classic-club-ph');
    }
    JsonResponse::success($monitor->snapshot($range, $service))->send();
} catch (Throwable $exception) {
    error_log('System monitoring failed: ' . $exception->getMessage());
    JsonResponse::error('Unable to load monitoring data. Check database access and monitoring migration 014.', 500)->send();
}

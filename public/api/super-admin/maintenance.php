<?php

declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/../../../app/Services/MaintenanceService.php';

use ClassicClub\Http\JsonResponse;
use ClassicClub\Http\Request;
use ClassicClub\Services\MaintenanceService;

$request = new Request();

try {
    $method = $request->method();
    $context = getSuperAdminContext($pdo, $method === 'POST');
    $service = new MaintenanceService($pdo);
    if ($method === 'GET') {
        JsonResponse::success($service->state())->send();
    }
    if ($method !== 'POST') {
        JsonResponse::error('Method not allowed.', 405)->send();
    }
    $body = $request->json();
    $actor = (int) $context['user_id'];
    $result = match ($body['action'] ?? '') {
        'save_window' => $service->saveWindow($body, $actor),
        'enable' => $service->setMode(true, $actor),
        'disable' => $service->setMode(false, $actor),
        'save_announcement' => $service->saveAnnouncement($body, $actor),
        default => throw new RuntimeException('Invalid maintenance action.'),
    };
    JsonResponse::success($result)->send();
} catch (RuntimeException $exception) {
    JsonResponse::error($exception->getMessage(), 422)->send();
} catch (Throwable $exception) {
    error_log('Maintenance request failed: ' . $exception->getMessage());
    JsonResponse::error('Unable to complete the maintenance request.', 500)->send();
}

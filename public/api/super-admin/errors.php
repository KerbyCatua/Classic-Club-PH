<?php
declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/../../../app/Services/ErrorManagementService.php';

use ClassicClub\Http\JsonResponse;
use ClassicClub\Http\Request;
use ClassicClub\Services\ErrorManagementService;

try {
    $request = new Request();
    $context = getSuperAdminContext($pdo, $request->method() === 'POST');
    $service = new ErrorManagementService($pdo);
    if ($request->method() === 'GET') {
        if (isset($_GET['id'])) {
            $id = filter_var($_GET['id'], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            $page = filter_var($_GET['event_page'] ?? 1, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 1000000]]);
            if (!$id || !$page) throw new InvalidArgumentException('Invalid detail request.');
            JsonResponse::success($service->detail($id, $page))->send();
        }
        JsonResponse::success($service->listing($_GET))->send();
    }
    if ($request->method() === 'POST') JsonResponse::success($service->update((int) $context['user_id'], $request->json()))->send();
    header('Allow: GET, POST');
    JsonResponse::error('Method not allowed.', 405)->send();
} catch (InvalidArgumentException $e) {
    JsonResponse::error($e->getMessage(), 422)->send();
} catch (RuntimeException $e) {
    if (in_array($e->getCode(), [404, 409], true)) JsonResponse::error($e->getMessage(), $e->getCode())->send();
    error_log('Error management failed: ' . $e->getMessage());
    JsonResponse::error('Unable to access error management. Verify migration 015 and database access.', 500)->send();
} catch (Throwable $e) {
    error_log('Error management failed: ' . $e->getMessage());
    JsonResponse::error('Unable to access error management.', 500)->send();
}

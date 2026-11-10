<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/../../../app/Services/SuperAdminAccountService.php';

use ClassicClub\Http\JsonResponse;
use ClassicClub\Http\Request;
use ClassicClub\Services\SuperAdminAccountService;

$request = new Request();
try {
    if (!in_array($request->method(), ['GET', 'POST'], true)) JsonResponse::error('Method not allowed.', 405)->send();
    $ctx = getSuperAdminContext($pdo, $request->method() === 'POST');
    $service = new SuperAdminAccountService($pdo);
    $actor = $ctx['user_id'];
    if ($request->method() === 'GET') {
        if ($request->query('view', '') === 'history') {
            JsonResponse::success($service->history($actor, max(0, $request->queryInteger('before', 0))))->send();
        }
        JsonResponse::success($service->read($actor))->send();
    }
    $body = $request->json();
    switch ($body['action'] ?? '') {
        case 'update_profile': $service->updateProfile($actor, $body); break;
        case 'update_password': $service->updatePassword($actor, $body); break;
        case 'request_recovery':
            $service->requestRecovery($actor, trim($ctx['user']['first_name'] . ' ' . $ctx['user']['last_name']));
            break;
        default: throw new InvalidArgumentException('Unsupported account action.');
    }
    JsonResponse::success($service->read($actor))->send();
} catch (InvalidArgumentException $e) {
    JsonResponse::error($e->getMessage(), 422)->send();
} catch (Throwable $e) {
    error_log($e->getMessage());
    JsonResponse::error('Unable to load or update your account. Please retry.', 500)->send();
}

<?php

declare(strict_types=1);

/**
 * Module 21.2 — Global User Management.
 *
 * Read and write access to application-wide user accounts for authenticated
 * Super Admins. Mutating requests require a valid CSRF token.
 */

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/../../../app/Validation/ValidationException.php';
require_once __DIR__ . '/../../../app/Validation/GlobalUserValidator.php';
require_once __DIR__ . '/../../../app/Support/AuditLogger.php';
require_once __DIR__ . '/../../../app/Services/GlobalUserService.php';

use ClassicClub\Http\JsonResponse;
use ClassicClub\Http\Request;
use ClassicClub\Services\GlobalUserService;
use ClassicClub\Support\AuditLogger;
use ClassicClub\Validation\GlobalUserValidator;
use ClassicClub\Validation\ValidationException;

$request = new Request();
$validator = new GlobalUserValidator();

try {
    if ($request->method() === 'GET') {
        $context = getSuperAdminContext($pdo, false);
        $service = new GlobalUserService($pdo, new AuditLogger($pdo));

        $userId = $request->queryInteger('id', 0);
        if ($userId > 0) {
            $historyLimit = $validator->historyLimit($request->query('history', 6));
            JsonResponse::success($service->getUserDetail($userId, $historyLimit))->send();
        }

        $filters = $validator->listFilters([
            'search' => $request->query('search', ''),
            'role' => $request->query('role', ''),
            'status' => $request->query('status', ''),
            'month' => $request->query('month', ''),
            'sort' => $request->query('sort', 'role'),
        ]);

        JsonResponse::success($service->getUsers($filters))->send();
    }

    if ($request->method() === 'POST') {
        $context = getSuperAdminContext($pdo, true);
        $service = new GlobalUserService($pdo, new AuditLogger($pdo));
        $body = $request->json();
        $action = trim((string) ($body['action'] ?? ''));

        $actorUserId = (int) $context['user_id'];
        $actorName = trim(
            (string) ($context['user']['first_name'] ?? '') . ' ' .
            (string) ($context['user']['last_name'] ?? '')
        );
        if ($actorName === '') {
            $actorName = (string) ($context['user']['email'] ?? 'Super Admin');
        }

        if ($action === 'create') {
            $data = $validator->create($body);
            $result = $service->createUser($actorUserId, $actorName, $data);
            JsonResponse::success($result, 201)->send();
        }

        if ($action === 'update') {
            $data = $validator->update($body);
            $result = $service->updateUser($actorUserId, $actorName, $data);
            JsonResponse::success($result)->send();
        }

        if ($action === 'set_status') {
            $data = $validator->statusChange($body);
            $result = $service->setUserStatus($actorUserId, $actorName, $data);
            JsonResponse::success($result)->send();
        }

        if ($action === 'change_role') {
            $data = $validator->roleChange($body);
            $result = $service->changeUserRole($actorUserId, $actorName, $data);
            JsonResponse::success($result)->send();
        }

        if ($action === 'request_password_reset') {
            $userId = $validator->userId($body['user_id'] ?? 0);
            $result = $service->requestPasswordReset($actorUserId, $actorName, $userId);
            JsonResponse::success($result)->send();
        }

        JsonResponse::error('Invalid user management action.', 422)->send();
    }

    JsonResponse::error('Method not allowed.', 405)->send();
} catch (ValidationException $exception) {
    JsonResponse::error($exception->getMessage(), 422, $exception->errors())->send();
} catch (RuntimeException $exception) {
    JsonResponse::error($exception->getMessage(), 400)->send();
} catch (Throwable $exception) {
    error_log('Global user management failed: ' . $exception->getMessage());
    JsonResponse::error('Unable to complete the user management request.', 500)->send();
}

<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

use ClassicClub\Http\JsonResponse;
use ClassicClub\Http\Request;

$request = new Request();

try {
    if ($request->method() === 'GET') {
        $ctx = getAdminContext($pdo, false);
        $filters = [
            'search' => $request->queryString('search') ?? '',
            'permission' => $request->queryString('permission') ?? '',
            'status' => $request->queryString('status') ?? '',
        ];
        $staff = $ctx['service']->getStaff($ctx['business_id'], $filters);
        JsonResponse::success(['staff' => $staff])->send();
    }

    if ($request->method() === 'POST') {
        $ctx = getAdminContext($pdo, true);
        requireAdminPermission($ctx, 'can_manage_staff');
        $body = $request->json();
        $action = $body['action'] ?? 'invite';

        if ($action === 'invite') {
            $result = $ctx['service']->inviteStaff(
                $ctx['business_id'],
                $body['staff'] ?? $body,
                $ctx['user_id'],
                $ctx['admin_name']
            );
            JsonResponse::success($result, 201)->send();
        }

        if ($action === 'update') {
            $staffId = (int)($body['staff_id'] ?? 0);
            $result = $ctx['service']->updateStaff(
                $ctx['business_id'],
                $staffId,
                $body['staff'] ?? $body,
                $ctx['user_id'],
                $ctx['admin_name']
            );
            JsonResponse::success($result)->send();
        }

        if (in_array($action, ['activate', 'deactivate'], true)) {
            $staffId = (int)($body['staff_id'] ?? 0);
            $status = $action === 'activate' ? 'active' : 'inactive';
            $result = $ctx['service']->setStaffStatus(
                $ctx['business_id'],
                $staffId,
                $status,
                $ctx['user_id'],
                $ctx['admin_name']
            );
            JsonResponse::success($result)->send();
        }

        JsonResponse::error('Invalid staff action.', 422)->send();
    }

    JsonResponse::error('Method not allowed.', 405)->send();
} catch (Throwable $e) {
    JsonResponse::error($e->getMessage(), 400)->send();
}

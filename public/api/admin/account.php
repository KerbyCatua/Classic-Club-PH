<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

use ClassicClub\Http\JsonResponse;
use ClassicClub\Http\Request;

$request = new Request();

try {
    if ($request->method() === 'GET') {
        $ctx = getAdminContext($pdo, false);
        $profile = $ctx['service']->getBusinessProfile($ctx['business_id'], $ctx['user_id']);
        JsonResponse::success($profile)->send();
    }

    if ($request->method() === 'POST') {
        $ctx = getAdminContext($pdo, true);
        $body = $request->json();
        $action = $body['action'] ?? '';

        if ($action === 'update_business') {
            requireAdminPermission($ctx, 'can_manage_staff');
            $result = $ctx['service']->updateBusinessProfile(
                $ctx['business_id'],
                $body['business'] ?? $body,
                $ctx['user_id'],
                $ctx['admin_name']
            );
            JsonResponse::success($result)->send();
        }

        if ($action === 'update_admin_profile') {
            $result = $ctx['service']->updateAdminProfile(
                $ctx['user_id'],
                $body['admin'] ?? $body
            );
            JsonResponse::success($result)->send();
        }

        if ($action === 'update_password') {
            $current = (string)($body['current_password'] ?? '');
            $new = (string)($body['new_password'] ?? '');
            $ctx['service']->updatePassword($ctx['user_id'], $current, $new);
            JsonResponse::success(['message' => 'Password changed successfully.'])->send();
        }

        JsonResponse::error('Invalid account action.', 422)->send();
    }

    JsonResponse::error('Method not allowed.', 405)->send();
} catch (Throwable $e) {
    JsonResponse::error($e->getMessage(), 400)->send();
}

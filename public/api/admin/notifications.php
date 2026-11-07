<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

use ClassicClub\Http\JsonResponse;
use ClassicClub\Http\Request;

$request = new Request();

try {
    if ($request->method() === 'GET') {
        $ctx = getAdminContext($pdo, false);
        requireAdminPermission($ctx, 'can_view_notifications');
        $filters = [
            'search' => $request->queryString('search') ?? '',
            'type' => $request->queryString('type') ?? '',
            'read_status' => $request->queryString('read_status') ?? '',
        ];
        $notifications = $ctx['service']->getNotifications($ctx['business_id'], $filters);
        JsonResponse::success($notifications)->send();
    }

    if ($request->method() === 'POST') {
        $ctx = getAdminContext($pdo, true);
        requireAdminPermission($ctx, 'can_view_notifications');
        $body = $request->json();
        $action = $body['action'] ?? 'mark_read';

        if ($action === 'mark_read') {
            $notificationId = (int)($body['notification_id'] ?? 0);
            $success = $ctx['service']->markNotificationRead($ctx['business_id'], $notificationId);
            JsonResponse::success(['success' => $success, 'message' => 'Notification marked as read.'])->send();
        }

        if ($action === 'mark_all_read') {
            $success = $ctx['service']->markAllNotificationsRead($ctx['business_id']);
            JsonResponse::success(['success' => $success, 'message' => 'All notifications marked as read.'])->send();
        }

        JsonResponse::error('Invalid notification action.', 422)->send();
    }

    JsonResponse::error('Method not allowed.', 405)->send();
} catch (Throwable $e) {
    JsonResponse::error($e->getMessage(), 400)->send();
}

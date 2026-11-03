<?php

declare(strict_types=1);

use ClassicClub\Http\JsonResponse;
use ClassicClub\Http\Request;
use ClassicClub\Middleware\PermissionMiddleware;
use ClassicClub\Repositories\InquiryRepository;
use ClassicClub\Support\AuditLogger;

require_once __DIR__ . '/../../../app/Database/Connection.php';
require_once __DIR__ . '/../../../app/Support/Input.php';
require_once __DIR__ . '/../../../app/Http/Request.php';
require_once __DIR__ . '/../../../app/Http/Response.php';
require_once __DIR__ . '/../../../app/Http/JsonResponse.php';
require_once __DIR__ . '/../../../app/Auth/SessionManager.php';
require_once __DIR__ . '/../../../app/Authorization/PermissionChecker.php';
require_once __DIR__ . '/../../../app/Middleware/AuthMiddleware.php';
require_once __DIR__ . '/../../../app/Middleware/PermissionMiddleware.php';
require_once __DIR__ . '/../../../app/Middleware/CsrfMiddleware.php';
require_once __DIR__ . '/../../../app/Repositories/InquiryRepository.php';
require_once __DIR__ . '/../../../app/Support/AuditLogger.php';

try {
    $userId = PermissionMiddleware::require($pdo, 'inquiries.manage');
    $request = new Request();
    if ($request->method() !== 'PATCH') {
        JsonResponse::error('Method not allowed.', 405)->send();
    }
    \ClassicClub\Middleware\CsrfMiddleware::require();
    $body = $request->json();
    $id = filter_var($body['id'] ?? null, FILTER_VALIDATE_INT);
    $status = trim((string) ($body['status'] ?? ''));
    if ($id === false || !in_array($status, ['open', 'in_progress', 'resolved', 'closed'], true)) {
        JsonResponse::error('A valid inquiry id and status are required.', 422)->send();
    }
    $updated = (new InquiryRepository($pdo))->updateStatus(
        (int) $id,
        $status,
        isset($body['assigned_to']) ? (int) $body['assigned_to'] : $userId
    );
    if (!$updated) {
        JsonResponse::error('Inquiry not found or unchanged.', 404)->send();
    }
    (new AuditLogger($pdo))->record(
        'contact.inquiry_status_updated',
        $userId,
        'contact_inquiry',
        (int) $id,
        ['status' => $status]
    );
    JsonResponse::success(['updated' => true])->send();
} catch (Throwable $exception) {
    if ($exception instanceof RuntimeException) {
        JsonResponse::error($exception->getMessage(), 401)->send();
    }
    error_log($exception->getMessage());
    JsonResponse::error('Unable to update inquiry.', 500)->send();
}

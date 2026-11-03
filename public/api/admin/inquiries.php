<?php

declare(strict_types=1);

use ClassicClub\Http\JsonResponse;
use ClassicClub\Http\Request;
use ClassicClub\Middleware\PermissionMiddleware;
use ClassicClub\Repositories\InquiryRepository;

require_once __DIR__ . '/../../../app/Database/Connection.php';
require_once __DIR__ . '/../../../app/Support/Input.php';
require_once __DIR__ . '/../../../app/Http/Request.php';
require_once __DIR__ . '/../../../app/Http/Response.php';
require_once __DIR__ . '/../../../app/Http/JsonResponse.php';
require_once __DIR__ . '/../../../app/Auth/SessionManager.php';
require_once __DIR__ . '/../../../app/Authorization/PermissionChecker.php';
require_once __DIR__ . '/../../../app/Middleware/AuthMiddleware.php';
require_once __DIR__ . '/../../../app/Middleware/PermissionMiddleware.php';
require_once __DIR__ . '/../../../app/Repositories/InquiryRepository.php';

try {
    PermissionMiddleware::require($pdo, 'inquiries.view');
    $request = new Request();
    if ($request->method() !== 'GET') {
        JsonResponse::error('Method not allowed.', 405)->send();
    }

    $status = $request->queryString('status');
    if ($status !== '' && !in_array($status, ['open', 'in_progress', 'resolved', 'closed'], true)) {
        JsonResponse::error('Invalid inquiry status.', 422)->send();
    }

    JsonResponse::success((new InquiryRepository($pdo))->list($status))->send();
} catch (Throwable $exception) {
    if ($exception instanceof RuntimeException) {
        JsonResponse::error($exception->getMessage(), 401)->send();
    }
    error_log($exception->getMessage());
    JsonResponse::error('Unable to load inquiries.', 500)->send();
}

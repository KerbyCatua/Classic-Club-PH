<?php

declare(strict_types=1);

use ClassicClub\Auth\SessionManager;
use ClassicClub\Http\JsonResponse;
use ClassicClub\Http\Request;
use ClassicClub\Support\AuditLogger;

require_once __DIR__ . '/../../../app/Http/Response.php';
require_once __DIR__ . '/../../../app/Http/JsonResponse.php';
require_once __DIR__ . '/../../../app/Http/Request.php';
require_once __DIR__ . '/../../../app/Auth/SessionManager.php';
require_once __DIR__ . '/../../../app/Middleware/CsrfMiddleware.php';
require_once __DIR__ . '/../../../app/Database/Connection.php';
require_once __DIR__ . '/../../../app/Support/AuditLogger.php';

$request = new Request();

if ($request->method() !== 'POST') {
    JsonResponse::error('Method not allowed.', 405)->send();
}
\ClassicClub\Middleware\CsrfMiddleware::require();

$userId = SessionManager::userId();

(new AuditLogger($pdo))->record(
    'auth.logout',
    $userId,
    'user',
    $userId
);

SessionManager::logout();

JsonResponse::success([
    'message' => 'Signed out successfully.',
])->send();
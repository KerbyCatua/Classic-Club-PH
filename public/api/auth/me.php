<?php

declare(strict_types=1);

use ClassicClub\Http\JsonResponse;
use ClassicClub\Repositories\UserRepository;
use ClassicClub\Services\AuthService;
use ClassicClub\Support\AuditLogger;
use RuntimeException;

require_once __DIR__ . '/../../../app/Database/Connection.php';
require_once __DIR__ . '/../../../app/Http/Response.php';
require_once __DIR__ . '/../../../app/Http/JsonResponse.php';
require_once __DIR__ . '/../../../app/Auth/SessionManager.php';
require_once __DIR__ . '/../../../app/Repositories/UserRepository.php';
require_once __DIR__ . '/../../../app/Support/AuditLogger.php';
require_once __DIR__ . '/../../../app/Services/AuthService.php';

try {
    $service = new AuthService(
        new UserRepository($pdo),
        new AuditLogger($pdo)
    );

    JsonResponse::success([
        'user' => $service->currentUser(),
    ])->send();
} catch (RuntimeException $exception) {
    JsonResponse::error($exception->getMessage(), 401)->send();
} catch (Throwable $exception) {
    error_log($exception->getMessage());
    JsonResponse::error(
        'An unexpected server error occurred.',
        500
    )->send();
}
<?php

declare(strict_types=1);

use ClassicClub\Http\JsonResponse;
use ClassicClub\Http\Request;
use ClassicClub\Repositories\UserRepository;
use ClassicClub\Services\AuthService;
use ClassicClub\Support\AuditLogger;
use ClassicClub\Validation\AuthValidator;
use ClassicClub\Validation\ValidationException;
use RuntimeException;

require_once __DIR__ . '/../../../app/Database/Connection.php';
require_once __DIR__ . '/../../../app/Support/Input.php';
require_once __DIR__ . '/../../../app/Http/Request.php';
require_once __DIR__ . '/../../../app/Http/Response.php';
require_once __DIR__ . '/../../../app/Http/JsonResponse.php';
require_once __DIR__ . '/../../../app/Auth/SessionManager.php';
require_once __DIR__ . '/../../../app/Validation/ValidationException.php';
require_once __DIR__ . '/../../../app/Validation/AuthValidator.php';
require_once __DIR__ . '/../../../app/Repositories/UserRepository.php';
require_once __DIR__ . '/../../../app/Support/AuditLogger.php';
require_once __DIR__ . '/../../../app/Services/AuthService.php';

$request = new Request();

try {
    if ($request->method() !== 'POST') {
        JsonResponse::error('Method not allowed.', 405)->send();
    }

    $data = (new AuthValidator())->login($request->json());

    $service = new AuthService(
        new UserRepository($pdo),
        new AuditLogger($pdo)
    );

    $user = $service->login($data);

    JsonResponse::success([
        'user' => $user,
        'message' => 'Signed in successfully.',
    ])->send();
} catch (ValidationException $exception) {
    JsonResponse::error(
        $exception->getMessage(),
        422,
        $exception->errors()
    )->send();
} catch (RuntimeException $exception) {
    JsonResponse::error($exception->getMessage(), 401)->send();
} catch (Throwable $exception) {
    error_log($exception->getMessage());
    JsonResponse::error(
        'An unexpected server error occurred.',
        500
    )->send();
}
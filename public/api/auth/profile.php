<?php

declare(strict_types=1);

use ClassicClub\Auth\SessionManager;
use ClassicClub\Http\JsonResponse;
use ClassicClub\Http\Request;
use ClassicClub\Repositories\UserRepository;
use ClassicClub\Services\AccountProfileService;
use ClassicClub\Validation\AccountProfileValidator;
use ClassicClub\Validation\ValidationException;

require_once __DIR__ . '/../../../app/Database/Connection.php';
require_once __DIR__ . '/../../../app/Http/Response.php';
require_once __DIR__ . '/../../../app/Http/JsonResponse.php';
require_once __DIR__ . '/../../../app/Http/Request.php';
require_once __DIR__ . '/../../../app/Auth/SessionManager.php';
require_once __DIR__ . '/../../../app/Middleware/CsrfMiddleware.php';
require_once __DIR__ . '/../../../app/Repositories/UserRepository.php';
require_once __DIR__ . '/../../../app/Support/AuditLogger.php';
require_once __DIR__ . '/../../../app/Validation/ValidationException.php';
require_once __DIR__ . '/../../../app/Validation/AccountProfileValidator.php';
require_once __DIR__ . '/../../../app/Services/AccountProfileService.php';

try {
    $request = new Request();
    if (!in_array($request->method(), ['GET', 'POST'], true)) {
        header('Allow: GET, POST');
        JsonResponse::error('Method not allowed.', 405)->send();
    }
    $actor = SessionManager::userId();
    $user = $actor === null ? null : (new UserRepository($pdo))->findById($actor);
    if (!$user || $user['status'] !== 'active') JsonResponse::error('Please sign in to an active account.', 401)->send();
    $service = new AccountProfileService($pdo);
    if ($request->method() === 'GET') JsonResponse::success($service->read($actor))->send();
    \ClassicClub\Middleware\CsrfMiddleware::require();
    $body = $request->json();
    $validator = new AccountProfileValidator();
    if (($body['action'] ?? '') === 'update_profile') {
        JsonResponse::success($service->updateProfile($actor, $validator->profile($body)))->send();
    }
    if (($body['action'] ?? '') === 'update_password') {
        $service->updatePassword($actor, $validator->password($body));
        JsonResponse::success(['message' => 'Password updated successfully.'])->send();
    }
    JsonResponse::error('Invalid profile action.', 422)->send();
} catch (ValidationException $e) {
    JsonResponse::error($e->getMessage(), 422, $e->errors())->send();
} catch (Throwable $e) {
    if (in_array($e->getCode(), [401, 429], true)) JsonResponse::error($e->getMessage(), (int) $e->getCode())->send();
    error_log($e->getMessage());
    JsonResponse::error('Unable to process your account changes. Please try again.', 500)->send();
}

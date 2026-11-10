<?php

declare(strict_types=1);

use ClassicClub\Auth\SessionManager;
use ClassicClub\Http\JsonResponse;
use ClassicClub\Http\Request;
use ClassicClub\Repositories\AddressRepository;
use ClassicClub\Repositories\UserRepository;
use ClassicClub\Support\AuditLogger;
use ClassicClub\Validation\AddressValidator;
use ClassicClub\Validation\ValidationException;

require_once __DIR__ . '/../../../app/Database/Connection.php';
require_once __DIR__ . '/../../../app/Http/Response.php';
require_once __DIR__ . '/../../../app/Http/JsonResponse.php';
require_once __DIR__ . '/../../../app/Http/Request.php';
require_once __DIR__ . '/../../../app/Auth/SessionManager.php';
require_once __DIR__ . '/../../../app/Middleware/CsrfMiddleware.php';
require_once __DIR__ . '/../../../app/Repositories/UserRepository.php';
require_once __DIR__ . '/../../../app/Repositories/AddressRepository.php';
require_once __DIR__ . '/../../../app/Support/AuditLogger.php';
require_once __DIR__ . '/../../../app/Validation/ValidationException.php';
require_once __DIR__ . '/../../../app/Validation/AddressValidator.php';

try {
    $request = new Request();
    if (!in_array($request->method(), ['GET', 'POST'], true)) {
        header('Allow: GET, POST');
        JsonResponse::error('Method not allowed.', 405)->send();
    }
    $actor = SessionManager::userId();
    $user = $actor === null ? null : (new UserRepository($pdo))->findById($actor);
    if (!$user || $user['status'] !== 'active') JsonResponse::error('Please sign in to an active account.', 401)->send();
    $repo = new AddressRepository($pdo);
    if ($request->method() === 'GET') JsonResponse::success(['addresses' => $repo->all($actor)])->send();
    \ClassicClub\Middleware\CsrfMiddleware::require();
    $body = $request->json();
    $id = $body['id'] ?? null;
    if ($id !== null && (!is_int($id) || $id <= 0)) JsonResponse::error('Invalid address ID.', 422)->send();
    if (($body['action'] ?? '') === 'save') {
        $data = (new AddressValidator())->validate($body);
        $savedId = $repo->save($actor, $id, $data);
        (new AuditLogger($pdo))->record($id ? 'account.address_updated' : 'account.address_created', $actor, 'user_address', $savedId);
        JsonResponse::success(['id' => $savedId, 'addresses' => $repo->all($actor)], $id ? 200 : 201)->send();
    }
    if (($body['action'] ?? '') === 'delete' && $id !== null) {
        if (array_diff(array_keys($body), ['action', 'id'])) JsonResponse::error('Unexpected address fields.', 422)->send();
        $repo->delete($actor, $id);
        (new AuditLogger($pdo))->record('account.address_deleted', $actor, 'user_address', $id);
        JsonResponse::success(['addresses' => $repo->all($actor)])->send();
    }
    JsonResponse::error('Invalid address action.', 422)->send();
} catch (ValidationException $e) {
    JsonResponse::error($e->getMessage(), 422, $e->errors())->send();
} catch (Throwable $e) {
    if ($e->getCode() === 404) JsonResponse::error($e->getMessage(), 404)->send();
    error_log($e->getMessage());
    JsonResponse::error('Unable to process your addresses. Please try again.', 500)->send();
}

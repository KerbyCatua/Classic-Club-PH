<?php
declare(strict_types=1);

require_once __DIR__ . '/../../../app/Database/Connection.php';
require_once __DIR__ . '/../../../app/Support/Input.php';
require_once __DIR__ . '/../../../app/Http/Request.php';
require_once __DIR__ . '/../../../app/Http/Response.php';
require_once __DIR__ . '/../../../app/Http/JsonResponse.php';
require_once __DIR__ . '/../../../app/Auth/SessionManager.php';
require_once __DIR__ . '/../../../app/Middleware/AuthMiddleware.php';
require_once __DIR__ . '/../../../app/Middleware/CsrfMiddleware.php';
require_once __DIR__ . '/../../../app/Services/AdminBusinessService.php';

use ClassicClub\Http\JsonResponse;
use ClassicClub\Http\Request;
use ClassicClub\Middleware\AuthMiddleware;
use ClassicClub\Middleware\CsrfMiddleware;
use ClassicClub\Services\AdminBusinessService;

function getAdminContext(PDO $pdo, bool $requireCsrf = false): array
{
    $userId = AuthMiddleware::requireUser();
    if ($requireCsrf) {
        CsrfMiddleware::require();
    }
    // Release PHP session lock immediately so parallel AJAX requests do not block each other
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }
    $service = new AdminBusinessService($pdo);
    $auth = $service->authorizeAdmin($userId);
    return [
        'user_id' => $userId,
        'business_id' => (int)$auth['business_id'],
        'permissions' => $auth['permissions'] ?? [],
        'auth' => $auth,
        'service' => $service,
        'admin_name' => trim(($auth['user']['first_name'] ?? '') . ' ' . ($auth['user']['last_name'] ?? '')) ?: 'Admin',
    ];
}

function requireAdminPermission(array $ctx, string $permission): void
{
    if (empty($ctx['permissions'][$permission])) {
        JsonResponse::error('Your staff account does not have permission for this action.', 403)->send();
    }
}

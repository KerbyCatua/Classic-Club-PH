<?php

declare(strict_types=1);

require_once __DIR__ . '/../../../app/Database/Connection.php';
require_once __DIR__ . '/../../../app/Support/Input.php';
require_once __DIR__ . '/../../../app/Http/Request.php';
require_once __DIR__ . '/../../../app/Http/Response.php';
require_once __DIR__ . '/../../../app/Http/JsonResponse.php';
require_once __DIR__ . '/../../../app/Auth/SessionManager.php';
require_once __DIR__ . '/../../../app/Middleware/AuthMiddleware.php';

use ClassicClub\Auth\SessionManager;
use ClassicClub\Http\JsonResponse;
use ClassicClub\Middleware\AuthMiddleware;

/**
 * Authenticate the current session and require the super_admin global role.
 * Unlike the business-admin bootstrap, this context is not tied to a single
 * business assignment.
 */
function getSuperAdminContext(PDO $pdo): array
{
    $userId = AuthMiddleware::requireUser();

    // Release the PHP session lock so parallel dashboard requests can run.
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }

    $statement = $pdo->prepare(<<<'SQL'
        SELECT id, email, first_name, last_name, status
        FROM users
        WHERE id = :id
          AND deleted_at IS NULL
        LIMIT 1
    SQL);
    $statement->execute(['id' => $userId]);
    $user = $statement->fetch();

    if ($user === false || $user['status'] !== 'active') {
        SessionManager::logout();
        JsonResponse::error('Super Admin access is required.', 403)->send();
    }

    $statement = $pdo->prepare(<<<'SQL'
        SELECT r.name
        FROM roles r
        INNER JOIN user_roles ur ON ur.role_id = r.id
        WHERE ur.user_id = :user_id
    SQL);
    $statement->execute(['user_id' => $userId]);
    $roles = $statement->fetchAll(PDO::FETCH_COLUMN);

    if (!in_array('super_admin', $roles, true)) {
        JsonResponse::error('Super Admin access is required.', 403)->send();
    }

    return [
        'user_id' => $userId,
        'user' => $user,
        'roles' => $roles,
    ];
}

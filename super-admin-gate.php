<?php

declare(strict_types=1);

/**
 * Server-side access gate for the Super Admin dashboard.
 *
 * The .htaccess rewrite sends every request for super-admin-dashboard.html
 * through this file. The dashboard markup is only streamed after the current
 * session has been authenticated AND confirmed to hold the super_admin role.
 */

use ClassicClub\Auth\SessionManager;

require_once __DIR__ . '/app/Database/Connection.php';
require_once __DIR__ . '/app/Auth/SessionManager.php';

header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Referrer-Policy: same-origin');

$redirect = static function (string $location): never {
    header('Location: ' . $location, true, 302);
    exit;
};

$userId = SessionManager::userId();

if ($userId === null) {
    $redirect('auth.html?notice=super_admin_required');
}

$statement = $pdo->prepare(
    <<<'SQL'
        SELECT id, status
        FROM users
        WHERE id = :id
          AND deleted_at IS NULL
        LIMIT 1
    SQL
);
$statement->execute(['id' => $userId]);
$user = $statement->fetch();

if ($user === false || $user['status'] !== 'active') {
    SessionManager::logout();
    $redirect('auth.html?notice=super_admin_required');
}

$statement = $pdo->prepare(
    <<<'SQL'
        SELECT r.name
        FROM roles r
        INNER JOIN user_roles ur ON ur.role_id = r.id
        WHERE ur.user_id = :user_id
    SQL
);
$statement->execute(['user_id' => $userId]);
$roles = $statement->fetchAll(PDO::FETCH_COLUMN);

if (!in_array('super_admin', $roles, true)) {
    // Authenticated, but not a Super Admin: the auth page shows a snackbar
    // explaining that Super Admin access is required.
    $redirect('auth.html?notice=super_admin_required');
}

$dashboard = __DIR__ . '/super-admin-dashboard.html';

if (!is_file($dashboard)) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=UTF-8');
    exit('Super Admin dashboard is unavailable.');
}

header('Content-Type: text/html; charset=UTF-8');
readfile($dashboard);
exit;

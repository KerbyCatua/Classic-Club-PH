<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

use ClassicClub\Http\JsonResponse;
use ClassicClub\Http\Request;

$request = new Request();

try {
    $ctx = getAdminContext($pdo, false);
    $business = $ctx['auth']['business'] ?? [];
    $user = $ctx['auth']['user'] ?? [];
    unset($user['password_hash']);

    JsonResponse::success([
        'authenticated' => true,
        'user' => $user,
        'business' => $business,
        'roles' => $user['roles'] ?? ['admin'],
        'permissions' => $ctx['permissions'] ?? [],
        'staff_role' => $ctx['auth']['staff_role'] ?? null,
    ])->send();
} catch (Throwable $e) {
    JsonResponse::error($e->getMessage(), 403)->send();
}

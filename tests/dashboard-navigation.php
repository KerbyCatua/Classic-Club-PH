<?php

declare(strict_types=1);

// Run with CC_PLAYWRIGHT_PATH set, using an active local XAMPP application.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../app/Database/Connection.php';
require_once __DIR__ . '/../app/Auth/SessionManager.php';
require_once __DIR__ . '/../app/Repositories/UserRepository.php';

use ClassicClub\Auth\SessionManager;
use ClassicClub\Repositories\UserRepository;

$base = rtrim($argv[1] ?? 'http://localhost/classic-club-ph', '/') . '/';
$businessId = $pdo->query("SELECT id FROM businesses WHERE status = 'active' ORDER BY id LIMIT 1")->fetchColumn();
if (!$businessId) throw new RuntimeException('An active business is required.');

$repo = new UserRepository($pdo);
$users = $sessions = [];
$fixtures = [
    'owner' => ['admin', 'owner'],
    'admin' => ['admin', 'inventory_manager'],
    'super_admin' => ['super_admin', 'owner'],
    'customer' => ['customer', null],
];
try {
    foreach ($fixtures as $name => [$role, $assignment]) {
        $email = 'dashboard-navigation-' . bin2hex(random_bytes(8)) . '@example.com';
        $id = $repo->create($email, password_hash(bin2hex(random_bytes(16)), PASSWORD_DEFAULT), 'Dashboard', 'Test');
        $users[] = $id;
        $repo->assignRole($id, $role);
        if ($name === 'super_admin') $repo->assignRole($id, 'admin');
        if ($assignment !== null) {
            $pdo->prepare("INSERT INTO business_users (business_id, user_id, name, email, role_title, permission_set, status)
                VALUES (?, ?, 'Dashboard Test', ?, ?, ?, 'active')")
                ->execute([$businessId, $id, $email, $assignment, $assignment]);
        }

        session_id('navigationtest' . bin2hex(random_bytes(12)));
        SessionManager::login($id);
        $sessions[$name] = ['name' => session_name(), 'value' => session_id(), 'userId' => $id];
        session_write_close();
    }

    $process = proc_open(['node', __DIR__ . '/dashboard-navigation.cjs'], [0 => ['pipe', 'r'], 1 => STDOUT, 2 => STDERR], $pipes);
    if (!is_resource($process)) throw new RuntimeException('Unable to start dashboard navigation checks.');
    fwrite($pipes[0], json_encode(['base' => $base, 'sessions' => $sessions], JSON_THROW_ON_ERROR));
    fclose($pipes[0]);
    if (proc_close($process) !== 0) throw new RuntimeException('Dashboard navigation checks failed.');
} finally {
    foreach ($users as $id) {
        $pdo->prepare('DELETE FROM business_users WHERE user_id = ?')->execute([$id]);
        $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
    }
    foreach ($sessions as $session) {
        session_id($session['value']);
        SessionManager::start();
        $_SESSION = [];
        session_destroy();
    }
}

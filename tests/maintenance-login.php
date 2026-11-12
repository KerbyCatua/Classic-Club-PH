<?php
declare(strict_types=1);
// Run: C:/xampp/php/php.exe tests/maintenance-login.php
// Requires Playwright and a local application with maintenance currently active.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../app/Database/Connection.php';
require_once __DIR__ . '/../app/Repositories/UserRepository.php';

$repo = new \ClassicClub\Repositories\UserRepository($pdo);
$users = [];
$fixtures = [];
$password = bin2hex(random_bytes(16)) . 'Aa1!';
$suffix = bin2hex(random_bytes(8)) . '@example.com';
try {
    $roles = $pdo->query('SELECT name FROM roles ORDER BY name')->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('super_admin', $roles, true)) throw new RuntimeException('Super Admin role must exist.');
    foreach (array_merge($roles, ['no_role', 'inactive_super_admin']) as $role) {
        $email = 'maintenance-test-' . $role . '-' . $suffix;
        $id = $repo->create($email, password_hash($password, PASSWORD_DEFAULT), 'Maintenance', 'Test');
        $users[] = $id;
        if ($role !== 'no_role') $repo->assignRole($id, $role === 'inactive_super_admin' ? 'super_admin' : $role);
        if ($role === 'inactive_super_admin') $pdo->prepare("UPDATE users SET status = 'inactive' WHERE id = ?")->execute([$id]);
        $fixtures[$role] = ['id' => $id, 'email' => $email];
    }
    $process = proc_open(['node', __DIR__ . '/maintenance-login.cjs'], [0 => ['pipe', 'r'], 1 => STDOUT, 2 => STDERR], $pipes);
    if (!is_resource($process)) throw new RuntimeException('Unable to start browser checks.');
    fwrite($pipes[0], json_encode(['base' => $argv[1] ?? 'http://localhost/classic-club-ph/', 'password' => $password, 'users' => $fixtures], JSON_THROW_ON_ERROR));
    fclose($pipes[0]);
    $status = proc_close($process);
    if ($status !== 0) throw new RuntimeException('Maintenance login checks failed.');
} finally {
    foreach ($users as $id) {
        $pdo->prepare('DELETE FROM audit_logs WHERE user_id = ?')->execute([$id]);
        $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
    }
    // Failed credentials have no user_id; remove only this run's test email logs.
    foreach ($fixtures as $fixture) {
        $pdo->prepare("DELETE FROM audit_logs WHERE action = 'auth.login_failed' AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.email')) = ?")->execute([$fixture['email']]);
    }
}

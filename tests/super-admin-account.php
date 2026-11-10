<?php
declare(strict_types=1);
// Run: C:/xampp/php/php.exe tests/super-admin-account.php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../app/Database/Connection.php';
require_once __DIR__ . '/../app/Auth/SessionManager.php';
require_once __DIR__ . '/../app/Repositories/UserRepository.php';
require_once __DIR__ . '/../app/Support/AuditLogger.php';

use ClassicClub\Auth\SessionManager;
use ClassicClub\Repositories\UserRepository;
use ClassicClub\Services\SystemConfigurationService;
use ClassicClub\Support\AuditLogger;

function check(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
function http(?array $session = null, ?array $body = null, bool $csrf = true, string $query = ''): array {
    global $base;
    $c = curl_init($base . '/public/api/super-admin/account.php' . $query);
    $headers = ['Accept: application/json'];
    if ($session) $headers[] = 'Cookie: ' . $session['cookie'];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
        if ($session && $csrf) $headers[] = 'X-CSRF-Token: ' . $session['token'];
        curl_setopt_array($c, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($body)]);
    }
    curl_setopt_array($c, [CURLOPT_HTTPHEADER => $headers, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20]);
    $raw = curl_exec($c);
    if ($raw === false) throw new RuntimeException(curl_error($c));
    $status = curl_getinfo($c, CURLINFO_RESPONSE_CODE);
    curl_close($c);
    return ['status' => $status, 'data' => json_decode($raw, true)['data'] ?? [], 'raw' => $raw];
}
function testSession(int $id): array {
    session_id('accounttest' . bin2hex(random_bytes(12)));
    SessionManager::login($id);
    $session = ['cookie' => session_name() . '=' . session_id(), 'id' => session_id(), 'token' => $_SESSION['csrf_token']];
    session_write_close();
    return $session;
}
$base = $argv[1] ?? 'http://localhost/classic-club-ph';
$repo = new UserRepository($pdo);
$users = $sessions = [];
$email = 'account-test-' . bin2hex(random_bytes(8)) . '@example.com';
$oldPassword = 'AccountTesting123!';
try {
    foreach (['super_admin', 'customer', 'admin'] as $role) {
        $id = $repo->create($role . '-' . $email, password_hash($oldPassword, PASSWORD_DEFAULT), 'Account', 'Test');
        $users[] = $id;
        $repo->assignRole($id, $role);
        $sessions[$role] = testSession($id);
    }
    $actor = $users[0];
    $admin = $sessions['super_admin'];
    check(http()['status'] === 401, 'Anonymous rejected.');
    check(http($sessions['customer'])['status'] === 403, 'Customer rejected.');
    check(http($sessions['admin'])['status'] === 403, 'Business admin rejected.');
    $r = http($admin);
    check($r['status'] === 200 && (int) $r['data']['profile']['id'] === $actor, 'Authenticated profile loads without MFA.');
    check($r['data']['session']['logged_in_at'] > 0, 'Real session timestamps.');
    $profile = ['action' => 'update_profile', 'first_name' => 'Updated', 'last_name' => 'Administrator', 'email' => $email, 'mobile' => '+63 917 123 4567'];
    $pdo->prepare('UPDATE users SET email_verified_at = NOW() WHERE id = ?')->execute([$actor]);
    check(http($admin, $profile, false)['status'] === 403, 'CSRF required.');
    check(http($admin, $profile + ['role' => 'customer'])['status'] === 422, 'Role injection rejected.');
    check(http($admin, array_replace($profile, ['email' => 'customer-' . $email]))['status'] === 422, 'Duplicate email rejected.');
    check(http($admin, array_replace($profile, ['email' => 'invalid']))['status'] === 422, 'Invalid email rejected.');
    check(http($admin, array_replace($profile, ['first_name' => str_repeat('a', 101)]))['status'] === 422, 'Field lengths enforced.');
    check(http($admin, array_replace($profile, ['mobile' => []]))['status'] === 422, 'Malformed fields rejected.');
    check(http($admin, $profile)['status'] === 200, 'Profile saved.');
    $r = http($admin)['data']['profile'];
    check($r['email'] === $email && $r['first_name'] === 'Updated' && $r['mobile'] === $profile['mobile'], 'Profile survives separate request.');
    check($r['email_verified_at'] === null, 'Email change clears previous verification.');
    check(array_column($repo->getRoles($actor), 'name') === ['super_admin'], 'Role unchanged.');

    $password = ['action' => 'update_password', 'current_password' => $oldPassword, 'new_password' => 'AccountChanged456!', 'password_confirmation' => 'AccountChanged456!'];
    check(http($admin, array_replace($password, ['current_password' => 'wrong']))['status'] === 422, 'Current password verified.');
    check(http($admin, array_replace($password, ['password_confirmation' => 'mismatch']))['status'] === 422, 'Confirmation checked on server.');
    $min = SystemConfigurationService::value('password_min_length');
    $short = str_repeat('a', $min - 2) . '1';
    check(http($admin, array_replace($password, ['new_password' => $short, 'password_confirmation' => $short]))['status'] === 422, 'Saved global password minimum enforced.');
    $letters = str_repeat('a', $min);
    check(http($admin, array_replace($password, ['new_password' => $letters, 'password_confirmation' => $letters]))['status'] === 422, 'Shared password composition enforced.');
    $sessions['other'] = testSession($actor);
    $r = http($admin, $password);
    check($r['status'] === 200, 'Password changed: ' . $r['raw']);
    check(http($admin)['status'] === 200, 'Current session retained.');
    $expected = SystemConfigurationService::value('invalidate_sessions') ? 401 : 200;
    check(http($sessions['other'])['status'] === $expected, 'Other session follows saved invalidation policy.');
    check(password_verify($password['new_password'], $repo->findByEmail($email)['password_hash']), 'Password hash persisted.');
    check(!str_contains($r['raw'], 'password_hash') && !str_contains($r['raw'], $password['new_password']), 'Credentials never returned.');

    $r = http($admin, ['action' => 'request_recovery', 'user_id' => $users[1]]);
    check($r['status'] === 200 && $r['data']['recovery']['latest_request']['expires_at'] > time(), 'Existing recovery workflow connected to actor only.');
    check(!str_contains($r['raw'], 'token_hash'), 'Recovery token never exposed.');
    $q = $pdo->prepare('SELECT COUNT(*) FROM password_reset_tokens WHERE user_id = ?');
    $q->execute([$users[1]]); check((int) $q->fetchColumn() === 0, 'Recovery cannot target another account.');
    $logger = new AuditLogger($pdo);
    for ($i = 0; $i < 22; $i++) $logger->record('account.test_activity', $actor, 'user', $actor);
    $logger->record('account.other_actor', $users[1], 'user', $actor);
    $first = http($admin, null, true, '?view=history&user_id=' . $users[1])['data'];
    check(count($first['items']) === 20 && $first['next_before'] > 0, 'Personal audit pagination.');
    $second = http($admin, null, true, '?view=history&before=' . $first['next_before'])['data'];
    $items = array_merge($first['items'], $second['items']);
    $actions = array_column($items, 'action');
    check(!in_array('account.other_actor', $actions, true), 'History filters actor, not target account.');
    foreach (['account.profile_updated', 'account.password_changed', 'users.password_reset_requested'] as $action) check(in_array($action, $actions, true), 'Audited: ' . $action);
    check(count(array_unique(array_column($items, 'id'))) === count($items), 'Audit pages do not overlap.');
    check(abs((int) $first['items'][0]['timestamp'] - time()) < 30, 'Database timestamp converted accurately.');
} finally {
    if ($pdo->inTransaction()) $pdo->rollBack();
    foreach ($users as $id) {
        $q = $pdo->prepare('DELETE FROM audit_logs WHERE user_id = ?'); $q->execute([$id]);
        $q = $pdo->prepare('DELETE FROM users WHERE id = ?'); $q->execute([$id]);
    }
    foreach ($sessions as $session) {
        session_id($session['id']); SessionManager::start(); $_SESSION = []; session_destroy();
    }
}
echo "PASS: authorization, CSRF, profile persistence, validation, password policy, confirmation, session invalidation, recovery requests and personal audit pagination.\n";

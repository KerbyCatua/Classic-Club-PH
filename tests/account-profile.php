<?php

declare(strict_types=1);

// Run: C:/xampp/php/php.exe tests/account-profile.php [http://localhost/classic-club-ph]
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../app/Database/Connection.php';
require_once __DIR__ . '/../app/Auth/SessionManager.php';
require_once __DIR__ . '/../app/Repositories/UserRepository.php';

use ClassicClub\Auth\SessionManager;
use ClassicClub\Repositories\UserRepository;
use ClassicClub\Services\SystemConfigurationService;

function check(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
function http(?array $session = null, ?array $body = null, bool $csrf = true, string $route = 'profile.php', string $method = ''): array {
    global $base;
    $c = curl_init($base . '/public/api/auth/' . $route);
    $headers = ['Accept: application/json'];
    if ($session) $headers[] = 'Cookie: ' . $session['cookie'];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
        if ($session && $csrf) $headers[] = 'X-CSRF-Token: ' . $session['token'];
        curl_setopt_array($c, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($body)]);
    }
    if ($method) curl_setopt($c, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt_array($c, [CURLOPT_HTTPHEADER => $headers, CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true, CURLOPT_TIMEOUT => 20]);
    $raw = curl_exec($c);
    if ($raw === false) throw new RuntimeException(curl_error($c));
    $status = curl_getinfo($c, CURLINFO_RESPONSE_CODE);
    $size = curl_getinfo($c, CURLINFO_HEADER_SIZE);
    curl_close($c);
    $headers = substr($raw, 0, $size);
    $raw = substr($raw, $size);
    preg_match('/Set-Cookie: PHPSESSID=([^;]+)/i', $headers, $cookie);
    return ['status' => $status, 'json' => json_decode($raw, true), 'raw' => $raw, 'cookie' => isset($cookie[1]) ? 'PHPSESSID=' . $cookie[1] : null];
}
function testSession(int $id): array {
    session_id('profiletest' . bin2hex(random_bytes(12)));
    SessionManager::login($id);
    $session = ['cookie' => session_name() . '=' . session_id(), 'id' => session_id(), 'token' => $_SESSION['csrf_token']];
    session_write_close();
    return $session;
}

$base = $argv[1] ?? 'http://localhost/classic-club-ph';
$repo = new UserRepository($pdo);
$users = $sessions = [];
$email = 'profile-test-' . bin2hex(random_bytes(8)) . '@example.com';
$emails = [$email, 'other-' . $email, 'new-' . $email];
$oldPassword = 'ProfileTesting123!';
try {
    foreach ([$email, $emails[1]] as $address) {
        $id = $repo->create($address, password_hash($oldPassword, PASSWORD_DEFAULT), 'Profile', 'Test');
        $users[] = $id;
        $repo->assignRole($id, 'customer');
        $sessions[] = testSession($id);
    }
    $actor = $users[0];
    $session = $sessions[0];
    check(http()['status'] === 401, 'Anonymous reads rejected.');
    check(http(null, ['action' => 'update_profile'])['status'] === 401, 'Anonymous writes rejected.');
    check(http($session, null, true, 'profile.php', 'DELETE')['status'] === 405, 'Unsupported method rejected.');
    $r = http($session);
    check($r['status'] === 200 && $r['json']['data']['user']['email'] === $email, 'Real account loaded.');
    check($r['json']['data']['newsletter'] === false, 'No implicit marketing opt-in.');
    check(!str_contains($r['raw'], 'password_hash'), 'Password hash never returned.');
    $profile = ['action' => 'update_profile', 'first_name' => 'Updated', 'last_name' => 'Customer', 'email' => $email, 'mobile' => '+63 917 123 4567', 'newsletter' => true];
    check(http($session, $profile, false)['status'] === 403, 'CSRF required.');
    check(http($session, $profile + ['user_id' => $users[1]])['status'] === 422, 'Cannot target another account.');
    check(http($session, $profile + ['role' => 'super_admin'])['status'] === 422, 'Role injection rejected.');
    foreach (['first_name' => '', 'last_name' => str_repeat('a', 101), 'email' => 'invalid', 'mobile' => 'bad-phone', 'newsletter' => 'true'] as $field => $value) {
        check(http($session, array_replace($profile, [$field => $value]))['status'] === 422, 'Invalid field rejected: ' . $field);
    }
    check(http($session, array_replace($profile, ['first_name' => []]))['status'] === 422, 'Malformed fields rejected.');
    check(http($session, $profile)['status'] === 200, 'Profile and preference saved.');
    $r = http($session)['json']['data'];
    check($r['user']['first_name'] === 'Updated' && $r['user']['mobile'] === $profile['mobile'] && $r['newsletter'], 'Changes survive separate request.');
    check(http($sessions[1])['json']['data']['user']['first_name'] === 'Profile', 'Other account unaffected.');
    $changed = array_replace($profile, ['email' => $emails[2]]);
    check(http($session, $changed)['status'] === 422, 'Email change requires current password.');
    check(http($session, array_replace($changed, ['email' => $emails[1], 'current_password' => $oldPassword]))['status'] === 422, 'Duplicate email rejected.');
    $pdo->prepare('UPDATE users SET email_verified_at = NOW() WHERE id = ?')->execute([$actor]);
    check(http($session, $changed + ['current_password' => $oldPassword])['status'] === 200, 'Confirmed email change saved.');
    $q = $pdo->prepare('SELECT email_verified_at FROM users WHERE id = ?'); $q->execute([$actor]);
    check($q->fetchColumn() === null, 'Previous email verification cleared.');
    $q = $pdo->prepare('SELECT status FROM newsletter_subscriptions WHERE email = ?'); $q->execute([$email]);
    check($q->fetchColumn() === 'unsubscribed', 'Old email unsubscribed.');
    check(http($session)['json']['data']['newsletter'] === true, 'Preference moved to new email.');
    $changed['newsletter'] = false; $changed['mobile'] = '';
    check(http($session, $changed)['status'] === 200, 'Unsubscribe and clear mobile.');
    check(http($session)['json']['data']['user']['mobile'] === null && http($session)['json']['data']['newsletter'] === false, 'Empty mobile stays empty and unsubscribe persists.');

    $password = ['action' => 'update_password', 'current_password' => $oldPassword, 'new_password' => 'ChangedProfile456!', 'confirm_password' => 'ChangedProfile456!'];
    check(http($session, array_replace($password, ['confirm_password' => 'mismatch']))['status'] === 422, 'Confirmation required.');
    check(http($session, array_replace($password, ['new_password' => str_repeat('a', 73)]))['status'] === 422, 'Bcrypt truncation rejected.');
    check(http($session, array_replace($password, ['new_password' => 'short1', 'confirm_password' => 'short1']))['status'] === 422, 'Global password minimum enforced.');
    check(http($session, array_replace($password, ['current_password' => 'wrong']))['status'] === 422, 'Current password verified.');
    $sessions[] = testSession($actor);
    $otherSession = end($sessions);
    $r = http($session, $password);
    check($r['status'] === 200, 'Password updated: ' . $r['raw']);
    check(!str_contains($r['raw'], $password['new_password']), 'Password never returned.');
    check($r['cookie'] !== null, 'Session ID rotated.');
    $session['cookie'] = $r['cookie'];
    $sessions[] = $session;
    check(http($session)['status'] === 200, 'Current session preserved.');
    check(http($otherSession)['status'] === (SystemConfigurationService::value('invalidate_sessions') ? 401 : 200), 'Other sessions follow invalidation policy.');
    check(password_verify($password['new_password'], $repo->findByEmail($emails[2])['password_hash']), 'New password hash persisted.');
    check(http($session, ['email' => $emails[2], 'password' => $oldPassword], true, 'login.php')['status'] === 401, 'Old password cannot sign in.');
    $r = http($session, ['email' => $emails[2], 'password' => $password['new_password']], true, 'login.php');
    check($r['status'] === 200, 'Updated email and password can sign in.');
    if ($r['cookie']) $sessions[] = ['cookie' => $r['cookie']];
    $q = $pdo->prepare('SELECT action FROM audit_logs WHERE user_id = ?'); $q->execute([$actor]);
    check(in_array('account.profile_updated', $q->fetchAll(PDO::FETCH_COLUMN), true), 'Profile changes audited.');
    check(array_column($repo->getRoles($actor), 'name') === ['customer'], 'Customer role unchanged.');
    $incorrectPassword = array_replace($password, ['current_password' => 'incorrect']);
    for ($attempt = 0; $attempt < SystemConfigurationService::value('failed_login_limit'); $attempt++) {
        check(http($sessions[1], $incorrectPassword)['status'] === 422, 'Incorrect password attempt rejected.');
    }
    check(http($sessions[1], $incorrectPassword)['status'] === 429, 'Password confirmation attempts are rate limited.');
    $pdo->prepare("UPDATE users SET status = 'suspended' WHERE id = ?")->execute([$users[1]]);
    check(http($sessions[1])['status'] === 401, 'Suspended account rejected.');
} finally {
    if ($pdo->inTransaction()) $pdo->rollBack();
    foreach ($users as $id) {
        $pdo->prepare('DELETE FROM audit_logs WHERE user_id = ?')->execute([$id]);
        $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
    }
    foreach ($emails as $address) {
        $pdo->prepare('DELETE FROM newsletter_subscriptions WHERE email = ?')->execute([$address]);
        $pdo->prepare("DELETE FROM audit_logs WHERE action = 'auth.login_failed' AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.email')) = ?")->execute([$address]);
    }
    foreach ($sessions as $session) {
        session_id(explode('=', $session['cookie'], 2)[1]); SessionManager::start(); $_SESSION = []; session_destroy();
    }
}
echo "PASS: profile and newsletter persistence, email confirmation, validation, authorization, CSRF, account isolation, password login, session policy and audit logging.\n";

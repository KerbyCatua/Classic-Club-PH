<?php
declare(strict_types=1);
// Run: C:/xampp/php/php.exe tests/system-configuration.php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../app/Database/Connection.php';
require_once __DIR__ . '/../app/Auth/SessionManager.php';
require_once __DIR__ . '/../app/Validation/ValidationException.php';
require_once __DIR__ . '/../app/Validation/AuthValidator.php';
require_once __DIR__ . '/../app/Repositories/UserRepository.php';
require_once __DIR__ . '/../app/Support/AuditLogger.php';
require_once __DIR__ . '/../app/Services/AuthService.php';

use ClassicClub\Auth\SessionManager;
use ClassicClub\Services\SystemConfigurationService as Config;
use ClassicClub\Validation\AuthValidator;
use ClassicClub\Validation\ValidationException;

function check(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
function http(string $path, ?array $session = null, ?array $body = null, bool $csrf = true): array {
    global $base;
    $c = curl_init($base . $path);
    $headers = ['Accept: application/json'];
    if ($session) $headers[] = 'Cookie: ' . $session['cookie'];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
        if ($csrf && $session) $headers[] = 'X-CSRF-Token: ' . $session['token'];
        curl_setopt_array($c, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($body)]);
    }
    curl_setopt_array($c, [CURLOPT_HTTPHEADER => $headers, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20]);
    $raw = curl_exec($c);
    $status = curl_getinfo($c, CURLINFO_RESPONSE_CODE);
    if ($raw === false) throw new RuntimeException(curl_error($c));
    curl_close($c);
    return ['status' => $status, 'json' => json_decode($raw, true), 'raw' => $raw];
}
function testSession(int $id): array {
    session_id('configtest' . bin2hex(random_bytes(12)));
    SessionManager::login($id);
    $session = ['cookie' => session_name() . '=' . session_id(), 'id' => session_id(), 'token' => $_SESSION['csrf_token']];
    session_write_close();
    return $session;
}
$base = $argv[1] ?? 'http://localhost/classic-club-ph';
$service = new Config($pdo);
$original = $pdo->query("SELECT setting_value FROM system_settings WHERE setting_key='global_configuration'")->fetchColumn();
$logStart = (int) $pdo->query('SELECT COALESCE(MAX(id),0) FROM audit_logs')->fetchColumn();
$actor = (int) $pdo->query("SELECT ur.user_id FROM user_roles ur JOIN roles r ON r.id=ur.role_id JOIN users u ON u.id=ur.user_id WHERE r.name='super_admin' AND u.status='active' AND u.deleted_at IS NULL LIMIT 1")->fetchColumn();
$businessAdmin = (int) $pdo->query("SELECT user_id FROM business_users WHERE user_id IS NOT NULL AND can_manage_staff=1 LIMIT 1")->fetchColumn();
check($actor > 0 && $businessAdmin > 0, 'Existing Super Admin and business admin required.');
$sessions = []; $testUser = 0;
$email = 'config-test-' . bin2hex(random_bytes(8)) . '@example.com';
try {
    $repo = new \ClassicClub\Repositories\UserRepository($pdo);
    $testUser = $repo->create($email, password_hash('Configuration123!', PASSWORD_DEFAULT), 'Config', 'Test');
    $repo->assignRole($testUser, 'customer');
    $admin = $sessions[] = testSession($actor);
    $customer = $sessions[] = testSession($testUser);
    $business = $sessions[] = testSession($businessAdmin);
    $endpoint = '/public/api/super-admin/configuration.php';
    check(http($endpoint)['status'] === 401, 'Anonymous cannot read settings.');
    check(http($endpoint, $customer)['status'] === 403, 'Customer cannot read settings.');
    check(http($endpoint, $business)['status'] === 403, 'Business admin cannot read settings.');
    check(http($endpoint, $admin, [], false)['status'] === 403, 'CSRF required.');
    $r = http($endpoint, $admin);
    check($r['status'] === 200, 'Super Admin can read: ' . $r['raw']);
    $saved = $r['json']['data'];
    $settings = Config::DEFAULTS;
    $settings['password_min_length'] = 14;
    $settings['report_period'] = 'weekly';
    $body = ['settings' => $settings, 'version' => $saved['version'], 'confirmed' => true];
    check(http($endpoint, $admin, array_replace($body, ['confirmed' => false]))['status'] === 422, 'Confirmation required.');
    $bad = $body; $bad['settings']['password_min_length'] = '14';
    check(http($endpoint, $admin, $bad)['status'] === 422, 'Strict value types.');
    $bad = $body; $bad['settings']['require_mfa'] = true;
    check(http($endpoint, $admin, $bad)['status'] === 422, 'Unsupported MFA configuration rejected.');
    $r = http($endpoint, $admin, $body);
    check($r['status'] === 200, 'Settings save: ' . $r['raw']);
    $saved = $r['json']['data'];
    check(http($endpoint, $admin)['json']['data']['settings'] === $settings, 'Saved values survive separate HTTP requests.');
    check(http($endpoint, $admin, $body)['status'] === 409, 'Stale save rejected.');
    $q = $pdo->prepare("SELECT COUNT(*) FROM audit_logs WHERE id>? AND action='configuration.updated' AND user_id=?");
    $q->execute([$logStart, $actor]); check((int) $q->fetchColumn() === 1, 'Configuration save audited.');
    $validator = new AuthValidator();
    $registration = ['first_name'=>'Test', 'last_name'=>'User', 'email'=>$email, 'password'=>'123456789012', 'password_confirmation'=>'123456789012'];
    try { $validator->registration($registration); throw new LogicException('Expected password-policy rejection.'); } catch (ValidationException) {}
    $registration['password'] = $registration['password_confirmation'] = '12345678901234';
    check($validator->registration($registration)['password'] === '12345678901234', 'Configured password minimum applies.');
    $settings['registration_enabled'] = false;
    $settings['reviews_enabled'] = false;
    $settings['report_exports_enabled'] = false;
    $settings['staff_management_enabled'] = false;
    $settings['failed_login_limit'] = 3;
    $saved = $service->save($settings, $saved['version'], $actor, true);
    check(http('/public/api/auth/register.php', $customer, $registration)['status'] === 409, 'Registration switch enforced.');
    check(http('/public/api/reviews/submit.php', $customer, [])['status'] === 403, 'Review switch enforced.');
    check(http('/public/api/admin/reviews.php', $business, ['action'=>'reply'])['status'] === 403, 'Reply switch enforced.');
    check(http('/public/api/admin/staff.php', $business, ['action'=>'invite'])['status'] === 403, 'Staff switch enforced.');
    check(http('/public/api/admin/reports.php?format=csv', $business)['status'] === 403, 'Export switch enforced.');
    $reports = http('/public/api/admin/reports.php', $business);
    check($reports['status'] === 200 && $reports['json']['data']['period'] === 'weekly', 'Report viewing uses configured default.');
    check(http('/public/api/admin/reports.php?period=yearly', $business)['json']['data']['period'] === 'yearly', 'Explicit report period overrides default.');
    check(http('/public/api/admin/staff.php', $business)['status'] === 200, 'Staff history remains available.');
    $auth = new \ClassicClub\Services\AuthService($repo, new \ClassicClub\Support\AuditLogger($pdo));
    for ($i = 0; $i < 3; $i++) {
        try { $auth->login(['email'=>$email, 'password'=>'wrong']); throw new LogicException('Expected login failure.'); }
        catch (RuntimeException $e) { check($e->getMessage() === 'Invalid email or password.', 'Invalid login counted.'); }
    }
    try { $auth->login(['email'=>$email, 'password'=>'Configuration123!']); throw new LogicException('Expected throttling.'); }
    catch (RuntimeException $e) { check(str_contains($e->getMessage(), 'Too many'), 'Configured failed-login limit enforced.'); }
    // Isolated sessions verify both expiry paths and password invalidation.
    foreach (['idle', 'absolute', 'password'] as $mode) {
        $session = $sessions[] = testSession($testUser);
        session_id($session['id']); SessionManager::start();
        if ($mode === 'idle') $_SESSION['last_activity_at'] = time() - 1801;
        if ($mode === 'absolute') $_SESSION['logged_in_at'] = time() - 43201;
        if ($mode === 'password') $_SESSION['password_fingerprint'] = 'stale';
        session_write_close();
        check(http('/public/api/auth/me.php', $session)['status'] === 401, $mode . ' session expires.');
    }
    $otherSession = $sessions[] = testSession($testUser);
    $currentSession = $sessions[] = testSession($testUser);
    session_id($currentSession['id']); SessionManager::start(); session_write_close();
    require_once __DIR__ . '/../app/Services/AdminBusinessService.php';
    $businessService = new \ClassicClub\Services\AdminBusinessService($pdo);
    try { $businessService->updatePassword($testUser, 'Configuration123!', 'Short123'); throw new LogicException('Expected password-policy rejection.'); }
    catch (RuntimeException $e) { check(str_contains($e->getMessage(), '14'), 'Password changes enforce configured minimum.'); }
    $businessService->updatePassword($testUser, 'Configuration123!', 'NewConfiguration123!');
    check(http('/public/api/auth/me.php', $currentSession)['status'] === 200, 'Password change retains current session.');
    check(http('/public/api/auth/me.php', $otherSession)['status'] === 401, 'Password change invalidates other session.');
    $settings['invalidate_sessions'] = false;
    $saved = $service->save($settings, $saved['version'], $actor, true);
    $session = $sessions[] = testSession($testUser);
    session_id($session['id']); SessionManager::start(); $_SESSION['password_fingerprint'] = 'stale'; session_write_close();
    check(http('/public/api/auth/me.php', $session)['status'] === 200, 'Disabled invalidation honored.');
} finally {
    if ($pdo->inTransaction()) $pdo->rollBack();
    if ($original === false) $pdo->exec("DELETE FROM system_settings WHERE setting_key='global_configuration'");
    else { $q=$pdo->prepare("UPDATE system_settings SET setting_value=? WHERE setting_key='global_configuration'"); $q->execute([$original]); }
    $q=$pdo->prepare("DELETE FROM audit_logs WHERE id>? AND (action='configuration.updated' OR user_id=? OR (action='auth.login_failed' AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.email'))=?))");
    $q->execute([$logStart,$testUser,$email]);
    if ($testUser) { $q=$pdo->prepare('DELETE FROM users WHERE id=?'); $q->execute([$testUser]); }
    foreach ($sessions as $session) { session_id($session['id']); SessionManager::start(); $_SESSION=[]; session_destroy(); }
}
echo "PASS: settings persistence, validation, confirmation, conflicts, audit, roles, CSRF, registration, password policy, login limits, feature gates and session policies.\n";

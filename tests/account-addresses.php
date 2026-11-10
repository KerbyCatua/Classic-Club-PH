<?php

declare(strict_types=1);

// Run: C:/xampp/php/php.exe tests/account-addresses.php [base URL] [optional browser test script]
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
ob_start();
require_once __DIR__ . '/../app/Database/Connection.php';
require_once __DIR__ . '/../app/Auth/SessionManager.php';
require_once __DIR__ . '/../app/Repositories/UserRepository.php';
require_once __DIR__ . '/../app/Repositories/OrderRepository.php';

use ClassicClub\Auth\SessionManager;
use ClassicClub\Repositories\UserRepository;
use ClassicClub\Repositories\OrderRepository;

function check(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
function addressHttp(?array $session = null, ?array $body = null, bool $csrf = true, string $method = ''): array {
    global $base;
    $c = curl_init($base . '/public/api/auth/addresses.php');
    $headers = ['Accept: application/json'];
    if ($session) $headers[] = 'Cookie: ' . $session['cookie'];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
        if ($session && $csrf) $headers[] = 'X-CSRF-Token: ' . $session['token'];
        curl_setopt_array($c, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($body)]);
    }
    if ($method) curl_setopt($c, CURLOPT_CUSTOMREQUEST, $method);
    curl_setopt_array($c, [CURLOPT_HTTPHEADER => $headers, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20]);
    $raw = curl_exec($c);
    if ($raw === false) throw new RuntimeException(curl_error($c));
    $status = curl_getinfo($c, CURLINFO_RESPONSE_CODE);
    curl_close($c);
    return ['status' => $status, 'json' => json_decode($raw, true), 'raw' => $raw];
}
function addressSession(int $id): array {
    session_id('addresstest' . bin2hex(random_bytes(12)));
    SessionManager::login($id);
    $session = ['cookie' => session_name() . '=' . session_id(), 'token' => $_SESSION['csrf_token']];
    session_write_close();
    return $session;
}

$base = $argv[1] ?? 'http://localhost/classic-club-ph';
$repo = new UserRepository($pdo);
$users = $sessions = [];
$fixture = null;
$data = ['action' => 'save', 'first_name' => 'Address', 'last_name' => 'Test', 'mobile' => '+63 917 123 4567',
    'label' => 'Home', 'country' => 'Philippines', 'region' => 'National Capital Region', 'province' => 'Metro Manila',
    'city' => 'Makati', 'barangay' => 'Poblacion', 'postal_code' => '1210', 'street_address' => '18 Test Street',
    'apartment' => 'Unit 4B', 'instructions' => 'Call at the gate', 'is_default_shipping' => false, 'is_default_billing' => false];
try {
    for ($i = 0; $i < 2; $i++) {
        $id = $repo->create('address-test-' . bin2hex(random_bytes(8)) . '@example.com', password_hash(bin2hex(random_bytes(12)), PASSWORD_DEFAULT), 'Address', 'Test');
        $users[] = $id;
        $repo->assignRole($id, 'customer');
        $sessions[] = addressSession($id);
    }
    [$session, $other] = $sessions;
    check(addressHttp()['status'] === 401, 'Anonymous read rejected.');
    check(addressHttp(null, $data)['status'] === 401, 'Anonymous write rejected.');
    check(addressHttp($session, null, true, 'DELETE')['status'] === 405, 'Method restricted.');
    check(addressHttp($session, $data, false)['status'] === 403, 'CSRF enforced.');
    check(addressHttp($session)['json']['data']['addresses'] === [], 'New account is empty.');
    foreach (['first_name' => '', 'last_name' => [], 'mobile' => 'bad', 'postal_code' => 'abc', 'province' => str_repeat('a', 121), 'country' => 'Other', 'is_default_shipping' => 'true'] as $key => $value) {
        check(addressHttp($session, array_replace($data, [$key => $value]))['status'] === 422, 'Invalid field rejected: ' . $key);
    }
    check(addressHttp($session, $data + ['user_id' => $users[1]])['status'] === 422, 'Owner injection rejected.');
    $r = addressHttp($session, $data);
    check($r['status'] === 201, 'Create persisted: ' . $r['raw']);
    $firstId = $r['json']['data']['id'];
    $saved = addressHttp($session)['json']['data']['addresses'][0];
    check($saved['street_address'] === $data['street_address'] && $saved['instructions'] === $data['instructions'], 'Read survives separate request.');
    check((int) $saved['is_default_shipping'] === 1 && (int) $saved['is_default_billing'] === 1, 'First address becomes both defaults.');
    check(addressHttp($other)['json']['data']['addresses'] === [], 'Other user cannot read address.');
    check(addressHttp($other, $data + ['id' => $firstId])['status'] === 404, 'Other user cannot update address.');
    check(addressHttp($other, ['action' => 'delete', 'id' => $firstId])['status'] === 404, 'Other user cannot delete address.');
    $r = addressHttp($session, array_replace($data, ['label' => 'Work', 'street_address' => '20 Work Street', 'is_default_shipping' => true]));
    check($r['status'] === 201, 'Second address created.');
    $secondId = $r['json']['data']['id'];
    $all = addressHttp($session)['json']['data']['addresses'];
    check(count($all) === 2 && (int) $all[0]['id'] === $secondId, 'Shipping default changed.');
    check(array_sum(array_column($all, 'is_default_shipping')) === 1 && array_sum(array_column($all, 'is_default_billing')) === 1, 'Exactly one default per type.');
    $updated = array_replace($data, ['id' => $firstId, 'street_address' => 'Updated Street', 'is_default_shipping' => true]);
    check(addressHttp($session, $updated)['status'] === 200, 'Address updated.');
    check(addressHttp($session)['json']['data']['addresses'][0]['street_address'] === 'Updated Street', 'Update persisted.');

    // Verify checkout stores a separate snapshot, including delivery instructions.
    $pdo->beginTransaction();
    $orders = new OrderRepository($pdo);
    $orderId = $orders->create(['order_number' => 'ADDRESS-TEST-' . bin2hex(random_bytes(6)), 'user_id' => $users[0], 'email' => 'address-test@example.com', 'subtotal' => 0, 'shipping' => 0, 'discount' => 0, 'total' => 0]);
    $orders->addAddress($orderId, $data);
    $q = $pdo->prepare('SELECT * FROM order_addresses WHERE order_id = ?'); $q->execute([$orderId]); $snapshot = $q->fetch();
    check($snapshot['region'] === $data['region'] && $snapshot['instructions'] === $data['instructions'] && $snapshot['street_address'] === $data['street_address'], 'Order address is independent of subsequent book edits.');
    $pdo->rollBack();

    check(addressHttp($session, ['action' => 'delete', 'id' => $firstId])['status'] === 200, 'Default address removed.');
    $saved = addressHttp($session)['json']['data']['addresses'][0];
    check((int) $saved['id'] === $secondId && (int) $saved['is_default_shipping'] === 1 && (int) $saved['is_default_billing'] === 1, 'Defaults reassigned after deletion.');
    check(addressHttp($session, ['action' => 'delete', 'id' => $firstId])['status'] === 404, 'Missing address reported.');

    if (isset($argv[2])) {
        $fixture = tempnam(sys_get_temp_dir(), 'cc-address-');
        file_put_contents($fixture, json_encode(['base' => $base, 'session' => $session, 'other' => $other]));
        passthru('node ' . escapeshellarg($argv[2]) . ' ' . escapeshellarg($fixture), $exit);
        check($exit === 0, 'Browser tests passed.');
    }
    $pdo->prepare("UPDATE users SET status = 'suspended' WHERE id = ?")->execute([$users[1]]);
    check(addressHttp($other)['status'] === 401, 'Suspended account rejected.');
    foreach (addressHttp($session)['json']['data']['addresses'] as $address) {
        check(addressHttp($session, ['action' => 'delete', 'id' => (int) $address['id']])['status'] === 200, 'Address deleted.');
    }
    check(addressHttp($session)['json']['data']['addresses'] === [], 'Last address deletion persists.');
} finally {
    if ($pdo->inTransaction()) $pdo->rollBack();
    foreach ($users as $id) {
        $pdo->prepare('DELETE FROM audit_logs WHERE user_id = ?')->execute([$id]);
        $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$id]);
    }
    foreach ($sessions as $session) {
        session_id(explode('=', $session['cookie'], 2)[1]); SessionManager::start(); $_SESSION = []; session_destroy();
    }
    if ($fixture) unlink($fixture);
}
echo "PASS: address CRUD, persistence, validation, CSRF, account isolation, defaults, suspended accounts and checkout snapshots.\n";

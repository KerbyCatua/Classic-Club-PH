<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
ob_start();

// Real database behavior, with all test data rolled back.
require_once __DIR__ . '/../app/Database/Connection.php';
require_once __DIR__ . '/../app/Repositories/UserRepository.php';
require_once __DIR__ . '/../app/Repositories/WishlistRepository.php';
require_once __DIR__ . '/../app/Services/WishlistService.php';
require_once __DIR__ . '/../app/Auth/SessionManager.php';

use ClassicClub\Repositories\UserRepository;
use ClassicClub\Repositories\WishlistRepository;
use ClassicClub\Services\WishlistService;

function check(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$pdo->beginTransaction();
try {
    $userId = (new UserRepository($pdo))->create('wishlist-test-' . bin2hex(random_bytes(8)) . '@example.test', 'test-only', 'Wishlist', 'Test');
    $repository = new WishlistRepository($pdo);
    $service = new WishlistService($repository);
    $keys = $pdo->query("SELECT catalog_key FROM product_variants WHERE availability_status = 'active' LIMIT 8")->fetchAll(PDO::FETCH_COLUMN);
    check(count($keys) === 8, 'Eight active products required');
    foreach ($keys as $key) $service->toggle($userId, $key, true);
    check(count($service->view($userId)['items']) === 8, 'Save eight');
    $service->toggle($userId, $keys[0], false);
    $service->toggle($userId, $keys[0], false);
    check(count($service->view($userId)['items']) === 7, 'Repeated removal must not restore');
    foreach ($keys as $key) $service->toggle($userId, $key, false);
    check($service->view($userId)['items'] === [], 'Remove all');
    $service->toggle($userId, $keys[0], true);
    $service->toggle($userId, $keys[0], true);
    check(count($service->view($userId)['items']) === 1, 'Repeated add must not duplicate or remove');
    $fresh = new WishlistService(new WishlistRepository($pdo));
    check(count($fresh->view($userId)['items']) === 1, 'State survives service recreation');
    check($fresh->toggle($userId, $keys[0])['saved'] === false, 'Legacy toggle removes');
    check($fresh->toggle($userId, $keys[0])['saved'] === true, 'Legacy toggle adds');
    $variantId = $repository->variantId($keys[0]);
    $pdo->prepare("UPDATE product_variants SET availability_status = 'archived' WHERE id = ?")->execute([$variantId]);
    $fresh->toggle($userId, $keys[0], false);
    check($fresh->view($userId)['items'] === [], 'Inactive products can still be removed');
    check($fresh->toggle($userId, 'nonexistent-test-product', false)['items'] === [], 'Removing a missing product is idempotent');
    echo "PASS: database add/remove, empty state, retries, deduplication, persistence, legacy toggle and inactive/missing removal\n";
} finally {
    $pdo->rollBack();
}

// Exercise the actual HTTP endpoint with an isolated temporary user/session.
$userId = (new UserRepository($pdo))->create('wishlist-http-' . bin2hex(random_bytes(8)) . '@example.test', 'test-only', 'Wishlist', 'Test');
$sessionId = null;
try {
    session_id('wishlisttest' . bin2hex(random_bytes(16)));
    \ClassicClub\Auth\SessionManager::login($userId);
    $sessionId = session_id();
    $cookie = session_name() . '=' . $sessionId;
    $token = $_SESSION['csrf_token'];
    session_write_close();
    $request = static function (string $endpoint, ?array $body = null, bool $csrf = true) use ($cookie, $token): array {
        $base = rtrim(getenv('CC_TEST_URL') ?: 'http://localhost/classic-club-ph', '/');
        $curl = curl_init($base . '/public/api/wishlist/' . $endpoint . '.php');
        $headers = ['Accept: application/json', 'Content-Type: application/json', 'Cookie: ' . $cookie];
        if ($body !== null) {
            if ($csrf) $headers[] = 'X-CSRF-Token: ' . $token;
            curl_setopt($curl, CURLOPT_POST, true);
            curl_setopt($curl, CURLOPT_POSTFIELDS, json_encode($body));
        }
        curl_setopt_array($curl, [CURLOPT_HTTPHEADER => $headers, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20]);
        $raw = curl_exec($curl);
        $status = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        curl_close($curl);
        return ['status' => $status, 'json' => json_decode((string) $raw, true)];
    };
    check($request('toggle', ['catalog_key' => $keys[0], 'saved' => true], false)['status'] === 403, 'CSRF required');
    check($request('toggle', ['catalog_key' => $keys[0], 'saved' => 'false'])['status'] === 422, 'Boolean state required');
    foreach ($keys as $key) {
        check($request('toggle', ['catalog_key' => $key, 'saved' => true])['status'] === 200, 'HTTP save');
    }
    check(count($request('view')['json']['data']['items']) === 8, 'HTTP list persists eight');
    foreach ($keys as $key) {
        check($request('toggle', ['catalog_key' => $key, 'saved' => false])['status'] === 200, 'HTTP remove');
    }
    check($request('view')['json']['data']['items'] === [], 'HTTP empty wishlist persists');
    $request('toggle', ['catalog_key' => $keys[0], 'saved' => false]);
    check($request('view')['json']['data']['items'] === [], 'HTTP retry cannot restore deletion');
    $request('toggle', ['catalog_key' => $keys[0], 'saved' => true]);
    $request('toggle', ['catalog_key' => $keys[0], 'saved' => true]);
    check(count($request('view')['json']['data']['items']) === 1, 'HTTP repeated add stays unique');
    echo "PASS: live HTTP persistence, empty state, idempotent retries, boolean validation and CSRF\n";
} finally {
    if ($sessionId !== null) {
        session_id($sessionId);
        \ClassicClub\Auth\SessionManager::start();
        $_SESSION = [];
        session_destroy();
    }
    $pdo->prepare('DELETE FROM users WHERE id = ?')->execute([$userId]);
}
ob_end_flush();

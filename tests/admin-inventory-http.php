<?php
declare(strict_types=1);

// C:/xampp/php/php.exe tests/admin-inventory-http.php [http://localhost/classic-club-ph]
// Uses an isolated session and one temporary movement. Never changes product stock.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../app/Database/Connection.php';
require_once __DIR__ . '/../app/Auth/SessionManager.php';
require_once __DIR__ . '/../app/Services/AdminBusinessService.php';
use ClassicClub\Auth\SessionManager;
use ClassicClub\Services\AdminBusinessService;

function checkInventoryHttp(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}
$base = $argv[1] ?? 'http://localhost/classic-club-ph';
$actor = (int)$pdo->query("SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE r.name IN ('admin', 'super_admin') AND u.status = 'active' AND u.deleted_at IS NULL LIMIT 1")->fetchColumn();
checkInventoryHttp($actor > 0, 'An active administrator is required.');
$service = new AdminBusinessService($pdo);
$auth = $service->authorizeAdmin($actor);
session_id('inventorytest' . bin2hex(random_bytes(16)));
SessionManager::start();
$_SESSION = ['user_id' => $actor, 'csrf_token' => bin2hex(random_bytes(32)), 'logged_in_at' => time(), 'last_activity_at' => time()];
$testSession = ['cookie' => session_name() . '=' . session_id(), 'token' => $_SESSION['csrf_token'], 'id' => session_id()];
session_write_close();

function inventoryRequest(string $endpoint, ?array $body = null, bool $authenticated = true, bool $csrf = true, ?string $method = null): array {
    global $base, $testSession;
    $handle = curl_init($base . '/public/api/admin/' . $endpoint);
    $headers = ['Accept: application/json'];
    if ($authenticated) $headers[] = 'Cookie: ' . $testSession['cookie'];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
        if ($csrf) $headers[] = 'X-CSRF-Token: ' . $testSession['token'];
        curl_setopt($handle, CURLOPT_POSTFIELDS, json_encode($body));
    }
    curl_setopt_array($handle, [CURLOPT_HTTPHEADER => $headers, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 15, CURLOPT_CUSTOMREQUEST => $method ?? ($body === null ? 'GET' : 'POST')]);
    $raw = curl_exec($handle);
    $status = curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $error = curl_error($handle);
    curl_close($handle);
    if ($raw === false) throw new RuntimeException($error);
    return ['status' => $status, 'json' => json_decode($raw, true), 'raw' => $raw];
}
$movementId = 0;
try {
    foreach (['inventory.php', 'movements.php'] as $endpoint) {
        checkInventoryHttp(inventoryRequest($endpoint, null, false)['status'] === 401, 'Anonymous requests are rejected.');
        checkInventoryHttp(inventoryRequest($endpoint, [], true, false)['status'] === 403, 'CSRF is required.');
        checkInventoryHttp(inventoryRequest($endpoint, null, true, true, 'DELETE')['status'] === 405, 'Unsupported methods are rejected.');
        checkInventoryHttp(inventoryRequest($endpoint)['status'] === 200, 'Authenticated list loads.');
    }
    foreach ([1.5, '1.5', true, null, -1, 2147483648] as $quantity) {
        $response = inventoryRequest('inventory.php', ['action' => 'restock', 'product_id' => 0, 'quantity' => $quantity]);
        checkInventoryHttp($response['status'] === 422, 'Invalid quantity rejected before any stock mutation: ' . $response['raw']);
    }
    checkInventoryHttp(inventoryRequest('inventory.php', ['action' => 'adjust', 'quantity' => 1, 'reason' => str_repeat('x', 256)])['status'] === 422, 'Oversized reason rejected.');
    checkInventoryHttp(inventoryRequest('movements.php', ['movement_id' => 0])['status'] === 422, 'Invalid movement ID rejected.');
    checkInventoryHttp(inventoryRequest('movements.php', ['movement_id' => PHP_INT_MAX])['status'] === 404, 'Missing movement rejected.');

    $marker = 'Inventory-HTTP-' . bin2hex(random_bytes(8));
    $stmt = $pdo->prepare("INSERT INTO inventory_movements (variant_size_id, product_id, quantity_delta, movement_type, reason, created_by) SELECT vs.id, p.id, 0, 'adjustment', ?, ? FROM products p JOIN product_variants pv ON pv.product_id = p.id JOIN variant_sizes vs ON vs.variant_id = pv.id WHERE p.business_id = ? LIMIT 1");
    $stmt->execute([$marker, $actor, $auth['business_id']]);
    $movementId = (int)$pdo->lastInsertId();
    checkInventoryHttp($movementId > 0, 'A seeded product is required.');
    $endpoint = 'movements.php?search=' . rawurlencode($marker);
    checkInventoryHttp(count(inventoryRequest($endpoint)['json']['data']['movements']) === 1, 'Unread fixture is visible.');
    for ($i = 0; $i < 2; $i++) {
        $response = inventoryRequest('movements.php', ['movement_id' => $movementId]);
        checkInventoryHttp($response['status'] === 200 && $response['json']['data']['is_read'] === true, 'Confirmation and duplicate confirmation succeed.');
    }
    checkInventoryHttp(inventoryRequest($endpoint)['json']['data']['movements'] === [], 'Read receipt survives another HTTP request.');
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM inventory_movements WHERE id = ?');
    $stmt->execute([$movementId]);
    checkInventoryHttp((int)$stmt->fetchColumn() === 1, 'Confirmation retains the audit record.');
} finally {
    if ($movementId) $pdo->prepare('DELETE FROM inventory_movements WHERE id = ?')->execute([$movementId]);
    session_id($testSession['id']);
    SessionManager::start();
    $_SESSION = [];
    session_destroy();
}
echo "PASS: live HTTP authentication, CSRF, method/quantity/reason validation, mark-read persistence and audit retention. Temporary fixture/session removed.\n";

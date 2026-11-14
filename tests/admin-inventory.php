<?php
declare(strict_types=1);

// Run after migration 019: C:/xampp/php/php.exe tests/admin-inventory.php
// Exercise real stock operations under an outer rollback, including their internal transactions.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../app/Services/AdminBusinessService.php';
use ClassicClub\Services\AdminBusinessService;

final class InventoryTestConnection extends PDO
{
    public function beginTest(): void { parent::beginTransaction(); }
    public function endTest(): void { parent::rollBack(); }
    public function beginTransaction(): bool { $this->exec('SAVEPOINT inventory_test_action'); return true; }
    public function commit(): bool { $this->exec('RELEASE SAVEPOINT inventory_test_action'); return true; }
    public function rollBack(): bool { $this->exec('ROLLBACK TO SAVEPOINT inventory_test_action'); return true; }
}
function checkInventory(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}
function rejectsInventory(callable $action): void {
    try { $action(); } catch (RuntimeException $error) { return; }
    throw new RuntimeException('Expected invalid stock action to be rejected.');
}
$config = require __DIR__ . '/../app/Config/database.php';
$pdo = new InventoryTestConnection(
    "mysql:host={$config['host']};port={$config['port']};dbname={$config['database']};charset={$config['charset']}",
    $config['username'], $config['password'],
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]
);
$pdo->beginTest();
try {
    $service = new AdminBusinessService($pdo);
    $fixture = $pdo->query('SELECT p.id, p.business_id, MIN(vs.id) AS size_id FROM products p JOIN product_variants pv ON pv.product_id = p.id JOIN variant_sizes vs ON vs.variant_id = pv.id WHERE p.business_id IS NOT NULL GROUP BY p.id HAVING COUNT(vs.id) > 1 LIMIT 1')->fetch();
    $users = $pdo->query('SELECT id FROM users ORDER BY id LIMIT 2')->fetchAll(PDO::FETCH_COLUMN);
    checkInventory((bool)$fixture && count($users) === 2, 'Requires a seeded product with multiple sizes and two users.');
    $id = (int)$fixture['id'];
    $business = (int)$fixture['business_id'];
    $user = (int)$users[0];
    $marker = 'Inventory-test-' . bin2hex(random_bytes(8));
    $pdo->prepare('UPDATE products SET name = ?, min_stock_threshold = 0, is_active = 1 WHERE id = ?')->execute([$marker, $id]);
    $read = fn() => $service->getInventory($business, ['search' => $marker, 'admin' => $marker]);
    $checkStock = function (int $expected) use ($pdo, $id, $read): void {
        $data = $read();
        checkInventory(count($data['products']) === 1, 'Product remains available to Inventory.');
        checkInventory((int)$data['products'][0]['stock_qty'] === $expected, 'Product stock equals expected total.');
        checkInventory((int)$data['products'][0]['min_stock_threshold'] === 0, 'Zero threshold retained.');
        checkInventory($data['summary']['total_physical_stock'] === $expected, 'Physical total matches.');
        checkInventory($data['summary']['total_available_stock'] === $expected, 'Active available total matches.');
        checkInventory($data['summary']['low_stock_count'] === 0, 'Zero threshold is not replaced by ten.');
        checkInventory($data['summary']['out_of_stock_count'] === ($expected === 0 ? 1 : 0), 'Out-of-stock count matches.');
        $stmt = $pdo->prepare('SELECT MIN(vs.quantity_on_hand) FROM variant_sizes vs JOIN product_variants pv ON pv.id = vs.variant_id WHERE pv.product_id = ?');
        $stmt->execute([$id]);
        checkInventory((int)$stmt->fetchColumn() >= 0, 'No size bucket goes negative.');
    };
    $expected = (int)$read()['products'][0]['stock_qty'];
    foreach ([['restock', 5], ['increase', 3], ['decrease', 4], ['set', 0], ['set', 11]] as [$type, $quantity]) {
        $before = $expected;
        $result = $type === 'restock'
            ? $service->restockProduct($business, $id, $quantity, $marker, $user, $marker)
            : $service->adjustStock($business, $id, $type, $quantity, $marker, $user, $marker);
        $expected = $type === 'set' ? $quantity : $before + ($type === 'decrease' ? -$quantity : $quantity);
        checkInventory($result['previous_quantity'] === $before && $result['new_quantity'] === $expected, 'Returned transition is correct.');
        $checkStock($expected);
        $latest = $service->getMovements($business, ['search' => $marker, 'admin' => $marker])[0];
        checkInventory((int)$latest['previous_quantity'] === $before && (int)$latest['new_quantity'] === $expected, 'History records correct transition.');
        checkInventory((int)$latest['quantity_delta'] === $expected - $before, 'History delta reconciles.');
    }
    $beforeInvalid = count($service->getMovements($business, ['search' => $marker, 'admin' => $marker]));
    rejectsInventory(fn() => $service->restockProduct($business, $id, 0, $marker, $user, 'Test'));
    rejectsInventory(fn() => $service->restockProduct(0, $id, 5, $marker, $user, 'Test'));
    rejectsInventory(fn() => $service->adjustStock($business, $id, 'decrease', 12, $marker, $user, 'Test'));
    rejectsInventory(fn() => $service->adjustStock($business, $id, 'set', -1, $marker, $user, 'Test'));
    rejectsInventory(fn() => $service->adjustStock($business, $id, 'increase', 0, $marker, $user, 'Test'));
    rejectsInventory(fn() => $service->adjustStock($business, $id, 'unknown', 1, $marker, $user, 'Test'));
    rejectsInventory(fn() => $service->adjustStock($business, $id, 'set', 1, '  ', $user, 'Test'));
    $checkStock(11);
    checkInventory(count($service->getMovements($business, ['search' => $marker, 'admin' => $marker])) === $beforeInvalid, 'Rejected changes leave history untouched.');
    $pdo->prepare('UPDATE products SET is_active = 0 WHERE id = ?')->execute([$id]);
    checkInventory($read()['summary']['total_available_stock'] === 0 && $read()['summary']['total_physical_stock'] === 11, 'Inactive stock remains physical but is not purchasable.');

    $restocks = $service->getMovements($business, ['search' => $marker, 'admin' => $marker, 'movement' => 'restock'], $user);
    checkInventory(count($restocks) === 1, 'Restock filter works.');
    checkInventory(count($service->getMovements($business, ['search' => $marker, 'admin' => $marker, 'movement' => 'adjustment'], $user)) === 4, 'Adjustment filter works.');
    $movement = (int)$restocks[0]['id'];
    checkInventory(!$service->markMovementRead(0, $user, $movement), 'Other businesses cannot mark the movement.');
    checkInventory(!$service->markMovementRead($business, $user, 0), 'Missing movement rejected.');
    checkInventory($service->markMovementRead($business, $user, $movement), 'Confirmation persists read receipt.');
    checkInventory($service->markMovementRead($business, $user, $movement), 'Repeated confirmation is idempotent.');
    $reloaded = new AdminBusinessService($pdo);
    checkInventory(count($reloaded->getMovements($business, ['search' => $marker, 'admin' => $marker], $user)) === 4, 'Read receipt survives a new service instance.');
    checkInventory(count($reloaded->getMovements($business, ['search' => $marker, 'admin' => $marker], (int)$users[1])) === 5, 'Other administrators retain their list.');
    checkInventory(count($reloaded->getMovements($business, ['search' => $marker, 'admin' => $marker])) === 5, 'Original movement history is preserved.');

    // Legacy rows derive ownership from their variant; they must never leak across businesses.
    $stmt = $pdo->prepare("INSERT INTO inventory_movements (variant_size_id, quantity_delta, movement_type, admin_name, reason) VALUES (?, 1, 'receipt', ?, ?)");
    for ($i = 0; $i < 55; $i++) $stmt->execute([$fixture['size_id'], $marker, $marker]);
    $legacyId = (int)$pdo->lastInsertId();
    checkInventory(count($service->getMovements($business, ['search' => $marker, 'admin' => $marker], $user)) === 59, 'Scrollable list includes records beyond the previous 50-row cap.');
    checkInventory($service->getMovements(0, ['search' => $marker, 'admin' => $marker], $user) === [], 'Legacy movement ownership is isolated.');
    checkInventory(!$service->markMovementRead(0, $user, $legacyId), 'Legacy receipt is also business scoped.');
    checkInventory($service->markMovementRead($business, $user, $legacyId), 'Owned legacy movement can be marked.');
    echo "PASS: restock, increase/decrease/set, zero stock, size totals, summaries, validation/rollback, movement filters, read persistence, isolation and complete history. Test changes rolled back.\n";
} finally {
    $pdo->endTest();
}

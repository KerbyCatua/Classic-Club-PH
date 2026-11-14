<?php
declare(strict_types=1);

// C:/xampp/php/php.exe tests/admin-products.php
// Exercise the real service under one outer rollback; only test-created images are removed.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../app/Services/AdminBusinessService.php';
use ClassicClub\Services\AdminBusinessService;

final class ProductTestConnection extends PDO
{
    public function beginTest(): void { parent::beginTransaction(); }
    public function endTest(): void { parent::rollBack(); }
    public function beginTransaction(): bool { $this->exec('SAVEPOINT product_test_action'); return true; }
    public function commit(): bool { $this->exec('RELEASE SAVEPOINT product_test_action'); return true; }
    public function rollBack(): bool { $this->exec('ROLLBACK TO SAVEPOINT product_test_action'); return true; }
}
function checkProduct(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}
function rejectsProduct(callable $action, string $message): void {
    try { $action(); } catch (RuntimeException $error) {
        checkProduct(str_contains($error->getMessage(), $message), $error->getMessage());
        return;
    }
    throw new RuntimeException('Expected rejection: ' . $message);
}
$config = require __DIR__ . '/../app/Config/database.php';
$pdo = new ProductTestConnection(
    "mysql:host={$config['host']};port={$config['port']};dbname={$config['database']};charset={$config['charset']}",
    $config['username'], $config['password'],
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]
);
$images = [];
$pdo->beginTest();
try {
    $service = new AdminBusinessService($pdo);
    $business = (int)$pdo->query('SELECT id FROM businesses LIMIT 1')->fetchColumn();
    $user = (int)$pdo->query('SELECT id FROM users LIMIT 1')->fetchColumn();
    $category = (int)$pdo->query('SELECT id FROM categories WHERE is_active = 1 LIMIT 1')->fetchColumn();
    checkProduct($business > 0 && $user > 0 && $category > 0, 'A seeded database is required.');
    $marker = 'Product-test-' . bin2hex(random_bytes(8));
    $png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=');
    $data = ['name' => $marker, 'sku' => $marker, 'category_id' => $category, 'price' => 1200.50,
        'initial_stock' => 20, 'min_stock_threshold' => 10, 'is_active' => 1, 'description' => 'Test description',
        'image' => 'data:image/png;base64,' . base64_encode($png)];
    $id = $service->createProduct($business, $data, $user, 'Product Test')['product_id'];
    $read = function () use ($service, $business, $marker, $id): array {
        $products = $service->getProducts($business, ['search' => $marker]);
        $matches = array_values(array_filter($products, fn($p) => (int)$p['id'] === $id));
        checkProduct(count($matches) === 1, 'Created product can be read by SKU.');
        return $matches[0];
    };
    $created = $read();
    $images[] = $created['image_url'];
    checkProduct((int)$created['stock_qty'] === 20 && (int)$created['is_active'] === 1, 'Create stores stock and availability.');
    checkProduct((float)$created['price'] === 1200.50, 'Create stores decimal price.');
    rejectsProduct(fn() => $service->createProduct($business, $data, $user, 'Product Test'), 'SKU');
    rejectsProduct(fn() => $service->createProduct($business, [...$data, 'price' => -1], $user, 'Product Test'), 'greater than zero');
    rejectsProduct(fn() => $service->updateProduct($business, $id, [...$data, 'image' => null], $user, 'Product Test'), 'image is required');
    rejectsProduct(fn() => $service->updateProduct(0, $id, $data, $user, 'Product Test'), 'not found');

    $service->updateProduct($business, $id, [...$data, 'name' => $marker . ' edited', 'price' => 1890.75, 'min_stock_threshold' => 0], $user, 'Product Test');
    $edited = $read();
    $images[] = $edited['image_url'];
    checkProduct((float)$edited['price'] === 1890.75 && (int)$edited['min_stock_threshold'] === 0, 'Edit persists price and a zero threshold.');
    checkProduct((int)$edited['stock_qty'] === 20, 'Edit preserves stock.');
    checkProduct($edited['image_url'] !== $created['image_url'], 'Edit persists the uploaded image.');

    foreach (['deactivate' => [0, 'draft'], 'activate' => [1, 'active'], 'archive' => [0, 'archived']] as $action => [$active, $status]) {
        $service->setProductStatus($business, $id, $action, $user, 'Product Test');
        $saved = $read();
        checkProduct((int)$saved['is_active'] === $active && $saved['availability_status'] === $status, "$action persists status.");
        checkProduct((int)$saved['stock_qty'] === 20, "$action retains stock.");
    }
    $service->setProductStatus($business, $id, 'activate', $user, 'Product Test');
    checkProduct($read()['availability_status'] === 'active', 'Archived product can be activated again.');
    rejectsProduct(fn() => $service->setProductStatus(0, $id, 'archive', $user, 'Product Test'), 'not found');
    // Audit records use entity_type as the affected resource in this schema.
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM audit_logs WHERE entity_type LIKE ?');
    $stmt->execute([$marker . '%']);
    checkProduct((int)$stmt->fetchColumn() === 6, 'Create, edit and status changes are audited.');
    echo "PASS: real product create/edit/activate/deactivate/archive, retained stock, image storage, validation, business isolation and audit logs. All database changes rolled back.\n";
} finally {
    $pdo->endTest();
    $root = realpath(__DIR__ . '/../public/uploads/products');
    foreach (array_unique($images) as $imagePath) {
        $path = realpath(__DIR__ . '/../' . $imagePath);
        if ($root && $path && dirname($path) === $root) unlink($path);
    }
}

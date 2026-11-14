<?php
declare(strict_types=1);

// CLI-only fixtures for review-replies.cjs. Existing reviews are never changed.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../app/Database/Connection.php';
require_once __DIR__ . '/../app/Auth/SessionManager.php';
require_once __DIR__ . '/../app/Services/AdminBusinessService.php';

use ClassicClub\Auth\SessionManager;
use ClassicClub\Services\AdminBusinessService;

$mode = $argv[1] ?? '';
$state = json_decode(stream_get_contents(STDIN), true) ?? [];
if ($mode === 'setup') {
    $actor = (int)$pdo->query("SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE r.name IN ('admin', 'super_admin') AND u.status = 'active' AND u.deleted_at IS NULL ORDER BY u.id LIMIT 1")->fetchColumn();
    if (!$actor) throw new RuntimeException('A seeded, active administrator is required.');
    $service = new AdminBusinessService($pdo);
    $auth = $service->authorizeAdmin($actor);
    $variant = $pdo->query("SELECT pv.id, pv.product_id, p.business_id FROM product_variants pv JOIN products p ON p.id = pv.product_id WHERE pv.catalog_key = 'structured-overshirt-graphite'")->fetch();
    if (!$variant || (int)$variant['business_id'] !== (int)$auth['business_id']) throw new RuntimeException('The target product must belong to the test administrator.');
    $other = (int)$pdo->query('SELECT id FROM product_variants WHERE product_id != ' . (int)$variant['product_id'] . ' LIMIT 1')->fetchColumn();
    if (!$other) throw new RuntimeException('A second product is required for isolation checks.');
    $marker = 'ReviewTest' . bin2hex(random_bytes(6));
    $state = ['marker' => $marker, 'reviews' => [], 'orders' => [], 'variant_id' => (int)$variant['id'], 'business_id' => (int)$auth['business_id']];
    $pdo->beginTransaction();
    try {
        $order = $pdo->prepare("INSERT INTO orders (order_number, user_id, status, subtotal, shipping_amount, total_amount) VALUES (?, ?, 'delivered', 1200, 0, 1200)");
        $review = $pdo->prepare("INSERT INTO product_reviews (order_id, user_id, variant_id, rating, title, content, display_name, email, size_purchased, fit_feedback, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'review-test@example.invalid', 'M', 'True to size', ?, ?)");
        // Insert the target last, so it is included in the three-review preview.
        foreach ([8, 7, 6, 5, 4, 3, 2, 1] as $index) {
            $order->execute([$marker . '-' . $index, $actor]);
            $orderId = (int)$pdo->lastInsertId();
            $state['orders'][] = $orderId;
            $review->execute([$orderId, $actor, $index === 6 ? $other : (int)$variant['id'], $index === 2 ? 4 : 5,
                $marker . ' review ' . $index, $index === 3 ? str_repeat('Long feedback with full text available. ', 35) : 'Customer feedback ' . $index,
                $marker . ' customer ' . $index, $index === 7 ? 'hidden' : ($index === 8 ? 'pending' : 'published'), date('Y-m-d H:i:s', time() + 8 - $index)]);
            $state['reviews'][(string)$index] = (int)$pdo->lastInsertId();
        }
        // The service must reject replies outside this business without changing data.
        try {
            $service->replyReview((int)$auth['business_id'] + 100000, $state['reviews']['1'], 'Wrong business', 'Test', $actor);
            throw new LogicException('Cross-business reply was accepted.');
        } catch (RuntimeException $error) {
            if (!str_contains($error->getMessage(), 'not found')) throw $error;
        }
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
    session_id('reviewtest' . bin2hex(random_bytes(16)));
    SessionManager::start();
    $_SESSION = ['user_id' => $actor, 'csrf_token' => bin2hex(random_bytes(32)), 'logged_in_at' => time(), 'last_activity_at' => time()];
    $state['session_id'] = session_id();
    $state['session_name'] = session_name();
    $state['token'] = $_SESSION['csrf_token'];
    session_write_close();
    echo json_encode($state, JSON_THROW_ON_ERROR);
} elseif (in_array($mode, ['inspect', 'cleanup'], true)) {
    $marker = (string)($state['marker'] ?? '');
    if (!preg_match('/^ReviewTest[a-f0-9]{12}$/', $marker)) throw new RuntimeException('Invalid fixture marker.');
    $query = $pdo->prepare('SELECT pr.id, pr.business_reply, pr.business_reply_by, pr.business_replied_at FROM product_reviews pr JOIN orders o ON o.id = pr.order_id WHERE o.order_number LIKE ? ORDER BY pr.id');
    $query->execute([$marker . '-%']);
    if ($mode === 'inspect') {
        echo json_encode($query->fetchAll(), JSON_THROW_ON_ERROR);
    } else {
        $pdo->beginTransaction();
        foreach ($query->fetchAll() as $row) {
            $pdo->prepare("DELETE FROM audit_logs WHERE business_id = ? AND entity_type = ? AND action IN ('Review reply published', 'Review flagged for moderation')")->execute([(int)$state['business_id'], 'Review #' . (int)$row['id']]);
        }
        $pdo->prepare('DELETE FROM orders WHERE order_number LIKE ?')->execute([$marker . '-%']);
        $pdo->commit();
        session_id((string)$state['session_id']);
        SessionManager::start();
        $_SESSION = [];
        session_destroy();
        echo "Temporary review fixtures and session removed.\n";
    }
} else {
    throw new RuntimeException('Use setup, inspect or cleanup.');
}

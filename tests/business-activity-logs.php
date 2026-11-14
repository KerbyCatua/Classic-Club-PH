<?php
declare(strict_types=1);

// Run after migration 018: C:/xampp/php/php.exe tests/business-activity-logs.php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../app/Database/Connection.php';
require_once __DIR__ . '/../app/Services/AdminBusinessService.php';

use ClassicClub\Services\AdminBusinessService;

function checkLog(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}

$pdo->beginTransaction();
try {
    $businessId = (int)$pdo->query('SELECT id FROM businesses LIMIT 1')->fetchColumn();
    $users = $pdo->query('SELECT id FROM users ORDER BY id LIMIT 2')->fetchAll(PDO::FETCH_COLUMN);
    checkLog($businessId > 0 && count($users) === 2, 'Requires a seeded business and two users.');
    $service = new AdminBusinessService($pdo);
    $marker = 'Activity-read-test-' . bin2hex(random_bytes(8));
    $service->logActivity($businessId, 'Test Administrator', $marker, 'Test resource', 'Unchanged audit details', (int)$users[0]);
    $id = (int)$pdo->lastInsertId();
    $filters = ['search' => $marker];
    checkLog(count($service->getActivityLogs($businessId, $filters, (int)$users[0])) === 1, 'Unread record visible.');
    checkLog(!$service->markActivityLogRead(0, (int)$users[0], $id), 'Another business cannot mark the record.');
    checkLog(!$service->markActivityLogRead($businessId, (int)$users[0], 0), 'Missing record rejected.');
    checkLog($service->markActivityLogRead($businessId, (int)$users[0], $id), 'Record marked.');
    checkLog($service->markActivityLogRead($businessId, (int)$users[0], $id), 'Repeated confirmation is idempotent.');
    $reloaded = new AdminBusinessService($pdo);
    checkLog($reloaded->getActivityLogs($businessId, $filters, (int)$users[0]) === [], 'Saved receipt hides the record after reloading.');
    checkLog(count($reloaded->getActivityLogs($businessId, $filters, (int)$users[1])) === 1, 'Other administrators retain their unread record.');
    $audit = $reloaded->getActivityLogs($businessId, $filters);
    checkLog(count($audit) === 1 && $audit[0]['change_details'] === 'Unchanged audit details', 'Audit trail preserved.');
    echo "PASS: activity log persistence, reader/business isolation, duplicate confirmation and audit preservation.\n";
} finally {
    $pdo->rollBack();
}

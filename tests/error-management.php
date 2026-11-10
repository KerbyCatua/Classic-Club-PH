<?php
declare(strict_types=1);
// Run: C:/xampp/php/php.exe tests/error-management.php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../app/Database/Connection.php';
require_once __DIR__ . '/../app/Services/ErrorManagementService.php';

use ClassicClub\Support\ErrorTracker;
use ClassicClub\Services\ErrorManagementService;

function check(bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
}
$service = new ErrorManagementService($pdo);
$actor = (int) $pdo->query("SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.name='super_admin' AND u.status='active' AND u.deleted_at IS NULL LIMIT 1")->fetchColumn();
check($actor > 0, 'An active Super Admin is required for this integration test.');
$id = 0;
$unique = bin2hex(random_bytes(8));
$_SERVER['REQUEST_URI'] = '/classic-club-ph/public/api/test/error-' . $unique . '.php?password=DO_NOT_STORE';
$_SERVER['REQUEST_METHOD'] = 'POST';
$_SERVER['REQUEST_TIME_FLOAT'] = microtime(true) - 0.01;
try {
    $frames = [['file' => __FILE__, 'line' => 23, 'args' => ['password' => 'DO_NOT_STORE']]];
    $id = ErrorTracker::record($pdo, 503, $frames);
    check(ErrorTracker::record($pdo, 503, $frames) === $id, 'Identical failures must group together.');
    $d = $service->detail($id);
    check((int) $d['group']['occurrences'] === 2 && count($d['events']) === 2, 'Occurrences persist.');
    check(!str_contains(json_encode($d), 'DO_NOT_STORE'), 'Query values and stack arguments are excluded.');
    check(!str_contains($d['events'][0]['stack'], 'C:'), 'Machine paths are excluded.');
    $list = $service->listing(['search' => $d['events'][0]['request_id'], 'recurring' => 'Recurring']);
    check($list['total'] === 1, 'Request search and recurrence filters work.');
    check($service->listing(['search' => $unique, 'recurring' => 'Single'])['total'] === 0, 'Single filter excludes recurring groups.');
    $body = ['id' => $id, 'version' => (int) $d['group']['version'], 'severity' => 'Critical', 'state' => 'Resolved', 'reviewer_id' => $actor, 'incident_id' => null, 'reviewed' => true, 'note' => 'Regression test note'];
    $updated = $service->update($actor, $body);
    check($updated['group']['state'] === 'Resolved' && $updated['group']['reviewed_at'] !== null, 'Resolution and review persist.');
    check(count($updated['history']) === 1 && $updated['history'][0]['metadata']['note'] === 'Regression test note', 'Triage is audited.');
    try { $service->update($actor, $body); throw new LogicException('Stale updates must fail.'); }
    catch (RuntimeException $e) { check($e->getCode() === 409, 'Version conflicts return 409.'); }
    ErrorTracker::record($pdo, 503, $frames);
    $reopened = $service->detail($id);
    check($reopened['group']['state'] === 'Unresolved' && $reopened['group']['reviewed_at'] === null && $reopened['group']['severity'] === 'Critical', 'Recurrence reopens and preserves assigned severity.');
    $body['version'] = (int) $reopened['group']['version']; $body['reviewer_id'] = -1;
    try { $service->update($actor, $body); throw new LogicException('Invalid assignment must fail.'); }
    catch (InvalidArgumentException) {}
    foreach ([['date' => '2026-02-31'], ['state' => ['Resolved']], ['page' => -1]] as $bad) {
        try { $service->listing($bad); throw new LogicException('Malformed filters must fail.'); }
        catch (InvalidArgumentException) {}
    }
    check($service->detail($id)['group']['state'] === 'Unresolved', 'Rejected changes leave state intact.');
    for ($i = 0; $i < 24; ++$i) ErrorTracker::record($pdo, 503, $frames);
    $older = $service->detail($id, 2);
    check($older['event_pages'] === 2 && count($older['events']) === 2, 'Request history paginates without dropping older events.');
    $today = (new DateTimeImmutable('now', new DateTimeZone('Asia/Manila')))->format('Y-m-d');
    check($service->listing(['search' => $unique, 'date' => $today, 'severity' => 'Critical', 'state' => 'Unresolved'])['total'] === 1, 'Date, severity and state filters combine.');
    echo "PASS: grouping, persistence, redaction, filters, triage audit, conflict protection, recurrence, pagination and validation\n";
} finally {
    if ($pdo->inTransaction()) $pdo->rollBack();
    if ($id) {
        $q = $pdo->prepare("DELETE FROM audit_logs WHERE entity_type='error_group' AND entity_id=?"); $q->execute([$id]);
        $q = $pdo->prepare('DELETE FROM error_groups WHERE id=?'); $q->execute([$id]);
    }
}

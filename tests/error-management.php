<?php
declare(strict_types=1);
// Run: C:/xampp/php/php.exe tests/error-management.php [tests/error-management.cjs] [base URL]
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
$id = 0; $extraIds = []; $fixture = null; $sessionId = null; $output = [];
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
    $last = $service->detail($id, 999);
    check($last['event_page'] === 2 && count($last['events']) === 2, 'Out-of-range occurrence pages clamp to the last page.');
    $today = (new DateTimeImmutable('now', new DateTimeZone('Asia/Manila')))->format('Y-m-d');
    check($service->listing(['search' => $unique, 'date' => $today, 'severity' => 'Critical', 'state' => 'Unresolved'])['total'] === 1, 'Date, severity and state filters combine.');
    $pdo->prepare('UPDATE error_groups SET module=?, summary=? WHERE id=?')->execute(['Audit ' . $unique, 'Primary ' . $unique . ' %_!', $id]);
    check($service->listing(['search' => '%_!', 'module' => 'Audit ' . $unique])['total'] === 1, 'Search supports literal wildcard characters.');
    check($service->listing(['search' => 'PrimaryX' . $unique . ' %_!', 'module' => 'Audit ' . $unique])['total'] === 0, 'Search does not interpret wildcards.');
    $pdo->prepare('UPDATE error_groups SET summary=? WHERE id=?')->execute(['Primary ' . $unique, $id]);
    check($service->listing(['search' => '%', 'module' => 'Audit ' . $unique])['total'] === 0, 'Percent searches match only literal percent signs.');
    check($service->listing(['search' => '_', 'module' => 'Audit ' . $unique])['total'] === 0, 'Underscore searches match only literal underscores.');
    check($service->listing(['search' => str_repeat('ñ', 255)])['total'] === 0, 'Search accepts 255 multibyte characters.');
    if (isset($argv[1])) {
        require_once __DIR__ . '/../app/Auth/SessionManager.php';
        for ($i = 1; $i <= 27; ++$i) {
            $_SERVER['REQUEST_URI'] = '/classic-club-ph/public/api/test/error-' . $unique . '-' . $i . '.php';
            $extraId = ErrorTracker::record($pdo, 503, $frames); $extraIds[] = $extraId;
            if ($i % 2 === 0) ErrorTracker::record($pdo, 503, $frames);
            $pdo->prepare('UPDATE error_groups SET summary=?, module=?, severity=?, state=? WHERE id=?')->execute([
                'Case ' . $unique . ' ' . $i, ($i === 27 ? 'Alternate ' : 'Audit ') . $unique,
                ['Critical', 'High', 'Medium', 'Low', 'Informational'][$i % 5], $i % 3 === 0 ? 'Resolved' : 'Unresolved', $extraId
            ]);
        }
        // Zero is a search term, even when it is the only character.
        $zeroId = current(array_filter($extraIds, static fn ($value) => !str_contains((string) $value, '0')));
        check((bool) $zeroId, 'A fixture ID without zero is available.');
        $pdo->prepare('UPDATE error_groups SET summary=?, module=? WHERE id=?')->execute(['Letters', 'Zero test', $zeroId]);
        $pdo->prepare('UPDATE error_events SET request_id=?, endpoint=?, source=? WHERE group_id=?')->execute([str_repeat('f', 32), 'letters.php', 'letters.php:1', $zeroId]);
        check($service->listing(['search' => '0', 'module' => 'Zero test'])['total'] === 0, 'Zero search is not treated as an empty filter.');
        $pdo->prepare('UPDATE error_groups SET summary=?, module=? WHERE id=?')->execute(['Case ' . $unique . ' zero', 'Audit ' . $unique, $zeroId]);
        \ClassicClub\Auth\SessionManager::login($actor);
        $sessionId = session_id(); $cookie = session_name() . '=' . $sessionId; session_write_close();
        $fixture = tempnam(sys_get_temp_dir(), 'cc-errors-');
        file_put_contents($fixture, json_encode(['base' => $argv[2] ?? 'http://localhost/classic-club-ph', 'cookie' => $cookie, 'id' => $id, 'actor' => $actor, 'unique' => $unique, 'today' => $today]));
        exec('node ' . escapeshellarg($argv[1]) . ' ' . escapeshellarg($fixture) . ' 2>&1', $output, $exit);
        check($exit === 0, 'Error module browser checks failed: ' . implode("\n", $output));
    }
} finally {
    if ($pdo->inTransaction()) $pdo->rollBack();
    foreach (array_filter(array_merge([$id], $extraIds)) as $testId) {
        $q = $pdo->prepare("DELETE FROM audit_logs WHERE entity_type='error_group' AND entity_id=?"); $q->execute([$testId]);
        $q = $pdo->prepare('DELETE FROM error_groups WHERE id=?'); $q->execute([$testId]);
    }
    if ($sessionId) { session_id($sessionId); \ClassicClub\Auth\SessionManager::start(); $_SESSION = []; session_destroy(); }
    if ($fixture) unlink($fixture);
}
if ($output) echo implode("\n", $output) . "\n";
echo "PASS: grouping, persistence, redaction, filters, triage audit, conflict protection, recurrence, pagination and validation\n";

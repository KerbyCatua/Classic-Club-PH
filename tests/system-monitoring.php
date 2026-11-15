<?php

declare(strict_types=1);

// Run: C:/xampp/php/php.exe tests/system-monitoring.php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../app/Database/Connection.php';
require_once __DIR__ . '/../app/Services/MaintenanceService.php';
require_once __DIR__ . '/../app/Services/SystemMonitoringService.php';

use ClassicClub\Services\SystemMonitoringService;

$assert = static function (bool $condition, string $message): void {
    if (!$condition) { throw new RuntimeException($message); }
};
$monitor = new SystemMonitoringService($pdo);
$pdo->beginTransaction();
try {
    $now = new DateTimeImmutable('now', new DateTimeZone('Asia/Manila'));
    $baseline = $monitor->snapshot('30d', 'api');
    $baseline7 = $monitor->snapshot('7d', 'api');
    $goodQuery = $pdo->prepare("SELECT COALESCE(SUM(healthy), 0) FROM monitoring_samples WHERE service = 'api' AND checked_at >= ? AND checked_at <= ?");
    $goodQuery->execute([$now->modify('-30 days')->format('Y-m-d H:i:s'), $now->format('Y-m-d H:i:s')]);
    $baselineGood = (int) $goodQuery->fetchColumn();
    $time = $now->modify('-20 days')->format('Y-m-d H:i:s');
    $insert = $pdo->prepare("INSERT INTO monitoring_samples (checked_at, service, healthy, latency_ms, status, context) VALUES (?, 'api', ?, ?, ?, 'monitoring regression test')");
    foreach ([[1, 10, 'Available'], [1, 20, 'Available'], [0, 900, 'Unavailable']] as $fixture) {
        $insert->execute(array_merge([$time], $fixture));
    }
    $data = $monitor->snapshot('30d', 'api');
    $assert($data['check_count'] === $baseline['check_count'] + 3, 'Persisted service samples are counted.');
    $assert(abs($data['availability_percent'] - round(($baselineGood + 2) / $data['check_count'] * 100, 2)) < .001, 'Availability includes failing checks.');
    $assert($data['failed_24h'] === $baseline['failed_24h'], 'Old failures do not inflate 24-hour failures.');
    $assert(count($data['history']) >= 30, 'History includes missing days.');
    $assert($monitor->snapshot('7d', 'api')['check_count'] === $baseline7['check_count'], 'Range filtering excludes old fixtures.');
    $assert(count($monitor->snapshot('24h', 'api')['history']) === 25, 'Rolling 24 hours includes partial boundary hours.');
    $assert(count(array_filter($data['services'], static fn (array $row): bool => $row['service'] !== 'api')) === 0, 'Service filter is applied.');
    $assert(count(array_filter($data['incidents'], static fn (array $row): bool => $row['status'] === 'Unavailable')) > 0, 'Failed probes appear in incident history.');
    $percentile = new ReflectionMethod(SystemMonitoringService::class, 'percentile');
    $assert($percentile->invoke($monitor, [], .95) === null, 'Missing percentiles stay null.');
    $assert($percentile->invoke($monitor, range(1, 100), .95) === 95.0, 'p95 uses nearest rank.');
    $assert($percentile->invoke($monitor, [50, 10, 20], .5) === 20.0, 'Median sorts samples.');
    $median = new ReflectionMethod(SystemMonitoringService::class, 'median');
    $assert($median->invoke($monitor, []) === null, 'Missing medians stay null.');
    $assert($median->invoke($monitor, [50, 10, 20]) === 20.0, 'Odd-count median sorts samples.');
    $assert($median->invoke($monitor, [40, 10, 30, 20]) === 25.0, 'Even-count median averages the middle measurements.');
    $assert($median->invoke($monitor, [0, 0]) === 0.0, 'Measured zero latency stays zero.');
    $latencies = $pdo->prepare("SELECT latency_ms FROM monitoring_samples WHERE service = 'api' AND checked_at >= ? AND checked_at <= ?");
    $latencies->execute([$now->modify('-30 days')->format('Y-m-d H:i:s'), $now->format('Y-m-d H:i:s')]);
    $values = array_map('floatval', $latencies->fetchAll(PDO::FETCH_COLUMN));
    $assert($data['api_median_ms'] === $median->invoke($monitor, $values), 'Snapshot median matches persisted latency measurements.');
    $assert($data['api_p95_ms'] === $percentile->invoke($monitor, $values, .95), 'Snapshot p95 matches persisted latency measurements.');
    $assert(array_sum(array_column($data['history'], 'checks')) === $data['check_count'], 'History counts equal the range total.');
    $assert(count(array_unique(array_column($data['history'], 'period'))) === count($data['history']), 'Export period timestamps are unique.');
    $runtime = $monitor->snapshot('24h', 'server');
    $assert($runtime['availability_percent'] === null && $runtime['check_count'] === 0, 'PHP request execution does not invent uptime checks.');
    $assert($runtime['api_p95_ms'] === null, 'Other services do not acquire API latency.');
    $probe = new ReflectionMethod(SystemMonitoringService::class, 'probe');
    [$body, $code] = $probe->invoke($monitor, 'http://127.0.0.1:1/classic-club-ph/index.html');
    $assert($body === false && $code === 0, 'Connection failures are detected.');
    echo "PASS: stored history, availability, filters, missing buckets, incidents and percentiles\n";
} finally {
    $pdo->rollBack();
}

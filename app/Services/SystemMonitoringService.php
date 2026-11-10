<?php

declare(strict_types=1);

namespace ClassicClub\Services;

use DateTimeImmutable;
use DateTimeZone;
use PDO;
use Throwable;

/** Module 21.5 only. HTTP probes carry no user credentials and never mutate commerce data. */
final class SystemMonitoringService
{
    public function __construct(private readonly PDO $pdo) {}

    private function now(): DateTimeImmutable
    {
        return new DateTimeImmutable('now', new DateTimeZone('Asia/Manila'));
    }

    /** The caller supplies a trusted local origin, never a browser-provided URL or Host header. */
    public function collect(string $origin): void
    {
        if (!(int) $this->pdo->query("SELECT GET_LOCK('classic_club_monitoring', 0)")->fetchColumn()) {
            return;
        }
        try {
            $now = $this->now();
            $query = $this->pdo->prepare('SELECT MAX(checked_at) FROM monitoring_samples WHERE checked_at > ?');
            $query->execute([$now->modify('-30 seconds')->format('Y-m-d H:i:s')]);
            if ($query->fetchColumn()) {
                return;
            }
            $maintenance = (new MaintenanceService($this->pdo))->state();
            $samples = [];
            foreach (['application' => '/index.html', 'api' => '/public/api/catalog/products.php?per_page=1'] as $service => $path) {
                [$body, $code, $latency] = $this->probe(rtrim($origin, '/') . $path);
                $valid = $body !== false && $code === 200;
                if ($valid) {
                    $valid = $service === 'api'
                        ? (json_decode($body, true)['success'] ?? false) === true
                        : stripos($body, '<html') !== false;
                }
                $status = $valid ? 'Available' : ($code === 503 && $maintenance['active'] ? 'Maintenance' : 'Unavailable');
                $samples[] = [$service, (int) $valid, $latency, $status,
                    ($service === 'api' ? 'Catalog GET' : 'Storefront GET') . ' / ' . ($code ? 'HTTP ' . $code : 'connection failed or timed out'), null, null];
            }
            $start = microtime(true);
            try {
                $this->pdo->query('SELECT 1')->fetchColumn();
                $latency = round((microtime(true) - $start) * 1000, 3);
                $connections = null;
                try {
                    $row = $this->pdo->query("SHOW GLOBAL STATUS LIKE 'Threads_connected'")->fetch();
                    $connections = $row ? (int) $row['Value'] : null;
                } catch (Throwable) { /* Optional server counters may be restricted. */ }
                $samples[] = ['database', 1, $latency, 'Connected', 'SELECT 1 succeeded', $connections, 'Open DB connections'];
            } catch (Throwable) {
                $samples[] = ['database', 0, round((microtime(true) - $start) * 1000, 3), 'Unavailable', 'Database health query failed', null, 'Open DB connections'];
            }
            // Memory is this PHP monitoring request, not host-wide utilization.
            $samples[] = ['server', 1, 0, 'Responding', 'PHP ' . PHP_VERSION . ' / ' . PHP_OS_FAMILY,
                round(memory_get_peak_usage(true) / 1048576, 2), 'PHP request peak memory (MiB)'];
            $this->pdo->beginTransaction();
            $insert = $this->pdo->prepare('INSERT INTO monitoring_samples (checked_at, service, healthy, latency_ms, status, context, resource_value, resource_label) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
            foreach ($samples as $sample) {
                $insert->execute(array_merge([$now->format('Y-m-d H:i:s')], $sample));
            }
            $this->pdo->prepare('DELETE FROM monitoring_samples WHERE checked_at < ?')->execute([$now->modify('-31 days')->format('Y-m-d H:i:s')]);
            $this->pdo->commit();
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        } finally {
            $this->pdo->query("SELECT RELEASE_LOCK('classic_club_monitoring')");
        }
    }

    /** Native sockets work with XAMPP even when Apache cannot load cURL. */
    private function probe(string $url): array
    {
        $start = microtime(true);
        $parts = parse_url($url);
        // Monitoring probes must stay on this machine, regardless of calling context.
        if (($parts['scheme'] ?? '') !== 'http' || ($parts['host'] ?? '') !== '127.0.0.1') {
            throw new \RuntimeException('Monitoring requires a loopback HTTP origin.');
        }
        $socket = @stream_socket_client('tcp://127.0.0.1:' . ($parts['port'] ?? 80), $errno, $error, 2);
        $body = false;
        $code = 0;
        if ($socket !== false) {
            stream_set_timeout($socket, 5);
            $path = ($parts['path'] ?? '/') . (isset($parts['query']) ? '?' . $parts['query'] : '');
            fwrite($socket, 'GET ' . $path . " HTTP/1.0\r\nHost: localhost\r\nAccept-Encoding: identity\r\nConnection: close\r\nUser-Agent: ClassicClubHealth/1.0\r\n\r\n");
            $response = stream_get_contents($socket, 2097152);
            $meta = stream_get_meta_data($socket);
            fclose($socket);
            if ($response !== false && !$meta['timed_out'] && str_contains($response, "\r\n\r\n")) {
                [$headers, $body] = explode("\r\n\r\n", $response, 2);
                if (preg_match('/^HTTP\/\d\.\d (\d{3})/', $headers, $matches)) {
                    $code = (int) $matches[1];
                }
            }
        }
        return [$body, $code, round((microtime(true) - $start) * 1000, 3)];
    }

    public function snapshot(string $range, string $service): array
    {
        $now = $this->now();
        $since = $now->modify(['24h' => '-24 hours', '7d' => '-7 days', '30d' => '-30 days'][$range]);
        $query = $this->pdo->prepare('SELECT * FROM monitoring_samples WHERE checked_at >= ? AND checked_at <= ?'
            . ($service !== 'all' ? ' AND service = ?' : '') . ' ORDER BY checked_at, id');
        $params = [$since->format('Y-m-d H:i:s'), $now->format('Y-m-d H:i:s')];
        if ($service !== 'all') { $params[] = $service; }
        $query->execute($params);
        $latest = [];
        $buckets = [];
        $checkCount = 0;
        $healthyCount = 0;
        $firstSample = null;
        $lastSample = null;
        $api = [];
        $failed24 = 0;
        $total24 = 0;
        $cutoff = $now->modify('-24 hours')->format('Y-m-d H:i:s');
        // Process rows incrementally; a month of samples must not become a large PHP row array.
        while ($row = $query->fetch()) {
            $firstSample ??= $row['checked_at'];
            $lastSample = $row['checked_at'];
            $latest[$row['service']] = $row;
            $key = $range === '24h' ? substr($row['checked_at'], 0, 13) . ':00:00' : substr($row['checked_at'], 0, 10) . ' 00:00:00';
            if (!isset($buckets[$key])) {
                $buckets[$key] = ['period' => $key, 'api' => [], 'memory' => [], 'checks' => 0, 'failed' => 0];
            }
            if (in_array($row['service'], ['application', 'api', 'database'], true)) {
                $checkCount++;
                $healthyCount += (int) $row['healthy'];
                $buckets[$key]['checks']++;
                $buckets[$key]['failed'] += 1 - (int) $row['healthy'];
                if ($row['checked_at'] >= $cutoff) {
                    $total24++;
                    $failed24 += 1 - (int) $row['healthy'];
                }
            }
            if ($row['service'] === 'api') {
                $api[] = (float) $row['latency_ms'];
                $buckets[$key]['api'][] = (float) $row['latency_ms'];
            }
            if ($row['service'] === 'server' && $row['resource_value'] !== null) {
                $buckets[$key]['memory'][] = (float) $row['resource_value'];
            }
        }
        $history = [];
        // Include empty time buckets so missing monitoring coverage is visible.
        $cursor = $range === '24h' ? $since->setTime((int) $since->format('H'), 0) : $since->setTime(0, 0);
        while ($cursor <= $now) {
            $key = $cursor->format('Y-m-d H:i:s');
            $bucket = $buckets[$key] ?? ['checks' => 0, 'failed' => 0, 'api' => [], 'memory' => []];
            $history[] = [
                'label' => $cursor->format($range === '24h' ? 'd M H:00' : 'd M'),
                'checks' => $bucket['checks'], 'failed' => $bucket['failed'],
                'p95_ms' => $this->percentile($bucket['api'], .95),
                'memory_mib' => $bucket['memory'] ? round(array_sum($bucket['memory']) / count($bucket['memory']), 2) : null,
            ];
            $cursor = $cursor->modify($range === '24h' ? '+1 hour' : '+1 day');
        }
        $maintenance = (new MaintenanceService($this->pdo))->state();
        $events = $this->pdo->prepare("SELECT action, created_at FROM audit_logs WHERE created_at >= ? AND created_at <= ? AND (action LIKE 'maintenance.%' OR action LIKE '%error%' OR action LIKE '%fail%' OR action LIKE '%exception%' OR action LIKE '%timeout%') ORDER BY created_at DESC, id DESC LIMIT 15");
        $events->execute([$since->format('Y-m-d H:i:s'), $now->format('Y-m-d H:i:s')]);
        $incidents = $this->pdo->prepare("SELECT service, status, context, checked_at FROM monitoring_samples WHERE checked_at >= ? AND checked_at <= ? AND healthy = 0" . ($service !== 'all' ? ' AND service = ?' : '') . ' ORDER BY checked_at DESC, id DESC LIMIT 15');
        $incidents->execute($params);
        return [
            'generated_at' => $now->format(DATE_ATOM),
            'range' => $range, 'service' => $service,
            'first_sample' => $firstSample,
            'last_sample' => $lastSample,
            'availability_percent' => $checkCount ? round($healthyCount / $checkCount * 100, 2) : null,
            'check_count' => $checkCount,
            'api_p95_ms' => $this->percentile($api, .95),
            'api_median_ms' => $this->percentile($api, .5),
            'failed_24h' => $failed24, 'checks_24h' => $total24,
            'services' => array_values($latest), 'history' => $history,
            'maintenance' => $maintenance, 'events' => $events->fetchAll(),
            'incidents' => $incidents->fetchAll(),
        ];
    }

    private function percentile(array $values, float $percentile): ?float
    {
        if (!$values) { return null; }
        sort($values, SORT_NUMERIC);
        return round($values[max(0, (int) ceil(count($values) * $percentile) - 1)], 3);
    }
}

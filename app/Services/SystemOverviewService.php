<?php

declare(strict_types=1);

namespace ClassicClub\Services;

use DateTimeImmutable;
use DateTimeZone;
use PDO;
use Throwable;

/**
 * Read-only, application-wide metrics for the Super Admin System Overview
 * (Module 21.1). Every figure is derived from the live database; no demo or
 * illustrative values are returned.
 */
final class SystemOverviewService
{
    private const GLOBAL_ROLES = ['customer', 'admin', 'super_admin'];

    private const STATUSES = ['active', 'inactive', 'suspended', 'pending'];

    public function __construct(
        private readonly PDO $pdo
    ) {
    }

    public function getOverview(): array
    {
        $now = new DateTimeImmutable('now', new DateTimeZone('Asia/Manila'));

        return [
            'generated_at' => $now->format(DATE_ATOM),
            'generated_at_label' => $now->format('d M Y, H:i') . ' PHT',
            'users' => $this->getUserStats(),
            'health' => $this->getHealth(),
            'errors' => $this->getErrorSummary($now),
            'support' => $this->getSupportSummary(),
            'security_events' => $this->getSecurityEvents(),
            'activities' => $this->getRecentActivities(),
            'activity_chart' => $this->getActivityChart($now),
        ];
    }

    /**
     * Registered accounts, grouped by global role and account status.
     */
    private function getUserStats(): array
    {
        $statement = $this->pdo->query(<<<'SQL'
            SELECT u.id, u.status, r.name AS role_name
            FROM users u
            LEFT JOIN user_roles ur ON ur.user_id = u.id
            LEFT JOIN roles r ON r.id = ur.role_id
            WHERE u.deleted_at IS NULL
            ORDER BY u.id
        SQL);

        $accounts = [];
        foreach ($statement->fetchAll() as $row) {
            $id = (int) $row['id'];
            if (!isset($accounts[$id])) {
                $accounts[$id] = [
                    'status' => (string) $row['status'],
                    'roles' => [],
                ];
            }
            if (!empty($row['role_name'])) {
                $accounts[$id]['roles'][] = (string) $row['role_name'];
            }
        }

        $byStatus = $this->emptyStatusCounts();
        $roles = [];
        foreach (self::GLOBAL_ROLES as $role) {
            $roles[$role] = $this->emptyStatusCounts();
        }
        $other = $this->emptyStatusCounts();

        foreach ($accounts as $account) {
            $status = $account['status'];
            if (isset($byStatus[$status])) {
                $byStatus[$status]++;
            }

            $matched = false;
            foreach (self::GLOBAL_ROLES as $role) {
                if (in_array($role, $account['roles'], true)) {
                    $matched = true;
                    if (isset($roles[$role][$status])) {
                        $roles[$role][$status]++;
                    }
                    $roles[$role]['total']++;
                }
            }

            if (!$matched) {
                if (isset($other[$status])) {
                    $other[$status]++;
                }
                $other['total']++;
            }
        }

        $byStatus['total'] = count($accounts);

        return [
            'total' => count($accounts),
            'by_status' => $byStatus,
            'roles' => $roles,
            'other' => $other,
        ];
    }

    /**
     * Application / server / database health plus the configured version and
     * maintenance state.
     */
    private function getHealth(): array
    {
        $databaseConnected = false;
        $databaseLatency = null;
        $startedAt = microtime(true);

        try {
            $this->pdo->query('SELECT 1')->fetchColumn();
            $databaseConnected = true;
            $databaseLatency = round((microtime(true) - $startedAt) * 1000, 1);
        } catch (Throwable) {
            $databaseConnected = false;
        }

        $settings = $this->getSettings();
        $maintenanceOn = ($settings['maintenance_mode'] ?? '0') === '1';
        $nextMaintenance = trim((string) ($settings['maintenance_next_at'] ?? ''));
        $uptimeSeconds = $databaseConnected ? $this->getDatabaseUptime() : null;

        $maintenanceLabel = 'Off';
        if ($maintenanceOn) {
            $maintenanceLabel = 'Active';
        } elseif ($nextMaintenance !== '') {
            $next = strtotime($nextMaintenance);
            $maintenanceLabel = $next !== false
                ? 'Next scheduled: ' . date('d M', $next)
                : 'Next scheduled';
        }

        return [
            'application_status' => $maintenanceOn ? 'Maintenance' : 'Available',
            'server_status' => $databaseConnected ? 'Healthy' : 'Degraded',
            'database_status' => $databaseConnected ? 'Connected' : 'Unavailable',
            'database_latency_ms' => $databaseLatency,
            'database_uptime_seconds' => $uptimeSeconds,
            'database_uptime_label' => $uptimeSeconds !== null ? $this->formatUptime($uptimeSeconds) : '—',
            'application_version' => (string) ($settings['application_version'] ?? '2.6.1'),
            'maintenance_mode' => $maintenanceOn,
            'maintenance_label' => $maintenanceLabel,
        ];
    }

    /**
     * Error and failure activity recorded in the audit log. The schema does
     * not maintain a dedicated error table, so the audit trail is the source
     * of truth for failed operations.
     */
    private function getErrorSummary(DateTimeImmutable $now): array
    {
        $errorWhere = "(
            al.action LIKE '%error%'
            OR al.action LIKE '%fail%'
            OR al.action LIKE '%exception%'
            OR al.action LIKE '%timeout%'
            OR al.action LIKE '%blocked%'
        )";

        $since24 = $now->modify('-24 hours')->format('Y-m-d H:i:s');
        $since7d = $now->modify('-7 days')->format('Y-m-d H:i:s');

        $total24 = $this->scalar(
            'SELECT COUNT(*) FROM audit_logs al WHERE al.created_at >= :since',
            ['since' => $since24]
        );

        $failed24 = $this->scalar(
            "SELECT COUNT(*) FROM audit_logs al WHERE al.created_at >= :since AND $errorWhere",
            ['since' => $since24]
        );

        $errorCount = $this->scalar(
            "SELECT COUNT(*) FROM audit_logs al WHERE al.created_at >= :since AND $errorWhere",
            ['since' => $since7d]
        );

        $statement = $this->pdo->prepare(<<<SQL
            SELECT al.id, al.action, al.entity_type, al.created_at,
                   u.first_name, u.last_name
            FROM audit_logs al
            LEFT JOIN users u ON u.id = al.user_id
            WHERE $errorWhere
            ORDER BY al.created_at DESC, al.id DESC
            LIMIT 2
        SQL);
        $statement->execute();

        $recent = [];
        foreach ($statement->fetchAll() as $row) {
            $recent[] = [
                'action' => (string) $row['action'],
                'entity_type' => (string) ($row['entity_type'] ?? ''),
                'user' => $this->userName($row['first_name'] ?? null, $row['last_name'] ?? null),
                'time_label' => $this->timeLabel((string) $row['created_at']),
            ];
        }

        return [
            'error_count_7d' => $errorCount,
            'failed_24h' => $failed24,
            'total_events_24h' => $total24,
            'error_rate_24h' => $total24 > 0 ? round(($failed24 / $total24) * 100, 2) : 0.0,
            'recent' => $recent,
        ];
    }

    /**
     * Contact inquiries are the application's support queue.
     */
    private function getSupportSummary(): array
    {
        $statement = $this->pdo->query(
            'SELECT status, COUNT(*) AS total FROM contact_inquiries GROUP BY status'
        );

        $counts = [
            'open' => 0,
            'in_progress' => 0,
            'resolved' => 0,
            'closed' => 0,
        ];
        $total = 0;
        foreach ($statement->fetchAll() as $row) {
            $status = (string) $row['status'];
            $count = (int) $row['total'];
            if (isset($counts[$status])) {
                $counts[$status] = $count;
            }
            $total += $count;
        }

        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT i.id, i.full_name, i.topic, i.status, i.created_at,
                   u.first_name, u.last_name
            FROM contact_inquiries i
            LEFT JOIN users u ON u.id = i.assigned_to
            WHERE i.status IN ('open', 'in_progress')
            ORDER BY i.created_at DESC, i.id DESC
            LIMIT 1
        SQL);
        $statement->execute();
        $latest = $statement->fetch();

        $assignee = $latest === false
            ? ''
            : trim(((string) ($latest['first_name'] ?? '')) . ' ' . ((string) ($latest['last_name'] ?? '')));

        return [
            'total' => $total,
            'open' => $counts['open'],
            'in_progress' => $counts['in_progress'],
            'resolved' => $counts['resolved'],
            'closed' => $counts['closed'],
            'unresolved' => $counts['open'] + $counts['in_progress'],
            'latest' => $latest === false ? null : [
                'id' => (int) $latest['id'],
                'reference' => 'INQ-' . (int) $latest['id'],
                'full_name' => (string) $latest['full_name'],
                'topic' => (string) $latest['topic'],
                'topic_label' => $this->topicLabel((string) $latest['topic']),
                'status' => (string) $latest['status'],
                'status_label' => $this->statusLabel((string) $latest['status']),
                'assignee' => $assignee !== '' ? $assignee : 'Unassigned',
                'time_label' => $this->timeLabel((string) $latest['created_at']),
            ],
        ];
    }

    /**
     * Authentication and security-related audit entries.
     */
    private function getSecurityEvents(): array
    {
        $statement = $this->pdo->query(<<<'SQL'
            SELECT al.id, al.action, al.ip_address, al.created_at,
                   u.first_name, u.last_name
            FROM audit_logs al
            LEFT JOIN users u ON u.id = al.user_id
            WHERE al.action LIKE 'auth.%'
               OR al.action LIKE '%failed%'
               OR al.action LIKE '%blocked%'
               OR al.action LIKE '%security%'
            ORDER BY al.created_at DESC, al.id DESC
            LIMIT 2
        SQL);

        $events = [];
        foreach ($statement->fetchAll() as $row) {
            $events[] = [
                'action' => (string) $row['action'],
                'action_label' => $this->securityActionLabel((string) $row['action']),
                'user' => $this->userName($row['first_name'] ?? null, $row['last_name'] ?? null),
                'ip_address' => (string) ($row['ip_address'] ?? ''),
                'time_label' => $this->timeLabel((string) $row['created_at']),
            ];
        }

        return $events;
    }

    /**
     * Latest non-authentication administrative changes.
     */
    private function getRecentActivities(): array
    {
        $statement = $this->pdo->query(<<<'SQL'
            SELECT al.id, al.action, al.entity_type, al.metadata, al.created_at,
                   u.first_name, u.last_name
            FROM audit_logs al
            LEFT JOIN users u ON u.id = al.user_id
            WHERE al.action NOT LIKE 'auth.%'
              AND al.action NOT LIKE 'contact.%'
            ORDER BY al.created_at DESC, al.id DESC
            LIMIT 3
        SQL);

        $activities = [];
        foreach ($statement->fetchAll() as $row) {
            $metadata = json_decode((string) ($row['metadata'] ?? ''), true);
            $detail = '';
            if (is_array($metadata)) {
                $detail = trim((string) ($metadata['change'] ?? ''));
            }
            if ($detail === '') {
                $detail = trim((string) ($row['entity_type'] ?? ''));
            }

            $activities[] = [
                'action' => (string) $row['action'],
                'user' => $this->userName($row['first_name'] ?? null, $row['last_name'] ?? null),
                'detail' => $detail,
                'time_label' => $this->timeLabel((string) $row['created_at']),
            ];
        }

        return $activities;
    }

    /**
     * Seven-day activity series from the audit trail.
     */
    private function getActivityChart(DateTimeImmutable $now): array
    {
        $start = $now->modify('-6 days')->setTime(0, 0, 0);
        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT DATE(created_at) AS day, COUNT(*) AS total
            FROM audit_logs
            WHERE created_at >= :start
            GROUP BY DATE(created_at)
        SQL);
        $statement->execute(['start' => $start->format('Y-m-d H:i:s')]);

        $counts = [];
        foreach ($statement->fetchAll() as $row) {
            $counts[(string) $row['day']] = (int) $row['total'];
        }

        $days = [];
        for ($offset = 0; $offset < 7; $offset++) {
            $day = $start->modify('+' . $offset . ' days');
            $key = $day->format('Y-m-d');
            $days[] = [
                'date' => $key,
                'label' => $day->format('d M'),
                'count' => $counts[$key] ?? 0,
            ];
        }

        $total = array_sum(array_column($days, 'count'));

        return [
            'total' => $total,
            'max' => max(array_column($days, 'count')) ?: 0,
            'days' => $days,
        ];
    }

    private function getSettings(): array
    {
        $settings = [
            'application_version' => '2.6.1',
            'maintenance_mode' => '0',
            'maintenance_next_at' => '',
        ];

        try {
            $statement = $this->pdo->query(
                'SELECT setting_key, setting_value FROM system_settings'
            );
            foreach ($statement->fetchAll() as $row) {
                $settings[(string) $row['setting_key']] = $row['setting_value'];
            }
        } catch (Throwable) {
            // The settings table is optional; safe defaults keep the overview
            // readable on installations that have not run the migration yet.
        }

        return $settings;
    }

    private function getDatabaseUptime(): ?int
    {
        try {
            $statement = $this->pdo->query("SHOW GLOBAL STATUS LIKE 'Uptime'");
            $row = $statement->fetch();
            if ($row !== false && isset($row['Value'])) {
                return (int) $row['Value'];
            }
        } catch (Throwable) {
            // Uptime is a convenience metric; never fail the overview for it.
        }

        return null;
    }

    private function scalar(string $sql, array $params = []): int
    {
        $statement = $this->pdo->prepare($sql);
        $statement->execute($params);

        return (int) $statement->fetchColumn();
    }

    private function emptyStatusCounts(): array
    {
        $counts = ['total' => 0];
        foreach (self::STATUSES as $status) {
            $counts[$status] = 0;
        }

        return $counts;
    }

    private function userName(?string $firstName, ?string $lastName): string
    {
        $name = trim(((string) $firstName) . ' ' . ((string) $lastName));

        return $name !== '' ? $name : 'System';
    }

    private function timeLabel(string $dateTime): string
    {
        $timestamp = strtotime($dateTime);

        return $timestamp !== false ? date('d M, H:i', $timestamp) : $dateTime;
    }

    private function topicLabel(string $topic): string
    {
        return match ($topic) {
            'sizing' => 'Sizing',
            'order' => 'Order',
            'return' => 'Return',
            'other' => 'Other',
            default => ucfirst($topic),
        };
    }

    private function statusLabel(string $status): string
    {
        return match ($status) {
            'open' => 'Open',
            'in_progress' => 'In Progress',
            'resolved' => 'Resolved',
            'closed' => 'Closed',
            default => ucfirst(str_replace('_', ' ', $status)),
        };
    }

    private function securityActionLabel(string $action): string
    {
        if (stripos($action, 'fail') !== false || stripos($action, 'blocked') !== false) {
            return 'Failed authentication';
        }

        return match ($action) {
            'auth.login' => 'Sign-in',
            'auth.logout' => 'Sign-out',
            'auth.registration' => 'Account registration',
            default => ucfirst(str_replace(['.', '_'], [' ', ' '], $action)),
        };
    }

    private function formatUptime(int $seconds): string
    {
        $days = intdiv($seconds, 86400);
        $hours = intdiv($seconds % 86400, 3600);
        $minutes = intdiv($seconds % 3600, 60);

        if ($days > 0) {
            return $days . 'd ' . $hours . 'h';
        }
        if ($hours > 0) {
            return $hours . 'h ' . $minutes . 'm';
        }

        return $minutes . 'm';
    }
}

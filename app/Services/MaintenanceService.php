<?php

declare(strict_types=1);

namespace ClassicClub\Services;

use DateTimeImmutable;
use DateTimeZone;
use PDO;
use RuntimeException;

final class MaintenanceService
{
    private const ZONE = 'Asia/Manila';
    private const CONFIG_KEY = 'maintenance_config';

    public function __construct(private readonly PDO $pdo)
    {
    }

    public function state(): array
    {
        $settings = $this->settings();
        $config = $this->config($settings);
        $now = new DateTimeImmutable('now', new DateTimeZone(self::ZONE));
        $window = $config['window'];
        $scheduledActive = $window['status'] === 'Scheduled'
            && $window['start_at'] <= $now->format('Y-m-d H:i:s')
            && $window['end_at'] > $now->format('Y-m-d H:i:s');
        $active = $config['manual_mode'] || $scheduledActive;

        // Keep the existing overview settings in sync with the effective state.
        $next = $window['status'] === 'Scheduled' && $window['start_at'] > $now->format('Y-m-d H:i:s')
            ? $window['start_at'] : '';
        if (($settings['maintenance_mode'] ?? '') !== ($active ? '1' : '0')
            || ($settings['maintenance_next_at'] ?? '') !== $next) {
            $this->writeSetting('maintenance_mode', $active ? '1' : '0');
            $this->writeSetting('maintenance_next_at', $next);
        }

        return [
            'active' => $active,
            'manual_mode' => $config['manual_mode'],
            'scheduled_active' => $scheduledActive,
            'window' => $window,
            'announcement' => $config['announcement'],
            'server_time' => $now->format('Y-m-d H:i:s'),
            'history' => $this->history(),
        ];
    }

    public function saveWindow(array $input, int $actor): array
    {
        $status = $input['status'] ?? '';
        if (!in_array($status, ['Draft', 'Scheduled', 'Cancelled'], true)) {
            throw new RuntimeException('Choose a valid schedule state.');
        }
        $start = $this->dateTime($input['start_at'] ?? null);
        $end = $this->dateTime($input['end_at'] ?? null);
        if ($end <= $start) {
            throw new RuntimeException('The end must be after the start.');
        }
        $now = new DateTimeImmutable('now', new DateTimeZone(self::ZONE));
        if ($status === 'Scheduled' && $start <= $now) {
            throw new RuntimeException('Scheduled windows must start in the future. Use Enable maintenance to start now.');
        }
        if ($status === 'Scheduled' && $end <= $now) {
            throw new RuntimeException('Scheduled windows must end in the future.');
        }
        $purpose = trim((string) ($input['purpose'] ?? ''));
        if ($purpose === '' || mb_strlen($purpose) > 160) {
            throw new RuntimeException('Enter a purpose of up to 160 characters.');
        }
        $window = [
            'status' => $status,
            'start_at' => $start->format('Y-m-d H:i:s'),
            'end_at' => $end->format('Y-m-d H:i:s'),
            'purpose' => $purpose,
            'notify_users' => !empty($input['notify_users']),
        ];
        $this->change('maintenance.window_saved', $actor, function (array &$config) use ($window): array {
            $config['window'] = $window;
            return $window;
        });
        return $this->state();
    }

    public function setMode(bool $enabled, int $actor): array
    {
        $this->change($enabled ? 'maintenance.enabled' : 'maintenance.disabled', $actor,
            function (array &$config) use ($enabled): array {
                if ($config['manual_mode'] === $enabled) {
                    throw new RuntimeException('Maintenance mode is already ' . ($enabled ? 'on.' : 'off.'));
                }
                $config['manual_mode'] = $enabled;
                return ['manual_mode' => $enabled];
            });
        return $this->state();
    }

    public function saveAnnouncement(array $input, int $actor): array
    {
        $title = trim((string) ($input['title'] ?? ''));
        $message = trim((string) ($input['message'] ?? ''));
        $location = (string) ($input['location'] ?? '');
        if ($title === '' || mb_strlen($title) > 120 || $message === '' || mb_strlen($message) > 1000) {
            throw new RuntimeException('Enter a title (up to 120 characters) and message (up to 1000 characters).');
        }
        if (!in_array($location, ['Application-wide', 'Banner only', 'Maintenance page only'], true)) {
            throw new RuntimeException('Choose a valid display location.');
        }
        $announcement = compact('title', 'message', 'location');
        $this->change('maintenance.announcement_saved', $actor,
            function (array &$config) use ($announcement): array {
                $config['announcement'] = $announcement;
                return $announcement;
            });
        return $this->state();
    }

    private function change(string $action, int $actor, callable $mutate): void
    {
        $this->pdo->beginTransaction();
        try {
            $this->pdo->exec("INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES ('maintenance_config', '{}')");
            $statement = $this->pdo->query("SELECT setting_value FROM system_settings WHERE setting_key = 'maintenance_config' FOR UPDATE");
            $config = $this->config([self::CONFIG_KEY => (string) $statement->fetchColumn()]);
            $detail = $mutate($config);
            $this->writeSetting(self::CONFIG_KEY, json_encode($config, JSON_THROW_ON_ERROR));
            $audit = $this->pdo->prepare('INSERT INTO audit_logs (user_id, action, entity_type, metadata, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?)');
            $audit->execute([$actor, $action, 'maintenance', json_encode($detail, JSON_THROW_ON_ERROR),
                $_SERVER['REMOTE_ADDR'] ?? null, $_SERVER['HTTP_USER_AGENT'] ?? null]);
            $this->pdo->commit();
        } catch (\Throwable $exception) {
            $this->pdo->rollBack();
            throw $exception;
        }
    }

    private function settings(): array
    {
        $rows = $this->pdo->query("SELECT setting_key, setting_value FROM system_settings WHERE setting_key IN ('maintenance_config', 'maintenance_mode', 'maintenance_next_at')")->fetchAll(PDO::FETCH_KEY_PAIR);
        return $rows ?: [];
    }

    private function config(array $settings): array
    {
        $raw = json_decode((string) ($settings[self::CONFIG_KEY] ?? ''), true);
        $raw = is_array($raw) ? $raw : [];
        return [
            'manual_mode' => isset($raw['manual_mode']) ? (bool) $raw['manual_mode'] : (($settings['maintenance_mode'] ?? '0') === '1'),
            'window' => array_merge(['status' => 'Draft', 'start_at' => '', 'end_at' => '', 'purpose' => '', 'notify_users' => false], is_array($raw['window'] ?? null) ? $raw['window'] : []),
            'announcement' => array_merge(['title' => '', 'message' => '', 'location' => 'Application-wide'], is_array($raw['announcement'] ?? null) ? $raw['announcement'] : []),
        ];
    }

    private function writeSetting(string $key, string $value): void
    {
        $statement = $this->pdo->prepare('INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)');
        $statement->execute([$key, $value]);
    }

    private function history(): array
    {
        $statement = $this->pdo->query("SELECT a.action, a.metadata, a.created_at, CONCAT_WS(' ', u.first_name, u.last_name) AS actor FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id WHERE a.action LIKE 'maintenance.%' ORDER BY a.id DESC LIMIT 30");
        return array_map(static function (array $row): array {
            $row['metadata'] = json_decode((string) $row['metadata'], true) ?: [];
            return $row;
        }, $statement->fetchAll());
    }

    private function dateTime(mixed $value): DateTimeImmutable
    {
        if (!is_string($value) || !preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/', $value)) {
            throw new RuntimeException('Enter a valid date and time.');
        }
        $date = DateTimeImmutable::createFromFormat('!Y-m-d H:i', $value, new DateTimeZone(self::ZONE));
        if (!$date || $date->format('Y-m-d H:i') !== $value) {
            throw new RuntimeException('Enter a valid date and time.');
        }
        return $date;
    }
}

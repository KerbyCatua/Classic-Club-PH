<?php
declare(strict_types=1);

namespace ClassicClub\Services;

use PDO;
use InvalidArgumentException;
use RuntimeException;

final class SystemConfigurationService
{
    public const DEFAULTS = [
        'registration_enabled' => true,
        'password_min_length' => 12,
        'failed_login_limit' => 5,
        'idle_timeout_minutes' => 30,
        'session_duration_hours' => 12,
        'invalidate_sessions' => true,
        'reviews_enabled' => true,
        'report_exports_enabled' => true,
        'staff_management_enabled' => true,
        'report_period' => 'monthly',
    ];

    public function __construct(private readonly PDO $pdo) {}

    public static function value(string $key): mixed
    {
        global $pdo;
        if (!array_key_exists($key, self::DEFAULTS)) {
            throw new InvalidArgumentException('Unsupported setting.');
        }
        return $pdo instanceof PDO ? (new self($pdo))->read()['settings'][$key] : self::DEFAULTS[$key];
    }

    public function read(): array
    {
        $raw = $this->pdo->query("SELECT setting_value FROM system_settings WHERE setting_key = 'global_configuration'")->fetchColumn();
        return $this->decode($raw === false ? '' : (string) $raw);
    }

    private function decode(string $raw): array
    {
        $data = $raw === '' ? [] : json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
        return [
            'settings' => array_replace(self::DEFAULTS, array_intersect_key($data['settings'] ?? [], self::DEFAULTS)),
            'version' => hash('sha256', $raw),
            'saved_at' => $data['saved_at'] ?? null,
            'saved_by' => $data['saved_by'] ?? null,
        ];
    }

    public function save(array $settings, string $version, int $actor, bool $confirmed): array
    {
        if (!$confirmed) throw new InvalidArgumentException('Review and confirm the changes before saving.');
        if (array_diff_key($settings, self::DEFAULTS) || array_diff_key(self::DEFAULTS, $settings)) {
            throw new InvalidArgumentException('Submit only the supported configuration settings.');
        }
        $choices = [
            'password_min_length' => [10, 12, 14], 'failed_login_limit' => [3, 5],
            'idle_timeout_minutes' => [30, 45, 60], 'session_duration_hours' => [8, 12, 24],
            'report_period' => ['daily', 'weekly', 'monthly', 'yearly'],
        ];
        foreach (self::DEFAULTS as $key => $default) {
            if (isset($choices[$key]) ? !in_array($settings[$key], $choices[$key], true) : !is_bool($settings[$key])) {
                throw new InvalidArgumentException('Invalid value for ' . $key . '.');
            }
        }
        $this->pdo->beginTransaction();
        try {
            $this->pdo->exec("INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES ('global_configuration', '')");
            $raw = (string) $this->pdo->query("SELECT setting_value FROM system_settings WHERE setting_key = 'global_configuration' FOR UPDATE")->fetchColumn();
            $before = $this->decode($raw);
            if (!hash_equals($before['version'], $version)) throw new RuntimeException('Configuration changed. Reload the saved configuration before reviewing again.', 409);
            $data = ['settings' => $settings, 'saved_at' => gmdate('c'), 'saved_by' => $actor];
            $raw = json_encode($data, JSON_THROW_ON_ERROR);
            $q = $this->pdo->prepare("UPDATE system_settings SET setting_value = ? WHERE setting_key = 'global_configuration'");
            $q->execute([$raw]);
            require_once __DIR__ . '/../Support/AuditLogger.php';
            (new \ClassicClub\Support\AuditLogger($this->pdo))->record('configuration.updated', $actor, 'system_configuration', null, ['before' => $before['settings'], 'after' => $settings]);
            $this->pdo->commit();
            return $this->decode($raw);
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            throw $e;
        }
    }

    public static function requireFeature(string $key): void
    {
        if (!self::value($key)) {
            \ClassicClub\Http\JsonResponse::error('This feature is disabled in global system configuration.', 403)->send();
        }
    }
}

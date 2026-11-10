<?php
declare(strict_types=1);

namespace ClassicClub\Services;

use ClassicClub\Auth\SessionManager;
use ClassicClub\Support\AuditLogger;
use InvalidArgumentException;
use PDO;
use Throwable;

require_once __DIR__ . '/AdminBusinessService.php';
require_once __DIR__ . '/SystemConfigurationService.php';
require_once __DIR__ . '/../Support/AuditLogger.php';
require_once __DIR__ . '/../Validation/ValidationException.php';
require_once __DIR__ . '/GlobalUserService.php';

/** Personal account operations only; the caller supplies the authenticated actor. */
final class SuperAdminAccountService
{
    public function __construct(private readonly PDO $pdo) {}

    public function read(int $actor): array
    {
        $q = $this->pdo->prepare('SELECT id, first_name, last_name, email, mobile, email_verified_at, last_login_at FROM users WHERE id = ? AND deleted_at IS NULL');
        $q->execute([$actor]);
        $profile = $q->fetch();
        $q = $this->pdo->prepare('SELECT UNIX_TIMESTAMP(created_at) AS created_at, UNIX_TIMESTAMP(expires_at) AS expires_at, UNIX_TIMESTAMP(used_at) AS used_at FROM password_reset_tokens WHERE user_id = ? ORDER BY id DESC LIMIT 1');
        $q->execute([$actor]);
        $reset = $q->fetch() ?: null;
        return [
            'profile' => $profile,
            'password_policy' => [
                'minimum' => SystemConfigurationService::value('password_min_length'),
                'invalidate_sessions' => SystemConfigurationService::value('invalidate_sessions'),
            ],
            'session' => [
                'logged_in_at' => (int) ($_SESSION['logged_in_at'] ?? 0),
                'last_activity_at' => (int) ($_SESSION['last_activity_at'] ?? 0),
            ],
            'recovery' => ['latest_request' => $reset],
            'history' => $this->history($actor, 0, 5),
        ];
    }

    public function updateProfile(int $actor, array $data): void
    {
        // No role, permission, status, or arbitrary target account may be supplied.
        if (array_diff_key($data, array_flip(['action', 'first_name', 'last_name', 'email', 'mobile']))) {
            throw new InvalidArgumentException('Submit only personal profile fields.');
        }
        foreach (['first_name' => 100, 'last_name' => 100, 'email' => 190, 'mobile' => 40] as $key => $max) {
            if (!is_string($data[$key] ?? null)) throw new InvalidArgumentException('Invalid ' . $key . '.');
            $data[$key] = trim($data[$key]);
            if (mb_strlen($data[$key]) > $max || ($key !== 'mobile' && $data[$key] === '')) {
                throw new InvalidArgumentException('Check ' . $key . ' (maximum ' . $max . ' characters).');
            }
        }
        $data['email'] = strtolower($data['email']);
        if (!filter_var($data['email'], FILTER_VALIDATE_EMAIL)) throw new InvalidArgumentException('Enter a valid email address.');
        $this->pdo->beginTransaction();
        try {
            $q = $this->pdo->prepare('SELECT id FROM users WHERE email = ? AND id <> ?');
            $q->execute([$data['email'], $actor]);
            if ($q->fetchColumn()) throw new InvalidArgumentException('An account already exists for this email.');
            (new AdminBusinessService($this->pdo))->updateAdminProfile($actor, $data);
            $q = $this->pdo->prepare('UPDATE users SET email_verified_at = IF(email = ?, email_verified_at, NULL), email = ? WHERE id = ?');
            $q->execute([$data['email'], $data['email'], $actor]);
            (new AuditLogger($this->pdo))->record('account.profile_updated', $actor, 'user', $actor);
            $this->pdo->commit();
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            if ($e instanceof \PDOException && $e->getCode() === '23000') throw new InvalidArgumentException('An account already exists for this email.');
            throw $e;
        }
    }

    public function updatePassword(int $actor, array $data): void
    {
        foreach (['current_password', 'new_password', 'password_confirmation'] as $key) {
            if (!is_string($data[$key] ?? null) || $data[$key] === '') throw new InvalidArgumentException('Complete all password fields.');
        }
        if ($data['new_password'] !== $data['password_confirmation']) throw new InvalidArgumentException('Passwords do not match.');
        // The shared password workflow verifies the current password, applies the
        // saved global policy, and preserves this session's password fingerprint.
        SessionManager::start();
        try {
            (new AdminBusinessService($this->pdo))->updatePassword($actor, $data['current_password'], $data['new_password']);
        } catch (\RuntimeException $e) {
            if ($e instanceof \PDOException) throw $e;
            throw new InvalidArgumentException($e->getMessage());
        } finally {
            if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
        }
        (new AuditLogger($this->pdo))->record('account.password_changed', $actor, 'user', $actor);
    }

    public function requestRecovery(int $actor, string $name): void
    {
        // The existing workflow writes local DATETIME values. This application
        // stores them in Philippine time; do not inherit the PHP host's zone.
        $zone = date_default_timezone_get();
        try {
            date_default_timezone_set('Asia/Manila');
            (new GlobalUserService($this->pdo, new AuditLogger($this->pdo)))->requestPasswordReset($actor, $name, $actor);
        } finally {
            date_default_timezone_set($zone);
        }
    }

    public function history(int $actor, int $before = 0, int $limit = 20): array
    {
        $limit = max(1, min(50, $limit));
        $q = $this->pdo->prepare('SELECT id, action, entity_type, entity_id, UNIX_TIMESTAMP(created_at) AS timestamp, metadata FROM audit_logs WHERE user_id = ?' . ($before > 0 ? ' AND id < ?' : '') . ' ORDER BY id DESC LIMIT ' . ($limit + 1));
        $q->execute($before > 0 ? [$actor, $before] : [$actor]);
        $rows = $q->fetchAll();
        $more = count($rows) > $limit;
        $rows = array_slice($rows, 0, $limit);
        foreach ($rows as &$row) {
            $meta = json_decode($row['metadata'] ?? '', true);
            // Never return arbitrary metadata, which may contain security data.
            $row['description'] = is_string($meta['change'] ?? null) ? $meta['change'] : '';
            unset($row['metadata']);
        }
        unset($row);
        return ['items' => $rows, 'next_before' => $more ? (int) end($rows)['id'] : null];
    }
}

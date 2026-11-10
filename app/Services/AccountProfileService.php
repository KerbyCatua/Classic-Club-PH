<?php

declare(strict_types=1);

namespace ClassicClub\Services;

use ClassicClub\Repositories\UserRepository;
use ClassicClub\Support\AuditLogger;
use ClassicClub\Validation\ValidationException;
use PDO;
use PDOException;
use RuntimeException;
use Throwable;

final class AccountProfileService
{
    public function __construct(private readonly PDO $pdo) {}

    public function read(int $actor): array
    {
        $user = (new UserRepository($this->pdo))->findById($actor);
        $q = $this->pdo->prepare('SELECT status FROM newsletter_subscriptions WHERE email = ?');
        $q->execute([$user['email']]);
        return [
            'user' => $user,
            'newsletter' => $q->fetchColumn() === 'subscribed',
            'password_policy' => ['minimum' => SystemConfigurationService::value('password_min_length'), 'maximum' => 72],
        ];
    }

    public function updateProfile(int $actor, array $data): array
    {
        $this->pdo->beginTransaction();
        try {
            $user = $this->lockUser($actor);
            $emailChanged = $user['email'] !== $data['email'];
            if ($emailChanged) $this->verifyPassword($actor, $user, $data['current_password']);
            $q = $this->pdo->prepare('SELECT id FROM users WHERE email = ? AND id <> ?');
            $q->execute([$data['email'], $actor]);
            if ($q->fetchColumn()) throw new ValidationException('This email is already in use.', ['email' => 'An account already exists for this email.']);
            $q = $this->pdo->prepare('UPDATE users SET first_name = ?, last_name = ?, mobile = ?, email_verified_at = IF(email = ?, email_verified_at, NULL), email = ? WHERE id = ?');
            $q->execute([$data['first_name'], $data['last_name'], $data['mobile'] ?: null, $data['email'], $data['email'], $actor]);
            if ($emailChanged) {
                $q = $this->pdo->prepare("UPDATE newsletter_subscriptions SET status = 'unsubscribed', unsubscribed_at = NOW() WHERE email = ? AND status = 'subscribed'");
                $q->execute([$user['email']]);
            }
            $q = $this->pdo->prepare("INSERT INTO newsletter_subscriptions (email, status, source, unsubscribed_at) VALUES (?, ?, 'account', IF(? = 1, NULL, NOW())) ON DUPLICATE KEY UPDATE status = VALUES(status), unsubscribed_at = VALUES(unsubscribed_at)");
            $q->execute([$data['email'], $data['newsletter'] ? 'subscribed' : 'unsubscribed', (int) $data['newsletter']]);
            (new AuditLogger($this->pdo))->record('account.profile_updated', $actor, 'user', $actor);
            $this->pdo->commit();
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            $this->recordPasswordFailure($actor, $e);
            if ($e instanceof PDOException && $e->getCode() === '23000') throw new ValidationException('This email is already in use.', ['email' => 'An account already exists for this email.']);
            throw $e;
        }
        return $this->read($actor);
    }

    public function updatePassword(int $actor, array $data): void
    {
        $this->pdo->beginTransaction();
        try {
            $user = $this->lockUser($actor);
            $this->verifyPassword($actor, $user, $data['current_password']);
            $hash = password_hash($data['new_password'], PASSWORD_DEFAULT);
            if ($hash === false) throw new RuntimeException('Unable to secure the password.');
            $q = $this->pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
            $q->execute([$hash, $actor]);
            (new AuditLogger($this->pdo))->record('account.password_changed', $actor, 'user', $actor);
            $this->pdo->commit();
            // Preserve this session; SessionManager applies the configured policy to other sessions.
            $_SESSION['password_fingerprint'] = hash('sha256', $hash);
            session_regenerate_id(true);
        } catch (Throwable $e) {
            if ($this->pdo->inTransaction()) $this->pdo->rollBack();
            $this->recordPasswordFailure($actor, $e);
            throw $e;
        }
    }

    private function lockUser(int $actor): array
    {
        $q = $this->pdo->prepare("SELECT email, password_hash FROM users WHERE id = ? AND status = 'active' AND deleted_at IS NULL FOR UPDATE");
        $q->execute([$actor]);
        return $q->fetch() ?: throw new RuntimeException('Account unavailable.', 401);
    }

    private function verifyPassword(int $actor, array $user, string $password): void
    {
        $q = $this->pdo->prepare("SELECT COUNT(*) FROM audit_logs WHERE user_id = ? AND action = 'account.password_failed' AND created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)");
        $q->execute([$actor]);
        if ((int) $q->fetchColumn() >= SystemConfigurationService::value('failed_login_limit')) throw new RuntimeException('Too many incorrect password attempts. Try again in 15 minutes.', 429);
        if (!password_verify($password, $user['password_hash'])) throw new ValidationException('Current password does not match our records.', ['current_password' => 'Enter your correct current password.']);
    }

    private function recordPasswordFailure(int $actor, Throwable $error): void
    {
        if ($error instanceof ValidationException && isset($error->errors()['current_password'])) {
            (new AuditLogger($this->pdo))->record('account.password_failed', $actor, 'user', $actor);
        }
    }
}

<?php

declare(strict_types=1);

namespace ClassicClub\Services;

require_once __DIR__ . '/SystemConfigurationService.php';

use ClassicClub\Auth\SessionManager;
use ClassicClub\Repositories\UserRepository;
use ClassicClub\Support\AuditLogger;
use RuntimeException;

final class AuthService
{
    public function __construct(
        private readonly UserRepository $users,
        private readonly AuditLogger $auditLogger
    ) {
    }

    public function register(array $data): array
    {
        if (!SystemConfigurationService::value('registration_enabled')) {
            throw new RuntimeException('Public account registration is currently disabled.');
        }
        if ($this->users->findByEmail($data['email']) !== null) {
            throw new RuntimeException('An account already exists for this email.');
        }

        $passwordHash = password_hash(
            $data['password'],
            PASSWORD_DEFAULT
        );

        if ($passwordHash === false) {
            throw new RuntimeException('Unable to secure the password.');
        }

        $userId = $this->users->create(
            $data['email'],
            $passwordHash,
            $data['first_name'],
            $data['last_name']
        );

        $this->users->assignRole($userId, 'customer');

        SessionManager::login($userId);

        $this->auditLogger->record(
            'auth.registration',
            $userId,
            'user',
            $userId
        );

        return $this->users->findById($userId)
            ?? throw new RuntimeException('Unable to load the new account.');
    }

    public function login(array $data): array
    {
        global $pdo;
        if ($pdo instanceof \PDO) {
            $q = $pdo->prepare("SELECT COUNT(*) FROM audit_logs WHERE action = 'auth.login_failed' AND created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE) AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.email')) = ?");
            $q->execute([$data['email']]);
            if ((int) $q->fetchColumn() >= SystemConfigurationService::value('failed_login_limit')) {
                throw new RuntimeException('Too many failed sign-in attempts. Please try again in 15 minutes.');
            }
        }
        $user = $this->users->findByEmail($data['email']);

        if (
            $user === null ||
            !password_verify($data['password'], $user['password_hash'])
        ) {
            $this->auditLogger->record('auth.login_failed', null, null, null, ['email' => $data['email']]);
            throw new RuntimeException('Invalid email or password.');
        }

        if ($user['status'] !== 'active') {
            throw new RuntimeException('This account is not active.');
        }

        if (
            password_needs_rehash(
                $user['password_hash'],
                PASSWORD_DEFAULT
            )
        ) {
            $newHash = password_hash(
                $data['password'],
                PASSWORD_DEFAULT
            );

            if ($newHash === false) {
                throw new RuntimeException('Unable to update password security.');
            }

            // Optional later improvement: add updatePasswordHash() to repository.
        }

        $userId = (int) $user['id'];

        $this->users->updateLastLogin($userId);
        SessionManager::login($userId);

        $this->auditLogger->record(
            'auth.login',
            $userId,
            'user',
            $userId
        );

        unset($user['password_hash']);
        $user['roles'] = array_column($this->users->getRoles($userId), 'name');

        return $user;
    }

    public function currentUser(): array
    {
        $userId = SessionManager::userId();

        if ($userId === null) {
            throw new RuntimeException('Authentication required.');
        }

        $user = $this->users->findById($userId);

        if ($user === null) {
            SessionManager::logout();
            throw new RuntimeException('User account was not found.');
        }

        $user['roles'] = array_column($this->users->getRoles($userId), 'name');

        
        return $user;
    }

    public function logout(): void
    {
        SessionManager::logout();
    }

    public function assignRole(int $userId, string $role): void
    {
        $this->users->assignRole($userId, $role);
    }
}


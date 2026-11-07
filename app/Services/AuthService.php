<?php

declare(strict_types=1);

namespace ClassicClub\Services;

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
        $user = $this->users->findByEmail($data['email']);

        if (
            $user === null ||
            !password_verify($data['password'], $user['password_hash'])
        ) {
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


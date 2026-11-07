<?php

declare(strict_types=1);

namespace ClassicClub\Repositories;

use PDO;
use RuntimeException;

final class UserRepository
{
    public function __construct(
        private readonly PDO $pdo
    ) {
    }

    public function findByEmail(string $email): ?array
    {
        $statement = $this->pdo->prepare(
            <<<'SQL'
                SELECT
                    id,
                    email,
                    password_hash,
                    first_name,
                    last_name,
                    mobile,
                    status
                FROM users
                WHERE email = :email
                  AND deleted_at IS NULL
                LIMIT 1
            SQL
        );

        $statement->execute([
            'email' => strtolower(trim($email)),
        ]);

        $user = $statement->fetch();

        return $user ?: null;
    }

    public function findById(int $id): ?array
    {
        $statement = $this->pdo->prepare(
            <<<'SQL'
                SELECT
                    id,
                    email,
                    first_name,
                    last_name,
                    mobile,
                    status,
                    created_at
                FROM users
                WHERE id = :id
                  AND deleted_at IS NULL
                LIMIT 1
            SQL
        );

        $statement->execute(['id' => $id]);

        $user = $statement->fetch();

        return $user ?: null;
    }

    public function create(
        string $email,
        string $passwordHash,
        string $firstName,
        string $lastName
    ): int {
        $statement = $this->pdo->prepare(
            <<<'SQL'
                INSERT INTO users
                    (email, password_hash, first_name, last_name, status)
                VALUES
                    (:email, :password_hash, :first_name, :last_name, 'active')
            SQL
        );

        $statement->execute([
            'email' => strtolower(trim($email)),
            'password_hash' => $passwordHash,
            'first_name' => trim($firstName),
            'last_name' => trim($lastName),
        ]);

        return (int) $this->pdo->lastInsertId();
    }

    public function getRoles(int $userId): array
    {
        $statement = $this->pdo->prepare(
            <<<'SQL'
                SELECT r.id, r.name, r.display_name
                FROM roles r
                INNER JOIN user_roles ur ON ur.role_id = r.id
                WHERE ur.user_id = :user_id
            SQL
        );

        $statement->execute(['user_id' => $userId]);

        return $statement->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    public function updateLastLogin(int $userId): void
    {
        $statement = $this->pdo->prepare(
            'UPDATE users SET last_login_at = NOW() WHERE id = :id'
        );

        $statement->execute(['id' => $userId]);
    }

    public function assignRole(int $userId, string $roleName): void
    {
        $statement = $this->pdo->prepare(
            <<<'SQL'
                INSERT INTO user_roles (user_id, role_id)
                SELECT :user_id, id
                FROM roles
                WHERE name = :role_name
                LIMIT 1
            SQL
        );

        $statement->execute([
            'user_id' => $userId,
            'role_name' => $roleName,
        ]);

        if ($statement->rowCount() !== 1) {
            throw new RuntimeException(
                'Unable to assign the requested user role.'
            );
        }
    }
}
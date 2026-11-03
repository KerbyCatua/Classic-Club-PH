<?php

declare(strict_types=1);

namespace ClassicClub\Authorization;

use PDO;

final class PermissionChecker
{
    public function __construct(
        private readonly PDO $pdo
    ) {
    }

    public function allows(int $userId, string $permissionName): bool
    {
        $statement = $this->pdo->prepare(
            <<<'SQL'
                SELECT
                    CASE
                        WHEN EXISTS (
                            SELECT 1
                            FROM user_permissions up
                            INNER JOIN permissions p
                                ON p.id = up.permission_id
                            WHERE up.user_id = :deny_user_id
                              AND p.name = :deny_permission
                              AND up.effect = 'deny'
                        ) THEN 0

                        WHEN EXISTS (
                            SELECT 1
                            FROM user_permissions up
                            INNER JOIN permissions p
                                ON p.id = up.permission_id
                            WHERE up.user_id = :allow_user_id
                              AND p.name = :allow_permission
                              AND up.effect = 'allow'
                        ) THEN 1

                        WHEN EXISTS (
                            SELECT 1
                            FROM user_roles ur
                            INNER JOIN role_permissions rp
                                ON rp.role_id = ur.role_id
                            INNER JOIN permissions p
                                ON p.id = rp.permission_id
                            WHERE ur.user_id = :role_user_id
                              AND p.name = :role_permission
                        ) THEN 1

                        ELSE 0
                    END AS is_allowed
            SQL
        );

        $statement->execute([
            'deny_user_id' => $userId,
            'deny_permission' => $permissionName,
            'allow_user_id' => $userId,
            'allow_permission' => $permissionName,
            'role_user_id' => $userId,
            'role_permission' => $permissionName,
        ]);

        return (bool) $statement->fetchColumn();
    }
}
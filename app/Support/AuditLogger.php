<?php

declare(strict_types=1);

namespace ClassicClub\Support;

use PDO;
use Throwable;

final class AuditLogger
{
    public function __construct(
        private readonly PDO $pdo
    ) {
    }

    public function record(
        string $action,
        ?int $userId = null,
        ?string $entityType = null,
        ?int $entityId = null,
        array $metadata = []
    ): void {
        try {
            $statement = $this->pdo->prepare(
                <<<'SQL'
                    INSERT INTO audit_logs
                        (
                            user_id,
                            action,
                            entity_type,
                            entity_id,
                            ip_address,
                            user_agent,
                            metadata
                        )
                    VALUES
                        (
                            :user_id,
                            :action,
                            :entity_type,
                            :entity_id,
                            :ip_address,
                            :user_agent,
                            :metadata
                        )
                SQL
            );

            $statement->execute([
                'user_id' => $userId,
                'action' => $action,
                'entity_type' => $entityType,
                'entity_id' => $entityId,
                'ip_address' => $_SERVER['REMOTE_ADDR'] ?? null,
                'user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? null,
                'metadata' => $metadata === []
                    ? null
                    : json_encode($metadata, JSON_THROW_ON_ERROR),
            ]);
        } catch (Throwable $exception) {
            error_log('Audit log failed: ' . $exception->getMessage());
        }
    }
}
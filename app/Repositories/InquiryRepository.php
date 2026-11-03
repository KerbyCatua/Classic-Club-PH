<?php

declare(strict_types=1);

namespace ClassicClub\Repositories;

use PDO;

final class InquiryRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function create(array $inquiry): int
    {
        $statement = $this->pdo->prepare(
            <<<'SQL'
                INSERT INTO contact_inquiries
                    (user_id, full_name, email, topic, order_number, message)
                VALUES
                    (:user_id, :full_name, :email, :topic, :order_number, :message)
            SQL
        );
        $statement->execute($inquiry);

        return (int) $this->pdo->lastInsertId();
    }

    public function addAttachment(int $inquiryId, array $attachment): void
    {
        $statement = $this->pdo->prepare(
            <<<'SQL'
                INSERT INTO inquiry_attachments
                    (inquiry_id, original_name, stored_name, mime_type, file_size, storage_path)
                VALUES
                    (:inquiry_id, :original_name, :stored_name, :mime_type, :file_size, :storage_path)
            SQL
        );
        $statement->execute([
            'inquiry_id' => $inquiryId,
            ...$attachment,
        ]);
    }

    public function list(string $status = ''): array
    {
        $sql = <<<'SQL'
            SELECT i.id, i.full_name, i.email, i.topic, i.order_number, i.message,
                   i.status, i.assigned_to, i.created_at, i.updated_at,
                   COUNT(a.id) AS attachment_count
            FROM contact_inquiries i
            LEFT JOIN inquiry_attachments a ON a.inquiry_id = i.id
        SQL;
        $parameters = [];
        if ($status !== '') {
            $sql .= ' WHERE i.status = :status';
            $parameters['status'] = $status;
        }
        $sql .= ' GROUP BY i.id ORDER BY i.created_at DESC';
        $statement = $this->pdo->prepare($sql);
        $statement->execute($parameters);

        return $statement->fetchAll();
    }

    public function updateStatus(int $id, string $status, ?int $assignedTo): bool
    {
        $statement = $this->pdo->prepare(
            'UPDATE contact_inquiries SET status = :status, assigned_to = :assigned_to WHERE id = :id'
        );
        $statement->execute([
            'status' => $status,
            'assigned_to' => $assignedTo,
            'id' => $id,
        ]);

        return $statement->rowCount() > 0;
    }

    public function attachment(int $id): ?array
    {
        $statement = $this->pdo->prepare(
            'SELECT original_name, mime_type, storage_path FROM inquiry_attachments WHERE id = :id'
        );
        $statement->execute(['id' => $id]);
        $attachment = $statement->fetch();

        return $attachment ?: null;
    }
}

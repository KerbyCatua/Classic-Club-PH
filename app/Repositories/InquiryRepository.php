<?php

declare(strict_types=1);

namespace ClassicClub\Repositories;

use PDO;

final class InquiryRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function create(array $inquiry, int $businessId = 1): int
    {
        $statement = $this->pdo->prepare(
            <<<'SQL'
                INSERT INTO contact_inquiries
                    (business_id, user_id, full_name, email, topic, order_number, message)
                VALUES
                    (:business_id, :user_id, :full_name, :email, :topic, :order_number, :message)
            SQL
        );
        $statement->execute(['business_id' => $businessId] + $inquiry);

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

    public function list(int $businessId, string $status = ''): array
    {
        $sql = <<<'SQL'
            SELECT i.id, i.full_name, i.email, i.topic, i.order_number, i.message,
                   i.status, i.assigned_to, i.created_at, i.updated_at,
                   COUNT(a.id) AS attachment_count
            FROM contact_inquiries i
            LEFT JOIN inquiry_attachments a ON a.inquiry_id = i.id
            WHERE i.business_id = :business_id
        SQL;
        $parameters = ['business_id' => $businessId];
        if ($status !== '') {
            $sql .= ' AND i.status = :status';
            $parameters['status'] = $status;
        }
        $sql .= ' GROUP BY i.id ORDER BY i.created_at DESC';
        $statement = $this->pdo->prepare($sql);
        $statement->execute($parameters);

        return $statement->fetchAll();
    }

    public function updateStatus(int $businessId, int $id, string $status, ?int $assignedTo): bool
    {
        $statement = $this->pdo->prepare(
            'UPDATE contact_inquiries SET status = :status, assigned_to = :assigned_to WHERE business_id = :business_id AND id = :id'
        );
        $statement->execute([
            'business_id' => $businessId,
            'status' => $status,
            'assigned_to' => $assignedTo,
            'id' => $id,
        ]);

        return $statement->rowCount() > 0;
    }

    public function attachment(int $businessId, int $id): ?array
    {
        $statement = $this->pdo->prepare(
            'SELECT a.original_name, a.mime_type, a.storage_path
             FROM inquiry_attachments a JOIN contact_inquiries i ON i.id = a.inquiry_id
             WHERE i.business_id = :business_id AND a.id = :id'
        );
        $statement->execute(['business_id' => $businessId, 'id' => $id]);
        $attachment = $statement->fetch();

        return $attachment ?: null;
    }
}

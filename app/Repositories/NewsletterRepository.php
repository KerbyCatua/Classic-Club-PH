<?php

declare(strict_types=1);

namespace ClassicClub\Repositories;

use PDO;

final class NewsletterRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function subscribe(string $email, string $source = 'footer'): array
    {
        $statement = $this->pdo->prepare(
            <<<'SQL'
                INSERT INTO newsletter_subscriptions
                    (email, status, source, unsubscribed_at)
                VALUES
                    (:email, 'subscribed', :source, NULL)
                ON DUPLICATE KEY UPDATE
                    status = 'subscribed',
                    source = VALUES(source),
                    unsubscribed_at = NULL
            SQL
        );
        $statement->execute(['email' => $email, 'source' => $source]);

        return ['email' => $email, 'status' => 'subscribed'];
    }
}

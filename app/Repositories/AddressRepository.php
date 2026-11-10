<?php

declare(strict_types=1);

namespace ClassicClub\Repositories;

use PDO;
use RuntimeException;
use Throwable;

final class AddressRepository
{
    public function __construct(private readonly PDO $pdo) {}

    public function all(int $userId): array
    {
        $q = $this->pdo->prepare('SELECT * FROM user_addresses WHERE user_id = ? ORDER BY is_default_shipping DESC, id ASC');
        $q->execute([$userId]);
        return $q->fetchAll();
    }

    public function save(int $userId, ?int $id, array $data): int
    {
        return $this->mutate($userId, function () use ($userId, $id, $data): int {
            if ($id !== null) $this->requireOwned($userId, $id);
            foreach (['is_default_shipping', 'is_default_billing'] as $flag) {
                if ($data[$flag]) {
                    $q = $this->pdo->prepare("UPDATE user_addresses SET $flag = 0 WHERE user_id = ?");
                    $q->execute([$userId]);
                }
            }
            if ($id === null) {
                $columns = array_keys($data);
                $q = $this->pdo->prepare('INSERT INTO user_addresses (user_id, ' . implode(', ', $columns) . ') VALUES (?' . str_repeat(', ?', count($columns)) . ')');
                $q->execute([$userId, ...array_values($data)]);
                $id = (int) $this->pdo->lastInsertId();
            } else {
                $assignments = array_map(static fn ($key) => "$key = ?", array_keys($data));
                $q = $this->pdo->prepare('UPDATE user_addresses SET ' . implode(', ', $assignments) . ' WHERE id = ? AND user_id = ?');
                $q->execute([...array_values($data), $id, $userId]);
            }
            return $id;
        });
    }

    public function delete(int $userId, int $id): void
    {
        $this->mutate($userId, function () use ($userId, $id): int {
            $this->requireOwned($userId, $id);
            $q = $this->pdo->prepare('DELETE FROM user_addresses WHERE id = ? AND user_id = ?');
            $q->execute([$id, $userId]);
            return $id;
        });
    }

    private function requireOwned(int $userId, int $id): void
    {
        $q = $this->pdo->prepare('SELECT id FROM user_addresses WHERE id = ? AND user_id = ?');
        $q->execute([$id, $userId]);
        if (!$q->fetchColumn()) throw new RuntimeException('Address not found.', 404);
    }

    private function mutate(int $userId, callable $operation): int
    {
        $this->pdo->beginTransaction();
        try {
            // Serialize changes for this account, including first-address creation.
            $q = $this->pdo->prepare('SELECT id FROM users WHERE id = ? FOR UPDATE');
            $q->execute([$userId]);
            $id = $operation();
            foreach (['is_default_shipping', 'is_default_billing'] as $flag) {
                $q = $this->pdo->prepare("SELECT id FROM user_addresses WHERE user_id = ? AND $flag = 1");
                $q->execute([$userId]);
                if (!$q->fetchColumn()) {
                    $q = $this->pdo->prepare("UPDATE user_addresses SET $flag = 1 WHERE user_id = ? ORDER BY id ASC LIMIT 1");
                    $q->execute([$userId]);
                }
            }
            $this->pdo->commit();
            return $id;
        } catch (Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }
}

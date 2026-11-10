<?php
declare(strict_types=1);
namespace ClassicClub\Services;

use PDO;
use InvalidArgumentException;
use RuntimeException;
use Throwable;

final class ErrorManagementService
{
    public function __construct(private readonly PDO $pdo) {}

    public function listing(array $filters): array
    {
        $where = ['1=1']; $params = [];
        foreach (['severity' => ['Critical', 'High', 'Medium', 'Low', 'Informational'], 'state' => ['Resolved', 'Unresolved'], 'recurring' => ['Recurring', 'Single']] as $key => $values) {
            $value = $filters[$key] ?? '';
            if (!is_string($value) || ($value !== '' && !in_array($value, $values, true))) throw new InvalidArgumentException('Invalid ' . $key . ' filter.');
            if ($value === '') continue;
            if ($key === 'recurring') $where[] = $value === 'Recurring' ? 'g.occurrences > 1' : 'g.occurrences = 1';
            else { $where[] = "g.$key = ?"; $params[] = $value; }
        }
        foreach (['search', 'date', 'module'] as $key) {
            if (isset($filters[$key]) && (!is_string($filters[$key]) || strlen($filters[$key]) > 255)) throw new InvalidArgumentException('Invalid filter.');
        }
        if (!empty($filters['date'])) {
            $date = \DateTimeImmutable::createFromFormat('!Y-m-d', $filters['date']);
            if (!$date || $date->format('Y-m-d') !== $filters['date']) throw new InvalidArgumentException('Invalid date.');
            $where[] = 'EXISTS (SELECT 1 FROM error_events d WHERE d.group_id=g.id AND d.occurred_at >= ? AND d.occurred_at < ?)';
            $params[] = $date->format('Y-m-d'); $params[] = $date->modify('+1 day')->format('Y-m-d');
        }
        if (!empty($filters['module'])) { $where[] = 'g.module = ?'; $params[] = $filters['module']; }
        if (!empty($filters['search'])) {
            $where[] = "(CONCAT('ERR-',g.id,' ',g.summary,' ',g.module) LIKE ? OR EXISTS (SELECT 1 FROM error_events e WHERE e.group_id=g.id AND CONCAT(e.request_id,' ',e.endpoint,' ',e.source) LIKE ?))";
            $params[] = '%' . $filters['search'] . '%'; $params[] = '%' . $filters['search'] . '%';
        }
        $page = filter_var($filters['page'] ?? 1, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 1000000]]);
        if ($page === false) throw new InvalidArgumentException('Invalid page.');
        $sql = implode(' AND ', $where);
        $q = $this->pdo->prepare("SELECT COUNT(*) FROM error_groups g WHERE $sql"); $q->execute($params); $total = (int) $q->fetchColumn();
        $page = min($page, max(1, (int) ceil($total / 25)));
        $offset = ($page - 1) * 25;
        $q = $this->pdo->prepare("SELECT g.* FROM error_groups g WHERE $sql ORDER BY g.last_seen DESC, g.id DESC LIMIT 25 OFFSET $offset"); $q->execute($params);
        $now = (new \DateTimeImmutable('now', new \DateTimeZone('Asia/Manila')))->modify('-24 hours')->format('Y-m-d H:i:s');
        $count = $this->pdo->prepare('SELECT COUNT(*) FROM error_events WHERE occurred_at >= ? AND http_status >= 400'); $count->execute([$now]);
        return ['groups' => $q->fetchAll(PDO::FETCH_ASSOC), 'total' => $total, 'page' => $page, 'pages' => max(1, (int) ceil($total / 25)), 'failed_24h' => (int) $count->fetchColumn(),
            'unresolved' => (int) $this->pdo->query("SELECT COUNT(*) FROM error_groups WHERE state='Unresolved'")->fetchColumn(),
            'modules' => $this->pdo->query('SELECT DISTINCT module FROM error_groups ORDER BY module')->fetchAll(PDO::FETCH_COLUMN)];
    }

    public function detail(int $id, int $eventPage = 1): array
    {
        $q = $this->pdo->prepare('SELECT * FROM error_groups WHERE id=?'); $q->execute([$id]); $group = $q->fetch(PDO::FETCH_ASSOC);
        if (!$group) throw new RuntimeException('Error group not found.', 404);
        $offset = (max(1, min(1000000, $eventPage)) - 1) * 25;
        $q = $this->pdo->prepare("SELECT * FROM error_events WHERE group_id=? ORDER BY id DESC LIMIT 25 OFFSET $offset"); $q->execute([$id]); $events = $q->fetchAll(PDO::FETCH_ASSOC);
        $q = $this->pdo->prepare("SELECT a.id, a.created_at, a.metadata, CONCAT_WS(' ',u.first_name,u.last_name) AS actor FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE a.entity_type='error_group' AND a.entity_id=? ORDER BY a.id DESC LIMIT 30"); $q->execute([$id]);
        $history = $q->fetchAll(PDO::FETCH_ASSOC);
        foreach ($history as &$row) $row['metadata'] = json_decode($row['metadata'] ?? '{}', true);
        return ['group' => $group, 'events' => $events, 'history' => $history, 'event_page' => $eventPage,
            'event_pages' => max(1, (int) ceil((int) $group['occurrences'] / 25)),
            'reviewers' => $this->pdo->query("SELECT DISTINCT u.id, CONCAT_WS(' ',u.first_name,u.last_name) AS name FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.name='super_admin' AND u.status='active' AND u.deleted_at IS NULL ORDER BY name")->fetchAll(PDO::FETCH_ASSOC),
            'incidents' => $this->incidents($group['incident_id'])];
    }

    private function incidents(mixed $linked): array
    {
        $q = $this->pdo->prepare('SELECT id, checked_at, service, status FROM monitoring_samples WHERE healthy=0 ORDER BY id DESC LIMIT 100'); $q->execute(); $rows = $q->fetchAll(PDO::FETCH_ASSOC);
        if ($linked && !in_array((int) $linked, array_map(static fn ($r) => (int) $r['id'], $rows), true)) {
            $q = $this->pdo->prepare('SELECT id, checked_at, service, status FROM monitoring_samples WHERE id=?'); $q->execute([$linked]);
            if ($row = $q->fetch(PDO::FETCH_ASSOC)) $rows[] = $row;
        }
        return $rows;
    }

    public function update(int $actor, array $body): array
    {
        foreach (['id', 'version'] as $key) if (!filter_var($body[$key] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]])) throw new InvalidArgumentException('Invalid ' . $key . '.');
        if (!in_array($body['severity'] ?? '', ['Critical', 'High', 'Medium', 'Low', 'Informational'], true) || !in_array($body['state'] ?? '', ['Resolved', 'Unresolved'], true)) throw new InvalidArgumentException('Choose a valid severity and state.');
        $note = $body['note'] ?? '';
        if (!is_string($note) || strlen($note) > 4000) throw new InvalidArgumentException('Notes must be at most 4000 bytes.');
        if (!is_bool($body['reviewed'] ?? null)) throw new InvalidArgumentException('Invalid review flag.');
        foreach (['reviewer_id', 'incident_id'] as $key) {
            if (($body[$key] ?? null) !== null && !filter_var($body[$key], FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]])) throw new InvalidArgumentException('Invalid assignment.');
        }
        $this->pdo->beginTransaction();
        try {
            $q = $this->pdo->prepare('SELECT * FROM error_groups WHERE id=? FOR UPDATE'); $q->execute([$body['id']]); $before = $q->fetch(PDO::FETCH_ASSOC);
            if (!$before) throw new RuntimeException('Error group not found.', 404);
            if ((int) $before['version'] !== (int) $body['version']) throw new RuntimeException('This group changed. Reload its details before saving.', 409);
            if ($body['reviewer_id'] ?? null) {
                $q = $this->pdo->prepare("SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.id=? AND r.name='super_admin' AND u.status='active' AND u.deleted_at IS NULL"); $q->execute([$body['reviewer_id']]);
                if (!$q->fetchColumn()) throw new InvalidArgumentException('Reviewer must be an active Super Admin.');
            }
            if ($body['incident_id'] ?? null) {
                $q = $this->pdo->prepare('SELECT 1 FROM monitoring_samples WHERE id=? AND healthy=0'); $q->execute([$body['incident_id']]);
                if (!$q->fetchColumn()) throw new InvalidArgumentException('Select a recorded failed health check.');
            }
            $actionAt = (new \DateTimeImmutable('now', new \DateTimeZone('Asia/Manila')))->format('Y-m-d H:i:s');
            $reviewedAt = $body['reviewed'] ? $actionAt : null;
            $q = $this->pdo->prepare('UPDATE error_groups SET severity=?, state=?, reviewer_id=?, incident_id=?, reviewed_at=?, version=version+1 WHERE id=?');
            $q->execute([$body['severity'], $body['state'], $body['reviewer_id'] ?? null, $body['incident_id'] ?? null, $reviewedAt, $body['id']]);
            // Use the existing audit store; failure must roll back this management action.
            $q = $this->pdo->prepare("INSERT INTO audit_logs (user_id, action, entity_type, entity_id, metadata, created_at) VALUES (?, 'error.triage', 'error_group', ?, ?, ?)");
            $q->execute([$actor, $body['id'], json_encode(['before' => array_intersect_key($before, array_flip(['severity', 'state', 'reviewer_id', 'incident_id', 'reviewed_at'])), 'after' => ['severity' => $body['severity'], 'state' => $body['state'], 'reviewer_id' => $body['reviewer_id'] ?? null, 'incident_id' => $body['incident_id'] ?? null, 'reviewed_at' => $reviewedAt], 'note' => trim($note)], JSON_THROW_ON_ERROR), $actionAt]);
            $this->pdo->commit();
        } catch (Throwable $e) { $this->pdo->rollBack(); throw $e; }
        return $this->detail((int) $body['id']);
    }
}

<?php

declare(strict_types=1);

namespace ClassicClub\Services;

use ClassicClub\Support\AuditLogger;
use ClassicClub\Validation\ValidationException;
use DateTimeImmutable;
use DateTimeZone;
use PDO;
use RuntimeException;
use Throwable;

/**
 * Application-wide user administration for the Super Admin workspace
 * (Module 21.2). All reads and writes target the live users / roles /
 * user_roles / business_users tables.
 */
final class GlobalUserService
{
    private const ROLE_LABELS = [
        'super_admin' => 'Super Admin',
        'admin' => 'Admin / Business Owner',
        'customer' => 'Customer',
    ];

    private const STATUS_LABELS = [
        'active' => 'Active',
        'inactive' => 'Inactive',
        'suspended' => 'Suspended',
        'pending' => 'Pending',
    ];

    private const PERMISSION_SETS = [
        'owner' => [
            'label' => 'Business owner · business-bound',
            'role_title' => 'Business owner',
            'flags' => [
                'can_manage_products' => 1,
                'can_adjust_stock' => 1,
                'can_view_reports' => 1,
                'can_reply_reviews' => 1,
                'can_view_notifications' => 1,
                'can_manage_staff' => 1,
            ],
        ],
        'inventory_manager' => [
            'label' => 'Inventory manager · business-bound',
            'role_title' => 'Inventory manager',
            'flags' => [
                'can_manage_products' => 1,
                'can_adjust_stock' => 1,
                'can_view_reports' => 1,
                'can_reply_reviews' => 1,
                'can_view_notifications' => 1,
                'can_manage_staff' => 0,
            ],
        ],
        'reports_staff' => [
            'label' => 'Review & reports staff · business-bound',
            'role_title' => 'Review & reports staff',
            'flags' => [
                'can_manage_products' => 0,
                'can_adjust_stock' => 0,
                'can_view_reports' => 1,
                'can_reply_reviews' => 1,
                'can_view_notifications' => 1,
                'can_manage_staff' => 0,
            ],
        ],
        'inventory_viewer' => [
            'label' => 'Inventory viewer · business-bound',
            'role_title' => 'Inventory viewer',
            'flags' => [
                'can_manage_products' => 0,
                'can_adjust_stock' => 0,
                'can_view_reports' => 1,
                'can_reply_reviews' => 0,
                'can_view_notifications' => 1,
                'can_manage_staff' => 0,
            ],
        ],
    ];

    public function __construct(
        private readonly PDO $pdo,
        private readonly AuditLogger $auditLogger
    ) {
    }

    public function getUsers(array $filters = []): array
    {
        $rows = $this->fetchUserRows($filters);
        $users = array_map(fn (array $row): array => $this->mapUserRow($row), $rows);
        $summary = $this->getSummary();
        $now = new DateTimeImmutable('now', new DateTimeZone('Asia/Manila'));

        return [
            'users' => $users,
            'summary' => $summary,
            'filters' => $this->getFilterOptions(),
            'meta' => [
                'matching' => count($users),
                'total' => $summary['total'],
                'generated_at_label' => $now->format('d M Y, H:i') . ' PHT',
            ],
        ];
    }

    public function getUserDetail(int $userId, int $historyLimit = 6): array
    {
        $rows = $this->fetchUserRows(['id' => $userId]);

        if ($rows === []) {
            throw new RuntimeException('That user account could not be found.');
        }

        $user = $this->mapUserRow($rows[0]);
        $history = $this->getHistory($userId, $historyLimit);

        return [
            'user' => $user,
            'history' => $history,
            'history_total' => $this->countHistory($userId),
        ];
    }

    public function createUser(int $actorUserId, string $actorName, array $data): array
    {
        $this->assertEmailUnique($data['email']);

        $passwordHash = password_hash(bin2hex(random_bytes(24)), PASSWORD_DEFAULT);
        if ($passwordHash === false) {
            throw new RuntimeException('Unable to secure the new account credential.');
        }

        $status = $data['status'];
        if ($data['require_email_verification'] && $status === 'active') {
            $status = 'pending';
        }

        $verifiedAt = $data['require_email_verification'] ? null : date('Y-m-d H:i:s');

        $this->pdo->beginTransaction();

        try {
            $statement = $this->pdo->prepare(<<<'SQL'
                INSERT INTO users
                    (
                        email,
                        password_hash,
                        first_name,
                        last_name,
                        status,
                        email_verified_at,
                        created_at
                    )
                VALUES
                    (
                        :email,
                        :password_hash,
                        :first_name,
                        :last_name,
                        :status,
                        :email_verified_at,
                        NOW()
                    )
            SQL);

            $statement->execute([
                'email' => $data['email'],
                'password_hash' => $passwordHash,
                'first_name' => $data['first_name'],
                'last_name' => $data['last_name'],
                'status' => $status,
                'email_verified_at' => $verifiedAt,
            ]);

            $userId = (int) $this->pdo->lastInsertId();

            $this->syncRole($userId, $data['role']);
            $this->syncBusinessAssignment(
                $userId,
                $data['name'],
                $data['email'],
                $data['role'],
                (int) $data['business_id'],
                (string) $data['permission_set']
            );

            if ($data['send_invitation']) {
                $this->issueResetToken($userId, $actorUserId);
            }

            $this->auditLogger->record(
                'users.created',
                $actorUserId,
                'user',
                $userId,
                [
                    'actor' => $actorName,
                    'change' => sprintf(
                        'Created %s account %s · status %s%s',
                        self::ROLE_LABELS[$data['role']],
                        $data['email'],
                        self::STATUS_LABELS[$status],
                        $data['send_invitation'] ? ' · one-time invitation prepared' : ''
                    ),
                    'role' => $data['role'],
                    'status' => $status,
                    'business_id' => (int) $data['business_id'],
                    'invitation' => $data['send_invitation'],
                ]
            );

            $this->pdo->commit();
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }

        $detail = $this->getUserDetail($userId, 8);

        return [
            'message' => sprintf('Account created for %s.', $data['email']),
            'user' => $detail['user'],
            'history' => $detail['history'],
        ];
    }

    public function updateUser(int $actorUserId, string $actorName, array $data): array
    {
        $target = $this->findUserOrFail((int) $data['user_id']);
        $this->assertEmailUnique($data['email'], (int) $target['id']);

        $currentRole = (string) $target['role_key'];
        $currentStatus = (string) $target['status_key'];
        $newRole = (string) $data['role'];
        $newStatus = (string) $data['status'];

        if ((int) $target['id'] === $actorUserId) {
            if ($newRole !== 'super_admin') {
                throw new ValidationException(
                    'You cannot remove the Super Admin role from your own account.',
                    ['role' => 'Another Super Admin must change your global role.']
                );
            }

            if ($newStatus !== 'active') {
                throw new ValidationException(
                    'You cannot deactivate or suspend your own Super Admin account.',
                    ['status' => 'Keep your own account active.']
                );
            }
        }

        $this->assertSuperAdminCoverage((int) $target['id'], $currentRole, $currentStatus, $newRole, $newStatus);

        $changes = [];
        if ((string) $target['name'] !== (string) $data['name']) {
            $changes[] = 'Name: ' . $target['name'] . ' → ' . $data['name'];
        }
        if ((string) $target['email'] !== (string) $data['email']) {
            $changes[] = 'Email: ' . $target['email'] . ' → ' . $data['email'];
        }
        if ($currentRole !== $newRole) {
            $changes[] = 'Role: ' . self::ROLE_LABELS[$currentRole] . ' → ' . self::ROLE_LABELS[$newRole];
        }
        if ($currentStatus !== $newStatus) {
            $changes[] = 'Status: ' . self::STATUS_LABELS[$currentStatus] . ' → ' . self::STATUS_LABELS[$newStatus];
        }

        $currentBusiness = (string) ($target['business_name'] ?? '');
        if ($currentBusiness === '') {
            $currentBusiness = 'Not assigned';
        }
        $newBusiness = 'Not business-bound';
        if ($newRole === 'admin') {
            $newBusiness = $this->businessName((int) $data['business_id']) ?? 'Not assigned';
        }
        if ($currentRole === 'admin' && $currentBusiness !== $newBusiness) {
            $changes[] = 'Assigned business: ' . $currentBusiness . ' → ' . $newBusiness;
        }

        $this->pdo->beginTransaction();

        try {
            $statement = $this->pdo->prepare(<<<'SQL'
                UPDATE users
                SET
                    first_name = :first_name,
                    last_name = :last_name,
                    email = :email,
                    status = :status,
                    email_verified_at = CASE
                        WHEN :status_verified = 'active' THEN COALESCE(email_verified_at, NOW())
                        ELSE email_verified_at
                    END
                WHERE id = :id
                  AND deleted_at IS NULL
            SQL);

            $statement->execute([
                'first_name' => $data['first_name'],
                'last_name' => $data['last_name'],
                'email' => $data['email'],
                'status' => $newStatus,
                'status_verified' => $newStatus,
                'id' => (int) $target['id'],
            ]);

            $this->syncRole((int) $target['id'], $newRole);
            $this->syncBusinessAssignment(
                (int) $target['id'],
                (string) $data['name'],
                (string) $data['email'],
                $newRole,
                (int) $data['business_id'],
                (string) $data['permission_set']
            );

            $this->auditLogger->record(
                'users.updated',
                $actorUserId,
                'user',
                (int) $target['id'],
                [
                    'actor' => $actorName,
                    'change' => $changes === [] ? 'Account details reviewed; no field changes.' : implode('; ', $changes),
                    'changes' => $changes,
                    'role' => $newRole,
                    'status' => $newStatus,
                ]
            );

            $this->pdo->commit();
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }

        $detail = $this->getUserDetail((int) $target['id'], 8);

        return [
            'message' => sprintf('Account details saved for %s.', $data['name']),
            'user' => $detail['user'],
            'history' => $detail['history'],
        ];
    }

    public function setUserStatus(int $actorUserId, string $actorName, array $data): array
    {
        $target = $this->findUserOrFail((int) $data['user_id']);
        $newStatus = (string) $data['status'];
        $currentStatus = (string) $target['status_key'];
        $currentRole = (string) $target['role_key'];

        if ((int) $target['id'] === $actorUserId && $newStatus !== 'active') {
            throw new ValidationException(
                'You cannot deactivate or suspend your own Super Admin account.',
                ['status' => 'Keep your own account active.']
            );
        }

        $this->assertSuperAdminCoverage(
            (int) $target['id'],
            $currentRole,
            $currentStatus,
            $currentRole,
            $newStatus
        );

        if ($newStatus === 'suspended') {
            $expected = 'SUSPEND ' . strtoupper((string) $target['name']);
            $confirmation = strtoupper(trim((string) $data['confirmation']));

            if ($confirmation !== $expected) {
                throw new ValidationException(
                    'The suspension confirmation phrase does not match.',
                    ['confirmation' => 'Type exactly: ' . $expected]
                );
            }
        }

        if ($currentStatus === $newStatus) {
            return [
                'message' => sprintf('%s is already marked %s.', $target['name'], self::STATUS_LABELS[$newStatus]),
                'user' => $target,
                'history' => $this->getHistory((int) $target['id'], 8),
            ];
        }

        $this->pdo->beginTransaction();

        try {
            $statement = $this->pdo->prepare(<<<'SQL'
                UPDATE users
                SET
                    status = :status,
                    email_verified_at = CASE
                        WHEN :status_verified = 'active' THEN COALESCE(email_verified_at, NOW())
                        ELSE email_verified_at
                    END
                WHERE id = :id
                  AND deleted_at IS NULL
            SQL);

            $statement->execute([
                'status' => $newStatus,
                'status_verified' => $newStatus,
                'id' => (int) $target['id'],
            ]);

            $this->auditLogger->record(
                'users.status_changed',
                $actorUserId,
                'user',
                (int) $target['id'],
                [
                    'actor' => $actorName,
                    'change' => 'Status: ' . self::STATUS_LABELS[$currentStatus] . ' → ' . self::STATUS_LABELS[$newStatus],
                    'previous_status' => $currentStatus,
                    'status' => $newStatus,
                ]
            );

            $this->pdo->commit();
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }

        $detail = $this->getUserDetail((int) $target['id'], 8);

        return [
            'message' => sprintf('%s is now %s.', $target['name'], self::STATUS_LABELS[$newStatus]),
            'user' => $detail['user'],
            'history' => $detail['history'],
        ];
    }

    public function changeUserRole(int $actorUserId, string $actorName, array $data): array
    {
        $target = $this->findUserOrFail((int) $data['user_id']);
        $currentRole = (string) $target['role_key'];
        $newRole = (string) $data['role'];

        if ((int) $target['id'] === $actorUserId && $newRole !== $currentRole) {
            throw new ValidationException(
                'You cannot change your own global role.',
                ['role' => 'Another Super Admin must change your role.']
            );
        }

        $this->assertSuperAdminCoverage(
            (int) $target['id'],
            $currentRole,
            (string) $target['status_key'],
            $newRole,
            (string) $target['status_key']
        );

        $privileged = $currentRole === 'super_admin' || $newRole === 'super_admin';
        $approverName = '';

        if ($privileged) {
            $approverId = (int) $data['approver_id'];

            if ($approverId < 1) {
                throw new ValidationException(
                    'A second authorized Super Admin approver is required for privileged role changes.',
                    ['approver_id' => 'Choose an authorized Super Admin approver.']
                );
            }

            if ($approverId === $actorUserId) {
                throw new ValidationException(
                    'The second approver must be a different Super Admin account.',
                    ['approver_id' => 'Choose another authorized Super Admin.']
                );
            }

            if ($approverId === (int) $target['id']) {
                throw new ValidationException(
                    'The target account cannot approve its own role change.',
                    ['approver_id' => 'Choose another authorized Super Admin.']
                );
            }

            $approverName = $this->activeSuperAdminName($approverId);
            if ($approverName === '') {
                throw new ValidationException(
                    'The selected approver is not an active Super Admin.',
                    ['approver_id' => 'Choose an active Super Admin account.']
                );
            }
        }

        $businessId = 0;
        $permissionSet = '';
        if ($newRole === 'admin') {
            $businessId = (int) ($target['business_id'] ?? 0);
            if ($businessId < 1) {
                $businessId = $this->firstActiveBusinessId();
            }
            $permissionSet = (string) ($target['permission_set'] ?? '');
            if ($permissionSet === '') {
                $permissionSet = 'owner';
            }
        }

        $this->pdo->beginTransaction();

        try {
            $this->syncRole((int) $target['id'], $newRole);
            $this->syncBusinessAssignment(
                (int) $target['id'],
                (string) $target['name'],
                (string) $target['email'],
                $newRole,
                $businessId,
                $permissionSet
            );

            $this->auditLogger->record(
                'users.role_changed',
                $actorUserId,
                'user',
                (int) $target['id'],
                [
                    'actor' => $actorName,
                    'change' => 'Role: ' . self::ROLE_LABELS[$currentRole] . ' → ' . self::ROLE_LABELS[$newRole]
                        . ($approverName !== '' ? ' · approved by ' . $approverName : ''),
                    'previous_role' => $currentRole,
                    'role' => $newRole,
                    'approver' => $approverName !== '' ? $approverName : null,
                    'justification' => $data['justification'],
                ]
            );

            $this->pdo->commit();
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }

        $detail = $this->getUserDetail((int) $target['id'], 8);

        return [
            'message' => sprintf('%s is now %s.', $target['name'], self::ROLE_LABELS[$newRole]),
            'user' => $detail['user'],
            'history' => $detail['history'],
        ];
    }

    public function requestPasswordReset(int $actorUserId, string $actorName, int $userId): array
    {
        $target = $this->findUserOrFail($userId);

        $this->pdo->beginTransaction();

        try {
            $this->issueResetToken($userId, $actorUserId);

            $this->auditLogger->record(
                'users.password_reset_requested',
                $actorUserId,
                'user',
                $userId,
                [
                    'actor' => $actorName,
                    'change' => sprintf(
                        'One-time password-reset request recorded for %s (%s); no password was revealed.',
                        $target['name'],
                        $target['email']
                    ),
                ]
            );

            $this->pdo->commit();
        } catch (Throwable $exception) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $exception;
        }

        return [
            'message' => sprintf(
                'One-time password-reset request recorded for %s. No password was revealed.',
                $target['name']
            ),
            'user' => $target,
            'history' => $this->getHistory($userId, 8),
        ];
    }

    private function fetchUserRows(array $filters): array
    {
        $sql = $this->userSelectSql();
        $where = ['1 = 1'];
        $params = [];

        if (!empty($filters['id'])) {
            $where[] = 'q.id = :id';
            $params['id'] = (int) $filters['id'];
        }

        if (!empty($filters['search'])) {
            $where[] = '(CONCAT_WS(\' \', q.first_name, q.last_name) LIKE :search_name OR q.email LIKE :search_email)';
            $search = '%' . $filters['search'] . '%';
            $params['search_name'] = $search;
            $params['search_email'] = $search;
        }

        if (!empty($filters['role'])) {
            $where[] = 'q.role_key = :role';
            $params['role'] = $filters['role'];
        }

        if (!empty($filters['status'])) {
            $where[] = 'q.status = :status';
            $params['status'] = $filters['status'];
        }

        if (!empty($filters['month'])) {
            $where[] = "DATE_FORMAT(q.created_at, '%Y-%m') = :month";
            $params['month'] = $filters['month'];
        }

        $sql .= ' WHERE ' . implode(' AND ', $where);

        $sort = $filters['sort'] ?? 'role';
        if (!empty($filters['id'])) {
            $sql .= ' ORDER BY q.id ASC';
        } elseif ($sort === 'name') {
            $sql .= ' ORDER BY q.last_name ASC, q.first_name ASC, q.email ASC';
        } elseif ($sort === 'recent') {
            $sql .= ' ORDER BY COALESCE(q.last_login_at, q.updated_at, q.created_at) DESC, q.id DESC';
        } else {
            $sql .= " ORDER BY FIELD(q.role_key, 'super_admin', 'admin', 'customer'), q.last_name ASC, q.first_name ASC, q.email ASC";
        }

        $statement = $this->pdo->prepare($sql);
        $statement->execute($params);

        return $statement->fetchAll();
    }

    private function userSelectSql(): string
    {
        return <<<'SQL'
            SELECT
                q.id,
                q.email,
                q.first_name,
                q.last_name,
                q.status,
                q.created_at,
                q.updated_at,
                q.last_login_at,
                q.email_verified_at,
                q.role_key,
                q.business_id,
                q.permission_set,
                q.role_title,
                b.name AS business_name
            FROM (
                SELECT
                    u.id,
                    u.email,
                    u.first_name,
                    u.last_name,
                    u.status,
                    u.created_at,
                    u.updated_at,
                    u.last_login_at,
                    u.email_verified_at,
                    CASE
                        WHEN EXISTS (
                            SELECT 1
                            FROM user_roles ur
                            INNER JOIN roles r ON r.id = ur.role_id
                            WHERE ur.user_id = u.id AND r.name = 'super_admin'
                        ) THEN 'super_admin'
                        WHEN EXISTS (
                            SELECT 1
                            FROM user_roles ur
                            INNER JOIN roles r ON r.id = ur.role_id
                            WHERE ur.user_id = u.id AND r.name IN ('admin', 'manager', 'staff')
                        ) THEN 'admin'
                        ELSE 'customer'
                    END AS role_key,
                    bu.business_id,
                    bu.permission_set,
                    bu.role_title
                FROM users u
                LEFT JOIN business_users bu ON bu.id = (
                    SELECT bu2.id
                    FROM business_users bu2
                    WHERE bu2.user_id = u.id
                      AND bu2.status = 'active'
                    ORDER BY bu2.id ASC
                    LIMIT 1
                )
                WHERE u.deleted_at IS NULL
            ) q
            LEFT JOIN businesses b ON b.id = q.business_id
        SQL;
    }

    private function mapUserRow(array $row): array
    {
        $roleKey = (string) ($row['role_key'] ?? 'customer');
        if (!isset(self::ROLE_LABELS[$roleKey])) {
            $roleKey = 'customer';
        }

        $statusKey = (string) ($row['status'] ?? 'pending');
        if (!isset(self::STATUS_LABELS[$statusKey])) {
            $statusKey = 'pending';
        }

        $name = trim((string) ($row['first_name'] ?? '') . ' ' . (string) ($row['last_name'] ?? ''));
        if ($name === '') {
            $name = (string) ($row['email'] ?? 'Unnamed account');
        }

        $businessId = $row['business_id'] !== null ? (int) $row['business_id'] : 0;
        $businessName = trim((string) ($row['business_name'] ?? ''));
        $business = '—';
        if ($roleKey === 'admin') {
            $business = $businessName !== '' ? $businessName : 'Not assigned';
        }

        $permissionSet = (string) ($row['permission_set'] ?? '');
        $permissionDefinition = $permissionSet !== '' ? $this->permissionDefinition($permissionSet) : null;

        $lastActivity = null;
        $lastActivityLabel = 'Never';
        if (!empty($row['last_login_at'])) {
            $timestamp = strtotime((string) $row['last_login_at']);
            if ($timestamp !== false) {
                $lastActivity = $timestamp;
                $lastActivityLabel = date('d M · H:i', $timestamp);
            }
        }

        $registeredAt = null;
        $registeredLabel = '';
        if (!empty($row['created_at'])) {
            $timestamp = strtotime((string) $row['created_at']);
            if ($timestamp !== false) {
                $registeredAt = $timestamp;
                $registeredLabel = date('d M Y', $timestamp);
            }
        }

        return [
            'id' => (int) $row['id'],
            'name' => $name,
            'first_name' => (string) ($row['first_name'] ?? ''),
            'last_name' => (string) ($row['last_name'] ?? ''),
            'email' => (string) ($row['email'] ?? ''),
            'role_key' => $roleKey,
            'role' => self::ROLE_LABELS[$roleKey],
            'status_key' => $statusKey,
            'status' => self::STATUS_LABELS[$statusKey],
            'business_id' => $businessId,
            'business' => $business,
            'permission_set' => $permissionSet,
            'permission_set_label' => $permissionDefinition['label'] ?? '',
            'role_title' => (string) ($row['role_title'] ?? ''),
            'registered_at' => $registeredAt,
            'registered' => $registeredLabel,
            'registration_month' => !empty($row['created_at']) ? date('Y-m', strtotime((string) $row['created_at'])) : '',
            'last_activity_at' => $lastActivity,
            'last_activity' => $lastActivityLabel,
            'email_verified' => !empty($row['email_verified_at']),
            'business_bound' => $roleKey === 'admin' && $businessId > 0,
        ];
    }

    private function getSummary(): array
    {
        $statement = $this->pdo->query(<<<'SQL'
            SELECT
                COUNT(*) AS total,
                COALESCE(SUM(status = 'active'), 0) AS active,
                COALESCE(SUM(status = 'inactive'), 0) AS inactive,
                COALESCE(SUM(status = 'suspended'), 0) AS suspended,
                COALESCE(SUM(status = 'pending'), 0) AS pending
            FROM users
            WHERE deleted_at IS NULL
        SQL);

        $row = $statement->fetch() ?: [];

        return [
            'total' => (int) ($row['total'] ?? 0),
            'active' => (int) ($row['active'] ?? 0),
            'inactive' => (int) ($row['inactive'] ?? 0),
            'suspended' => (int) ($row['suspended'] ?? 0),
            'pending' => (int) ($row['pending'] ?? 0),
        ];
    }

    private function getFilterOptions(): array
    {
        $months = [];
        $statement = $this->pdo->query(<<<'SQL'
            SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, COUNT(*) AS total
            FROM users
            WHERE deleted_at IS NULL
            GROUP BY DATE_FORMAT(created_at, '%Y-%m')
            ORDER BY month DESC
        SQL);

        foreach ($statement->fetchAll() as $row) {
            $value = (string) $row['month'];
            $date = DateTimeImmutable::createFromFormat('!Y-m', $value);
            $months[] = [
                'value' => $value,
                'label' => $date instanceof DateTimeImmutable ? $date->format('F Y') : $value,
                'total' => (int) $row['total'],
            ];
        }

        $businesses = [];
        $statement = $this->pdo->query(
            "SELECT id, name FROM businesses WHERE status = 'active' ORDER BY name ASC"
        );
        foreach ($statement->fetchAll() as $row) {
            $businesses[] = [
                'id' => (int) $row['id'],
                'name' => (string) $row['name'],
            ];
        }

        $permissionSets = [];
        foreach (self::PERMISSION_SETS as $key => $definition) {
            $permissionSets[$key] = $definition['label'];
        }

        $statement = $this->pdo->query(
            "SELECT DISTINCT permission_set FROM business_users WHERE permission_set <> '' ORDER BY permission_set ASC"
        );
        foreach ($statement->fetchAll() as $row) {
            $key = (string) $row['permission_set'];
            if ($key !== '' && !isset($permissionSets[$key])) {
                $permissionSets[$key] = $this->permissionDefinition($key)['label'];
            }
        }

        $permissionOptions = [];
        foreach ($permissionSets as $key => $label) {
            $permissionOptions[] = ['value' => $key, 'label' => $label];
        }

        $allRows = $this->fetchUserRows([]);
        $userOptions = [];
        foreach ($allRows as $row) {
            $user = $this->mapUserRow($row);
            $userOptions[] = [
                'id' => $user['id'],
                'name' => $user['name'],
                'email' => $user['email'],
                'role_key' => $user['role_key'],
                'role' => $user['role'],
                'status_key' => $user['status_key'],
                'status' => $user['status'],
            ];
        }

        $approvers = [];
        $statement = $this->pdo->query(<<<'SQL'
            SELECT u.id, u.first_name, u.last_name, u.email
            FROM users u
            WHERE u.status = 'active'
              AND u.deleted_at IS NULL
              AND EXISTS (
                  SELECT 1
                  FROM user_roles ur
                  INNER JOIN roles r ON r.id = ur.role_id
                  WHERE ur.user_id = u.id AND r.name = 'super_admin'
              )
            ORDER BY u.first_name ASC, u.last_name ASC, u.email ASC
        SQL);

        foreach ($statement->fetchAll() as $row) {
            $name = trim((string) $row['first_name'] . ' ' . (string) $row['last_name']);
            $approvers[] = [
                'id' => (int) $row['id'],
                'name' => $name !== '' ? $name : (string) $row['email'],
                'email' => (string) $row['email'],
            ];
        }

        return [
            'months' => $months,
            'businesses' => $businesses,
            'permission_sets' => $permissionOptions,
            'role_options' => [
                ['value' => 'super_admin', 'label' => self::ROLE_LABELS['super_admin']],
                ['value' => 'admin', 'label' => self::ROLE_LABELS['admin']],
                ['value' => 'customer', 'label' => self::ROLE_LABELS['customer']],
            ],
            'status_options' => [
                ['value' => 'active', 'label' => self::STATUS_LABELS['active']],
                ['value' => 'inactive', 'label' => self::STATUS_LABELS['inactive']],
                ['value' => 'suspended', 'label' => self::STATUS_LABELS['suspended']],
                ['value' => 'pending', 'label' => self::STATUS_LABELS['pending']],
            ],
            'user_options' => $userOptions,
            'approvers' => $approvers,
        ];
    }

    private function getHistory(int $userId, int $limit): array
    {
        $limit = max(1, min(100, $limit));

        $statement = $this->pdo->prepare(<<<SQL
            SELECT
                al.id,
                al.action,
                al.metadata,
                al.created_at,
                al.user_id,
                u.first_name,
                u.last_name
            FROM audit_logs al
            LEFT JOIN users u ON u.id = al.user_id
            WHERE al.entity_type = 'user'
              AND al.entity_id = :user_id
            ORDER BY al.created_at DESC, al.id DESC
            LIMIT $limit
        SQL);

        $statement->execute(['user_id' => $userId]);

        $history = [];
        foreach ($statement->fetchAll() as $row) {
            $metadata = json_decode((string) ($row['metadata'] ?? ''), true);
            $detail = is_array($metadata) ? trim((string) ($metadata['change'] ?? '')) : '';
            $actor = trim((string) ($row['first_name'] ?? '') . ' ' . (string) ($row['last_name'] ?? ''));
            if ($actor === '') {
                $actor = 'System';
            }

            $timestamp = strtotime((string) $row['created_at']);
            $timeLabel = $timestamp !== false ? date('d M Y · H:i', $timestamp) . ' PHT' : (string) $row['created_at'];

            $history[] = [
                'id' => (int) $row['id'],
                'action' => (string) $row['action'],
                'label' => $this->historyLabel((string) $row['action']),
                'detail' => $detail !== '' ? $detail : $this->historyDetail((string) $row['action']),
                'actor' => $actor,
                'time_label' => $timeLabel,
            ];
        }

        return $history;
    }

    private function countHistory(int $userId): int
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT COUNT(*)
            FROM audit_logs
            WHERE entity_type = 'user'
              AND entity_id = :user_id
        SQL);
        $statement->execute(['user_id' => $userId]);

        return (int) $statement->fetchColumn();
    }

    private function findUserOrFail(int $userId): array
    {
        $rows = $this->fetchUserRows(['id' => $userId]);

        if ($rows === []) {
            throw new RuntimeException('That user account could not be found.');
        }

        return $this->mapUserRow($rows[0]);
    }

    private function assertEmailUnique(string $email, int $exceptUserId = 0): void
    {
        $sql = 'SELECT id FROM users WHERE email = :email';
        $params = ['email' => $email];

        if ($exceptUserId > 0) {
            $sql .= ' AND id <> :id';
            $params['id'] = $exceptUserId;
        }

        $sql .= ' LIMIT 1';

        $statement = $this->pdo->prepare($sql);
        $statement->execute($params);

        if ($statement->fetchColumn() !== false) {
            throw new ValidationException('An account already exists for this email address.', [
                'email' => 'Use a different email address.',
            ]);
        }
    }

    private function assertSuperAdminCoverage(
        int $targetId,
        string $currentRole,
        string $currentStatus,
        string $newRole,
        string $newStatus
    ): void {
        $losesActiveSuperAdmin = $currentRole === 'super_admin'
            && $currentStatus === 'active'
            && ($newRole !== 'super_admin' || $newStatus !== 'active');

        if (!$losesActiveSuperAdmin) {
            return;
        }

        if ($this->activeSuperAdminCount($targetId) > 0) {
            return;
        }

        throw new ValidationException(
            'At least one active Super Admin account must remain at all times.',
            ['role' => 'Assign another active Super Admin before changing this account.']
        );
    }

    private function activeSuperAdminCount(int $exceptUserId = 0): int
    {
        $sql = <<<'SQL'
            SELECT COUNT(DISTINCT u.id)
            FROM users u
            WHERE u.status = 'active'
              AND u.deleted_at IS NULL
              AND EXISTS (
                  SELECT 1
                  FROM user_roles ur
                  INNER JOIN roles r ON r.id = ur.role_id
                  WHERE ur.user_id = u.id AND r.name = 'super_admin'
              )
        SQL;

        $params = [];
        if ($exceptUserId > 0) {
            $sql .= ' AND u.id <> :id';
            $params['id'] = $exceptUserId;
        }

        $statement = $this->pdo->prepare($sql);
        $statement->execute($params);

        return (int) $statement->fetchColumn();
    }

    private function activeSuperAdminName(int $userId): string
    {
        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT u.first_name, u.last_name, u.email
            FROM users u
            WHERE u.id = :id
              AND u.status = 'active'
              AND u.deleted_at IS NULL
              AND EXISTS (
                  SELECT 1
                  FROM user_roles ur
                  INNER JOIN roles r ON r.id = ur.role_id
                  WHERE ur.user_id = u.id AND r.name = 'super_admin'
              )
            LIMIT 1
        SQL);
        $statement->execute(['id' => $userId]);
        $row = $statement->fetch();

        if ($row === false) {
            return '';
        }

        $name = trim((string) $row['first_name'] . ' ' . (string) $row['last_name']);

        return $name !== '' ? $name : (string) $row['email'];
    }

    private function syncRole(int $userId, string $roleKey): void
    {
        if (!isset(self::ROLE_LABELS[$roleKey])) {
            throw new ValidationException('Select a valid global role.', [
                'role' => 'Choose Super Admin, Admin / Business Owner, or Customer.',
            ]);
        }

        $statement = $this->pdo->prepare('SELECT id FROM roles WHERE name = :name LIMIT 1');
        $statement->execute(['name' => $roleKey]);
        $roleId = $statement->fetchColumn();

        if ($roleId === false) {
            throw new RuntimeException('The requested global role is not configured.');
        }

        $statement = $this->pdo->prepare('DELETE FROM user_roles WHERE user_id = :user_id');
        $statement->execute(['user_id' => $userId]);

        $statement = $this->pdo->prepare(
            'INSERT INTO user_roles (user_id, role_id) VALUES (:user_id, :role_id)'
        );
        $statement->execute([
            'user_id' => $userId,
            'role_id' => (int) $roleId,
        ]);
    }

    private function syncBusinessAssignment(
        int $userId,
        string $name,
        string $email,
        string $roleKey,
        int $businessId,
        string $permissionSet
    ): void {
        if ($roleKey !== 'admin') {
            $statement = $this->pdo->prepare(
                "UPDATE business_users SET status = 'inactive' WHERE user_id = :user_id AND status = 'active'"
            );
            $statement->execute(['user_id' => $userId]);

            return;
        }

        if ($businessId < 1) {
            throw new ValidationException('Select an active business for this Admin / Business Owner account.', [
                'business_id' => 'A business assignment is required for business-bound access.',
            ]);
        }

        if (!$this->businessExists($businessId)) {
            throw new ValidationException('The selected business is not active.', [
                'business_id' => 'Choose an active business.',
            ]);
        }

        $definition = $this->permissionDefinition($permissionSet !== '' ? $permissionSet : 'owner');

        $statement = $this->pdo->prepare(<<<'SQL'
            SELECT id
            FROM business_users
            WHERE user_id = :user_id_one
               OR (email = :email AND business_id = :business_id_lookup)
            ORDER BY (user_id = :user_id_two) DESC, id ASC
            LIMIT 1
        SQL);
        $statement->execute([
            'user_id_one' => $userId,
            'user_id_two' => $userId,
            'email' => $email,
            'business_id_lookup' => $businessId,
        ]);
        $existingId = $statement->fetchColumn();

        $flags = $definition['flags'];

        if ($existingId !== false) {
            $statement = $this->pdo->prepare(<<<'SQL'
                UPDATE business_users
                SET
                    business_id = :business_id,
                    user_id = :user_id,
                    name = :name,
                    email = :email,
                    role_title = :role_title,
                    permission_set = :permission_set,
                    status = 'active',
                    can_manage_products = :can_manage_products,
                    can_adjust_stock = :can_adjust_stock,
                    can_view_reports = :can_view_reports,
                    can_reply_reviews = :can_reply_reviews,
                    can_view_notifications = :can_view_notifications,
                    can_manage_staff = :can_manage_staff
                WHERE id = :id
            SQL);

            $statement->execute([
                'business_id' => $businessId,
                'user_id' => $userId,
                'name' => $name,
                'email' => $email,
                'role_title' => $definition['role_title'],
                'permission_set' => $permissionSet !== '' ? $permissionSet : 'owner',
                'can_manage_products' => $flags['can_manage_products'],
                'can_adjust_stock' => $flags['can_adjust_stock'],
                'can_view_reports' => $flags['can_view_reports'],
                'can_reply_reviews' => $flags['can_reply_reviews'],
                'can_view_notifications' => $flags['can_view_notifications'],
                'can_manage_staff' => $flags['can_manage_staff'],
                'id' => (int) $existingId,
            ]);

            return;
        }

        $statement = $this->pdo->prepare(<<<'SQL'
            INSERT INTO business_users
                (
                    business_id,
                    user_id,
                    name,
                    email,
                    role_title,
                    permission_set,
                    status,
                    can_manage_products,
                    can_adjust_stock,
                    can_view_reports,
                    can_reply_reviews,
                    can_view_notifications,
                    can_manage_staff
                )
            VALUES
                (
                    :business_id,
                    :user_id,
                    :name,
                    :email,
                    :role_title,
                    :permission_set,
                    'active',
                    :can_manage_products,
                    :can_adjust_stock,
                    :can_view_reports,
                    :can_reply_reviews,
                    :can_view_notifications,
                    :can_manage_staff
                )
        SQL);

        $statement->execute([
            'business_id' => $businessId,
            'user_id' => $userId,
            'name' => $name,
            'email' => $email,
            'role_title' => $definition['role_title'],
            'permission_set' => $permissionSet !== '' ? $permissionSet : 'owner',
            'can_manage_products' => $flags['can_manage_products'],
            'can_adjust_stock' => $flags['can_adjust_stock'],
            'can_view_reports' => $flags['can_view_reports'],
            'can_reply_reviews' => $flags['can_reply_reviews'],
            'can_view_notifications' => $flags['can_view_notifications'],
            'can_manage_staff' => $flags['can_manage_staff'],
        ]);
    }

    private function businessExists(int $businessId): bool
    {
        $statement = $this->pdo->prepare(
            "SELECT 1 FROM businesses WHERE id = :id AND status = 'active' LIMIT 1"
        );
        $statement->execute(['id' => $businessId]);

        return $statement->fetchColumn() !== false;
    }

    private function businessName(int $businessId): ?string
    {
        $statement = $this->pdo->prepare('SELECT name FROM businesses WHERE id = :id LIMIT 1');
        $statement->execute(['id' => $businessId]);
        $name = $statement->fetchColumn();

        return $name !== false ? (string) $name : null;
    }

    private function firstActiveBusinessId(): int
    {
        $businessId = $this->pdo->query(
            "SELECT id FROM businesses WHERE status = 'active' ORDER BY id ASC LIMIT 1"
        )->fetchColumn();

        if ($businessId === false) {
            throw new RuntimeException('No active business is available for this assignment.');
        }

        return (int) $businessId;
    }

    private function permissionDefinition(string $permissionSet): array
    {
        if (isset(self::PERMISSION_SETS[$permissionSet])) {
            return self::PERMISSION_SETS[$permissionSet];
        }

        $title = ucwords(str_replace('_', ' ', $permissionSet));

        return [
            'label' => $title . ' · business-bound',
            'role_title' => $title,
            'flags' => [
                'can_manage_products' => 0,
                'can_adjust_stock' => 0,
                'can_view_reports' => 0,
                'can_reply_reviews' => 0,
                'can_view_notifications' => 1,
                'can_manage_staff' => 0,
            ],
        ];
    }

    private function issueResetToken(int $userId, int $requestedBy): void
    {
        $statement = $this->pdo->prepare(
            'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = :user_id AND used_at IS NULL'
        );
        $statement->execute(['user_id' => $userId]);

        $token = bin2hex(random_bytes(32));

        $statement = $this->pdo->prepare(<<<'SQL'
            INSERT INTO password_reset_tokens
                (user_id, token_hash, requested_by, expires_at)
            VALUES
                (:user_id, :token_hash, :requested_by, :expires_at)
        SQL);

        $statement->execute([
            'user_id' => $userId,
            'token_hash' => hash('sha256', $token),
            'requested_by' => $requestedBy,
            'expires_at' => date('Y-m-d H:i:s', time() + 3600),
        ]);
    }

    private function historyLabel(string $action): string
    {
        return match ($action) {
            'auth.login' => 'Login',
            'auth.logout' => 'Logout',
            'auth.registration' => 'Account registration',
            'users.created' => 'Account created',
            'users.updated' => 'Account updated',
            'users.status_changed' => 'Status change',
            'users.role_changed' => 'Role assignment',
            'users.password_reset_requested' => 'Password reset requested',
            default => ucfirst(str_replace(['.', '_'], ' ', $action)),
        };
    }

    private function historyDetail(string $action): string
    {
        return match ($action) {
            'auth.login' => 'Successful sign-in',
            'auth.logout' => 'Signed out',
            'auth.registration' => 'Account registered through the storefront',
            default => '',
        };
    }
}

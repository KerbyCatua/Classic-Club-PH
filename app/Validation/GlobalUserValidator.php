<?php

declare(strict_types=1);

namespace ClassicClub\Validation;

use ClassicClub\Support\Input;

/**
 * Validates and normalises input for the Super Admin global user management
 * module (21.2). Database-dependent checks live in GlobalUserService.
 */
final class GlobalUserValidator
{
    private const ROLE_ALIASES = [
        'super_admin' => 'super_admin',
        'super admin' => 'super_admin',
        'super administrator' => 'super_admin',
        'admin' => 'admin',
        'administrator' => 'admin',
        'admin / business owner' => 'admin',
        'business owner' => 'admin',
        'customer' => 'customer',
        'client' => 'customer',
    ];

    private const STATUS_ALIASES = [
        'active' => 'active',
        'inactive' => 'inactive',
        'suspended' => 'suspended',
        'pending' => 'pending',
    ];

    public function listFilters(array $query): array
    {
        return [
            'search' => mb_substr(trim(Input::string($query['search'] ?? '')), 0, 190),
            'role' => $this->role($query['role'] ?? '', false),
            'status' => $this->status($query['status'] ?? '', false),
            'month' => $this->month($query['month'] ?? ''),
            'sort' => $this->sort($query['sort'] ?? 'role'),
        ];
    }

    public function userId(mixed $value, string $field = 'user_id'): int
    {
        $id = Input::integer($value, 0);

        if ($id < 1) {
            throw new ValidationException('A valid user account is required.', [
                $field => 'Select a user account.',
            ]);
        }

        return $id;
    }

    public function historyLimit(mixed $value): int
    {
        $limit = Input::integer($value, 6);

        if ($limit < 1) {
            return 1;
        }

        return min($limit, 100);
    }

    public function update(array $input): array
    {
        $errors = [];

        $userId = $this->userId($input['user_id'] ?? 0);
        $name = $this->name($input['name'] ?? '', $errors);
        $email = $this->email($input['email'] ?? '', $errors);
        $role = $this->role($input['role'] ?? '', true);
        $status = $this->status($input['status'] ?? '', true);
        $businessId = max(0, Input::integer($input['business_id'] ?? 0, 0));
        $permissionSet = $this->permissionSet($input['permission_set'] ?? '', $errors);

        if ($role === 'admin' && $businessId < 1) {
            $errors['business_id'] = 'Select an active business for this Admin / Business Owner account.';
        }

        if ($permissionSet === '' && $role === 'admin') {
            $permissionSet = 'owner';
        }

        if ($errors !== []) {
            throw new ValidationException('Please correct the highlighted fields.', $errors);
        }

        return [
            'user_id' => $userId,
            'name' => $name['full'],
            'first_name' => $name['first'],
            'last_name' => $name['last'],
            'email' => $email,
            'role' => $role,
            'status' => $status,
            'business_id' => $role === 'admin' ? $businessId : 0,
            'permission_set' => $permissionSet,
        ];
    }

    public function statusChange(array $input): array
    {
        $errors = [];
        $userId = $this->userId($input['user_id'] ?? 0);
        $status = $this->status($input['status'] ?? '', true);

        if ($status === '') {
            $errors['status'] = 'Select a valid account status.';
        }

        if ($errors !== []) {
            throw new ValidationException('Please correct the highlighted fields.', $errors);
        }

        return [
            'user_id' => $userId,
            'status' => $status,
            'confirmation' => trim(Input::string($input['confirmation'] ?? '')),
        ];
    }

    public function roleChange(array $input): array
    {
        $errors = [];
        $userId = $this->userId($input['user_id'] ?? 0);
        $role = $this->role($input['role'] ?? '', true);
        $approverId = max(0, Input::integer($input['approver_id'] ?? 0, 0));
        $justification = trim(Input::string($input['justification'] ?? ''));

        if ($role === '') {
            $errors['role'] = 'Select a valid global role.';
        }

        if ($justification === '') {
            $errors['justification'] = 'Enter an authorization and business justification.';
        } elseif (mb_strlen($justification) < 10) {
            $errors['justification'] = 'Use at least 10 characters for the justification.';
        } elseif (mb_strlen($justification) > 1000) {
            $errors['justification'] = 'Keep the justification under 1,000 characters.';
        }

        if (!$this->boolean($input['authorization_confirmed'] ?? false)) {
            $errors['authorization_confirmed'] = 'Confirm that identity and access authorization were verified.';
        }

        if ($errors !== []) {
            throw new ValidationException('Please correct the highlighted fields.', $errors);
        }

        return [
            'user_id' => $userId,
            'role' => $role,
            'approver_id' => $approverId,
            'justification' => $justification,
            'authorization_confirmed' => true,
        ];
    }

    private function name(mixed $value, array &$errors): array
    {
        $full = trim(Input::string($value));
        $full = preg_replace('/\s+/', ' ', $full) ?: '';

        if ($full === '') {
            $errors['name'] = 'Enter the user\'s full name.';
            return ['full' => '', 'first' => '', 'last' => ''];
        }

        if (mb_strlen($full) > 200) {
            $errors['name'] = 'The full name must be 200 characters or fewer.';
        }

        $parts = preg_split('/\s+/', $full, 2) ?: [$full];
        $first = $parts[0] ?? '';
        $last = $parts[1] ?? '';

        if (mb_strlen($first) > 100 || mb_strlen($last) > 100) {
            $errors['name'] = 'First and last names must be 100 characters or fewer.';
        }

        return ['full' => $full, 'first' => $first, 'last' => $last];
    }

    private function email(mixed $value, array &$errors): string
    {
        $email = strtolower(trim(Input::string($value)));

        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors['email'] = 'Enter a valid email address.';
        } elseif (mb_strlen($email) > 190) {
            $errors['email'] = 'The email address must be 190 characters or fewer.';
        }

        return $email;
    }

    private function role(mixed $value, bool $required): string
    {
        $role = strtolower(trim(Input::string($value)));

        if ($role === '') {
            if ($required) {
                throw new ValidationException('Select a valid global role.', [
                    'role' => 'Choose Super Admin, Admin / Business Owner, or Customer.',
                ]);
            }

            return '';
        }

        return self::ROLE_ALIASES[$role] ?? '';
    }

    private function status(mixed $value, bool $required): string
    {
        $status = strtolower(trim(Input::string($value)));

        if ($status === '') {
            if ($required) {
                throw new ValidationException('Select a valid account status.', [
                    'status' => 'Choose Active, Inactive, Suspended, or Pending.',
                ]);
            }

            return '';
        }

        return self::STATUS_ALIASES[$status] ?? '';
    }

    private function month(mixed $value): string
    {
        $month = trim(Input::string($value));

        return preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $month) === 1 ? $month : '';
    }

    private function sort(mixed $value): string
    {
        $sort = strtolower(trim(Input::string($value)));

        return in_array($sort, ['role', 'name', 'recent'], true) ? $sort : 'role';
    }

    private function permissionSet(mixed $value, array &$errors): string
    {
        $permissionSet = strtolower(trim(Input::string($value)));

        if ($permissionSet === '') {
            return '';
        }

        if (preg_match('/^[a-z0-9_]{1,100}$/', $permissionSet) !== 1) {
            $errors['permission_set'] = 'Select a valid business permission set.';
            return '';
        }

        return $permissionSet;
    }

    private function boolean(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }

        return filter_var($value, FILTER_VALIDATE_BOOLEAN);
    }
}

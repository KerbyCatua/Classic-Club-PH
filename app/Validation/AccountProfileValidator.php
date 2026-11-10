<?php

declare(strict_types=1);

namespace ClassicClub\Validation;

use ClassicClub\Services\SystemConfigurationService;

final class AccountProfileValidator
{
    public function profile(array $input): array
    {
        $errors = [];
        $data = [];
        $allowed = ['action', 'first_name', 'last_name', 'email', 'mobile', 'newsletter', 'current_password'];
        if (array_diff_key($input, array_flip($allowed))) {
            $errors['profile'] = 'Submit only personal profile fields.';
        }
        foreach (['first_name' => 100, 'last_name' => 100, 'email' => 190, 'mobile' => 40] as $field => $max) {
            $value = $input[$field] ?? ($field === 'mobile' ? '' : null);
            $data[$field] = is_string($value) ? trim($value) : '';
            if (!is_string($value) || mb_strlen($data[$field]) > $max || ($field !== 'mobile' && $data[$field] === '')) {
                $errors[$field] = 'Enter ' . str_replace('_', ' ', $field) . ' (maximum ' . $max . ' characters).';
            }
        }
        $data['email'] = strtolower($data['email']);
        if (!filter_var($data['email'], FILTER_VALIDATE_EMAIL)) $errors['email'] = 'Enter a valid email address.';
        if ($data['mobile'] !== '' && (!preg_match('/^\+?[0-9 ()\-.]+$/', $data['mobile']) || strlen(preg_replace('/\D/', '', $data['mobile'])) < 7 || strlen(preg_replace('/\D/', '', $data['mobile'])) > 15)) {
            $errors['mobile'] = 'Enter a phone number with 7 to 15 digits.';
        }
        if (!is_bool($input['newsletter'] ?? null)) $errors['newsletter'] = 'Choose a valid newsletter preference.';
        $data['newsletter'] = $input['newsletter'] ?? false;
        $data['current_password'] = $input['current_password'] ?? '';
        if (!is_string($data['current_password']) || strlen($data['current_password']) > 4096) $errors['current_password'] = 'Enter a valid current password.';
        $this->check($errors);
        return $data;
    }

    public function password(array $input): array
    {
        $errors = [];
        if (array_diff_key($input, array_flip(['action', 'current_password', 'new_password', 'confirm_password']))) {
            $errors['password'] = 'Submit only password fields.';
        }
        foreach (['current_password', 'new_password', 'confirm_password'] as $field) {
            if (!is_string($input[$field] ?? null) || $input[$field] === '' || strlen($input[$field]) > ($field === 'current_password' ? 4096 : 72)) {
                $errors[$field] = $field === 'current_password' ? 'Enter your current password.' : 'Enter a password of up to 72 bytes.';
            }
        }
        $this->check($errors);
        $minimum = SystemConfigurationService::value('password_min_length');
        if (strlen($input['new_password']) < $minimum || !preg_match('/[A-Za-z]/', $input['new_password']) || !preg_match('/\d/', $input['new_password'])) {
            $errors['new_password'] = 'Use at least ' . $minimum . ' characters, including a letter and a number.';
        }
        if ($input['new_password'] !== $input['confirm_password']) $errors['confirm_password'] = 'Passwords do not match.';
        if ($input['new_password'] === $input['current_password']) $errors['new_password'] = 'Choose a different password from your current password.';
        $this->check($errors);
        return $input;
    }

    private function check(array $errors): void
    {
        if ($errors) throw new ValidationException('Please correct the highlighted fields.', $errors);
    }
}

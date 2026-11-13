<?php

declare(strict_types=1);

namespace ClassicClub\Validation;

require_once __DIR__ . '/../Services/SystemConfigurationService.php';

final class AuthValidator
{
    public function registration(array $data): array
    {
        // Reject non-string values; normalize spaces without stripping harmful input.
        $string = static fn (string $key): string => is_string($data[$key] ?? null) ? $data[$key] : '';
        $firstName = preg_replace('/ +/', ' ', trim($string('first_name'), ' '));
        $lastName = preg_replace('/ +/', ' ', trim($string('last_name'), ' '));
        $email = strtolower(trim($string('email'), ' '));
        $password = $string('password');
        $passwordConfirmation = $string('password_confirmation');

        $errors = [];

        foreach (['first_name' => $firstName, 'last_name' => $lastName] as $field => $name) {
            if (!preg_match('/\A.{1,100}\z/us', $name)
                || !preg_match("/\A\p{L}[\p{L}\p{M}]*(?:[ '\x{2019}-]\p{L}[\p{L}\p{M}]*)*\z/u", $name)) {
                $errors[$field] = ($field === 'first_name' ? 'First' : 'Last')
                    . ' name must be 1-100 letters, with spaces, apostrophes or hyphens between names.';
            }
        }

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)
            || !preg_match('/\A[a-z0-9]+(?:\.[a-z0-9]+)*(?:\+[a-z0-9]+(?:[._-][a-z0-9]+)*)?@gmail\.com\z/', $email)) {
            $errors['email'] = 'Enter a valid @gmail.com address (for example, your.name@gmail.com).';
        }

        if (!preg_match('/\A.{8,}\z/us', $password)
            || !preg_match('/[a-z]/', $password) || !preg_match('/[A-Z]/', $password)
            || !preg_match('/[0-9]/', $password) || !preg_match('/[\p{P}\p{S}]/u', $password)) {
            $errors['password'] = 'Use at least 8 characters, including a lowercase letter, an uppercase letter, a number and a special character.';
        }
        // PASSWORD_DEFAULT uses bcrypt: never silently truncate passwords at 72 bytes.
        if (strlen($password) > 72 || preg_match('/\p{C}/u', $password)) {
            $errors['password'] = 'Use a password of at most 72 bytes without control or invisible formatting characters.';
        }

        if ($password !== $passwordConfirmation) {
            $errors['password_confirmation'] = 'Passwords do not match.';
        }

        if (($data['terms_accepted'] ?? null) !== true) {
            $errors['terms_accepted'] = 'Please agree to the terms of use and privacy notice to create your account.';
        }

        if ($errors !== []) {
            throw new ValidationException(
                implode(' ', $errors),
                $errors
            );
        }

        return [
            'first_name' => $firstName,
            'last_name' => $lastName,
            'email' => $email,
            'password' => $password,
        ];
    }

    public function login(array $data): array
    {
        $email = strtolower(trim((string) ($data['email'] ?? '')));
        $password = (string) ($data['password'] ?? '');

        $errors = [];

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors['email'] = 'Enter a valid email address.';
        }

        if ($password === '') {
            $errors['password'] = 'Password is required.';
        }

        if ($errors !== []) {
            throw new ValidationException(
                'Please correct the highlighted fields.',
                $errors
            );
        }

        return [
            'email' => $email,
            'password' => $password,
        ];
    }
}

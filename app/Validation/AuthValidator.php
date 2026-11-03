<?php

declare(strict_types=1);

namespace ClassicClub\Validation;

final class AuthValidator
{
    public function registration(array $data): array
    {
        $firstName = trim((string) ($data['first_name'] ?? ''));
        $lastName = trim((string) ($data['last_name'] ?? ''));
        $email = strtolower(trim((string) ($data['email'] ?? '')));
        $password = (string) ($data['password'] ?? '');
        $passwordConfirmation = (string) ($data['password_confirmation'] ?? '');

        $errors = [];

        if ($firstName === '' || strlen($firstName) > 100) {
            $errors['first_name'] = 'First name is required.';
        }

        if ($lastName === '' || strlen($lastName) > 100) {
            $errors['last_name'] = 'Last name is required.';
        }

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $errors['email'] = 'Enter a valid email address.';
        }

        if (strlen($password) < 12) {
            $errors['password'] = 'Password must be at least 12 characters.';
        }

        if ($password !== $passwordConfirmation) {
            $errors['password_confirmation'] = 'Passwords do not match.';
        }

        if ($errors !== []) {
            throw new ValidationException(
                'Please correct the highlighted fields.',
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
<?php

declare(strict_types=1);

namespace ClassicClub\Validation;

final class NewsletterValidator
{
    public function validate(array $data): string
    {
        $email = trim((string) ($data['email'] ?? ''));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new ValidationException('A valid email address is required.', [
                'email' => 'Enter a valid email address.',
            ]);
        }

        return $email;
    }
}

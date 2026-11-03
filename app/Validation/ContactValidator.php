<?php

declare(strict_types=1);

namespace ClassicClub\Validation;

final class ContactValidator
{
    public function validate(array $data): array
    {
        $fields = [
            'full_name' => trim((string) ($data['full_name'] ?? '')),
            'email' => trim((string) ($data['email'] ?? '')),
            'topic' => trim((string) ($data['topic'] ?? '')),
            'order_number' => trim((string) ($data['order_number'] ?? '')),
            'message' => trim((string) ($data['message'] ?? '')),
        ];
        $errors = [];
        if ($fields['full_name'] === '') {
            $errors['full_name'] = 'Full name is required.';
        }
        if (!filter_var($fields['email'], FILTER_VALIDATE_EMAIL)) {
            $errors['email'] = 'A valid email is required.';
        }
        if (!in_array($fields['topic'], ['sizing', 'order', 'return', 'other'], true)) {
            $errors['topic'] = 'Choose a valid inquiry topic.';
        }
        if ($fields['message'] === '') {
            $errors['message'] = 'Message is required.';
        }
        if (mb_strlen($fields['message']) > 5000) {
            $errors['message'] = 'Message must be 5,000 characters or fewer.';
        }
        if ($errors !== []) {
            throw new ValidationException('Please correct the inquiry fields.', $errors);
        }

        return $fields;
    }
}

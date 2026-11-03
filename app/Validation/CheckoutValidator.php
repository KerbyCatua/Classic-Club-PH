<?php

declare(strict_types=1);

namespace ClassicClub\Validation;

final class CheckoutValidator
{
    public function validate(array $data): array
    {
        $fields = [
            'email' => trim((string) ($data['email'] ?? '')),
            'first_name' => trim((string) ($data['first_name'] ?? '')),
            'last_name' => trim((string) ($data['last_name'] ?? '')),
            'mobile' => trim((string) ($data['mobile'] ?? '')),
            'country' => trim((string) ($data['country'] ?? '')),
            'street_address' => trim((string) ($data['street_address'] ?? '')),
            'apartment' => trim((string) ($data['apartment'] ?? '')),
            'barangay' => trim((string) ($data['barangay'] ?? '')),
            'city' => trim((string) ($data['city'] ?? '')),
            'province' => trim((string) ($data['province'] ?? '')),
            'postal_code' => trim((string) ($data['postal_code'] ?? '')),
            'promotion_code' => strtoupper(trim((string) ($data['promotion_code'] ?? ''))),
        ];

        $errors = [];
        if (!filter_var($fields['email'], FILTER_VALIDATE_EMAIL)) {
            $errors['email'] = 'A valid email is required.';
        }

        foreach ([
            'first_name', 'last_name', 'mobile', 'country',
            'street_address', 'barangay', 'city', 'province', 'postal_code',
        ] as $field) {
            if ($fields[$field] === '') {
                $errors[$field] = 'This field is required.';
            }
        }

        if ($errors !== []) {
            throw new ValidationException('Please correct the checkout fields.', $errors);
        }

        return $fields;
    }
}

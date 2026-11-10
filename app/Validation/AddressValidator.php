<?php

declare(strict_types=1);

namespace ClassicClub\Validation;

final class AddressValidator
{
    public function validate(array $body): array
    {
        $limits = ['first_name' => 100, 'last_name' => 100, 'mobile' => 40, 'label' => 80,
            'country' => 80, 'region' => 120, 'province' => 120, 'city' => 120, 'barangay' => 120,
            'postal_code' => 20, 'street_address' => 255, 'apartment' => 255, 'instructions' => 500];
        $required = ['first_name', 'last_name', 'mobile', 'country', 'region', 'province', 'city',
            'barangay', 'postal_code', 'street_address'];
        $data = $errors = [];
        foreach ($body as $key => $value) {
            if (!array_key_exists($key, $limits) && !in_array($key, ['id', 'action', 'is_default_shipping', 'is_default_billing'], true)) {
                $errors[$key] = 'Unexpected field.';
            }
        }
        foreach ($limits as $field => $limit) {
            if (isset($body[$field]) && !is_string($body[$field])) {
                $errors[$field] = 'Enter text.';
            }
            $value = is_string($body[$field] ?? null) ? trim($body[$field]) : '';
            if (in_array($field, $required, true) && $value === '') $errors[$field] = 'This field is required.';
            if (mb_strlen($value) > $limit) $errors[$field] = "Use $limit characters or fewer.";
            $data[$field] = $value;
        }
        if ($data['country'] !== 'Philippines') $errors['country'] = 'Delivery is currently available in the Philippines.';
        if (!preg_match('/^\+?[0-9 ()-]{7,40}$/D', $data['mobile']) || strlen(preg_replace('/\D/', '', $data['mobile'])) < 7) {
            $errors['mobile'] = 'Enter a valid mobile number.';
        }
        if (!preg_match('/^[0-9]{4}$/D', $data['postal_code'])) $errors['postal_code'] = 'Enter a four-digit Philippine postal code.';
        foreach (['is_default_shipping', 'is_default_billing'] as $field) {
            if (isset($body[$field]) && !is_bool($body[$field])) $errors[$field] = 'Use true or false.';
            $data[$field] = ($body[$field] ?? false) === true ? 1 : 0;
        }
        if ($errors) throw new ValidationException('Please correct the address fields.', $errors);
        return $data;
    }
}

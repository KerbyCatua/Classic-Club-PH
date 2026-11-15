<?php

declare(strict_types=1);

namespace ClassicClub\Validation;

final class CheckoutValidator
{
    public function validate(array $data): array
    {
        // Match checkout limits to their database columns; never coerce arrays into text.
        $limits = ['email' => 190, 'first_name' => 100, 'last_name' => 100, 'mobile' => 40,
            'country' => 80, 'region' => 120, 'street_address' => 255, 'apartment' => 255,
            'barangay' => 120, 'city' => 120, 'province' => 120, 'postal_code' => 4,
            'instructions' => 500, 'promotion_code' => 50];
        $optional = ['apartment', 'instructions', 'promotion_code'];
        $fields = $errors = [];
        foreach ($limits as $field => $limit) {
            $value = $data[$field] ?? '';
            if (!is_string($value) || !mb_check_encoding($value, 'UTF-8')) {
                $errors[$field] = 'Enter valid text.';
                $value = '';
            }
            if (class_exists(\Normalizer::class)) $value = \Normalizer::normalize($value, \Normalizer::FORM_C);
            $value = preg_replace('/[\x{0000}-\x{0008}\x{000b}\x{000c}\x{000e}-\x{001f}\x{007f}-\x{009f}\x{200b}\x{feff}\x{202a}-\x{202e}\x{2066}-\x{2069}]/u', '', $value);
            $value = $field === 'instructions'
                ? trim(preg_replace('/[^\S\n]+/u', ' ', str_replace(["\r\n", "\r"], "\n", $value)))
                : trim(preg_replace('/\s+/u', ' ', $value));
            $fields[$field] = $value;
            if ($value === '' && !in_array($field, $optional, true)) $errors[$field] = 'This field is required.';
            if (mb_strlen($value) > $limit) $errors[$field] = "Use $limit characters or fewer.";
            if (strpbrk($value, '<>') !== false) $errors[$field] = 'Use plain text without < or > characters.';
        }
        $at = strrpos($fields['email'], '@');
        if ($at !== false) $fields['email'] = substr($fields['email'], 0, $at + 1) . strtolower(substr($fields['email'], $at + 1));
        if (!isset($errors['email']) && (!filter_var($fields['email'], FILTER_VALIDATE_EMAIL)
            || !preg_match('/^[^\s@]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/iD', $fields['email']))) {
            $errors['email'] = 'Enter a valid email address, such as you@example.com.';
        }
        foreach (['first_name', 'last_name'] as $field) {
            if (!isset($errors[$field]) && (!preg_match('/\p{L}/u', $fields[$field])
                || !preg_match('/^[\p{L}\p{M} .,\x{0027}’ʼ\-\x{2010}-\x{2015}·]+$/uD', $fields[$field]))) {
                $errors[$field] = 'Use letters, spaces, apostrophes, periods or hyphens for this name.';
            }
        }
        $mobile = preg_replace('/[\s().-]/u', '', $fields['mobile']);
        if (preg_match('/^09\d{9}$/D', $mobile)) $mobile = '+63' . substr($mobile, 1);
        elseif (preg_match('/^9\d{9}$/D', $mobile)) $mobile = '+63' . $mobile;
        elseif (preg_match('/^\+?639\d{9}$/D', $mobile)) $mobile = '+' . ltrim($mobile, '+');
        $fields['mobile'] = $mobile;
        if (!isset($errors['mobile']) && !preg_match('/^\+639\d{9}$/D', $mobile)) {
            $errors['mobile'] = 'Enter a Philippine mobile number, such as 0917 123 4567 or +63 917 123 4567.';
        }
        if (!isset($errors['country']) && $fields['country'] !== 'Philippines') $errors['country'] = 'Delivery is available within the Philippines only.';
        if (!isset($errors['postal_code']) && !preg_match('/^[0-9]{4}$/D', $fields['postal_code'])) $errors['postal_code'] = 'Enter a four-digit Philippine postal code, such as 1210.';
        foreach (['region', 'street_address', 'barangay', 'city', 'province'] as $field) {
            if (!isset($errors[$field]) && !preg_match('/[\p{L}\p{N}]/u', $fields[$field])) $errors[$field] = 'Enter an address detail containing letters or numbers.';
        }
        $fields['promotion_code'] = strtoupper($fields['promotion_code']);

        if ($errors !== []) {
            throw new ValidationException('Please correct the checkout fields.', $errors);
        }

        return $fields;
    }
}

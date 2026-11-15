<?php
declare(strict_types=1);

// Run: C:/xampp/php/php.exe tests/checkout-validation.php (no database writes).
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../app/Validation/ValidationException.php';
require_once __DIR__ . '/../app/Validation/CheckoutValidator.php';

use ClassicClub\Validation\CheckoutValidator;
use ClassicClub\Validation\ValidationException;

$validator = new CheckoutValidator();
$valid = ['email' => 'Customer+demo@EXAMPLE.COM', 'first_name' => ' José   María ', 'last_name' => 'Dela Cruz-O’Neil',
    'mobile' => '(0917) 123-4567', 'country' => 'Philippines', 'region' => 'National Capital Region',
    'street_address' => ' 18   Test Street ', 'apartment' => '', 'barangay' => 'Poblacion', 'city' => 'Makati',
    'province' => 'Metro Manila', 'postal_code' => '0400', 'instructions' => '', 'promotion_code' => ' demo '];
function verify(bool $ok, string $message): void { if (!$ok) throw new RuntimeException($message); }
function rejects(CheckoutValidator $validator, array $data, string $field): void {
    try { $validator->validate($data); }
    catch (ValidationException $error) {
        verify(isset($error->errors()[$field]), "Expected an error for $field");
        return;
    }
    throw new RuntimeException("Invalid $field accepted");
}

$result = $validator->validate($valid);
verify($result['first_name'] === 'José María', 'Unicode names and whitespace normalization');
verify($result['email'] === 'Customer+demo@example.com', 'Email preserves local part and normalizes domain');
verify($result['mobile'] === '+639171234567', 'Phone normalization');
verify($result['postal_code'] === '0400', 'Leading zero preserved');
verify($result['promotion_code'] === 'DEMO', 'Promotion normalization');
foreach (['0917 123 4567', '+63 (917) 123-4567', '639171234567', '9171234567'] as $phone) {
    verify($validator->validate(array_replace($valid, ['mobile' => $phone]))['mobile'] === '+639171234567', 'Accepted phone format: ' . $phone);
}
foreach (array_keys($valid) as $field) {
    if (in_array($field, ['apartment', 'instructions', 'promotion_code'], true)) continue;
    rejects($validator, array_replace($valid, [$field => " \t "]), $field);
}
foreach (['email', 'first_name', 'last_name', 'mobile', 'country', 'region', 'street_address', 'apartment', 'barangay', 'city', 'province', 'postal_code', 'instructions', 'promotion_code'] as $field) {
    rejects($validator, array_replace($valid, [$field => ['unexpected' => 'array']]), $field);
    rejects($validator, array_replace($valid, [$field => 123]), $field);
}
foreach (['email' => 'a..b@example.com', 'mobile' => '0917abc4567', 'country' => 'Japan',
    'first_name' => '1234', 'last_name' => '<script>', 'region' => '---', 'postal_code' => '12a4',
    'street_address' => '<img src=x onerror=alert(1)>', 'instructions' => '<script>alert(1)</script>'] as $field => $value) {
    rejects($validator, array_replace($valid, [$field => $value]), $field);
}
foreach (['email' => 190, 'first_name' => 100, 'last_name' => 100, 'region' => 120, 'street_address' => 255,
    'apartment' => 255, 'barangay' => 120, 'city' => 120, 'province' => 120, 'postal_code' => 4,
    'instructions' => 500, 'promotion_code' => 50] as $field => $max) {
    rejects($validator, array_replace($valid, [$field => str_repeat('A', $max + 1)]), $field);
}
$clean = $validator->validate(array_replace($valid, ['first_name' => "Jo\0sé\u{200b}", 'instructions' => "  Call   at gate\r\nRing bell  "]));
verify($clean['first_name'] === 'José', 'Invisible controls removed');
verify($clean['instructions'] === "Call at gate\nRing bell", 'Multiline instructions normalized');
verify(!isset($validator->validate($valid + ['card_number' => 'not-stored'])['card_number']), 'Payment details are never included in validated data');
echo "PASS: checkout validation, required fields, types, lengths, Unicode, phone and postal formats, plain text, normalization and safe payload.\n";

<?php

declare(strict_types=1);

// Run: C:/xampp/php/php.exe tests/registration.php
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../app/Validation/ValidationException.php';
require_once __DIR__ . '/../app/Validation/AuthValidator.php';

use ClassicClub\Validation\AuthValidator;
use ClassicClub\Validation\ValidationException;

$validator = new AuthValidator();
$valid = ['first_name' => 'Juan', 'last_name' => "O'Neill", 'email' => 'juan.santos@gmail.com',
    'password' => 'Abcdef1!', 'password_confirmation' => 'Abcdef1!', 'terms_accepted' => true];
$checks = 0;
function check(bool $ok, string $message): void {
    global $checks;
    if (!$ok) throw new RuntimeException($message);
    $checks++;
}
foreach (['juan.santos@gmail.com', 'JUAN.SANTOS@GMAIL.COM', 'juan.santos+club@gmail.com'] as $email) {
    check($validator->registration(array_replace($valid, ['email' => $email]))['email'] === strtolower($email), 'Valid Gmail address');
}
foreach (['María José', 'Anne-Marie', "O'Neill", 'D’Arcy', '李', "Jose\u{0301}"] as $name) {
    check($validator->registration(array_replace($valid, ['first_name' => $name]))['first_name'] === $name, 'Valid international name');
}
$normalized = $validator->registration(array_replace($valid, ['first_name' => '  Juan   Carlos  ', 'email' => ' JUAN.SANTOS@GMAIL.COM ']));
check($normalized['first_name'] === 'Juan Carlos' && $normalized['email'] === $valid['email'], 'Whitespace and email normalization');

$invalid = [
    'email' => ['', 'user@yahoo.com', 'user@gmail.com.evil.test', 'user@gmail', '@gmail.com', '.user@gmail.com', 'user.@gmail.com',
        'user..name@gmail.com', 'user_name@gmail.com', 'user name@gmail.com', 'user@@gmail.com', 'user@gmail..com',
        'user+@gmail.com', str_repeat('a', 65) . '@gmail.com', "user@gmail.com\n", '<script>@gmail.com', [], true],
    'first_name' => ['', ' ', 'Juan123', '<script>alert(1)</script>', 'Juan; DROP TABLE users;', 'Juan & Maria', "Juan\0", "Juan\n",
        'Juan--Carlos', '-Juan', 'Juan-', "Juan\u{200B}", str_repeat('a', 101), [], 123, false],
    'last_name' => ['', '<img src=x onerror=alert(1)>', '123', [], str_repeat('ñ', 101)],
    'password' => ['', 'ABCDEFG1!', 'abcdefg1!', 'Abcdefgh!', 'Abcdefg12', 'Abc1!xy', 'Abcdef1 ',
        "Abcdef1!\0", "Abcdef1!\n", "Abcdef1!\u{200B}", 'Abc1!' . str_repeat('x', 68), [], true],
    'password_confirmation' => ['', 'different', []],
    'terms_accepted' => [false, null, 0, 1, 'true', 'false', [], 'on'],
];
foreach ($invalid as $field => $values) {
    foreach ($values as $value) {
        $data = array_replace($valid, [$field => $value]);
        if ($field === 'password') $data['password_confirmation'] = $value;
        try {
            $validator->registration($data);
            throw new RuntimeException('Accepted invalid ' . $field . ': ' . json_encode($value));
        } catch (ValidationException $e) {
            check(isset($e->errors()[$field]), 'Specific error for ' . $field);
            check($e->getMessage() !== 'Please correct the highlighted fields.', 'Actionable server error');
        }
    }
}
foreach (array_keys($valid) as $field) {
    $data = $valid;
    unset($data[$field]);
    try {
        $validator->registration($data);
        throw new RuntimeException('Accepted missing ' . $field);
    } catch (ValidationException $e) {
        check(isset($e->errors()[$field]), 'Required field: ' . $field);
    }
}
// Registration rules must not restrict existing login credentials.
check($validator->login(['email' => 'member@example.com', 'password' => 'old'])['password'] === 'old', 'Login accepts existing non-Gmail/legacy credentials');
echo "PASS: $checks registration and login regression checks.\n";

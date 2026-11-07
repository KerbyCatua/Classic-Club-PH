<?php

declare(strict_types=1);

namespace ClassicClub\Auth;

final class SessionManager
{
    public static function start(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }

        session_set_cookie_params([
            'lifetime' => 0,
            'path' => '/',
            'domain' => '',
            'secure' => false,
            'httponly' => true,
            'samesite' => 'Lax',
        ]);

        session_start();
    }

    public static function login(int $userId): void
    {
        self::start();

        $_SESSION = [];
        session_regenerate_id(true);
        $_SESSION['user_id'] = $userId;
        $_SESSION['logged_in_at'] = time();

        // Login rotates the session ID and clears the session payload. Issue a
        // fresh CSRF secret immediately so the token fetched before login is
        // never reused against the authenticated session.
        self::rotateCsrfToken();
    }

    public static function userId(): ?int
    {
        self::start();

        if (!isset($_SESSION['user_id'])) {
            return null;
        }

        return (int) $_SESSION['user_id'];
    }

    public static function logout(): void
    {
        self::start();

        $_SESSION = [];

        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();

            setcookie(
                session_name(),
                '',
                [
                    'expires' => time() - 42000,
                    'path' => $params['path'] ?: '/',
                    'domain' => $params['domain'] ?? '',
                    'secure' => (bool) $params['secure'],
                    'httponly' => (bool) $params['httponly'],
                    'samesite' => $params['samesite'] ?? 'Lax',
                ]
            );
        }

        setcookie('cc_csrf_token', '', [
            'expires' => time() - 42000,
            'path' => '/',
            'secure' => false,
            'httponly' => false,
            'samesite' => 'Lax',
        ]);

        session_destroy();
    }

    public static function rotateCsrfToken(): string
    {
        self::start();

        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        self::setCsrfCookie($_SESSION['csrf_token']);

        return $_SESSION['csrf_token'];
    }

    public static function csrfToken(): string
    {
        self::start();

        if (empty($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        }

        self::setCsrfCookie($_SESSION['csrf_token']);

        return $_SESSION['csrf_token'];
    }

    public static function requireCsrf(): void
    {
        // A missing session secret means the security context expired (for
        // example after session garbage collection). Issue a new secret so the
        // client can refresh and retry, but still reject this request.
        $sessionToken = self::csrfToken();

        $requestToken = $_SERVER['HTTP_X_CSRF_TOKEN']
            ?? $_POST['_csrf']
            ?? $_POST['csrf_token']
            ?? '';

        if (!is_string($requestToken) || $requestToken === '' || !hash_equals($sessionToken, $requestToken)) {
            throw new \RuntimeException('Invalid or expired CSRF token. Please retry.');
        }
    }

    private static function setCsrfCookie(string $token): void
    {
        $current = $_COOKIE['cc_csrf_token'] ?? null;
        if ($current === $token) {
            return;
        }

        setcookie('cc_csrf_token', $token, [
            'expires' => 0,
            'path' => '/',
            'secure' => false,
            'httponly' => false,
            'samesite' => 'Lax',
        ]);

        $_COOKIE['cc_csrf_token'] = $token;
    }
}

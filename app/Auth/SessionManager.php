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
            'httponly' => true,
            'secure' => false,
            'samesite' => 'Lax',
        ]);

        session_start();
    }

    public static function login(int $userId): void
    {
        self::start();

        session_regenerate_id(true);
        $_SESSION['user_id'] = $userId;
        $_SESSION['logged_in_at'] = time();
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
                time() - 42000,
                $params['path'],
                $params['domain'],
                (bool) $params['secure'],
                (bool) $params['httponly']
            );
        }

        session_destroy();
    }

    public static function csrfToken(): string
    {
        self::start();

        if (empty($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        }

        setcookie('cc_csrf_token', $_SESSION['csrf_token'], [
            'expires' => 0,
            'path' => '/',
            'secure' => false,
            'httponly' => false,
            'samesite' => 'Lax',
        ]);

        return $_SESSION['csrf_token'];
    }

    public static function requireCsrf(): void
    {
        $sessionToken = self::csrfToken();
        $requestToken = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';

        if (!is_string($requestToken) || !hash_equals($sessionToken, $requestToken)) {
            throw new \RuntimeException('Invalid CSRF token.');
        }
    }
}
<?php

declare(strict_types=1);

namespace ClassicClub\Cart;

use ClassicClub\Auth\SessionManager;

final class CartIdentity
{
    public static function sessionHash(): string
    {
        SessionManager::start();

        if (empty($_SESSION['cart_token'])) {
            $_SESSION['cart_token'] = bin2hex(random_bytes(32));
        }

        return hash('sha256', $_SESSION['cart_token']);
    }
}

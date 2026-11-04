<?php

declare(strict_types=1);

namespace ClassicClub\Services;

use ClassicClub\Cart\CartIdentity;
use ClassicClub\Repositories\CartRepository;
use ClassicClub\Repositories\OrderRepository;
use PDO;
use RuntimeException;

final class CheckoutService
{
    private const SHIPPING = 180.00;

    public function __construct(
        private readonly PDO $pdo,
        private readonly CartRepository $carts,
        private readonly OrderRepository $orders
    ) {
    }

    public function create(?int $userId, array $data): array
    {
        $cartId = $this->carts->findOrCreate($userId, CartIdentity::sessionHash());
        $items = $this->carts->checkoutItems($cartId);

        if ($items === []) {
            throw new RuntimeException('Your cart is empty.');
        }

        $subtotal = 0.0;
        foreach ($items as $item) {
            $subtotal += (float) $item['price'] * (int) $item['quantity'];
        }

        $promotion = $this->promotion($data['promotion_code'], $subtotal);
        $shipping = self::SHIPPING;
        $discount = $promotion['discount'];
        $total = max(0, $subtotal + $shipping - $discount);
        $orderNumber = 'CC-' . date('ymd') . '-' . strtoupper(bin2hex(random_bytes(4)));

        $this->pdo->beginTransaction();
        try {
            $orderId = $this->orders->create([
                'order_number' => $orderNumber,
                'user_id' => $userId,
                'email' => $data['email'],
                'subtotal' => $subtotal,
                'shipping' => $shipping,
                'discount' => $discount,
                'total' => $total,
            ]);

            foreach ($items as $item) {
                $this->orders->addItem($orderId, $item);
            }
            $this->orders->addAddress($orderId, $data);
            if ($promotion['id'] !== null) {
                $redemption = $this->pdo->prepare(
                    <<<'SQL'
                        INSERT INTO promotion_redemptions
                            (promotion_id, order_id, user_id, discount_amount)
                        VALUES
                            (:promotion_id, :order_id, :user_id, :discount_amount)
                    SQL
                );
                $redemption->execute([
                    'promotion_id' => $promotion['id'],
                    'order_id' => $orderId,
                    'user_id' => $userId,
                    'discount_amount' => $discount,
                ]);
            }
            $this->carts->clear($cartId);

            $this->pdo->commit();
        } catch (\Throwable $exception) {
            $this->pdo->rollBack();
            throw $exception;
        }

        return [
            'order_number' => $orderNumber,
            'status' => 'confirmed',
            'placed_at' => date('c'),
            'items' => $items,
            'subtotal' => number_format($subtotal, 2, '.', ''),
            'shipping' => number_format($shipping, 2, '.', ''),
            'discount' => number_format($discount, 2, '.', ''),
            'total' => number_format($total, 2, '.', ''),
            'customer' => $data,
        ];
    }

    private function promotion(string $code, float $subtotal): array
    {
        if ($code === '') {
            return ['id' => null, 'discount' => 0.0];
        }

        $statement = $this->pdo->prepare(
            <<<'SQL'
                SELECT id, discount_type, discount_value, usage_limit
                FROM promotions
                WHERE code = :code
                  AND is_active = 1
                  AND (starts_at IS NULL OR starts_at <= NOW())
                  AND (ends_at IS NULL OR ends_at >= NOW())
                LIMIT 1
            SQL
        );
        $statement->execute(['code' => $code]);
        $promotion = $statement->fetch();

        if (!$promotion) {
            throw new RuntimeException('Promotion code is invalid or expired.');
        }

        if ($promotion['usage_limit'] !== null) {
            $usage = $this->pdo->prepare(
                'SELECT COUNT(*) FROM promotion_redemptions WHERE promotion_id = :promotion_id'
            );
            $usage->execute(['promotion_id' => $promotion['id']]);
            if ((int) $usage->fetchColumn() >= (int) $promotion['usage_limit']) {
                throw new RuntimeException('Promotion code usage limit has been reached.');
            }
        }

        $discount = match ($promotion['discount_type']) {
            'percentage' => round($subtotal * ((float) $promotion['discount_value'] / 100), 2),
            'fixed_amount' => min($subtotal, (float) $promotion['discount_value']),
            'free_shipping' => self::SHIPPING,
            default => 0.0,
        };

        return ['id' => (int) $promotion['id'], 'discount' => $discount];
    }
}

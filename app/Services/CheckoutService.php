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

            $this->pdo->beginTransaction();
            try {
                $items = $this->carts->checkoutItems($cartId);

                if ($items === []) {
                    throw new RuntimeException('Your cart is empty.');
                }

                $available = $this->lockAvailableStock($items);
                $this->assertStockAvailable($items, $available);

                $subtotal = 0.0;
                foreach ($items as $item) {
                    $subtotal += (float) $item['price'] * (int) $item['quantity'];
                }

                $promotion = $this->promotion($data['promotion_code'], $subtotal);
                $shipping = self::SHIPPING;
                $discount = $promotion['discount'];
                $total = max(0, $subtotal + $shipping - $discount);
                $orderNumber = 'CC-' . date('ymd') . '-' . strtoupper(bin2hex(random_bytes(4)));

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

                $this->deductStock($items, $available, $orderId);
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

        /**
         * Lock the variant-size rows backing the cart so concurrent checkouts cannot
         * oversell the same units.
         *
         * @return array<int,int> variant_size_id => quantity_on_hand
         */
        private function lockAvailableStock(array $items): array
        {
            $ids = array_values(array_unique(array_map(
                static fn (array $item): int => (int) $item['variant_size_id'],
                $items
            )));

            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $statement = $this->pdo->prepare(
                "SELECT id, quantity_on_hand FROM variant_sizes WHERE id IN ($placeholders) ORDER BY id FOR UPDATE"
            );
            $statement->execute($ids);

            $available = [];
            foreach ($statement->fetchAll() as $row) {
                $available[(int) $row['id']] = (int) $row['quantity_on_hand'];
            }

            return $available;
        }

        private function assertStockAvailable(array $items, array $available): void
        {
            foreach ($items as $item) {
                $variantSizeId = (int) $item['variant_size_id'];
                $quantity = (int) $item['quantity'];
                $remaining = $available[$variantSizeId] ?? 0;

                if ($quantity > $remaining) {
                    $label = trim(sprintf('%s / %s', (string) $item['name'], (string) $item['size']));
                    throw new RuntimeException(
                        $remaining > 0
                            ? "Only $remaining unit(s) of $label remain in stock. Please update your bag."
                            : "$label is out of stock. Please remove it from your bag."
                    );
                }
            }
        }

        /**
         * Deduct purchased units. Guarded updates keep stock from ever going negative,
         * and each order writes one sale movement per variant size.
         */
        private function deductStock(array $items, array $available, int $orderId): void
        {
            $update = $this->pdo->prepare(
                'UPDATE variant_sizes
                             SET quantity_on_hand = quantity_on_hand - :deduct
                 WHERE id = :variant_size_id
                               AND quantity_on_hand >= :required'
            );
            $movement = $this->pdo->prepare(
                <<<'SQL'
                    INSERT INTO inventory_movements
                        (variant_size_id, product_id, quantity_delta, previous_quantity,
                         new_quantity, movement_type, reference_type, reference_id, notes)
                    VALUES
                        (:variant_size_id, :product_id, :delta, :previous, :new,
                         'sale', 'order', :order_id, :notes)
                SQL
            );

            foreach ($items as $item) {
                $variantSizeId = (int) $item['variant_size_id'];
                $quantity = (int) $item['quantity'];

                $update->execute([
                                    'deduct' => $quantity,
                                    'required' => $quantity,
                                    'variant_size_id' => $variantSizeId,
                                ]);

                if ($update->rowCount() !== 1) {
                    throw new RuntimeException('Stock changed while placing the order. Please review your bag and try again.');
                }

                $previous = $available[$variantSizeId] ?? 0;
                $movement->execute([
                    'variant_size_id' => $variantSizeId,
                    'product_id' => $item['product_id'] ?? null,
                    'delta' => -$quantity,
                    'previous' => $previous,
                    'new' => $previous - $quantity,
                    'order_id' => $orderId,
                    'notes' => 'Checkout · -' . $quantity . ' units',
                ]);
                $available[$variantSizeId] = $previous - $quantity;
            }
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

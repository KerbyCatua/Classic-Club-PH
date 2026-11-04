<?php

declare(strict_types=1);

namespace ClassicClub\Repositories;

use PDO;

final class OrderRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function create(array $order): int
    {
        $statement = $this->pdo->prepare(
            <<<'SQL'
                INSERT INTO orders
                    (order_number, user_id, guest_email, status, payment_status,
                     subtotal, shipping_amount, discount_amount, total_amount, placed_at)
                VALUES
                    (:order_number, :user_id, :guest_email, 'confirmed', 'illustrative',
                     :subtotal, :shipping, :discount, :total, NOW())
            SQL
        );
        $statement->execute([
            'order_number' => $order['order_number'],
            'user_id' => $order['user_id'],
            'guest_email' => $order['email'],
            'subtotal' => $order['subtotal'],
            'shipping' => $order['shipping'],
            'discount' => $order['discount'],
            'total' => $order['total'],
        ]);

        return (int) $this->pdo->lastInsertId();
    }

    public function addItem(int $orderId, array $item): void
    {
        $statement = $this->pdo->prepare(
            <<<'SQL'
                INSERT INTO order_items
                    (order_id, variant_size_id, sku_snapshot, product_name_snapshot,
                     color_snapshot, size_snapshot, quantity, unit_price, line_total)
                VALUES
                    (:order_id, :variant_size_id, :sku, :name, :color, :size,
                     :quantity, :unit_price, :line_total)
            SQL
        );
        $statement->execute([
            'order_id' => $orderId,
            'variant_size_id' => $item['variant_size_id'],
            'sku' => $item['sku'],
            'name' => $item['name'],
            'color' => $item['color'],
            'size' => $item['size'],
            'quantity' => $item['quantity'],
            'unit_price' => $item['price'],
            'line_total' => $item['price'] * $item['quantity'],
        ]);
    }

    public function addAddress(int $orderId, array $address): void
    {
        $statement = $this->pdo->prepare(
            <<<'SQL'
                INSERT INTO order_addresses
                    (order_id, recipient_first_name, recipient_last_name, mobile,
                     country, street_address, apartment, barangay, city, province, postal_code)
                VALUES
                    (:order_id, :first_name, :last_name, :mobile, :country, :street,
                     :apartment, :barangay, :city, :province, :postal_code)
            SQL
        );
        $statement->execute([
            'order_id' => $orderId,
            'first_name' => $address['first_name'],
            'last_name' => $address['last_name'],
            'mobile' => $address['mobile'],
            'country' => $address['country'],
            'street' => $address['street_address'],
            'apartment' => $address['apartment'] ?: null,
            'barangay' => $address['barangay'],
            'city' => $address['city'],
            'province' => $address['province'],
            'postal_code' => $address['postal_code'],
        ]);
    }

    public function findForUserOrNumber(?int $userId, string $orderNumber): ?array
    {
        $statement = $this->pdo->prepare(
            <<<'SQL'
                SELECT
                    o.id, o.order_number, o.status, o.payment_status, o.placed_at,
                    o.subtotal, o.shipping_amount, o.discount_amount, o.total_amount,
                    o.guest_email, a.recipient_first_name, a.recipient_last_name,
                    a.mobile, a.country, a.street_address, a.apartment,
                    a.barangay, a.city, a.province, a.postal_code
                FROM orders o
                INNER JOIN order_addresses a ON a.order_id = o.id
                WHERE o.order_number = :order_number
                  AND (
                      o.user_id = :user_id_match
                      OR (:user_id_null IS NULL AND o.user_id IS NULL)
                  )
                LIMIT 1
            SQL
        );
        $statement->execute([
            'order_number' => $orderNumber,
            'user_id_match' => $userId,
            'user_id_null' => $userId,
        ]);
        $order = $statement->fetch();

        if (!$order) {
            return null;
        }

        $items = $this->pdo->prepare(
            <<<'SQL'
                SELECT
                    oi.sku_snapshot AS sku,
                    oi.product_name_snapshot AS name,
                    oi.color_snapshot AS color,
                    oi.size_snapshot AS size,
                    oi.quantity,
                    oi.unit_price AS price,
                    oi.line_total,
                    v.catalog_key AS id,
                    image.image_url AS image
                FROM order_items oi
                LEFT JOIN variant_sizes vs ON vs.id = oi.variant_size_id
                LEFT JOIN product_variants v ON v.id = vs.variant_id
                LEFT JOIN product_images image
                    ON image.variant_id = v.id
                   AND image.image_role = 'primary'
                   AND image.sort_order = 0
                WHERE oi.order_id = :order_id
                ORDER BY oi.id ASC
            SQL
        );
        $items->execute(['order_id' => $order['id']]);
        $order['items'] = $items->fetchAll();

        return $order;
    }

    public function latestForUser(int $userId): ?array
    {
        $statement = $this->pdo->prepare(
            'SELECT order_number FROM orders WHERE user_id = :user_id ORDER BY created_at DESC LIMIT 1'
        );
        $statement->execute(['user_id' => $userId]);
        $number = $statement->fetchColumn();

        return $number === false
            ? null
            : $this->findForUserOrNumber($userId, (string) $number);
    }
}

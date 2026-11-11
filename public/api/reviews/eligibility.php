<?php

declare(strict_types=1);

use ClassicClub\Auth\SessionManager;
use ClassicClub\Http\JsonResponse;
use ClassicClub\Repositories\OrderRepository;
use ClassicClub\Repositories\ReviewRepository;

require_once __DIR__ . '/../../../app/Database/Connection.php';
require_once __DIR__ . '/../../../app/Http/Response.php';
require_once __DIR__ . '/../../../app/Http/JsonResponse.php';
require_once __DIR__ . '/../../../app/Auth/SessionManager.php';
require_once __DIR__ . '/../../../app/Repositories/OrderRepository.php';
require_once __DIR__ . '/../../../app/Repositories/ReviewRepository.php';

try {
    $userId = SessionManager::userId();
    $orderNumber = trim((string) ($_GET['order_number'] ?? ''));
    $variantKey = trim((string) ($_GET['variant'] ?? ''));
    $variantId = isset($_GET['variant_id']) ? (int) $_GET['variant_id'] : 0;

    $reviewRepo = new ReviewRepository($pdo);
    $orderRepo = new OrderRepository($pdo);
    // Trigger simulated delivery update
    if ($orderNumber !== '') {
        $orderRepo->updateSimulatedDeliveries();
    }

    // Find variant
    $variant = null;
    if ($variantId > 0) {
        $variant = $reviewRepo->findVariantById($variantId);
    } elseif ($variantKey !== '') {
        $variant = $reviewRepo->findVariantByCatalogKey($variantKey);
    }

    $reviews = $variant ? $reviewRepo->getReviewsForVariant((int) $variant['variant_id']) : [];

    $eligibility = [
        'eligible' => false,
        'reason' => 'Sign in to review your purchase.',
        'order' => null
    ];

    if ($userId !== null && $orderNumber !== '') {
        $order = $reviewRepo->findOrderByNumber($orderNumber);
        if ($order && (int) $order['user_id'] === $userId && $variant) {
            $eligibility = $reviewRepo->checkEligibility($userId, (int) $order['id'], (int) $variant['variant_id']);
            $eligibility['order'] = [
                'id' => $order['id'],
                'order_number' => $order['order_number'],
                'status' => $order['status']
            ];
        } else {
            $eligibility = [
                'eligible' => false,
                'reason' => 'Order not found or does not belong to your account.',
                'order' => null
            ];
        }
    }

    JsonResponse::success([
        'variant' => $variant,
        'reviews' => $reviews,
        'eligibility' => $eligibility,
        'is_logged_in' => $userId !== null,
    ])->send();
} catch (Throwable $e) {
    error_log($e->getMessage());
    JsonResponse::error('Failed to load review details: ' . $e->getMessage(), 500)->send();
}

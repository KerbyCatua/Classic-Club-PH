<?php

declare(strict_types=1);

use ClassicClub\Auth\SessionManager;
use ClassicClub\Http\JsonResponse;
use ClassicClub\Http\Request;
use ClassicClub\Repositories\OrderRepository;
use ClassicClub\Repositories\ReviewRepository;

require_once __DIR__ . '/../../../app/Database/Connection.php';
require_once __DIR__ . '/../../../app/Http/Request.php';
require_once __DIR__ . '/../../../app/Http/Response.php';
require_once __DIR__ . '/../../../app/Http/JsonResponse.php';
require_once __DIR__ . '/../../../app/Auth/SessionManager.php';
require_once __DIR__ . '/../../../app/Repositories/OrderRepository.php';
require_once __DIR__ . '/../../../app/Repositories/ReviewRepository.php';

try {
    $request = new Request();
    if ($request->method() !== 'POST') {
        JsonResponse::error('Method not allowed.', 405)->send();
    }

    $userId = SessionManager::userId();
    if ($userId === null) {
        JsonResponse::error('You must be signed in to submit a review.', 401)->send();
    }

    $body = $request->json();

    $orderNumber = trim((string) ($body['order_number'] ?? ''));
    $variantId = (int) ($body['variant_id'] ?? 0);
    $variantKey = trim((string) ($body['catalog_key'] ?? ''));
    $rating = (int) ($body['rating'] ?? 0);
    $displayName = trim((string) ($body['display_name'] ?? ''));
    $email = trim((string) ($body['email'] ?? ''));
    $title = trim((string) ($body['title'] ?? ''));
    $content = trim((string) ($body['content'] ?? ''));
    $sizePurchased = trim((string) ($body['size_purchased'] ?? ''));
    $fitFeedback = trim((string) ($body['fit_feedback'] ?? ''));
    $consent = !empty($body['consent']);

    if (!$consent) {
        JsonResponse::error('You must agree to the review publication terms.', 422)->send();
    }

    if ($rating < 1 || $rating > 5) {
        JsonResponse::error('Please select a star rating between 1 and 5.', 422)->send();
    }

    if ($displayName === '') {
        JsonResponse::error('Display name is required.', 422)->send();
    }

    if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        JsonResponse::error('A valid email address is required.', 422)->send();
    }

    if ($title === '') {
        JsonResponse::error('Review title is required.', 422)->send();
    }

    if (mb_strlen($content) < 30) {
        JsonResponse::error('Review content must be at least 30 characters.', 422)->send();
    }

    if (mb_strlen($content) > 2000) {
        JsonResponse::error('Review content cannot exceed 2000 characters.', 422)->send();
    }

    if ($sizePurchased === '') {
        JsonResponse::error('Size purchased is required.', 422)->send();
    }

    if ($fitFeedback === '') {
        JsonResponse::error('Fit feedback is required.', 422)->send();
    }

    $reviewRepo = new ReviewRepository($pdo);
    $orderRepo = new OrderRepository($pdo);
    $orderRepo->updateSimulatedDeliveries();

    // Resolve variant
    $variant = null;
    if ($variantId > 0) {
        $variant = $reviewRepo->findVariantById($variantId);
    } elseif ($variantKey !== '') {
        $variant = $reviewRepo->findVariantByCatalogKey($variantKey);
    }

    if (!$variant) {
        JsonResponse::error('Product not found.', 404)->send();
    }

    $order = $reviewRepo->findOrderByNumber($orderNumber);
    if (!$order) {
        JsonResponse::error('Order not found.', 404)->send();
    }

    // Verify ownership and delivery status on the backend
    $eligibility = $reviewRepo->checkEligibility($userId, (int) $order['id'], (int) $variant['variant_id']);
    if (!$eligibility['eligible']) {
        JsonResponse::error($eligibility['reason'] ?: 'Product is not eligible for review.', 403)->send();
    }

    $reviewId = $reviewRepo->createReview([
        'order_id' => (int) $order['id'],
        'user_id' => $userId,
        'variant_id' => (int) $variant['variant_id'],
        'rating' => $rating,
        'title' => $title,
        'content' => $content,
        'display_name' => $displayName,
        'email' => $email,
        'size_purchased' => $sizePurchased,
        'fit_feedback' => $fitFeedback,
        'images' => $body['images'] ?? null,
    ]);

    JsonResponse::success([
        'message' => 'Thank you! Your review has been submitted successfully.',
        'review_id' => $reviewId
    ], 201)->send();
} catch (Throwable $e) {
    error_log($e->getMessage());
    JsonResponse::error('Unable to submit your review: ' . $e->getMessage(), 500)->send();
}

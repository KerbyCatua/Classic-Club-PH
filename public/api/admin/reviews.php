<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

use ClassicClub\Http\JsonResponse;
use ClassicClub\Http\Request;

$request = new Request();

try {
    if ($request->method() === 'GET') {
        $ctx = getAdminContext($pdo, false);
        $filters = [
            'search' => $request->queryString('search') ?? '',
            'product' => $request->queryString('product') ?? '',
            'rating' => $request->queryString('rating') ?? '',
        ];
        $reviews = $ctx['service']->getReviews($ctx['business_id'], $filters);
        JsonResponse::success($reviews)->send();
    }

    if ($request->method() === 'POST') {
        $ctx = getAdminContext($pdo, true);
        requireAdminPermission($ctx, 'can_reply_reviews');
        $body = $request->json();
        $action = $body['action'] ?? '';
        $reviewId = (int)($body['review_id'] ?? 0);

        if ($action === 'reply') {
            require_once __DIR__ . '/../../../app/Services/SystemConfigurationService.php';
            \ClassicClub\Services\SystemConfigurationService::requireFeature('reviews_enabled');
            $replyText = trim((string)($body['reply_text'] ?? ''));
            if ($replyText === '') {
                JsonResponse::error('Reply text cannot be empty.', 422)->send();
            }
            $result = $ctx['service']->replyReview(
                $ctx['business_id'],
                $reviewId,
                $replyText,
                $ctx['admin_name'],
                $ctx['user_id']
            );
            JsonResponse::success($result)->send();
        }

        if ($action === 'flag') {
            $reason = trim((string)($body['reason'] ?? 'Inappropriate review flagged for moderation'));
            $result = $ctx['service']->flagReview(
                $ctx['business_id'],
                $reviewId,
                $reason,
                $ctx['user_id'],
                $ctx['admin_name']
            );
            JsonResponse::success($result)->send();
        }

        JsonResponse::error('Invalid review action.', 422)->send();
    }

    JsonResponse::error('Method not allowed.', 405)->send();
} catch (Throwable $e) {
    JsonResponse::error($e->getMessage(), 400)->send();
}

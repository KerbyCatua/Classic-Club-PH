<?php

declare(strict_types=1);

use ClassicClub\Middleware\PermissionMiddleware;
use ClassicClub\Repositories\InquiryRepository;

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/../../../app/Authorization/PermissionChecker.php';
require_once __DIR__ . '/../../../app/Middleware/PermissionMiddleware.php';
require_once __DIR__ . '/../../../app/Repositories/InquiryRepository.php';

try {
    PermissionMiddleware::require($pdo, 'inquiries.view');
    $context = getSupportTicketContext($pdo);
    $id = filter_var($_GET['id'] ?? null, FILTER_VALIDATE_INT);
    if ($id === false) {
        http_response_code(422);
        exit('A valid attachment id is required.');
    }
    $attachment = (new InquiryRepository($pdo))->attachment($context['business_id'], (int) $id);
    if ($attachment === null || !is_file($attachment['storage_path'])) {
        http_response_code(404);
        exit('Attachment not found.');
    }
    header('Content-Type: ' . $attachment['mime_type']);
    header('Content-Disposition: attachment; filename="' . str_replace('"', '', $attachment['original_name']) . '"');
    header('X-Content-Type-Options: nosniff');
    readfile($attachment['storage_path']);
} catch (Throwable $exception) {
    error_log($exception->getMessage());
    http_response_code(500);
    exit('Unable to load attachment.');
}

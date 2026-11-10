<?php
declare(strict_types=1);
require_once __DIR__.'/bootstrap.php';
require_once __DIR__.'/../../../app/Repositories/InquiryRepository.php';
use ClassicClub\Http\JsonResponse;
use ClassicClub\Repositories\InquiryRepository;
try {
    getSuperAdminContext($pdo);
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') { header('Allow: GET'); JsonResponse::error('Method not allowed.',405)->send(); }
    $id=filter_var($_GET['id'] ?? null,FILTER_VALIDATE_INT,['options'=>['min_range'=>1]]);
    if (!$id) JsonResponse::error('Invalid attachment.',422)->send();
    $file=(new InquiryRepository($pdo))->attachment($id);
    if (!$file || !is_file($file['storage_path'])) JsonResponse::error('Attachment not found.',404)->send();
    header('Cache-Control: private, no-store');
    header('X-Content-Type-Options: nosniff');
    header('Content-Type: application/octet-stream');
    header("Content-Disposition: attachment; filename=attachment; filename*=UTF-8''".rawurlencode($file['original_name']));
    readfile($file['storage_path']);
} catch (Throwable $e) {
    error_log('Support attachment: '.$e->getMessage());
    JsonResponse::error('Unable to download attachment.',500)->send();
}

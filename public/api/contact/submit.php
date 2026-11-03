<?php

declare(strict_types=1);

use ClassicClub\Auth\SessionManager;
use ClassicClub\Http\JsonResponse;
use ClassicClub\Repositories\InquiryRepository;
use ClassicClub\Services\ContactService;
use ClassicClub\Support\AuditLogger;
use ClassicClub\Validation\ContactValidator;
use ClassicClub\Validation\ValidationException;

require_once __DIR__ . '/../../../app/Database/Connection.php';
require_once __DIR__ . '/../../../app/Http/Response.php';
require_once __DIR__ . '/../../../app/Http/JsonResponse.php';
require_once __DIR__ . '/../../../app/Auth/SessionManager.php';
require_once __DIR__ . '/../../../app/Middleware/CsrfMiddleware.php';
require_once __DIR__ . '/../../../app/Repositories/InquiryRepository.php';
require_once __DIR__ . '/../../../app/Support/AuditLogger.php';
require_once __DIR__ . '/../../../app/Validation/ValidationException.php';
require_once __DIR__ . '/../../../app/Validation/ContactValidator.php';
require_once __DIR__ . '/../../../app/Services/ContactService.php';

try {
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        JsonResponse::error('Method not allowed.', 405)->send();
    }
    \ClassicClub\Middleware\CsrfMiddleware::require();

    $data = (new ContactValidator())->validate($_POST);
    $id = (new ContactService(
        new InquiryRepository($pdo),
        dirname(__DIR__, 3) . '/storage/private/contact'
    ))->submit($data, $_FILES['attachment'] ?? null, SessionManager::userId());
    (new AuditLogger($pdo))->record(
        'contact.inquiry_created',
        SessionManager::userId(),
        'contact_inquiry',
        $id
    );

    JsonResponse::success(['inquiry_id' => $id], 201)->send();
} catch (ValidationException $exception) {
    JsonResponse::error($exception->getMessage(), 422, $exception->errors())->send();
} catch (RuntimeException $exception) {
    JsonResponse::error($exception->getMessage(), 422)->send();
} catch (Throwable $exception) {
    error_log($exception->getMessage());
    JsonResponse::error('Unable to submit the inquiry.', 500)->send();
}

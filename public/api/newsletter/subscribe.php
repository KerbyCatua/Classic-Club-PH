<?php

declare(strict_types=1);

use ClassicClub\Http\JsonResponse;
use ClassicClub\Http\Request;
use ClassicClub\Auth\SessionManager;
use ClassicClub\Repositories\NewsletterRepository;
use ClassicClub\Validation\NewsletterValidator;
use ClassicClub\Validation\ValidationException;

require_once __DIR__ . '/../../../app/Database/Connection.php';
require_once __DIR__ . '/../../../app/Support/Input.php';
require_once __DIR__ . '/../../../app/Http/Request.php';
require_once __DIR__ . '/../../../app/Http/Response.php';
require_once __DIR__ . '/../../../app/Http/JsonResponse.php';
require_once __DIR__ . '/../../../app/Auth/SessionManager.php';
require_once __DIR__ . '/../../../app/Middleware/CsrfMiddleware.php';
require_once __DIR__ . '/../../../app/Validation/ValidationException.php';
require_once __DIR__ . '/../../../app/Validation/NewsletterValidator.php';
require_once __DIR__ . '/../../../app/Repositories/NewsletterRepository.php';

try {
    $request = new Request();
    if ($request->method() !== 'POST') {
        JsonResponse::error('Method not allowed.', 405)->send();
    }
    \ClassicClub\Middleware\CsrfMiddleware::require();

    $email = (new NewsletterValidator())->validate($request->json());
    JsonResponse::success(
        (new NewsletterRepository($pdo))->subscribe($email)
    )->send();
} catch (ValidationException $exception) {
    JsonResponse::error($exception->getMessage(), 422, $exception->errors())->send();
} catch (Throwable $exception) {
    error_log($exception->getMessage());
    JsonResponse::error('Unable to subscribe at this time.', 500)->send();
}

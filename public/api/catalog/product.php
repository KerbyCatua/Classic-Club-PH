<?php

declare(strict_types=1);

use ClassicClub\Http\JsonResponse;
use ClassicClub\Http\Request;
use ClassicClub\Repositories\ProductRepository;
use ClassicClub\Services\CatalogService;
use ClassicClub\Validation\ProductValidator;
use ClassicClub\Validation\ValidationException;

require_once __DIR__ . '/../../../app/Database/Connection.php';
require_once __DIR__ . '/../../../app/Support/Input.php';
require_once __DIR__ . '/../../../app/Http/Request.php';
require_once __DIR__ . '/../../../app/Http/Response.php';
require_once __DIR__ . '/../../../app/Http/JsonResponse.php';
require_once __DIR__ . '/../../../app/Validation/ValidationException.php';
require_once __DIR__ . '/../../../app/Validation/ProductValidator.php';
require_once __DIR__ . '/../../../app/Repositories/ProductRepository.php';
require_once __DIR__ . '/../../../app/Services/CatalogService.php';

$request = new Request();

try {
    if ($request->method() !== 'GET') {
        JsonResponse::error('Method not allowed.', 405)->send();
    }

    $id = (new ProductValidator())->productId(
        $request->queryString('id')
    );
    $product = (new CatalogService(new ProductRepository($pdo)))->getProduct($id);

    JsonResponse::success($product)->send();
} catch (ValidationException $exception) {
    JsonResponse::error(
        $exception->getMessage(),
        422,
        $exception->errors()
    )->send();
} catch (RuntimeException $exception) {
    JsonResponse::error($exception->getMessage(), 404)->send();
} catch (Throwable $exception) {
    error_log($exception->getMessage());
    JsonResponse::error('An unexpected server error occurred.', 500)->send();
}

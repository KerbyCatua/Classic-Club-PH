<?php
declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/../../../app/Services/SystemConfigurationService.php';

use ClassicClub\Http\JsonResponse;
use ClassicClub\Http\Request;
use ClassicClub\Services\SystemConfigurationService;

$request = new Request();
try {
    if (!in_array($request->method(), ['GET', 'POST'], true)) JsonResponse::error('Method not allowed.', 405)->send();
    $ctx = getSuperAdminContext($pdo, $request->method() === 'POST');
    header('Cache-Control: no-store');
    $service = new SystemConfigurationService($pdo);
    if ($request->method() === 'GET') JsonResponse::success($service->read())->send();
    $body = $request->json();
    if (!is_array($body['settings'] ?? null) || !is_string($body['version'] ?? null)) throw new InvalidArgumentException('Invalid configuration request.');
    JsonResponse::success($service->save($body['settings'], $body['version'], $ctx['user_id'], ($body['confirmed'] ?? false) === true))->send();
} catch (InvalidArgumentException $e) {
    JsonResponse::error($e->getMessage(), 422)->send();
} catch (RuntimeException $e) {
    JsonResponse::error($e->getCode() === 409 ? $e->getMessage() : 'Unable to save configuration.', $e->getCode() === 409 ? 409 : 500)->send();
} catch (Throwable $e) {
    error_log($e->getMessage());
    JsonResponse::error('Unable to load or save configuration.', 500)->send();
}

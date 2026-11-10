<?php
declare(strict_types=1);
require_once __DIR__.'/bootstrap.php';
require_once __DIR__.'/../../../app/Services/SupportTicketService.php';

use ClassicClub\Http\Request;
use ClassicClub\Http\JsonResponse;
use ClassicClub\Services\SupportTicketService;

try {
    $request=new Request();
    $context=getSuperAdminContext($pdo,$request->method()==='POST');
    header('Cache-Control: no-store');
    $service=new SupportTicketService($pdo);
    if ($request->method()==='GET') {
        if (isset($_GET['id'])) JsonResponse::success($service->detail($service->integer($_GET['id']),(int)$context['user_id'],$service->integer($_GET['page'] ?? 1)))->send();
        JsonResponse::success($service->listing($_GET))->send();
    }
    if ($request->method()==='POST') {
        $multipart=str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'multipart/form-data');
        JsonResponse::success($service->mutate((int)$context['user_id'],$multipart ? $_POST : $request->json(),$_FILES['attachment'] ?? null))->send();
    }
    header('Allow: GET, POST'); JsonResponse::error('Method not allowed.',405)->send();
} catch (InvalidArgumentException $e) {
    JsonResponse::error($e->getMessage(),422)->send();
} catch (Throwable $e) {
    if (in_array($e->getCode(),[404,409],true)) JsonResponse::error($e->getMessage(),(int)$e->getCode())->send();
    error_log('Support tickets: '.$e->getMessage());
    JsonResponse::error('Unable to access support tickets. Check database access and migration 016.',500)->send();
}

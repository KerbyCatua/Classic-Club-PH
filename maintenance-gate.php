<?php

declare(strict_types=1);

require_once __DIR__ . '/app/Database/Connection.php';
require_once __DIR__ . '/app/Services/MaintenanceService.php';
require_once __DIR__ . '/app/Auth/SessionManager.php';

use ClassicClub\Auth\SessionManager;
use ClassicClub\Services\MaintenanceService;

$resource = (string) ($_GET['resource'] ?? '');
unset($_GET['resource']);
if ($resource === 'super-admin-dashboard.html') {
    $resource = 'super-admin-gate.php';
}
$allowed = $resource !== 'maintenance-gate.php' && (preg_match('/^[A-Za-z0-9_-]+\.(?:html|php)$/', $resource)
    || preg_match('#^components/[A-Za-z0-9_-]+\.html$#', $resource)
    || preg_match('#^public/api/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+\.php$#', $resource));
$root = realpath(__DIR__);
$target = realpath(__DIR__ . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $resource));
if (!$allowed || !$target || !$root || !str_starts_with($target, $root . DIRECTORY_SEPARATOR)
    || !preg_match('/\.(html|php)$/i', $target)) {
    http_response_code(404);
    exit('Not found.');
}

try {
    $state = (new MaintenanceService($pdo))->state();
} catch (Throwable $exception) {
    error_log('Maintenance gate failed: ' . $exception->getMessage());
    http_response_code(503);
    exit('Service temporarily unavailable.');
}

$isAdminRoute = $resource === 'super-admin-gate.php'
    || str_starts_with($resource, 'public/api/super-admin/')
    || str_starts_with($resource, 'public/api/auth/')
    || $resource === 'public/api/admin/auth-check.php'
    || str_starts_with($resource, 'components/');

if ($state['active'] && !$isAdminRoute) {
    $userId = SessionManager::userId();
    $authorized = false;
    if ($userId !== null) {
        $statement = $pdo->prepare("SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id WHERE u.id = ? AND u.status = 'active' AND u.deleted_at IS NULL AND r.name = 'super_admin' LIMIT 1");
        $statement->execute([$userId]);
        $authorized = (bool) $statement->fetchColumn();
    }
    if (!$authorized) {
        http_response_code(503);
        header('Cache-Control: no-store');
        header('Retry-After: 300');
        $announcement = $state['announcement'];
        $showOnPage = in_array($announcement['location'] ?? '', ['Application-wide', 'Maintenance page only'], true);
        $title = $showOnPage ? trim((string) ($announcement['title'] ?? '')) : '';
        $message = $showOnPage ? trim((string) ($announcement['message'] ?? '')) : '';
        $title = $title ?: 'Scheduled Maintenance';
        $message = $message ?: 'Classic Club PH is temporarily unavailable. Please try again shortly.';
        if (str_ends_with($resource, '.php')) {
            header('Content-Type: application/json; charset=utf-8');
            exit(json_encode(['success' => false, 'error' => ['message' => $message, 'fields' => []]], JSON_UNESCAPED_UNICODE));
        }
        $html = file_get_contents($target);
        if ($html === false) {
            http_response_code(500);
            exit('Unable to load page.');
        }
        $modal = '<div id="cc-maintenance-overlay" class="modal show" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="cc-maintenance-title" aria-describedby="cc-maintenance-message">'
            . '<div class="modal-dialog modal-dialog-centered cc-maintenance-dialog">'
            . '<section class="modal-content"><div class="modal-body d-flex flex-column">'
            . '<span class="cc-maintenance-eyebrow">CLASSIC CLUB PH &middot; SYSTEM STATUS</span>'
            . '<h1 id="cc-maintenance-title" class="m-0">' . htmlspecialchars($title, ENT_QUOTES, 'UTF-8') . '</h1>'
            . '<p id="cc-maintenance-message" class="m-0">' . nl2br(htmlspecialchars($message, ENT_QUOTES, 'UTF-8')) . '</p>'
            . '<div class="cc-maintenance-manage">'
            . '<button id="cc-maintenance-toggle" class="btn btn-link p-0" type="button" data-bs-toggle="collapse" data-bs-target="#cc-maintenance-admin" aria-expanded="false" aria-controls="cc-maintenance-admin">Manage Maintenance</button></div>'
            . '<div id="cc-maintenance-admin" class="collapse">'
            . '<section class="cc-maintenance-admin" aria-labelledby="cc-maintenance-admin-title">'
            . '<h2 id="cc-maintenance-admin-title" class="m-0">Super admin sign-in</h2>'
            . '<form id="cc-maintenance-login" class="d-flex flex-column">'
            . '<div><label class="form-label" for="cc-maintenance-email">Email</label>'
            . '<input class="form-control" id="cc-maintenance-email" type="email" placeholder="Enter your email" autocomplete="username" required></div>'
            . '<div><label class="form-label" for="cc-maintenance-password">Password</label>'
            . '<input class="form-control" id="cc-maintenance-password" type="password" placeholder="Enter your password" autocomplete="current-password" required></div>'
            . '<button class="btn btn-cc-teal w-100" type="submit">Sign In</button>'
            . '<p class="cc-maintenance-note m-0">Authorized super admins only.</p>'
            . '<p id="cc-maintenance-feedback" class="cc-maintenance-note m-0" role="alert" hidden></p>'
            . '</form></section></div></div></section></div></div>';
        $html = preg_replace_callback('/(<head\b[^>]*>)/i', static fn (array $match): string => $match[1]
            . '<link rel="stylesheet" href="assets/css/maintenance-access.css">', $html, 1);
        $html = preg_replace_callback('/(<body\b[^>]*>)/i', static fn (array $match): string => $match[1] . $modal, $html, 1);
        $html = preg_replace_callback('/(<\/body>)/i', static fn (array $match): string => '<script src="assets/js/maintenance-access.js"></script>' . $match[1], $html, 1);
        header('Content-Type: text/html; charset=utf-8');
        exit($html);
    }
}

if (str_ends_with($target, '.php')) {
    require $target;
} else {
    header('Content-Type: text/html; charset=utf-8');
    $html = file_get_contents($target);
    $window = $state['window'];
    $announcement = $state['announcement'];
    $showBanner = !$state['active'] && $window['status'] === 'Scheduled'
        && $window['start_at'] > $state['server_time'] && !empty($window['notify_users'])
        && in_array($announcement['location'] ?? '', ['Application-wide', 'Banner only'], true)
        && trim((string) ($announcement['message'] ?? '')) !== '';
    if ($showBanner && $html !== false) {
        $banner = '<aside role="status" style="padding:12px 20px;background:#2d2925;color:#fff;text-align:center;font:14px system-ui;position:relative;z-index:10000">'
            . '<strong>' . htmlspecialchars((string) ($announcement['title'] ?? ''), ENT_QUOTES, 'UTF-8') . '</strong> '
            . htmlspecialchars((string) $announcement['message'], ENT_QUOTES, 'UTF-8') . '</aside>';
        $html = preg_replace_callback('/(<body\b[^>]*>)/i', static fn (array $match): string => $match[1] . $banner, $html, 1);
    }
    echo $html;
}

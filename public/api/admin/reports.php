<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

use ClassicClub\Http\JsonResponse;
use ClassicClub\Http\Request;

$request = new Request();

try {
    $ctx = getAdminContext($pdo, false);
    requireAdminPermission($ctx, 'can_view_reports');
    $format = $request->queryString('format');

    $filters = [
        'period' => $request->queryString('period') ?? 'monthly',
        'from' => $request->queryString('from') ?? '',
        'to' => $request->queryString('to') ?? '',
    ];

    $reports = $ctx['service']->getReports($ctx['business_id'], $filters);

    if ($format === 'csv') {
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename=classic_club_sales_report_' . date('Ymd_His') . '.csv');
        $output = fopen('php://output', 'w');
        fputcsv($output, ['Product', 'SKU', 'Unit Price (PHP)', 'Units Sold', 'Revenue (PHP)', 'Revenue Share', 'Turnover Rate']);
        foreach ($reports['detailed_products'] as $prod) {
            fputcsv($output, [
                $prod['name'],
                $prod['sku'],
                $prod['unit_price'],
                $prod['sold'],
                $prod['revenue'],
                $prod['revenue_share'],
                $prod['turnover_rate']
            ]);
        }
        fclose($output);
        exit;
    }

    JsonResponse::success($reports)->send();
} catch (Throwable $e) {
    JsonResponse::error($e->getMessage(), 400)->send();
}

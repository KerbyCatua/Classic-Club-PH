<?php
declare(strict_types=1);

namespace ClassicClub\Support;

use PDO;
use Throwable;

/** Module 21.6 telemetry. Never retain messages, arguments, query strings or payloads. */
final class ErrorTracker
{
    private static bool $started = false;
    private static array $frames = [];
    private static ?array $warning = null;
    private static ?string $requestId = null;

    public static function start(): void
    {
        if (self::$started || PHP_SAPI === 'cli') return;
        self::$started = true;
        self::$requestId = bin2hex(random_bytes(16));
        if (!headers_sent()) header('X-Request-ID: ' . self::$requestId);
        set_error_handler(static function (int $type, string $message, string $file, int $line): bool {
            if ((error_reporting() & $type) && in_array($type, [E_WARNING, E_USER_WARNING, E_NOTICE, E_USER_NOTICE], true)) {
                self::$warning ??= ['file' => $file, 'line' => $line];
            }
            return false; // Preserve native PHP logging and response behavior.
        });
        register_shutdown_function(static function (): void {
            $fatal = error_get_last();
            $isFatal = $fatal && in_array($fatal['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true);
            $status = $isFatal ? 500 : (int) http_response_code();
            if ($status < 400 && !self::$warning) return;
            $frames = self::$frames;
            if ($isFatal) $frames = [['file' => $fatal['file'], 'line' => $fatal['line']]];
            elseif ($status < 400 && self::$warning) $frames = [self::$warning];
            try {
                $config = require __DIR__ . '/../Config/database.php';
                $pdo = new PDO(sprintf('mysql:host=%s;port=%d;dbname=%s;charset=%s', $config['host'], $config['port'], $config['database'], $config['charset']), $config['username'], $config['password'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
                self::record($pdo, $status, $frames, $isFatal ? 'PHP fatal error' : ($status < 400 ? 'PHP runtime warning' : 'HTTP request failure'));
            } catch (Throwable) {
                // Keep the application's existing PHP error log as the fallback.
                error_log('Module 21.6: unable to persist failed request telemetry.');
            }
        });
    }

    public static function responseFailure(): void
    {
        self::$frames = debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS, 15);
    }

    public static function safeSource(string $file, int $line): string
    {
        $root = str_replace('\\', '/', dirname(__DIR__, 2)) . '/';
        $file = str_replace('\\', '/', $file);
        return (str_starts_with(strtolower($file), strtolower($root)) ? substr($file, strlen($root)) : '[external]') . ':' . $line;
    }

    public static function record(PDO $pdo, int $status, array $frames, string $kind = 'HTTP request failure'): int
    {
        // SCRIPT_FILENAME remains the gate when Apache rewrites; resource was validated by the gate.
        $path = (string) (parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?? '');
        $path = preg_match('#/(public/api/[a-z0-9_-]+/[a-z0-9_-]+\.php)$#i', $path, $match) ? $match[1] : basename($path);
        if (!preg_match('#^(?:public/api/[a-z0-9_/-]+\.php|[a-z0-9_-]+\.(?:php|html))$#i', $path)) $path = '[unknown route]';
        $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
        if (!in_array($method, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'], true)) $method = 'OTHER';
        $stack = [];
        foreach ($frames as $frame) {
            if (!empty($frame['file']) && !in_array(basename($frame['file']), ['ErrorTracker.php', 'JsonResponse.php'], true)) $stack[] = self::safeSource($frame['file'], (int) ($frame['line'] ?? 0));
        }
        $stack = array_values(array_unique($stack));
        $source = $stack[0] ?? '[no PHP stack available]';
        $summary = $kind . ' / HTTP ' . $status;
        $module = preg_match('#public/api/([^/]+)/#', $path, $match) ? $match[1] . ' / API' : 'Application';
        $fingerprint = hash('sha256', implode('|', [$kind, $status, $method, $path, $source]));
        $now = (new \DateTimeImmutable('now', new \DateTimeZone('Asia/Manila')))->format('Y-m-d H:i:s');
        $pdo->beginTransaction();
        try {
            $q = $pdo->prepare("INSERT INTO error_groups (fingerprint, summary, module, severity, occurrences, first_seen, last_seen) VALUES (?, ?, ?, ?, 1, ?, ?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id), occurrences=occurrences+1, last_seen=GREATEST(last_seen, VALUES(last_seen)), state='Unresolved', reviewed_at=NULL, version=version+1");
            $q->execute([$fingerprint, $summary, $module, $kind === 'PHP fatal error' ? 'Critical' : ($status >= 500 ? 'High' : ($status < 400 ? 'Medium' : 'Low')), $now, $now]);
            $id = (int) $pdo->lastInsertId();
            $q = $pdo->prepare('INSERT INTO error_events (group_id, request_id, occurred_at, method, endpoint, http_status, duration_ms, source, stack) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
            $q->execute([$id, self::$requestId ?? bin2hex(random_bytes(16)), $now, $method, $path, $status, max(0, round((microtime(true) - ($_SERVER['REQUEST_TIME_FLOAT'] ?? microtime(true))) * 1000, 3)), $source, implode("\n", $stack)]);
            $pdo->commit();
            return $id;
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
    }
}

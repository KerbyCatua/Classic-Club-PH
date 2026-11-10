<?php

declare(strict_types=1);

namespace ClassicClub\Http;

final class JsonResponse extends Response
{
    public function __construct(
        mixed $data,
        int $status = 200
    ) {
        parent::__construct(
            json_encode(
                $data,
                JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR
            ),
            $status
        );

        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
        header('Pragma: no-cache');
    }

    public static function success(mixed $data, int $status = 200): self
    {
        return new self([
            'success' => true,
            'data' => $data,
        ], $status);
    }

    public static function error(
        string $message,
        int $status = 400,
        array $errors = []
    ): self {
        if ($status >= 400 && class_exists(\ClassicClub\Support\ErrorTracker::class, false)) {
            \ClassicClub\Support\ErrorTracker::responseFailure();
        }
        return new self([
            'success' => false,
            'error' => [
                'message' => $message,
                'fields' => $errors,
            ],
        ], $status);
    }
}

<?php

declare(strict_types=1);

namespace ClassicClub\Http;

use ClassicClub\Support\Input;

final class Request
{
    private ?array $jsonBody = null;

    public function method(): string
    {
        return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    }

    public function query(string $key, mixed $default = null): mixed
    {
        return $_GET[$key] ?? $default;
    }

    public function queryString(string $key, string $default = ''): string
    {
        return Input::string($this->query($key), $default);
    }

    public function queryInteger(string $key, int $default = 0): int
    {
        return Input::integer($this->query($key), $default);
    }

    public function json(): array
    {
        if ($this->jsonBody !== null) {
            return $this->jsonBody;
        }

        $rawBody = file_get_contents('php://input');
        if ($rawBody === false || trim($rawBody) === '') {
            return $this->jsonBody = [];
        }

        $decoded = json_decode($rawBody, true);
        return $this->jsonBody = is_array($decoded) ? $decoded : [];
    }
}

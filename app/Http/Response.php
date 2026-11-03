<?php

declare(strict_types=1);

namespace ClassicClub\Http;

class Response
{
    public function __construct(
        private readonly mixed $data,
        private readonly int $status = 200
    ) {
    }

    public function send(): never
    {
        http_response_code($this->status);
        exit((string) $this->data);
    }
}

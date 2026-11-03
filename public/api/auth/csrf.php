<?php

declare(strict_types=1);

use ClassicClub\Auth\SessionManager;
use ClassicClub\Http\JsonResponse;

require_once __DIR__ . '/../../../app/Http/Response.php';
require_once __DIR__ . '/../../../app/Http/JsonResponse.php';
require_once __DIR__ . '/../../../app/Auth/SessionManager.php';

JsonResponse::success(['token' => SessionManager::csrfToken()])->send();

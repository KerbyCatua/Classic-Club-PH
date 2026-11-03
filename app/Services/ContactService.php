<?php

declare(strict_types=1);

namespace ClassicClub\Services;

use ClassicClub\Repositories\InquiryRepository;
use RuntimeException;

final class ContactService
{
    private const MAX_FILE_SIZE = 5242880;

    public function __construct(
        private readonly InquiryRepository $inquiries,
        private readonly string $storageDirectory
    ) {
    }

    public function submit(array $data, ?array $file, ?int $userId): int
    {
        $attachment = $this->prepareAttachment($file);
        $inquiryId = $this->inquiries->create([
            'user_id' => $userId,
            'full_name' => $data['full_name'],
            'email' => $data['email'],
            'topic' => $data['topic'],
            'order_number' => $data['order_number'] !== '' ? $data['order_number'] : null,
            'message' => $data['message'],
        ]);

        if ($attachment !== null) {
            if (!is_dir($this->storageDirectory) && !mkdir($this->storageDirectory, 0700, true) && !is_dir($this->storageDirectory)) {
                throw new RuntimeException('Unable to prepare secure upload storage.');
            }
            $target = $this->storageDirectory . DIRECTORY_SEPARATOR . $attachment['stored_name'];
            if (!move_uploaded_file($attachment['tmp_name'], $target)) {
                throw new RuntimeException('Unable to store the uploaded file.');
            }
            chmod($target, 0600);
            unset($attachment['tmp_name']);
            $attachment['storage_path'] = $target;
            $this->inquiries->addAttachment($inquiryId, $attachment);
        }

        return $inquiryId;
    }

    private function prepareAttachment(?array $file): ?array
    {
        if ($file === null || ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
            return null;
        }
        if (($file['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK || (int) $file['size'] > self::MAX_FILE_SIZE) {
            throw new RuntimeException('The attachment must be a valid file up to 5 MB.');
        }
        $finfo = new \finfo(FILEINFO_MIME_TYPE);
        $mime = $finfo->file($file['tmp_name']);
        $allowed = [
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'application/pdf' => 'pdf',
        ];
        if (!isset($allowed[$mime])) {
            throw new RuntimeException('Only JPG, PNG, and PDF attachments are allowed.');
        }

        return [
            'original_name' => mb_substr(basename((string) $file['name']), 0, 255),
            'stored_name' => bin2hex(random_bytes(24)) . '.' . $allowed[$mime],
            'mime_type' => $mime,
            'file_size' => (int) $file['size'],
            'tmp_name' => $file['tmp_name'],
        ];
    }
}

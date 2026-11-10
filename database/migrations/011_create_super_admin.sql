USE classic_club_ph;

START TRANSACTION;

-- Ensure the super_admin role exists before assigning it.
INSERT INTO roles (name, display_name, description, is_system_role)
SELECT 'super_admin', 'Super Administrator', 'Full system access', 1
WHERE NOT EXISTS (
    SELECT 1 FROM roles WHERE name = 'super_admin'
);

-- Create the Super Admin account.
-- Email:    superadminsuperadmin@gmail.com
-- Password: Pogi123@Classic (bcrypt hash below)
INSERT INTO users
    (email, password_hash, first_name, last_name, mobile, status, email_verified_at, deleted_at)
VALUES
    (
        'superadminsuperadmin@gmail.com',
        '$2y$12$rFcZjmrTUtaUANBdodlu4.mCAOYkGGmKmtl.64KOte2khWYxJfOGm',
        'Super',
        'Admin',
        NULL,
        'active',
        NOW(),
        NULL
    )
ON DUPLICATE KEY UPDATE
    password_hash = VALUES(password_hash),
    first_name = VALUES(first_name),
    last_name = VALUES(last_name),
    status = 'active',
    email_verified_at = COALESCE(email_verified_at, NOW()),
    deleted_at = NULL;

SET @super_admin_user_id = (
    SELECT id
    FROM users
    WHERE email = 'superadminsuperadmin@gmail.com'
    LIMIT 1
);

-- Assign only the super_admin role to the account.
INSERT IGNORE INTO user_roles (user_id, role_id)
SELECT @super_admin_user_id, id
FROM roles
WHERE name = 'super_admin'
LIMIT 1;

COMMIT;

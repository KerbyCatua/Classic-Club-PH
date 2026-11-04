USE classic_club_ph;

START TRANSACTION;

INSERT INTO roles
    (id, name, display_name, description, is_system_role)
VALUES
    (1, 'super_admin', 'Super Administrator', 'Full system access', 1),
    (2, 'admin', 'Administrator', 'Administrative catalog, orders, users, and inquiries', 1),
    (3, 'manager', 'Manager', 'Inventory and order management', 1),
    (4, 'staff', 'Staff', 'Assigned operational access', 1),
    (5, 'customer', 'Customer', 'Customer account access', 1),
    (6, 'guest', 'Guest', 'Public catalog and guest checkout', 1);

INSERT INTO permissions
    (id, name, display_name, description)
VALUES
    (1, 'catalog.view', 'View catalog', 'View products and categories'),
    (2, 'catalog.manage', 'Manage catalog', 'Create and update catalog records'),
    (3, 'inventory.view', 'View inventory', 'View stock levels'),
    (4, 'inventory.manage', 'Manage inventory', 'Adjust stock levels'),
    (5, 'orders.view_own', 'View own orders', 'View personal orders'),
    (6, 'orders.view_all', 'View all orders', 'View all customer orders'),
    (7, 'orders.manage', 'Manage orders', 'Update order statuses'),
    (8, 'users.view', 'View users', 'View user accounts'),
    (9, 'users.manage', 'Manage users', 'Create and update user accounts'),
    (10, 'roles.manage', 'Manage roles', 'Manage roles and assignments'),
    (11, 'permissions.manage', 'Manage permissions', 'Manage permission assignments'),
    (12, 'inquiries.view', 'View inquiries', 'View customer inquiries'),
    (13, 'inquiries.manage', 'Manage inquiries', 'Update customer inquiries'),
    (14, 'newsletter.manage', 'Manage newsletter', 'Manage newsletter subscribers'),
    (15, 'audit.view', 'View audit logs', 'View system audit records');

INSERT INTO role_permissions (role_id, permission_id)
SELECT 1, id FROM permissions;

INSERT INTO role_permissions (role_id, permission_id)
SELECT 2, id
FROM permissions
WHERE name IN (
    'catalog.view',
    'catalog.manage',
    'inventory.view',
    'inventory.manage',
    'orders.view_all',
    'orders.manage',
    'users.view',
    'users.manage',
    'inquiries.view',
    'inquiries.manage',
    'newsletter.manage'
);

INSERT INTO role_permissions (role_id, permission_id)
SELECT 3, id
FROM permissions
WHERE name IN (
    'catalog.view',
    'catalog.manage',
    'inventory.view',
    'inventory.manage',
    'orders.view_all',
    'orders.manage'
);

INSERT INTO role_permissions (role_id, permission_id)
SELECT 4, id
FROM permissions
WHERE name IN (
    'catalog.view',
    'inventory.view',
    'orders.view_all',
    'inquiries.view'
);

INSERT INTO role_permissions (role_id, permission_id)
SELECT 5, id
FROM permissions
WHERE name IN (
    'catalog.view',
    'orders.view_own'
);

INSERT INTO categories
    (id, name, slug, description)
VALUES
    (1, 'Tops & tees', 'tops-tees', 'Tees, shirts, tanks, and knitwear'),
    (2, 'Outerwear & hoodies', 'outerwear-hoodies', 'Jackets, overshirts, and hoodies'),
    (3, 'Bottoms & accessories', 'bottoms-accessories', 'Trousers, shorts, pants, and accessories');

INSERT INTO products
    (id, category_id, name, slug, description)
VALUES
    (1, 1, 'Essential Heavyweight Tee', 'essential-heavyweight-tee',
        'A foundational tee with substance. Cut from 240 GSM cotton jersey with a relaxed body, dropped shoulder and a clean, substantial neckline.'),
    (2, 2, 'Structured Overshirt', 'structured-overshirt',
        'A clean shoulder and an open collar. Cut from structured cotton twill to frame your base layer with purposeful weight.'),
    (3, 3, 'Relaxed Tailored Trouser', 'relaxed-tailored-trouser',
        'Relaxed through the hip and clean through the leg. Tailored for everyday movement and effortless pairing.'),
    (4, 1, 'Textured Knit Polo', 'textured-knit-polo',
        'Tactile open-stitch cotton knit with a soft collar and relaxed drape that transitions seamlessly from day to evening.'),
    (5, 2, 'Loopback Club Hoodie', 'loopback-club-hoodie',
        'Heavyweight 380 GSM loopback cotton fleece with a double-layered hood, relaxed body and structured ribbed cuffs.'),
    (6, 1, 'Everyday Poplin Shirt', 'everyday-poplin-shirt',
        'Crisp cotton poplin cut with generous ease through the chest and shoulders for an unhurried, refined profile.'),
    (7, 3, 'Pleated City Short', 'pleated-city-short',
        'Tailored front pleats and a comfortable mid-thigh length crafted from breathable, structured cotton twill.'),
    (8, 1, 'Long-sleeve Jersey Tee', 'long-sleeve-jersey-tee',
        'Cut from 220 GSM combed cotton jersey with ribbed cuffs and a straight hem for standalone wear or easy layering.'),
    (9, 1, 'Ribbed Layering Tank', 'ribbed-layering-tank',
        'A close-fitting first layer in soft 2x2 cotton rib, designed to sit cleanly underneath open shirts and knitwear.'),
    (10, 2, 'Collarless Studio Jacket', 'collarless-studio-jacket',
        'Architectural collarless neckline with concealed front closure and welt pockets for a minimalist outer layer.'),
    (11, 2, 'Double-zip Club Hoodie', 'double-zip-club-hoodie',
        'Two-way matte metal zipper on 380 GSM loopback cotton allows customizable proportion and effortless layering.'),
    (12, 3, 'Understated Club Cap', 'understated-club-cap',
        'Unstructured six-panel silhouette in brushed cotton twill with a tonal back strap and minimal detailing.'),
    (13, 3, 'Daily Canvas Tote', 'daily-canvas-tote',
        'Heavyweight unbleached cotton canvas with reinforced shoulder straps and an internal slip pocket for daily essentials.'),
    (14, 3, 'Slim Leather Belt', 'slim-leather-belt',
        'Full-grain cowhide leather with an understated brushed metal buckle, cut to a versatile 28mm width.'),
    (15, 3, 'Drawstring Cotton Pant', 'drawstring-cotton-pant',
        'Internal drawstring waist and a straight leg in peached cotton twill for unrestrictive, all-day comfort.');

INSERT INTO product_variants
    (id, product_id, sku, color_name, price, is_new)
VALUES
    (1, 1, 'CC-TEE-001', 'Obsidian', 1890.00, 0),
    (2, 2, 'CC-OVR-002', 'Graphite', 4890.00, 1),
    (3, 3, 'CC-BTM-003', 'Charcoal', 3690.00, 1),
    (4, 4, 'CC-TOP-004', 'Oat', 2890.00, 1),
    (5, 1, 'CC-TEE-005', 'Chalk', 1890.00, 0),
    (6, 5, 'CC-HOD-006', 'Obsidian', 4290.00, 0),
    (7, 6, 'CC-SHRT-007', 'Ivory', 3290.00, 1),
    (8, 7, 'CC-BTM-008', 'Stone', 2490.00, 0),
    (9, 8, 'CC-TEE-009', 'Graphite', 2290.00, 0),
    (10, 9, 'CC-TOP-010', 'Chalk', 1290.00, 0),
    (11, 10, 'CC-JKT-011', 'Obsidian', 5890.00, 1),
    (12, 11, 'CC-HOD-012', 'Ash', 4590.00, 1),
    (13, 12, 'CC-ACC-013', 'Obsidian', 1190.00, 0),
    (14, 13, 'CC-ACC-014', 'Natural', 1490.00, 0),
    (15, 14, 'CC-ACC-015', 'Black', 2290.00, 0),
    (16, 15, 'CC-BTM-016', 'Stone', 3190.00, 1);

INSERT INTO product_images
    (variant_id, image_url, alt_text, image_role, sort_order)
VALUES
    (1, 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513904/01_ESSENTIAL_HEAVYWEIGHT_TEE_nu8k9g.webp', 'Essential Heavyweight Tee in Obsidian', 'primary', 0),
    (2, 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513903/02_STRUCTURED_OVERSHIRT_jxr8nm.webp', 'Structured Overshirt in Graphite', 'primary', 0),
    (3, 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513903/03_RELAXED_TAILORED_TROUSER_oi09yl.webp', 'Relaxed Tailored Trouser in Charcoal', 'primary', 0),
    (4, 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513903/04_TEXTURED_KNIT_POLO_lpd9rr.webp', 'Textured Knit Polo in Oat', 'primary', 0),
    (5, 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513903/05_ESSENTIAL_HEAVYWEIGHT_TEE_g1xl7f.webp', 'Essential Heavyweight Tee in Chalk', 'primary', 0),
    (6, 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513903/06_LOOPBACK_CLUB_HOODIE_pywyby.webp', 'Loopback Club Hoodie in Obsidian', 'primary', 0),
    (7, 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513902/07_EVERYDAY_POPLIN_SHIRT_niuho7.webp', 'Everyday Poplin Shirt in Ivory', 'primary', 0),
    (8, 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513903/08_PLEATED_CITY_SHORT_iuukkm.webp', 'Pleated City Short in Stone', 'primary', 0),
    (9, 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513902/09_LONG-SLEEVE_JERSEY_TEE_rdexnf.webp', 'Long-sleeve Jersey Tee in Graphite', 'primary', 0),
    (10, 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513902/10_RIBBED_LAYERING_TANK_jivwsn.webp', 'Ribbed Layering Tank in Chalk', 'primary', 0),
    (11, 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513906/11_COLLARLESS_STUDIO_JACKET_a5aupw.webp', 'Collarless Studio Jacket in Obsidian', 'primary', 0),
    (12, 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513906/12_DOUBLE-ZIP_CLUB_HOODIE_fqbd9r.webp', 'Double-zip Club Hoodie in Ash', 'primary', 0),
    (13, 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513905/13_UNDERSTATED_CLUB_CAP_fopwz5.webp', 'Understated Club Cap in Obsidian', 'primary', 0),
    (14, 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513905/14_DAILY_CANVAS_TOTE_zqzhqh.webp', 'Daily Canvas Tote in Natural', 'primary', 0),
    (15, 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513904/15_SLIM_LEATHER_BELT_lylsjo.webp', 'Slim Leather Belt in Black', 'primary', 0),
    (16, 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513904/16_DRAWSTRING_COTTON_PANT_x3ulk3.webp', 'Drawstring Cotton Pant in Stone', 'primary', 0);

INSERT INTO sizes
    (id, code, size_type, sort_order)
VALUES
    (1, 'XS', 'alpha', 1),
    (2, 'S', 'alpha', 2),
    (3, 'M', 'alpha', 3),
    (4, 'L', 'alpha', 4),
    (5, 'XL', 'alpha', 5),
    (6, 'XXL', 'alpha', 6),
    (7, '28', 'numeric', 28),
    (8, '30', 'numeric', 30),
    (9, '32', 'numeric', 32),
    (10, '34', 'numeric', 34),
    (11, '36', 'numeric', 36),
    (12, '38', 'numeric', 38),
    (13, 'OS', 'one_size', 1);

INSERT INTO variant_sizes
    (variant_id, size_id, quantity_on_hand)
SELECT v.id, s.id, 9999
FROM product_variants v
CROSS JOIN sizes s
WHERE v.id IN (1, 2, 4, 5, 6, 7, 9, 10, 11, 12)
  AND s.size_type = 'alpha';

INSERT INTO variant_sizes
    (variant_id, size_id, quantity_on_hand)
SELECT v.id, s.id, 9999
FROM product_variants v
CROSS JOIN sizes s
WHERE v.id IN (3, 8, 16)
  AND s.size_type = 'numeric';

INSERT INTO variant_sizes
    (variant_id, size_id, quantity_on_hand)
SELECT v.id, s.id, 9999
FROM product_variants v
CROSS JOIN sizes s
WHERE v.id IN (13, 14, 15)
  AND s.size_type = 'one_size';

INSERT INTO promotions
    (code, discount_type, discount_value, is_active)
VALUES
    ('CLASSIC10', 'percentage', 10.00, 1),
    ('FREESHIP', 'free_shipping', 0.00, 1);

COMMIT;
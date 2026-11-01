/**
 * Classic Club PH - Global State & Catalog Module (store.js)
 * Centralizes Product Catalog, Cart, Promo Codes, Orders, and Wishlist across all 18 pages.
 */
const CCStore = (function () {
  const STORAGE_KEYS = {
    CART: 'cc_cart_data',
    CART_INIT: 'cc_cart_initialized',
    WISHLIST: 'cc_wishlist_data',
    PROMO: 'cc_promo_data',
    LAST_ORDER: 'cc_last_order'
  };

  const SHIPPING_FEE = 180;

  // Master Product Catalog (16 pieces)
  const PRODUCTS = {
    'essential-hw-tee-obsidian': {
      id: 'essential-hw-tee-obsidian',
      sku: 'CC-TEE-001',
      srcImage: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513904/01_ESSENTIAL_HEAVYWEIGHT_TEE_nu8k9g.webp',
      badge: 'CORE / 240 GSM',
      isNew: false,
      name: 'Essential Heavyweight Tee',
      color: 'Obsidian',
      price: 1890,
      category: 'Tops & tees',
      categoryUrl: 'tops-tees.html',
      description: 'A foundational tee with substance. Cut from 240 GSM cotton jersey with a relaxed body, dropped shoulder and a clean, substantial neckline.'
    },
    'structured-overshirt-graphite': {
      id: 'structured-overshirt-graphite',
      sku: 'CC-OVR-002',
      srcImage: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513903/02_STRUCTURED_OVERSHIRT_jxr8nm.webp',
      badge: 'NEW / DROP 03',
      isNew: true,
      name: 'Structured Overshirt',
      color: 'Graphite',
      price: 4890,
      category: 'Outerwear & hoodies',
      categoryUrl: 'outerwear-hoodies.html',
      description: 'A clean shoulder and an open collar. Cut from structured cotton twill to frame your base layer with purposeful weight.'
    },
    'relaxed-trouser-charcoal': {
      id: 'relaxed-trouser-charcoal',
      sku: 'CC-BTM-003',
      srcImage: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513903/03_RELAXED_TAILORED_TROUSER_oi09yl.webp',
      badge: 'NEW / DROP 03',
      isNew: true,
      name: 'Relaxed Tailored Trouser',
      color: 'Charcoal',
      price: 3690,
      category: 'Bottoms & accessories',
      categoryUrl: 'bottoms-accessories.html',
      description: 'Relaxed through the hip and clean through the leg. Tailored for everyday movement and effortless pairing.'
    },
    'textured-knit-polo-oat': {
      id: 'textured-knit-polo-oat',
      sku: 'CC-TOP-004',
      srcImage: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513903/04_TEXTURED_KNIT_POLO_lpd9rr.webp',
      badge: 'NEW / DROP 03',
      isNew: true,
      name: 'Textured Knit Polo',
      color: 'Oat',
      price: 2890,
      category: 'Tops & tees',
      categoryUrl: 'tops-tees.html',
      description: 'Tactile open-stitch cotton knit with a soft collar and relaxed drape that transitions seamlessly from day to evening.'
    },
    'essential-hw-tee-chalk': {
      id: 'essential-hw-tee-chalk',
      sku: 'CC-TEE-005',
      srcImage: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513903/05_ESSENTIAL_HEAVYWEIGHT_TEE_g1xl7f.webp',
      badge: 'CORE / 240 GSM',
      isNew: false,
      name: 'Essential Heavyweight Tee',
      color: 'Chalk',
      price: 1890,
      category: 'Tops & tees',
      categoryUrl: 'tops-tees.html',
      description: 'A foundational tee with substance. Cut from 240 GSM cotton jersey with a relaxed body, dropped shoulder and a clean, substantial neckline.'
    },
    'loopback-hoodie-obsidian': {
      id: 'loopback-hoodie-obsidian',
      sku: 'CC-HOD-006',
      srcImage: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513903/06_LOOPBACK_CLUB_HOODIE_pywyby.webp',
      badge: 'CORE / 380 GSM',
      isNew: false,
      name: 'Loopback Club Hoodie',
      color: 'Obsidian',
      price: 4290,
      category: 'Outerwear & hoodies',
      categoryUrl: 'outerwear-hoodies.html',
      description: 'Heavyweight 380 GSM loopback cotton fleece with a double-layered hood, relaxed body and structured ribbed cuffs.'
    },
    'everyday-poplin-shirt-ivory': {
      id: 'everyday-poplin-shirt-ivory',
      sku: 'CC-SHRT-007',
      srcImage: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513902/07_EVERYDAY_POPLIN_SHIRT_niuho7.webp',
      badge: 'NEW / DROP 03',
      isNew: true,
      name: 'Everyday Poplin Shirt',
      color: 'Ivory',
      price: 3290,
      category: 'Tops & tees',
      categoryUrl: 'tops-tees.html',
      description: 'Crisp cotton poplin cut with generous ease through the chest and shoulders for an unhurried, refined profile.'
    },
    'pleated-city-short-stone': {
      id: 'pleated-city-short-stone',
      sku: 'CC-BTM-008',
      srcImage: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513903/08_PLEATED_CITY_SHORT_iuukkm.webp',
      badge: 'CORE / COTTON TWILL',
      isNew: false,
      name: 'Pleated City Short',
      color: 'Stone',
      price: 2490,
      category: 'Bottoms & accessories',
      categoryUrl: 'bottoms-accessories.html',
      description: ' tailored front pleats and a comfortable mid-thigh length crafted from breathable, structured cotton twill.'
    },
    'ls-jersey-tee-graphite': {
      id: 'ls-jersey-tee-graphite',
      sku: 'CC-TEE-009',
      srcImage: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513902/09_LONG-SLEEVE_JERSEY_TEE_rdexnf.webp',
      badge: 'CORE / 220 GSM',
      isNew: false,
      name: 'Long-sleeve Jersey Tee',
      color: 'Graphite',
      price: 2290,
      category: 'Tops & tees',
      categoryUrl: 'tops-tees.html',
      description: 'Cut from 220 GSM combed cotton jersey with ribbed cuffs and a straight hem for standalone wear or easy layering.'
    },
    'ribbed-tank-chalk': {
      id: 'ribbed-tank-chalk',
      sku: 'CC-TOP-010',
      srcImage: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513902/10_RIBBED_LAYERING_TANK_jivwsn.webp',
      badge: 'CORE / COTTON RIB',
      isNew: false,
      name: 'Ribbed Layering Tank',
      color: 'Chalk',
      price: 1290,
      category: 'Tops & tees',
      categoryUrl: 'tops-tees.html',
      description: 'A close-fitting first layer in soft 2x2 cotton rib, designed to sit cleanly underneath open shirts and knitwear.'
    },
    'collarless-jacket-obsidian': {
      id: 'collarless-jacket-obsidian',
      sku: 'CC-JKT-011',
      srcImage: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513906/11_COLLARLESS_STUDIO_JACKET_a5aupw.webp',
      badge: 'NEW / DROP 03',
      isNew: true,
      name: 'Collarless Studio Jacket',
      color: 'Obsidian',
      price: 5890,
      category: 'Outerwear & hoodies',
      categoryUrl: 'outerwear-hoodies.html',
      description: 'Architectural collarless neckline with concealed front closure and welt pockets for a minimalist outer layer.'
    },
    'double-zip-hoodie-ash': {
      id: 'double-zip-hoodie-ash',
      sku: 'CC-HOD-012',
      srcImage: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513906/12_DOUBLE-ZIP_CLUB_HOODIE_fqbd9r.webp',
      badge: 'NEW / DROP 03',
      isNew: true,
      name: 'Double-zip Club Hoodie',
      color: 'Ash',
      price: 4590,
      category: 'Outerwear & hoodies',
      categoryUrl: 'outerwear-hoodies.html',
      description: 'Two-way matte metal zipper on 380 GSM loopback cotton allows customizable proportion and effortless layering.'
    },
    'understated-cap-obsidian': {
      id: 'understated-cap-obsidian',
      sku: 'CC-ACC-013',
      srcImage: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513905/13_UNDERSTATED_CLUB_CAP_fopwz5.webp',
      badge: 'CORE / ADJUSTABLE',
      isNew: false,
      name: 'Understated Club Cap',
      color: 'Obsidian',
      price: 1190,
      category: 'Bottoms & accessories',
      categoryUrl: 'bottoms-accessories.html',
      description: 'Unstructured six-panel silhouette in brushed cotton twill with a tonal back strap and minimal detailing.'
    },
    'daily-canvas-tote-natural': {
      id: 'daily-canvas-tote-natural',
      sku: 'CC-ACC-014',
      srcImage: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513905/14_DAILY_CANVAS_TOTE_zqzhqh.webp',
      badge: 'CORE / HEAVY CANVAS',
      isNew: false,
      name: 'Daily Canvas Tote',
      color: 'Natural',
      price: 1490,
      category: 'Bottoms & accessories',
      categoryUrl: 'bottoms-accessories.html',
      description: 'Heavyweight unbleached cotton canvas with reinforced shoulder straps and an internal slip pocket for daily essentials.'
    },
    'slim-leather-belt-black': {
      id: 'slim-leather-belt-black',
      sku: 'CC-ACC-015',
      srcImage: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513904/15_SLIM_LEATHER_BELT_lylsjo.webp',
      badge: 'CORE / LEATHER',
      isNew: false,
      name: 'Slim Leather Belt',
      color: 'Black',
      price: 2290,
      category: 'Bottoms & accessories',
      categoryUrl: 'bottoms-accessories.html',
      description: 'Full-grain cowhide leather with a understated brushed metal buckle, cut to a versatile 28mm width.'
    },
    'drawstring-pant-stone': {
      id: 'drawstring-pant-stone',
      sku: 'CC-BTM-016',
      srcImage: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1793513904/16_DRAWSTRING_COTTON_PANT_x3ulk3.webp',
      badge: 'NEW / DROP 03',
      isNew: true,
      name: 'Drawstring Cotton Pant',
      color: 'Stone',
      price: 3190,
      category: 'Bottoms & accessories',
      categoryUrl: 'bottoms-accessories.html',
      description: 'Internal drawstring waist and a straight leg in peached cotton twill for unrestrictive, all-day comfort.'
    }
  };

  // Default Figma Cart Items (seeded once if user has never interacted with cart)
  const DEFAULT_CART = [
    {
      id: 'essential-hw-tee-obsidian',
      name: 'Essential Heavyweight Tee',
      color: 'Obsidian',
      size: 'M',
      price: 1890,
      quantity: 1
    },
    {
      id: 'structured-overshirt-graphite',
      name: 'Structured Overshirt',
      color: 'Graphite',
      size: 'M',
      price: 4890,
      quantity: 1
    }
  ];

  function ensureInitialized() {
    if (!localStorage.getItem(STORAGE_KEYS.CART_INIT)) {
      localStorage.setItem(STORAGE_KEYS.CART, JSON.stringify(DEFAULT_CART));
      localStorage.setItem(STORAGE_KEYS.CART_INIT, 'true');
    }
  }

  function formatPHP(amount) {
    return '₱' + Number(amount || 0).toLocaleString('en-PH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function getCart() {
    ensureInitialized();
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.CART)) || [];
    } catch (e) {
      return [];
    }
  }

  function saveCart(cartData) {
    localStorage.setItem(STORAGE_KEYS.CART_INIT, 'true');
    localStorage.setItem(STORAGE_KEYS.CART, JSON.stringify(cartData));
    window.dispatchEvent(new CustomEvent('cc:cartUpdated', { detail: cartData }));
  }

  function getWishlist() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.WISHLIST)) || [];
    } catch (e) {
      return [];
    }
  }

  function saveWishlist(wishlistData) {
    localStorage.setItem(STORAGE_KEYS.WISHLIST, JSON.stringify(wishlistData));
    window.dispatchEvent(new CustomEvent('cc:wishlistUpdated', { detail: wishlistData }));
  }

  function getPromo() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.PROMO)) || { code: '', discount: 0 };
    } catch (e) {
      return { code: '', discount: 0 };
    }
  }

  function savePromo(promoObj) {
    localStorage.setItem(STORAGE_KEYS.PROMO, JSON.stringify(promoObj));
    window.dispatchEvent(new CustomEvent('cc:cartUpdated', { detail: getCart() }));
  }

  return {
    formatPHP,

    // Product Catalog Methods
    getProducts: function () {
      return PRODUCTS;
    },
    getProductById: function (id) {
      if (PRODUCTS[id]) return PRODUCTS[id];
      if (id === 'essential-hw-tee') return PRODUCTS['essential-hw-tee-obsidian'];
      return PRODUCTS['essential-hw-tee-obsidian'];
    },
    getProductImage: function (productId) {
      const product = this.getProductById(productId);
      return product ? product.srcImage || '' : '';
    },

    // Cart Methods
    getCart,
    addToCart: function (item) {
      const cart = getCart();
      const color = item.color || 'Obsidian';
      const size = item.size || 'M';
      const existing = cart.find(
        c => c.id === item.id && c.color === color && c.size === size
      );

      if (existing) {
        existing.quantity += Number(item.quantity || 1);
      } else {
        cart.push({
          id: item.id,
          name: item.name,
          color: color,
          size: size,
          price: Number(item.price),
          quantity: Number(item.quantity || 1)
        });
      }
      saveCart(cart);
    },

    updateCartQty: function (id, color, size, newQty) {
      let cart = getCart();
      const target = cart.find(c => c.id === id && c.color === color && c.size === size);
      if (!target) return;

      if (newQty <= 0) {
        cart = cart.filter(c => !(c.id === id && c.color === color && c.size === size));
      } else {
        target.quantity = newQty;
      }
      saveCart(cart);
    },

    removeFromCart: function (id, color, size) {
      const cart = getCart().filter(
        c => !(c.id === id && c.color === color && c.size === size)
      );
      saveCart(cart);
    },

    moveToWishlist: function (id, color, size) {
      const wishlist = getWishlist();
      if (!wishlist.includes(id)) {
        wishlist.push(id);
        saveWishlist(wishlist);
      }
      this.removeFromCart(id, color, size);
    },

    clearCart: function () {
      saveCart([]);
      savePromo({ code: '', discount: 0 });
    },

    getCartTotalItems: function () {
      return getCart().reduce((sum, item) => sum + Number(item.quantity || 1), 0);
    },

    getCartTotals: function () {
      const cart = getCart();
      const totalItems = cart.reduce((sum, item) => sum + Number(item.quantity || 1), 0);
      const subtotal = cart.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity || 1), 0);
      const shipping = totalItems > 0 ? SHIPPING_FEE : 0;
      const promo = getPromo();
      let discount = 0;

      if (totalItems > 0 && promo && promo.code) {
        if (promo.code === 'CLASSIC10') {
          discount = Math.round(subtotal * 0.10);
        } else if (promo.code === 'FREESHIP') {
          discount = shipping;
        }
      }

      const total = Math.max(0, subtotal + shipping - discount);
      return {
        totalItems,
        subtotal,
        shipping,
        discount,
        promoCode: promo.code || '',
        total
      };
    },

    applyPromoCode: function (rawCode) {
      const code = (rawCode || '').trim().toUpperCase();
      if (!code) {
        savePromo({ code: '', discount: 0 });
        return { valid: false, message: 'No promotion applied to this order.' };
      }
      if (code === 'CLASSIC10') {
        savePromo({ code: 'CLASSIC10', discount: 10 });
        return { valid: true, message: 'Code CLASSIC10 applied (10% off subtotal).' };
      }
      if (code === 'FREESHIP') {
        savePromo({ code: 'FREESHIP', discount: SHIPPING_FEE });
        return { valid: true, message: 'Code FREESHIP applied (₱180.00 shipping discount).' };
      }
      savePromo({ code: '', discount: 0 });
      return { valid: false, message: `Code "${code}" is not valid. Try CLASSIC10.` };
    },

    // Checkout & Order Confirmation Methods
    placeOrder: function (customerData) {
      const cart = getCart();
      const totals = this.getCartTotals();
      const orderData = {
        orderNumber: 'CC-261030-0184',
        placedOn: '30 October 2026',
        status: 'Preparing for dispatch',
        items: cart.length > 0 ? cart : DEFAULT_CART,
        totals: cart.length > 0 ? totals : {
          totalItems: 2,
          subtotal: 6780,
          shipping: 180,
          discount: 0,
          total: 6960
        },
        customer: Object.assign({
          email: 'alex.reyes@example.com',
          firstName: 'Alex',
          lastName: 'Reyes',
          mobile: '+63 917 000 0184',
          country: 'Philippines',
          street: '18 Sample Street',
          apartment: 'Unit 4B · Example Residences',
          barangay: 'Poblacion',
          city: 'Makati City',
          province: 'Metro Manila',
          postalCode: '1210',
          paymentMethod: 'Illustrative card ending 4242.'
        }, customerData || {})
      };

      localStorage.setItem(STORAGE_KEYS.LAST_ORDER, JSON.stringify(orderData));
      this.clearCart();
      return orderData;
    },

    getLastOrder: function () {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEYS.LAST_ORDER));
        if (saved && saved.items && saved.items.length > 0) return saved;
      } catch (e) {}

      // Fallback to Figma illustrative order
      return {
        orderNumber: 'CC-261030-0184',
        placedOn: '30 October 2026',
        status: 'Preparing for dispatch',
        items: DEFAULT_CART,
        totals: {
          totalItems: 2,
          subtotal: 6780,
          shipping: 180,
          discount: 0,
          total: 6960
        },
        customer: {
          email: 'alex.reyes@example.com',
          firstName: 'Alex',
          lastName: 'Reyes',
          mobile: '+63 917 000 0184',
          country: 'Philippines',
          street: '18 Sample Street',
          apartment: 'Unit 4B · Example Residences',
          barangay: 'Poblacion',
          city: 'Makati City',
          province: 'Metro Manila',
          postalCode: '1210',
          paymentMethod: 'Illustrative card ending 4242.'
        }
      };
    },

    // Wishlist Methods
    getWishlist,
    toggleWishlist: function (productId) {
      const wishlist = getWishlist();
      const index = wishlist.indexOf(productId);
      if (index > -1) {
        wishlist.splice(index, 1);
      } else {
        wishlist.push(productId);
      }
      saveWishlist(wishlist);
      return index === -1;
    },
    isInWishlist: function (productId) {
      return getWishlist().includes(productId);
    }
  };
})();
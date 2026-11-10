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
    ORDERS: 'cc_order_history',
    LAST_ORDER: 'cc_last_order',
  };

  const SHIPPING_FEE = 180;
  let liveCatalogItems = [];
  let catalogPromise = null;
  let catalogLoaded = false;

  // Product records are loaded from the database catalog API.
  const PRODUCTS = Object.create(null);
  function ensureInitialized() {
    if (!localStorage.getItem(STORAGE_KEYS.CART_INIT)) {
      localStorage.setItem(STORAGE_KEYS.CART, JSON.stringify([]));
      localStorage.setItem(STORAGE_KEYS.CART_INIT, 'true');
    }
  }

  function formatPHP(amount) {
    return '₱' + Number(amount || 0).toLocaleString('en-PH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  // Exact filename mappings distinguish colour variants and legacy product names.
  const HIGH_RES_IMAGES = {
    "essential-hw-tee-obsidian":  "assets/img/CC-Products JPG HIGH QUALITY/01 ESSENTIAL HEAVYWEIGHT TEE.jpg",
    "structured-overshirt-graphite":  "assets/img/CC-Products JPG HIGH QUALITY/02 STRUCTURED OVERSHIRT.jpg",
    "relaxed-trouser-charcoal":  "assets/img/CC-Products JPG HIGH QUALITY/03 RELAXED TAILORED TROUSER.jpg",
    "textured-knit-polo-oat":  "assets/img/CC-Products JPG HIGH QUALITY/04 TEXTURED KNIT POLO.jpg",
    "essential-hw-tee-chalk":  "assets/img/CC-Products JPG HIGH QUALITY/05 ESSENTIAL HEAVYWEIGHT TEE.jpg",
    "loopback-hoodie-obsidian":  "assets/img/CC-Products JPG HIGH QUALITY/06 LOOPBACK CLUB HOODIE.jpg",
    "everyday-poplin-shirt-ivory":  "assets/img/CC-Products JPG HIGH QUALITY/07 EVERYDAY POPLIN SHIRT.jpg",
    "pleated-city-short-stone":  "assets/img/CC-Products JPG HIGH QUALITY/08 PLEATED CITY SHORT.jpg",
    "ls-jersey-tee-graphite":  "assets/img/CC-Products JPG HIGH QUALITY/09 LONG-SLEEVE JERSEY TEE.jpg",
    "ribbed-tank-chalk":  "assets/img/CC-Products JPG HIGH QUALITY/10 RIBBED LAYERING TANK.jpg",
    "collarless-jacket-obsidian":  "assets/img/CC-Products JPG HIGH QUALITY/11 COLLARLESS STUDIO JACKET.jpg",
    "double-zip-hoodie-ash":  "assets/img/CC-Products JPG HIGH QUALITY/12 DOUBLE-ZIP CLUB HOODIE.jpg",
    "understated-cap-obsidian":  "assets/img/CC-Products JPG HIGH QUALITY/13 UNDERSTATED CLUB CAP.jpg",
    "daily-canvas-tote-natural":  "assets/img/CC-Products JPG HIGH QUALITY/14 DAILY CANVAS TOTE.jpg",
    "slim-leather-belt-black":  "assets/img/CC-Products JPG HIGH QUALITY/15 SLIM LEATHER BELT.jpg",
    "drawstring-pant-stone":  "assets/img/CC-Products JPG HIGH QUALITY/16 DRAWSTRING COTTON PANT.jpg",
    "CC-TEE-001":  "assets/img/CC-Products JPG HIGH QUALITY/01 ESSENTIAL HEAVYWEIGHT TEE.jpg",
    "CC-OSH-002":  "assets/img/CC-Products JPG HIGH QUALITY/02 STRUCTURED OVERSHIRT.jpg",
    "CC-TRS-004":  "assets/img/CC-Products JPG HIGH QUALITY/03 RELAXED TAILORED TROUSER.jpg",
    "CC-TOP-004":  "assets/img/CC-Products JPG HIGH QUALITY/04 TEXTURED KNIT POLO.jpg",
    "CC-TEE-005":  "assets/img/CC-Products JPG HIGH QUALITY/05 ESSENTIAL HEAVYWEIGHT TEE.jpg",
    "CC-HOD-003":  "assets/img/CC-Products JPG HIGH QUALITY/06 LOOPBACK CLUB HOODIE.jpg",
    "CC-SHRT-007":  "assets/img/CC-Products JPG HIGH QUALITY/07 EVERYDAY POPLIN SHIRT.jpg",
    "CC-BTM-008":  "assets/img/CC-Products JPG HIGH QUALITY/08 PLEATED CITY SHORT.jpg",
    "CC-TEE-009":  "assets/img/CC-Products JPG HIGH QUALITY/09 LONG-SLEEVE JERSEY TEE.jpg",
    "CC-TOP-010":  "assets/img/CC-Products JPG HIGH QUALITY/10 RIBBED LAYERING TANK.jpg",
    "CC-JKT-011":  "assets/img/CC-Products JPG HIGH QUALITY/11 COLLARLESS STUDIO JACKET.jpg",
    "CC-HOD-012":  "assets/img/CC-Products JPG HIGH QUALITY/12 DOUBLE-ZIP CLUB HOODIE.jpg",
    "CC-CAP-005":  "assets/img/CC-Products JPG HIGH QUALITY/13 UNDERSTATED CLUB CAP.jpg",
    "CC-TOT-006":  "assets/img/CC-Products JPG HIGH QUALITY/14 DAILY CANVAS TOTE.jpg",
    "CC-ACC-015":  "assets/img/CC-Products JPG HIGH QUALITY/15 SLIM LEATHER BELT.jpg",
    "CC-BTM-016":  "assets/img/CC-Products JPG HIGH QUALITY/16 DRAWSTRING COTTON PANT.jpg"
};

  function catalogItemToProduct(item) {
    const key = item.catalog_key || `catalog-${item.id}-${item.variant_id}`;
    return {
      id: key,
      sku: item.sku || '',
      srcImage: HIGH_RES_IMAGES[key] || HIGH_RES_IMAGES[item.sku] || item.image_url || '',
      productGroup: String(item.id),
      badge: Number(item.is_new) === 1 ? 'NEW / LIVE CATALOG' : 'LIVE CATALOG',
      isNew: Number(item.is_new) === 1,
      name: item.name || '',
      color: item.color_name || 'Standard',
      price: Number(item.price || 0),
      category: item.category_name || 'Collection',
      categorySlug: item.category_slug || '',
      categoryUrl: `${item.category_slug || 'shop-all'}.html`,
      description: item.description || '',
            liveCatalogKey: key,
            stockQty: Number(item.stock_qty || 0),
            productStockQty: Number(item.product_stock_qty ?? item.stock_qty ?? 0),
            sizeStock: item.size_stock || ''
          };
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

  function getOrderHistory() {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.ORDERS) || localStorage.getItem('cc_orders');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (e) {
      console.error('Error reading order history:', e);
    }
    return [];
  }

  function saveOrderHistory(orders) {
    if (!Array.isArray(orders)) return;
    localStorage.setItem(STORAGE_KEYS.ORDERS, JSON.stringify(orders));
    localStorage.setItem('cc_orders', JSON.stringify(orders));
    if (orders.length > 0) {
      localStorage.setItem(STORAGE_KEYS.LAST_ORDER, JSON.stringify(orders[orders.length - 1]));
    }
    window.dispatchEvent(new CustomEvent('cc:ordersUpdated', { detail: orders }));
  }

  function appendOrder(order) {
    if (!order) return getOrderHistory();
    const orders = getOrderHistory();
    const existingIndex = orders.findIndex(o => (o.orderNumber && order.orderNumber && o.orderNumber === order.orderNumber) || (o.id && order.id && o.id === order.id));
    if (existingIndex > -1) {
      orders[existingIndex] = order;
    } else {
      orders.push(order);
    }
    saveOrderHistory(orders);
    return orders;
  }

  async function apiRequest(url, options = {}) {
    if ((options.method || 'GET').toUpperCase() !== 'GET') {
      const csrf = await fetch('public/api/auth/csrf.php', {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      }).then(response => response.json());
      options.headers = {
        ...(options.headers || {}),
        'X-CSRF-Token': csrf.data.token
      };
    }
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(options.headers || {})
      },
      ...options
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.error?.message || 'Request failed.');
    }

    return result.data;
  }

  return {
    formatPHP,

    // Product Catalog Methods
    getProducts: function () {
      return PRODUCTS;
    },
    getProductById: function (id) {
      if (PRODUCTS[id]) return PRODUCTS[id];
      const liveItem = liveCatalogItems.find(item =>
        String(item.catalog_key || '') === String(id)
      );
      return liveItem ? catalogItemToProduct(liveItem) : null;
    },
    getProductImage: function (productId) {
      const product = this.getProductById(productId);
      return product ? product.srcImage || '' : '';
    },
        // Cart items persisted before images were stored can be backfilled from
        // the live catalog once it is available.
        resolveCartImage: function (item) {
          if (!item) return '';
          if (item.image) return item.image;
          const product = this.getProductById(item.id);
          if (product && product.srcImage) {
            item.image = product.srcImage;
            return product.srcImage;
          }
          return '';
        },
        hydrateCartImages: function () {
          const cart = getCart();
          let changed = false;
          cart.forEach(item => {
            if (!item.image) {
              const image = this.getProductImage(item.id);
              if (image) {
                item.image = image;
                changed = true;
              }
            }
          });
          if (changed) saveCart(cart);
          return cart;
        },
    syncCatalogFromApi: function () {
      if (catalogLoaded) return Promise.resolve(liveCatalogItems);
      if (catalogPromise) return catalogPromise;
      catalogPromise = (async () => {
        try {
          const res = await fetch('public/api/catalog/products.php?per_page=50', {
            cache: 'no-store',
            headers: { 'Accept': 'application/json' }
          });
          const json = await res.json();
          if (json.success && json.data && Array.isArray(json.data.items)) {
            liveCatalogItems = json.data.items;
            Object.keys(PRODUCTS).forEach(key => delete PRODUCTS[key]);
            liveCatalogItems.forEach(p => {
              const key = p.catalog_key || `catalog-${p.id}-${p.variant_id}`;
              PRODUCTS[key] = catalogItemToProduct(p);
            });
            catalogLoaded = true;
            return liveCatalogItems;
          }
        } catch (e) {
          console.warn('Could not sync live catalog:', e);
        }
        catalogPromise = null;
        return null;
      })();
      return catalogPromise;
    },
    isCatalogLoaded: function () {
      return catalogLoaded;
    },
    whenCatalogReady: function () {
      return catalogLoaded ? Promise.resolve(liveCatalogItems) : this.syncCatalogFromApi();
    },
    isProductAvailable: function (productId) {
      if (!liveCatalogItems.length) return true;
      const product = PRODUCTS[productId];
      const catalogKey = product?.liveCatalogKey || productId;
      return liveCatalogItems.some(item =>
        String(item.catalog_key || '') === String(catalogKey) ||
        item.sku === product?.sku ||
        (item.name && product && item.name.toLowerCase() === product.name.toLowerCase())
      );
    },
    getLiveCatalogItems: function () {
      return liveCatalogItems.slice();
    },
        getProductStock: function (productId) {
          // Product-wide total: matches the admin inventory row.
          const product = this.getProductById(productId);
          return product ? Number(product.productStockQty || 0) : 0;
        },
        getVariantStock: function (productId) {
          // Units available for the specific colour variant on the product page.
          const product = this.getProductById(productId);
          return product ? Number(product.stockQty || 0) : 0;
        },
        getSizeStock: function (productId, size) {
          const product = this.getProductById(productId);
          if (!product || !product.sizeStock) return null;
          const pair = String(product.sizeStock).split(',')
            .map(entry => entry.split(':'))
            .find(([code]) => code === String(size));
          return pair ? Number(pair[1] || 0) : null;
        },
        getSizes: function (productId) {
          const product = this.getProductById(productId);
          if (!product || !product.sizeStock) return [];
          return String(product.sizeStock).split(',')
            .filter(entry => entry.includes(':'))
            .map(entry => {
              const [code, qty] = entry.split(':');
              return { code, stock: Number(qty || 0) };
            });
        },

    // Cart Methods
    getCart,
    getPromo,
    addToCart: async function (item) {
      try {
        const session = await fetch('public/api/auth/me.php', {
          credentials: 'same-origin',
          headers: { Accept: 'application/json' }
        });
        if (!session.ok) {
          window.location.href = 'auth.html?notice=login';
          return false;
        }
      } catch (error) {
        window.location.href = 'auth.html?notice=login';
        return false;
      }

      const cart = getCart();
      const color = item.color || 'Obsidian';
      const size = item.size || 'M';
      const existing = cart.find(
        c => c.id === item.id && c.color === color && c.size === size
      );

      const image = item.image || this.getProductImage(item.id) || '';

            const sizeStock = this.getSizeStock(item.id, size);
            const productStock = this.getProductStock(item.id);
            const availableStock = sizeStock === null ? productStock : sizeStock;
            const requestedQty = Number(item.quantity || 1);
            const currentQty = existing ? Number(existing.quantity) : 0;

            if (typeof availableStock === 'number' && currentQty + requestedQty > availableStock) {
              window.alert(
                availableStock > 0
                  ? `Only ${availableStock} unit(s) of this item are in stock.`
                  : 'This item is out of stock.'
              );
              return false;
            }

                  if (existing) {
                    existing.quantity += requestedQty;
                    if (image) existing.image = image;
                  } else {
                    cart.push({
                      id: item.id,
                      name: item.name,
                      color: color,
                      size: size,
                      price: Number(item.price),
                      quantity: requestedQty,
                      image: image
                    });
                  }
      saveCart(cart);
      return apiRequest('public/api/cart/add.php', {
        method: 'POST',
        body: JSON.stringify({
          catalog_key: item.id,
          size,
          quantity: Number(item.quantity || 1)
        })
      }).then(data => {
        saveCart(data.items || []);
        return true;
            }).catch(async error => {
        console.error('Server cart add failed:', error);
              window.alert(error.message || 'Unable to add this item to your bag.');
              await this.refreshCartFromServer();
              return false;
            });

          },

          refreshCartFromServer: async function () {
            try {
              const cartData = await apiRequest('public/api/cart/view.php');
              saveCart(cartData.items || []);
            } catch (error) {
              console.error('Server cart sync failed:', error);
            }
          },

    updateCartQty: function (id, color, size, newQty) {
      let cart = getCart();
      const target = cart.find(c => c.id === id && c.color === color && c.size === size);
      if (!target) return;

          if (Number(newQty) > 0) {
            const sizeStock = this.getSizeStock(id, size);
            const productStock = this.getProductStock(id);
            const availableStock = sizeStock === null ? productStock : sizeStock;
            if (typeof availableStock === 'number' && Number(newQty) > availableStock) {
              window.alert(
                availableStock > 0
                  ? `Only ${availableStock} unit(s) of this item are in stock.`
                  : 'This item is out of stock.'
              );
              return;
            }
          }

          if (newQty <= 0) {
        cart = cart.filter(c => !(c.id === id && c.color === color && c.size === size));
      } else {
        target.quantity = newQty;
      }
      saveCart(cart);
      apiRequest('public/api/cart/update.php', {
        method: 'POST',
        body: JSON.stringify({
          catalog_key: id,
          size,
          quantity: Number(newQty)
        })
      }).then(data => {
        saveCart(data.items || []);
      }).catch(error => {
        console.error('Server cart update failed:', error);
              window.alert(error.message || 'Unable to update your bag.');
              this.refreshCartFromServer();
            });
          },

    removeFromCart: function (id, color, size) {
      const cart = getCart().filter(
        c => !(c.id === id && c.color === color && c.size === size)
      );
      saveCart(cart);
      apiRequest('public/api/cart/remove.php', {
        method: 'POST',
        body: JSON.stringify({
          catalog_key: id,
          size
        })
      }).then(data => {
        saveCart(data.items || []);
      }).catch(error => {
        console.error('Server cart remove failed:', error);
      });
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
      apiRequest('public/api/wishlist/toggle.php', {
        method: 'POST',
        body: JSON.stringify({ catalog_key: productId })
      }).then(data => {
        const remoteIds = (data.items || []).map(item => item.id);
        saveWishlist(remoteIds);
      }).catch(error => {
        console.error('Server wishlist update failed:', error);
      });
      return index === -1;
    },
    isInWishlist: function (productId) {
      return getWishlist().includes(productId);
    },

    syncServerState: async function () {
      try {
        const cartData = await apiRequest('public/api/cart/view.php');
        saveCart(cartData.items || []);
      } catch (error) {
        console.error('Server cart sync failed:', error);
      }

      try {
        const wishlistData = await apiRequest('public/api/wishlist/view.php');
        saveWishlist((wishlistData.items || []).map(item => item.id));
      } catch (error) {
        if (!String(error.message).toLowerCase().includes('authentication')) {
          console.error('Server wishlist sync failed:', error);
        }
      }
    },

    // Order History Methods
    getOrderHistory,
    saveOrderHistory,
    appendOrder,
    getOrders: getOrderHistory,
    getLastOrder: function () {
      const orders = getOrderHistory();
      return orders.length > 0 ? orders[orders.length - 1] : null;
    },
    clearOrderHistory: function () {
      localStorage.removeItem(STORAGE_KEYS.ORDERS);
      localStorage.removeItem('cc_orders');
      localStorage.removeItem(STORAGE_KEYS.LAST_ORDER);
      window.dispatchEvent(new CustomEvent('cc:ordersUpdated', { detail: [] }));
    },
    clearAllUserData: function () {
      this.clearCart();
      this.clearOrderHistory();
      saveWishlist([]);
      localStorage.removeItem(STORAGE_KEYS.CART);
      localStorage.removeItem(STORAGE_KEYS.CART_INIT);
      localStorage.removeItem(STORAGE_KEYS.WISHLIST);
      localStorage.removeItem(STORAGE_KEYS.PROMO);
      localStorage.removeItem(STORAGE_KEYS.ORDERS);
      localStorage.removeItem('cc_orders');
      localStorage.removeItem(STORAGE_KEYS.LAST_ORDER);
      localStorage.removeItem('cc_user_profile');
    },
    placeOrder: function (customerData) {
      const cart = getCart();
      const totals = this.getCartTotals();
      const orderNumber = 'CC-' + Math.floor(100000 + Math.random() * 900000);
      const orderData = {
        orderNumber: orderNumber,
        placedOn: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
        status: 'Confirmed',
        items: cart.length > 0 ? [...cart] : [],
        totals: {
          totalItems: totals.totalItems,
          subtotal: totals.subtotal,
          shipping: totals.shipping,
          discount: totals.discount,
          total: totals.total
        },
        customer: Object.assign({
          email: '',
          firstName: '',
          lastName: '',
          mobile: '',
          country: 'Philippines',
          street: '',
          apartment: '',
          barangay: '',
          city: '',
          province: '',
          postalCode: '',
          paymentMethod: 'Illustrative card ending 4242.'
        }, customerData || {})
      };
      appendOrder(orderData);
      this.clearCart();
      return orderData;
    }
  };
})();

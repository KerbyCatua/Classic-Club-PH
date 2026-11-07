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

  function catalogItemToProduct(item) {
    const key = item.catalog_key || `catalog-${item.id}-${item.variant_id}`;
    return {
      id: key,
      sku: item.sku || '',
      srcImage: item.image_url || '',
      badge: Number(item.is_new) === 1 ? 'NEW / LIVE CATALOG' : 'LIVE CATALOG',
      isNew: Number(item.is_new) === 1,
      name: item.name || '',
      color: item.color_name || 'Standard',
      price: Number(item.price || 0),
      category: item.category_name || 'Collection',
      categorySlug: item.category_slug || '',
      categoryUrl: `${item.category_slug || 'shop-all'}.html`,
      description: item.description || '',
      liveCatalogKey: key
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

            if (existing) {
              existing.quantity += Number(item.quantity || 1);
              if (image) existing.image = image;
            } else {
              cart.push({
                id: item.id,
                name: item.name,
                color: color,
                size: size,
                price: Number(item.price),
                quantity: Number(item.quantity || 1),
                image: image
              });
            }
      saveCart(cart);
      apiRequest('public/api/cart/add.php', {
        method: 'POST',
        body: JSON.stringify({
          catalog_key: item.id,
          size,
          quantity: Number(item.quantity || 1)
        })
      }).then(data => {
        saveCart(data.items || []);
      }).catch(error => {
        console.error('Server cart add failed:', error);
      });

      return true;
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

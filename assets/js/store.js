/**
 * Classic Club PH - Global State Management
 * Handles Cart, Wishlist, and User Preferences using localStorage.
 */
const CCStore = (function() {
  const STORAGE_KEYS = {
    CART: 'cc_cart_data',
    WISHLIST: 'cc_wishlist_data'
  };

  // --- Core Getters ---
  function getCart() {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.CART)) || [];
  }

  function getWishlist() {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.WISHLIST)) || [];
  }

  // --- Core Setters (with Event Dispatching) ---
  function saveCart(cartData) {
    localStorage.setItem(STORAGE_KEYS.CART, JSON.stringify(cartData));
    window.dispatchEvent(new CustomEvent('cc:cartUpdated', { detail: cartData }));
  }

  function saveWishlist(wishlistData) {
    localStorage.setItem(STORAGE_KEYS.WISHLIST, JSON.stringify(wishlistData));
    window.dispatchEvent(new CustomEvent('cc:wishlistUpdated', { detail: wishlistData }));
  }

  return {
    // Cart Methods
    getCart,
    addToCart: function(product) {
      const cart = getCart();
      const existingItem = cart.find(item => item.id === product.id && item.size === product.size);
      
      if (existingItem) {
        existingItem.quantity += (product.quantity || 1);
      } else {
        cart.push({ ...product, quantity: product.quantity || 1 });
      }
      saveCart(cart);
    },
    removeFromCart: function(productId, size) {
      const cart = getCart().filter(item => !(item.id === productId && item.size === size));
      saveCart(cart);
    },
    clearCart: function() {
      saveCart([]);
    },
    getCartTotalItems: function() {
      return getCart().reduce((total, item) => total + item.quantity, 0);
    },

    // Wishlist Methods
    getWishlist,
    toggleWishlist: function(productId) {
      let wishlist = getWishlist();
      const index = wishlist.indexOf(productId);
      
      if (index > -1) {
        wishlist.splice(index, 1); // Remove if exists
      } else {
        wishlist.push(productId); // Add if doesn't exist
      }
      
      saveWishlist(wishlist);
      return index === -1; // Returns true if it was added, false if removed
    },
    isInWishlist: function(productId) {
      return getWishlist().includes(productId);
    }
  };
})();
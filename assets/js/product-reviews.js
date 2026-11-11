/* Shared review data and presentation for product and review pages. */
window.CCProductReviews = (() => {
  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'}[c]));
  }
  function stars(rating) {
    return [1,2,3,4,5].map(i => i <= Math.round(rating) ? '<span>&#9733;</span>' : '<span class="review-empty-star">&#9734;</span>').join('');
  }
  async function load({variant = '', variantId = '', orderNumber = ''}) {
    const params = new URLSearchParams({variant, variant_id: String(variantId), order_number: orderNumber});
    const res = await fetch('public/api/reviews/eligibility.php?' + params, {
      cache: 'no-store', credentials: 'same-origin', headers: {'Accept': 'application/json'}
    });
    const json = await res.json();
    if (!res.ok || !json.success) throw new Error('Reviews are temporarily unavailable. Please try again later.');
    return json.data;
  }
  function normalize(reviews, variant) {
    return reviews.filter(r => Number(r.variant_id) === Number(variant?.variant_id)).map(r => ({
      id: 'db-' + r.id, name: r.display_name, verified: Number(r.is_verified_purchase) === 1,
      date: new Date(r.created_at).toLocaleDateString('en-GB', {day:'numeric', month:'long', year:'numeric'}),
      size: r.size_purchased || '', color: variant.color_name || '', fit: r.fit_feedback || '',
      rating: Number(r.rating), title: r.title, content: r.content
    }));
  }
  function summary(reviews, root = document) {
    const total = reviews.length;
    const avg = total ? reviews.reduce((sum, r) => sum + r.rating, 0) / total : 0;
    root.querySelector('[data-review-average]').textContent = total ? avg.toFixed(1) : '\u2014';
    root.querySelector('[data-review-stars]').innerHTML = stars(avg);
    root.querySelector('[data-review-count]').textContent = total ? 'Based on ' + total + ' customer review' + (total === 1 ? '' : 's') : 'No reviews yet';
    root.querySelector('[data-review-breakdown]').innerHTML = [5,4,3,2,1].map(rating => {
      const count = reviews.filter(r => r.rating === rating).length;
      const pct = total ? count / total * 100 : 0;
      return `<div class="d-flex align-items-center gap-3"><span class="text-light-cc font-sans" style="font-size:12px;min-width:50px;">${rating} stars</span><div class="rating-bar-bg flex-grow-1" role="img" aria-label="${rating} stars: ${count} reviews"><div class="rating-bar-fill" style="width:${pct}%;"></div></div><span class="text-muted-cc font-sans text-end" style="font-size:12px;min-width:16px;">${count}</span></div>`;
    }).join('');
  }
  function renderList(container, reviews, emptyMessage = 'No reviews yet. Be the first to share your experience after your purchase.') {
    container.innerHTML = reviews.length ? reviews.map(r => {
      const starsHtml = stars(r.rating);
      return `
            <div class="review-item-row py-4 d-flex flex-column flex-md-row gap-4 gap-md-5">
              <div class="review-author flex-shrink-0 d-flex flex-column gap-2" >
                <span class="text-light-cc font-sans fw-medium" style="font-size: 14px;">${escapeHtml(r.name)}</span>
                <span class="text-accent font-sans" style="font-size: 10px; letter-spacing: 0.6px;">${r.verified ? '&#10003; VERIFIED PURCHASE &middot; DELIVERED' : 'CUSTOMER REVIEW'}</span>
                <span class="text-muted-cc font-sans" style="font-size: 11px;">${escapeHtml(r.date)}</span>
                <span class="text-muted-cc font-sans" style="font-size: 12px; line-height: 1.6;">Size ${escapeHtml(r.size)} · ${escapeHtml(r.color)}</span>
                <span class="text-muted-cc font-sans" style="font-size: 12px;">Fit — ${escapeHtml(r.fit)}</span>
              </div>
              <div class="flex-grow-1 d-flex flex-column gap-3">
                <div class="d-flex align-items-center gap-2">
                  <div class="d-flex gap-1 text-light-cc" style="font-size: 13px;">${starsHtml}</div>
                  <span class="text-muted-cc font-sans" style="font-size: 11px;">${r.rating}.0 / 5</span>
                </div>
                <h4 class="font-lora text-light-cc m-0" style="font-size: 24px; line-height: 1.3;">${escapeHtml(r.title)}</h4>
                <p class="text-muted-cc font-sans m-0" style="font-size: 14px; line-height: 1.75; max-width: 880px;">
                  ${escapeHtml(r.content)}
                </p>
              </div>
            </div>`;
    }).join('') : '<p class="cc-small-text text-muted-cc py-4 m-0">' + escapeHtml(emptyMessage) + '</p>';
  }
  function reviewUrl(product, variant = null) {
    const key = variant?.catalog_key || product.id;
    const params = new URLSearchParams({id: product.id, variant: key});
    if (variant?.variant_id) params.set('variant_id', variant.variant_id);
    if (variant?.product_id) params.set('product_id', variant.product_id);
    return 'review-product.html?' + params + '#customer-reviews';
  }
  async function preview(product) {
    const root = document.getElementById('product-review-preview');
    const link = root.querySelector('[data-review-link]');
    link.href = reviewUrl(product);
    try {
      const data = await load({variant: product.id});
      const reviews = normalize(data.reviews || [], data.variant);
      summary(reviews, root);
      const fits = new Map();
      reviews.forEach(r => { if (r.fit) fits.set(r.fit, (fits.get(r.fit) || 0) + 1); });
      root.querySelector('[data-review-fit]').textContent = [...fits].map(([fit, count]) => count + ' of ' + reviews.length + ': ' + fit).join('. ') || 'Fit feedback will appear with customer reviews.';
      renderList(root.querySelector('[data-review-list]'), reviews.slice(0, 3));
      link.href = reviewUrl(product, data.variant);
    } catch (err) {
      root.querySelector('[data-review-list]').textContent = err.message;
      root.querySelector('[data-review-count]').textContent = 'Reviews unavailable';
    }
  }
  return {load, normalize, summary, renderList, reviewUrl, preview};
})();

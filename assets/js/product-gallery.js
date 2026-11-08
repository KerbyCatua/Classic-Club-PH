/**
 * Classic Club PH - Product Gallery Assets (product-gallery.js)
 * Each catalog product owns exactly four preview assets:
 * front view, back view, on-body fit and fabric detail.
 */
const CCProductGallery = (function () {
  const SETS = {
    'CC-01': {
      front: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125200/Essential_Heavyweight_Tee_Obsidian_front_u5cnmg.webp',
      back: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125199/Essential_Heavyweight_Tee_Obsidian_back_o8nnja.webp',
      onBody: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125202/On-body_fit_relaxed_shoulder_and_straight_hem_q4mers.webp',
      fabric: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125201/Fabric_macro_240_GSM_jersey_and_rib_neckline_gd9wdb.webp'
    },
    'CC-02': {
      front: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125198/Structured_Overshirt_Graphite_front_uepsaw.webp',
      back: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125197/Structured_Overshirt_Graphite_back_gyuuxk.webp',
      onBody: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125196/On-body_fit_relaxed_shoulder_and_straight_hem_geqwye.webp',
      fabric: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125196/Fabric_macro_240_GSM_jersey_and_rib_neckline_n3iwh8.webp'
    },
    'CC-03': {
      front: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125194/Relaxed_Pleated_Trouser_Charcoal_front_pxqlsa.webp',
      back: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125194/Relaxed_Pleated_Trouser_Charcoal_back_ndlvoc.webp',
      onBody: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125193/On-body_fit_relaxed_shoulder_and_straight_hem_x00emf.webp',
      fabric: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125192/Fabric_macro_240_GSM_jersey_and_rib_neckline_agidwj.webp'
    },
    'CC-04': {
      front: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125191/Textured_Knit_Polo_Oat_front_cpe25d.webp',
      back: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125190/Textured_Knit_Polo_Oat_back_e33jp6.webp',
      onBody: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125188/On-body_fit_relaxed_shoulder_and_straight_hem_mj0n9g.webp',
      fabric: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125188/Fabric_macro_240_GSM_jersey_and_rib_neckline_on599s.webp'
    },
    'CC-05': {
      front: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125185/Essential_Heavyweight_Tee_Chalk_front_dgwpyz.webp',
      back: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125184/Essential_Heavyweight_Tee_Chalk_back_eoeqht.webp',
      onBody: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125187/On-body_fit_relaxed_shoulder_and_straight_hem_zqzr3b.webp',
      fabric: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125186/Fabric_macro_240_GSM_jersey_and_rib_neckline_bnnpqd.webp'
    },
    'CC-06': {
      front: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125181/Everyday_Loopback_Hoodie_Obsidian_front_co0qrq.webp',
      back: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125180/Everyday_Loopback_Hoodie_Obsidian_back_netre9.webp',
      onBody: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125183/On-body_fit_relaxed_shoulder_and_straight_hem_qqbubo.webp',
      fabric: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125182/Fabric_macro_240_GSM_jersey_and_rib_neckline_p5xg6n.webp'
    },
    'CC-07': {
      front: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125178/Everyday_Poplin_Shirt_Ivory_front_vxh3nf.webp',
      back: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125177/Everyday_Poplin_Shirt_Ivory_back_il7a6h.webp',
      onBody: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125179/On-body_fit_relaxed_shoulder_and_straight_hem_y6nb4c.webp',
      fabric: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125178/Fabric_macro_240_GSM_jersey_and_rib_neckline_pnjll1.webp'
    },
    'CC-08': {
      front: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125176/Pleated_City_Short_Stone_front_qywx4i.webp',
      back: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125175/Pleated_City_Short_Stone_back_jsfcyt.webp',
      onBody: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125174/On-body_fit_relaxed_shoulder_and_straight_hem_optg1d.webp',
      fabric: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125174/Fabric_macro_240_GSM_jersey_and_rib_neckline_srmsvq.webp'
    },
    'CC-09': {
      front: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125171/Long-sleeve_Jersey_Tee_Graphite_front_tbxguw.webp',
      back: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125170/Long-sleeve_Jersey_Tee_Graphite_back_xjdxvx.webp',
      onBody: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125172/On-body_fit_relaxed_shoulder_and_straight_hem_d98ggl.webp',
      fabric: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125170/Fabric_macro_240_GSM_jersey_and_rib_neckline_dhxeng.webp'
    },
    'CC-10': {
      front: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125169/Ribbed_Layering_Tank_Chalk_front_htqdfk.webp',
      back: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125169/Ribbed_Layering_Tank_Chalk_back_osnxfj.webp',
      onBody: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125169/On-body_fit_relaxed_shoulder_and_straight_hem_j8pwb9.webp',
      fabric: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125169/Fabric_macro_240_GSM_jersey_and_rib_neckline_jzc0ai.webp'
    },
    'CC-11': {
      front: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125226/Collarless_Studio_Jacket_Obsidian_front_ux0wlb.webp',
      back: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125225/Collarless_Studio_Jacket_Obsidian_back_pr7c3c.webp',
      onBody: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125227/On-body_fit_relaxed_shoulder_and_straight_hem_nxnpqh.webp',
      fabric: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125227/Fabric_macro_240_GSM_jersey_and_rib_neckline_tr1crs.webp'
    },
    'CC-12': {
      front: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125222/Double-zip_Club_Hoodie_Ash_front_wcoipa.webp',
      back: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125221/Double-zip_Club_Hoodie_Ash_back_vuc1lb.webp',
      onBody: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125223/On-body_fit_relaxed_shoulder_and_straight_hem_zys5vj.webp',
      fabric: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125223/Fabric_macro_240_GSM_jersey_and_rib_neckline_a9zfys.webp'
    },
    'CC-13': {
      front: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125219/Understated_Club_Cap_Obsidian_front_uqltjn.webp',
      back: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125218/Understated_Club_Cap_Obsidian_back_gtzifx.webp',
      onBody: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125217/On-body_fit_relaxed_shoulder_and_straight_hem_uivg7b.webp',
      fabric: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125216/Fabric_macro_240_GSM_jersey_and_rib_neckline_nxu4m3.webp'
    },
    'CC-14': {
      front: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125204/Everyday_Canvas_Tote_Natural_front_p4afvr.webp',
      back: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125204/Everyday_Canvas_Tote_Natural_back_r345qy.webp',
      onBody: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125206/On-body_fit_relaxed_shoulder_and_straight_hem_kspay0.webp',
      fabric: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125205/Fabric_macro_240_GSM_jersey_and_rib_neckline_jynzg9.webp'
    },
    'CC-15': {
      front: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125215/Slim_Leather_Belt_Black_front_xkwxzk.webp',
      back: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125214/Slim_Leather_Belt_Black_back_e1nvfq.webp',
      onBody: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125212/On-body_fit_relaxed_shoulder_and_straight_hem_s5mjjb.webp',
      fabric: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125212/Fabric_macro_240_GSM_jersey_and_rib_neckline_hymh58.webp'
    },
    'CC-16': {
      front: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125208/Drawstring_Cotton_Pant_Stone_front_ksmebz.webp',
      back: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125207/Drawstring_Cotton_Pant_Stone_back_kbzty5.webp',
      onBody: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125210/On-body_fit_relaxed_shoulder_and_straight_hem_aqdyxp.webp',
      fabric: 'https://res.cloudinary.com/doeikmdvh/image/upload/v1794125210/Fabric_macro_240_GSM_jersey_and_rib_neckline_u7gsn9.webp'
    }
  };

  // Catalog keys exposed by the products API, mapped to their asset set.
  const CATALOG_KEY_TO_SET = {
    'essential-hw-tee-obsidian': 'CC-01',
    'structured-overshirt-graphite': 'CC-02',
    'relaxed-trouser-charcoal': 'CC-03',
    'textured-knit-polo-oat': 'CC-04',
    'essential-hw-tee-chalk': 'CC-05',
    'loopback-hoodie-obsidian': 'CC-06',
    'everyday-poplin-shirt-ivory': 'CC-07',
    'pleated-city-short-stone': 'CC-08',
    'ls-jersey-tee-graphite': 'CC-09',
    'ribbed-tank-chalk': 'CC-10',
    'collarless-jacket-obsidian': 'CC-11',
    'double-zip-hoodie-ash': 'CC-12',
    'understated-cap-obsidian': 'CC-13',
    'daily-canvas-tote-natural': 'CC-14',
    'slim-leather-belt-black': 'CC-15',
    'drawstring-pant-stone': 'CC-16'
  };

  // SKU remains the stable identifier if a catalog key is renamed.
  const SKU_TO_SET = {
    'CC-TEE-001': 'CC-01',
    'CC-OSH-002': 'CC-02',
    'CC-TRS-004': 'CC-03',
    'CC-TOP-004': 'CC-04',
    'CC-TEE-005': 'CC-05',
    'CC-HOD-003': 'CC-06',
    'CC-SHRT-007': 'CC-07',
    'CC-BTM-008': 'CC-08',
    'CC-TEE-009': 'CC-09',
    'CC-TOP-010': 'CC-10',
    'CC-JKT-011': 'CC-11',
    'CC-HOD-012': 'CC-12',
    'CC-CAP-005': 'CC-13',
    'CC-TOT-006': 'CC-14',
    'CC-ACC-015': 'CC-15',
    'CC-BTM-016': 'CC-16'
  };

  function resolveSetKey(product) {
    if (!product) return null;
    const catalogKey = product.liveCatalogKey || product.id;
    if (catalogKey && CATALOG_KEY_TO_SET[catalogKey]) {
      return CATALOG_KEY_TO_SET[catalogKey];
    }
    if (product.sku && SKU_TO_SET[product.sku]) {
      return SKU_TO_SET[product.sku];
    }
    return null;
  }

  function render(product) {
      const images = this.getImages(product);
      const slots = document.querySelectorAll('[data-gallery-image]');
      const bySlot = {};
      images.forEach(entry => { bySlot[entry.slot] = entry.url; });

      slots.forEach(img => {
        const slot = img.getAttribute('data-gallery-image');
        const url = bySlot[slot] || '';
        const box = img.closest('.cc-asset-box');

        if (url) {
          img.src = url;
          img.alt = product ? `${product.name} / ${product.color || ''} / ${slot.replace('-', ' ')}` : '';
          if (box) box.classList.add('cc-has-asset');
        } else {
          // Never leave another product's image behind.
          img.removeAttribute('src');
          img.alt = '';
          if (box) box.classList.remove('cc-has-asset');
        }
      });

      return images.length;
    }

    return {
      // Returns [{ slot, url }] in front, back, on-body, fabric order.
      getImages: function (product) {
        const setKey = resolveSetKey(product);
        const set = setKey ? SETS[setKey] : null;
        if (!set) return [];
        return [
          { slot: 'front', url: set.front },
          { slot: 'back', url: set.back },
          { slot: 'on-body', url: set.onBody },
          { slot: 'fabric', url: set.fabric }
        ];
      },
      // Renders the four previews for this product; clears stale images otherwise.
      render: render,
      hasImages: function (product) {
        return resolveSetKey(product) !== null;
      }
    };
  })();
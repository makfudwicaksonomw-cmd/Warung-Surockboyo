/* ============================================================
   CUSTOMER APP LOGIC
   ============================================================ */

(function(){

  // --- Deteksi jika Firebase config belum diisi ---
  if(firebaseConfig.apiKey.startsWith("GANTI_")){
    document.getElementById('setup-warning').style.display = 'block';
  }

  // Bersihkan pesanan "Selesai" berusia >24 jam setiap kali halaman ini dibuka
  runOrderCleanup();

  const urlParams = new URLSearchParams(window.location.search);
  const tableFromQr = urlParams.get('table') || '';

  let settings = { ...DEFAULT_SETTINGS };
  let menuItems = [];
  let categories = [];
  let activeCategory = 'Semua';
  let cart = JSON.parse(localStorage.getItem('cart_items') || '[]');
  let bannerIndex = 0;
  let bannerTimer = null;
  let currentDetailItem = null;
  let currentDetailVariants = {}; // groupName -> selected option
  let currentQty = 1;

  const el = (id) => document.getElementById(id);

  function saveCart(){
    localStorage.setItem('cart_items', JSON.stringify(cart));
    renderCartFab();
  }

  // ---------------- SETTINGS (tema, nama, logo) ----------------
  db.collection('settings').doc('general').onSnapshot(doc => {
    if(doc.exists){
      settings = { ...DEFAULT_SETTINGS, ...doc.data() };
    }
    applyTheme(settings);
    el('restaurant-name').textContent = settings.restaurantName;
    el('restaurant-name-2').textContent = settings.restaurantName;
    el('restaurant-tagline').textContent = settings.tagline;
    if(settings.logoBase64){
      el('logo-img').src = settings.logoBase64;
      el('logo-img').style.display = 'block';
      el('logo-img-2').src = settings.logoBase64;
      el('logo-img-2').style.display = 'block';
    }
    document.title = settings.restaurantName + " — Pesan Online";
  }, err => console.error("settings error", err));

  // ---------------- BANNERS ----------------
  db.collection('banners').orderBy('order').onSnapshot(snap => {
    const banners = [];
    snap.forEach(d => banners.push(d.data()));
    renderBanners(banners);
  }, err => console.error("banners error", err));

  function renderBanners(banners){
    const slider = el('banner-slider');
    const slidesEl = el('banner-slides');
    const dotsEl = el('banner-dots');
    clearInterval(bannerTimer);
    if(!banners.length){ slider.style.display = 'none'; return; }
    slider.style.display = 'block';
    slidesEl.innerHTML = banners.map((b,i) =>
      `<div class="banner-slide ${i===0?'active':''}"><img src="${b.imageBase64}" alt="Promo"></div>`
    ).join('');
    dotsEl.innerHTML = banners.map((_,i) => `<span class="${i===0?'active':''}"></span>`).join('');
    bannerIndex = 0;
    if(banners.length > 1){
      bannerTimer = setInterval(() => {
        const slides = slidesEl.querySelectorAll('.banner-slide');
        const dots = dotsEl.querySelectorAll('span');
        slides[bannerIndex].classList.remove('active');
        dots[bannerIndex].classList.remove('active');
        bannerIndex = (bannerIndex + 1) % banners.length;
        slides[bannerIndex].classList.add('active');
        dots[bannerIndex].classList.add('active');
      }, 4000);
    }
  }

  // ---------------- MENU ----------------
  db.collection('menu').onSnapshot(snap => {
    menuItems = [];
    snap.forEach(d => menuItems.push({ id: d.id, ...d.data() }));
    categories = ['Semua', ...new Set(menuItems.map(m => m.category).filter(Boolean))];
    renderCategoryTabs();
    renderMenu();
  }, err => console.error("menu error", err));

  function renderCategoryTabs(){
    el('category-tabs').innerHTML = categories.map(cat =>
      `<button class="category-tab ${cat === activeCategory ? 'active':''}" data-cat="${escapeHtml(cat)}">${escapeHtml(cat)}</button>`
    ).join('');
    el('category-tabs').querySelectorAll('.category-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        activeCategory = btn.dataset.cat;
        renderCategoryTabs();
        renderMenu();
      });
    });
  }

  function renderMenu(){
    const grouped = {};
    menuItems.forEach(item => {
      const cat = item.category || 'Lainnya';
      if(activeCategory !== 'Semua' && cat !== activeCategory) return;
      if(!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(item);
    });

    const section = el('menu-section');
    if(Object.keys(grouped).length === 0){
      section.innerHTML = `<div class="empty-cart"><div class="icon">🍽️</div>Menu belum tersedia.</div>`;
      return;
    }

    section.innerHTML = Object.keys(grouped).map(cat => `
      <h3>${escapeHtml(cat)}</h3>
      ${grouped[cat].map(item => `
        <div class="menu-card ${item.status === 'habis' ? 'is-unavailable':''}" data-id="${item.id}">
          <img class="thumb" src="${item.imageBase64 || ''}" alt="${escapeHtml(item.name)}">
          <div class="info">
            <p class="name">${escapeHtml(item.name)}</p>
            <p class="desc">${escapeHtml(item.description || '')}</p>
            <div class="price-row">
              <span class="price">${formatRupiah(item.price)}</span>
              ${item.status === 'habis'
                ? `<span class="badge-out">Habis</span>`
                : `<button class="add-btn" data-quick-id="${item.id}">+</button>`
              }
            </div>
          </div>
        </div>
      `).join('')}
    `).join('');

    // Klik card -> buka detail
    section.querySelectorAll('.menu-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if(e.target.closest('.add-btn')) return;
        const item = menuItems.find(m => m.id === card.dataset.id);
        if(item && item.status !== 'habis') openDetail(item);
      });
    });
    // Klik tombol + langsung buka detail juga (agar bisa pilih varian/catatan)
    section.querySelectorAll('.add-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = menuItems.find(m => m.id === btn.dataset.quickId);
        if(item) openDetail(item);
      });
    });
  }

  // ---------------- DETAIL SHEET ----------------
  function openDetail(item){
    currentDetailItem = item;
    currentDetailVariants = {};
    currentQty = 1;
    el('detail-photo').src = item.imageBase64 || '';
    el('detail-name').textContent = item.name;
    el('detail-price').textContent = formatRupiah(item.price);
    el('detail-desc').textContent = item.description || '';
    el('qty-val').textContent = '1';
    el('note-input').value = '';

    const variantGroups = item.variantGroups || [];
    el('detail-variants').innerHTML = variantGroups.map(group => `
      <div class="field-label">${escapeHtml(group.name)}</div>
      <div class="variant-options" data-group="${escapeHtml(group.name)}">
        ${group.options.map((opt,i) => `<button type="button" class="variant-chip ${i===0?'active':''}" data-opt="${escapeHtml(opt)}">${escapeHtml(opt)}</button>`).join('')}
      </div>
    `).join('');
    variantGroups.forEach(group => {
      currentDetailVariants[group.name] = group.options[0];
    });
    el('detail-variants').querySelectorAll('.variant-options').forEach(groupEl => {
      groupEl.querySelectorAll('.variant-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          groupEl.querySelectorAll('.variant-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          currentDetailVariants[groupEl.dataset.group] = chip.dataset.opt;
        });
      });
    });

    openSheet('sheet-detail');
  }

  el('qty-minus').addEventListener('click', () => {
    currentQty = Math.max(1, currentQty - 1);
    el('qty-val').textContent = currentQty;
  });
  el('qty-plus').addEventListener('click', () => {
    currentQty += 1;
    el('qty-val').textContent = currentQty;
  });

  el('add-to-cart-btn').addEventListener('click', () => {
    cart.push({
      cartId: Date.now() + '-' + Math.random().toString(36).slice(2,7),
      menuId: currentDetailItem.id,
      name: currentDetailItem.name,
      price: currentDetailItem.price,
      qty: currentQty,
      variants: { ...currentDetailVariants },
      note: el('note-input').value.trim()
    });
    saveCart();
    closeSheet('sheet-detail');
    showToast('Ditambahkan ke keranjang');
  });

  // ---------------- CART ----------------
  function cartSubtotal(item){ return item.price * item.qty; }
  function cartGrandTotal(){ return cart.reduce((sum,i) => sum + cartSubtotal(i), 0); }

  function renderCartFab(){
    const fab = el('cart-fab');
    if(cart.length === 0){ fab.classList.add('hidden'); return; }
    fab.classList.remove('hidden');
    el('cart-count').textContent = cart.reduce((s,i) => s + i.qty, 0);
    el('cart-total').textContent = formatRupiah(cartGrandTotal());
  }

  function renderCartSheet(){
    const listEl = el('cart-list');
    if(cart.length === 0){
      listEl.innerHTML = `<div class="empty-cart"><div class="icon">🛒</div>Keranjang masih kosong.</div>`;
      el('cart-totals-box').style.display = 'none';
      el('checkout-btn').style.display = 'none';
      return;
    }
    listEl.innerHTML = cart.map(item => {
      const variantStr = Object.values(item.variants || {}).join(', ');
      return `
      <div class="cart-item" data-cart-id="${item.cartId}">
        <div class="ci-info">
          <div class="ci-name">${escapeHtml(item.name)}</div>
          ${variantStr ? `<div class="ci-variant">${escapeHtml(variantStr)}</div>` : ''}
          ${item.note ? `<div class="ci-note">"${escapeHtml(item.note)}"</div>` : ''}
          <div class="ci-row">
            <div class="qty-stepper">
              <button type="button" class="cart-qty-minus">−</button>
              <span class="qty-val">${item.qty}</span>
              <button type="button" class="cart-qty-plus">+</button>
            </div>
            <span style="font-family:var(--font-mono);font-weight:600;">${formatRupiah(cartSubtotal(item))}</span>
          </div>
          <button class="ci-remove" type="button">Hapus</button>
        </div>
      </div>`;
    }).join('');

    listEl.querySelectorAll('.cart-item').forEach(row => {
      const cartId = row.dataset.cartId;
      row.querySelector('.cart-qty-plus').addEventListener('click', () => {
        const item = cart.find(i => i.cartId === cartId);
        item.qty += 1; saveCart(); renderCartSheet();
      });
      row.querySelector('.cart-qty-minus').addEventListener('click', () => {
        const item = cart.find(i => i.cartId === cartId);
        item.qty = Math.max(1, item.qty - 1); saveCart(); renderCartSheet();
      });
      row.querySelector('.ci-remove').addEventListener('click', () => {
        cart = cart.filter(i => i.cartId !== cartId);
        saveCart(); renderCartSheet();
      });
    });

    el('cart-totals-box').style.display = 'block';
    el('checkout-btn').style.display = 'block';
    el('cart-grand-total').textContent = formatRupiah(cartGrandTotal());
  }

  el('cart-fab').addEventListener('click', () => { renderCartSheet(); openSheet('sheet-cart'); });
  el('checkout-btn').addEventListener('click', () => {
    closeSheet('sheet-cart');
    el('checkout-table').value = tableFromQr;
    openSheet('sheet-checkout');
  });

  // ---------------- CHECKOUT ----------------
  el('submit-order-btn').addEventListener('click', async () => {
    const name = el('checkout-name').value.trim();
    if(!name){ showToast('Nama wajib diisi'); return; }
    if(cart.length === 0){ showToast('Keranjang kosong'); return; }

    const btn = el('submit-order-btn');
    btn.disabled = true;
    btn.textContent = 'Mengirim pesanan...';

    const orderData = {
      customerName: name,
      tableNumber: el('checkout-table').value.trim(),
      whatsapp: el('checkout-wa').value.trim(),
      orderNumber: generateOrderNumber(),
      items: cart.map(i => ({
        menuId: i.menuId, name: i.name, price: i.price, qty: i.qty,
        variants: i.variants, note: i.note, subtotal: cartSubtotal(i)
      })),
      total: cartGrandTotal(),
      status: 'menunggu',
      estimasi: '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    try{
      const docRef = await db.collection('orders').add(orderData);
      localStorage.setItem('currentOrderId', docRef.id);
      cart = [];
      saveCart();
      closeSheet('sheet-checkout');
      watchOrder(docRef.id);
    }catch(err){
      console.error(err);
      showToast('Gagal mengirim pesanan. Cek koneksi Firebase.');
    }finally{
      btn.disabled = false;
      btn.textContent = 'Pesan Sekarang';
    }
  });

  // ---------------- ORDER STATUS (realtime) ----------------
  function watchOrder(orderId){
    el('view-menu').style.display = 'none';
    el('view-order-status').style.display = 'block';

    db.collection('orders').doc(orderId).onSnapshot(doc => {
      if(!doc.exists) return;
      const order = doc.data();
      renderOrderStatus(order);
    }, err => console.error("order watch error", err));
  }

  function renderOrderStatus(order){
    el('order-no').textContent = '#' + order.orderNumber;
    const currentIdx = ORDER_STATUS_STEPS.findIndex(s => s.key === order.status);
    el('status-track').innerHTML = ORDER_STATUS_STEPS.map((step, i) => `
      <div class="step ${i < currentIdx ? 'done' : ''} ${i === currentIdx ? 'current' : ''}">
        <div class="dot">${i <= currentIdx ? (i===currentIdx ? step.icon : '✓') : ''}</div>
        <div class="label">${step.label}</div>
      </div>
    `).join('');

    el('ticket-stamp').textContent = order.status === 'selesai' ? '✅' : '🧾';

    if(order.estimasi){
      el('eta-box').style.display = 'block';
      el('eta-value').textContent = order.estimasi + ' menit';
    } else {
      el('eta-box').style.display = 'none';
    }

    el('order-summary-items').innerHTML = order.items.map(i => {
      const variantStr = Object.values(i.variants || {}).join(', ');
      return `<div style="margin-bottom:6px;">
        <b>${i.qty}x ${escapeHtml(i.name)}</b> — ${formatRupiah(i.subtotal)}
        ${variantStr ? `<div style="font-size:11.5px;color:var(--color-muted);">${escapeHtml(variantStr)}</div>` : ''}
      </div>`;
    }).join('');
    el('order-summary-total').textContent = formatRupiah(order.total);
  }

  el('btn-new-order').addEventListener('click', () => {
    localStorage.removeItem('currentOrderId');
    el('view-order-status').style.display = 'none';
    el('view-menu').style.display = 'block';
  });

  // Jika ada pesanan aktif tersimpan, langsung tampilkan status-nya
  const savedOrderId = localStorage.getItem('currentOrderId');
  if(savedOrderId){ watchOrder(savedOrderId); }

  // ---------------- SHEET HELPERS ----------------
  function openSheet(id){ el(id).classList.add('open'); document.body.style.overflow = 'hidden'; }
  function closeSheet(id){ el(id).classList.remove('open'); document.body.style.overflow = ''; }

  el('close-detail').addEventListener('click', () => closeSheet('sheet-detail'));
  el('close-cart').addEventListener('click', () => closeSheet('sheet-cart'));
  el('close-checkout').addEventListener('click', () => closeSheet('sheet-checkout'));
  document.querySelectorAll('.sheet-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => { if(e.target === overlay) overlay.classList.remove('open'); });
  });

  renderCartFab();
})();

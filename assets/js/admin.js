/* ============================================================
   ADMIN APP LOGIC
   ============================================================ */

(function(){

  if(firebaseConfig.apiKey.startsWith("GANTI_")){
    document.getElementById('setup-warning').style.display = 'block';
  }

  const el = (id) => document.getElementById(id);
  let settings = { ...DEFAULT_SETTINGS };
  let menuItems = [];
  let banners = [];
  let orders = [];
  let dailySales = [];
  let editingMenuId = null;
  let editingBannerId = null;
  let variantGroupsDraft = [];
  let menuImageData = "";
  let bannerImageData = "";
  let logoImageData = "";
  let orderStatusFilter = "semua";

  // Bersihkan pesanan "Selesai" berusia >24 jam saat dashboard dibuka, lalu ulangi tiap 20 menit
  runOrderCleanup();
  setInterval(runOrderCleanup, 20 * 60 * 1000);

  // ---------------- LOGIN ----------------
  function checkLoginState(){
    if(sessionStorage.getItem('adminLoggedIn') === 'true'){
      el('view-login').style.display = 'none';
      el('view-admin').style.display = 'block';
    } else {
      el('view-login').style.display = 'flex';
      el('view-admin').style.display = 'none';
    }
  }

  el('login-btn').addEventListener('click', attemptLogin);
  el('login-password').addEventListener('keydown', (e) => { if(e.key === 'Enter') attemptLogin(); });

  function attemptLogin(){
    const pass = el('login-password').value;
    const correctPass = settings.adminPassword || DEFAULT_SETTINGS.adminPassword;
    if(pass === correctPass){
      sessionStorage.setItem('adminLoggedIn', 'true');
      el('login-error').style.display = 'none';
      checkLoginState();
    } else {
      el('login-error').style.display = 'block';
    }
  }

  document.querySelectorAll('#admin-nav button').forEach(btn => {
    btn.addEventListener('click', () => {
      if(btn.dataset.tab === 'logout'){
        sessionStorage.removeItem('adminLoggedIn');
        checkLoginState();
        return;
      }
      document.querySelectorAll('#admin-nav button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
      el('tab-' + btn.dataset.tab).style.display = 'block';
    });
  });

  // ---------------- SETTINGS ----------------
  db.collection('settings').doc('general').onSnapshot(doc => {
    if(doc.exists) settings = { ...DEFAULT_SETTINGS, ...doc.data() };
    applyTheme(settings);
    checkLoginState();
    populateDisplayForm();
  });

  function populateDisplayForm(){
    el('set-restaurant-name').value = settings.restaurantName;
    el('set-tagline').value = settings.tagline;
    el('set-primary-color').value = settings.primaryColor;
    el('set-primary-color-hex').textContent = settings.primaryColor;
    el('set-header-color').value = settings.headerColor;
    el('set-header-color-hex').textContent = settings.headerColor;
    el('set-footer-color').value = settings.footerColor;
    el('set-footer-color-hex').textContent = settings.footerColor;
    el('set-bg-color').value = settings.bgColor;
    el('set-bg-color-hex').textContent = settings.bgColor;
    el('set-deployed-url').value = settings.deployedUrl || '';
    if(settings.logoBase64){
      el('logo-preview').src = settings.logoBase64;
      el('logo-preview').style.display = 'block';
      logoImageData = settings.logoBase64;
    }
  }

  ['primary','header','footer','bg'].forEach(key => {
    el(`set-${key}-color`).addEventListener('input', (e) => {
      el(`set-${key}-color-hex`).textContent = e.target.value;
    });
  });

  el('logo-drop').addEventListener('click', () => el('logo-file').click());
  el('logo-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if(!file) return;
    logoImageData = await compressImageFile(file, 300, 0.8);
    el('logo-preview').src = logoImageData;
    el('logo-preview').style.display = 'block';
  });
  el('logo-url').addEventListener('change', async (e) => {
    const url = e.target.value.trim();
    if(!url) return;
    try{
      logoImageData = await compressImageFromUrl(url, 300, 0.8);
      el('logo-preview').src = logoImageData;
      el('logo-preview').style.display = 'block';
    }catch(err){ showToast(err.message); }
  });

  el('save-display-btn').addEventListener('click', async () => {
    const btn = el('save-display-btn');
    btn.disabled = true; btn.textContent = 'Menyimpan...';
    const newSettings = {
      restaurantName: el('set-restaurant-name').value.trim() || DEFAULT_SETTINGS.restaurantName,
      tagline: el('set-tagline').value.trim(),
      logoBase64: logoImageData,
      primaryColor: el('set-primary-color').value,
      headerColor: el('set-header-color').value,
      footerColor: el('set-footer-color').value,
      bgColor: el('set-bg-color').value,
      deployedUrl: settings.deployedUrl || '',
      adminPassword: settings.adminPassword || DEFAULT_SETTINGS.adminPassword
    };
    if(el('set-password').value.trim()){
      newSettings.adminPassword = el('set-password').value.trim();
    }
    try{
      await db.collection('settings').doc('general').set(newSettings, { merge: true });
      showToast('Tampilan berhasil disimpan');
      el('set-password').value = '';
    }catch(err){
      console.error(err); showToast('Gagal menyimpan. Cek koneksi Firebase.');
    }finally{
      btn.disabled = false; btn.textContent = 'Simpan Perubahan';
    }
  });

  // ---------------- DASHBOARD ----------------
  function updateDashboard(){
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const todayOrders = orders.filter(o => o.createdAt && o.createdAt.toDate() >= todayStart);
    el('stat-orders-today').textContent = todayOrders.length;
    el('stat-sales-today').textContent = formatRupiah(todayOrders.reduce((s,o) => s + (o.total||0), 0));
    el('stat-menu-count').textContent = menuItems.length;
    el('stat-processing').textContent = orders.filter(o => ['diproses','dimasak'].includes(o.status)).length;

    const pendingCount = orders.filter(o => o.status === 'menunggu').length;
    el('pending-badge').textContent = pendingCount;

    const recent = [...orders].sort((a,b) => (b.createdAt?.toMillis()||0) - (a.createdAt?.toMillis()||0)).slice(0,5);
    el('recent-orders-list').innerHTML = recent.length ? recent.map(o => orderCardHtml(o)).join('') :
      `<div class="empty-cart"><div class="icon">📋</div>Belum ada pesanan.</div>`;
    attachOrderCardEvents('#recent-orders-list');
  }

  // ---------------- MENU MANAGEMENT ----------------
  db.collection('menu').onSnapshot(snap => {
    menuItems = [];
    snap.forEach(d => menuItems.push({ id: d.id, ...d.data() }));
    renderMenuList();
    updateDashboard();
    updateCategorySuggestions();
  });

  function updateCategorySuggestions(){
    const cats = [...new Set(menuItems.map(m => m.category).filter(Boolean))];
    el('category-suggestions').innerHTML = cats.map(c => `<option value="${escapeHtml(c)}">`).join('');
  }

  function renderMenuList(){
    if(menuItems.length === 0){
      el('menu-list').innerHTML = `<div class="empty-cart"><div class="icon">🍽️</div>Belum ada menu. Klik "+ Tambah Menu".</div>`;
      return;
    }
    el('menu-list').innerHTML = menuItems.map(item => `
      <div class="admin-card">
        <img class="thumb" src="${item.imageBase64 || ''}" alt="">
        <div class="info">
          <div class="t">${escapeHtml(item.name)}</div>
          <div class="s">${escapeHtml(item.category || '-')} • ${formatRupiah(item.price)} • ${item.status === 'habis' ? 'Habis' : 'Tersedia'}</div>
        </div>
        <div class="actions">
          <button class="icon-btn" data-edit="${item.id}">✏️</button>
          <button class="icon-btn danger" data-delete="${item.id}">🗑️</button>
        </div>
      </div>
    `).join('');
    el('menu-list').querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => openMenuForm(menuItems.find(m => m.id === btn.dataset.edit)));
    });
    el('menu-list').querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if(confirm('Hapus menu ini?')){
          await db.collection('menu').doc(btn.dataset.delete).delete();
          showToast('Menu dihapus');
        }
      });
    });
  }

  el('btn-add-menu').addEventListener('click', () => openMenuForm(null));
  el('close-menu-form').addEventListener('click', () => closeSheet('sheet-menu-form'));

  function openMenuForm(item){
    editingMenuId = item ? item.id : null;
    el('menu-form-title').textContent = item ? 'Edit Menu' : 'Tambah Menu';
    el('menu-name').value = item ? item.name : '';
    el('menu-price').value = item ? item.price : '';
    el('menu-desc').value = item ? (item.description || '') : '';
    el('menu-category').value = item ? (item.category || '') : '';
    menuImageData = item ? (item.imageBase64 || '') : '';
    el('menu-image-url').value = '';
    if(menuImageData){
      el('menu-image-preview').src = menuImageData;
      el('menu-image-preview').style.display = 'block';
    } else {
      el('menu-image-preview').style.display = 'none';
    }
    document.querySelectorAll('#sheet-menu-form .status-pill').forEach(p => {
      p.classList.toggle('active', p.dataset.status === (item ? item.status : 'tersedia'));
    });
    variantGroupsDraft = item && item.variantGroups ? JSON.parse(JSON.stringify(item.variantGroups)) : [];
    renderVariantGroupsDraft();
    openSheet('sheet-menu-form');
  }

  document.querySelectorAll('#sheet-menu-form .status-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#sheet-menu-form .status-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
    });
  });

  el('menu-image-drop').addEventListener('click', () => el('menu-image-file').click());
  el('menu-image-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if(!file) return;
    menuImageData = await compressImageFile(file);
    el('menu-image-preview').src = menuImageData;
    el('menu-image-preview').style.display = 'block';
  });
  el('menu-image-url').addEventListener('change', async (e) => {
    const url = e.target.value.trim();
    if(!url) return;
    try{
      menuImageData = await compressImageFromUrl(url);
      el('menu-image-preview').src = menuImageData;
      el('menu-image-preview').style.display = 'block';
    }catch(err){ showToast(err.message); }
  });

  function renderVariantGroupsDraft(){
    el('variant-groups-list').innerHTML = variantGroupsDraft.map((g, idx) => `
      <div class="admin-card" style="display:block;" data-idx="${idx}">
        <label style="margin-top:0;">Nama Grup</label>
        <input class="input-field group-name-input" value="${escapeHtml(g.name)}" placeholder="Contoh: Level Pedas">
        <label>Pilihan (pisahkan dengan koma)</label>
        <input class="input-field group-options-input" value="${escapeHtml(g.options.join(', '))}" placeholder="Level 1, Level 2, Level 3">
        <button class="ghost-btn remove-group-btn" type="button" style="color:var(--color-danger);">Hapus Grup Ini</button>
      </div>
    `).join('');
    el('variant-groups-list').querySelectorAll('.admin-card').forEach(card => {
      const idx = Number(card.dataset.idx);
      card.querySelector('.group-name-input').addEventListener('input', (e) => {
        variantGroupsDraft[idx].name = e.target.value;
      });
      card.querySelector('.group-options-input').addEventListener('input', (e) => {
        variantGroupsDraft[idx].options = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
      });
      card.querySelector('.remove-group-btn').addEventListener('click', () => {
        variantGroupsDraft.splice(idx, 1);
        renderVariantGroupsDraft();
      });
    });
  }

  el('add-variant-group-btn').addEventListener('click', () => {
    variantGroupsDraft.push({ name: '', options: [] });
    renderVariantGroupsDraft();
  });

  el('save-menu-btn').addEventListener('click', async () => {
    const name = el('menu-name').value.trim();
    const price = Number(el('menu-price').value);
    if(!name || !price){ showToast('Nama dan harga wajib diisi'); return; }
    const status = document.querySelector('#sheet-menu-form .status-pill.active').dataset.status;
    const validGroups = variantGroupsDraft.filter(g => g.name.trim() && g.options.length > 0);

    const data = {
      name, price,
      description: el('menu-desc').value.trim(),
      category: el('menu-category').value.trim() || 'Lainnya',
      status,
      imageBase64: menuImageData,
      variantGroups: validGroups
    };

    const btn = el('save-menu-btn');
    btn.disabled = true; btn.textContent = 'Menyimpan...';
    try{
      if(editingMenuId){
        await db.collection('menu').doc(editingMenuId).update(data);
      } else {
        await db.collection('menu').add(data);
      }
      showToast('Menu tersimpan');
      closeSheet('sheet-menu-form');
    }catch(err){
      console.error(err); showToast('Gagal menyimpan menu.');
    }finally{
      btn.disabled = false; btn.textContent = 'Simpan Menu';
    }
  });

  // ---------------- BANNER MANAGEMENT ----------------
  db.collection('banners').orderBy('order').onSnapshot(snap => {
    banners = [];
    snap.forEach(d => banners.push({ id: d.id, ...d.data() }));
    renderBannerList();
  });

  function renderBannerList(){
    if(banners.length === 0){
      el('banner-list').innerHTML = `<div class="empty-cart"><div class="icon">🖼️</div>Belum ada banner.</div>`;
      return;
    }
    el('banner-list').innerHTML = banners.map((b, idx) => `
      <div class="admin-card">
        <img class="thumb" src="${b.imageBase64}" alt="">
        <div class="info"><div class="t">Banner ${idx+1}</div><div class="s">Urutan: ${b.order}</div></div>
        <div class="actions">
          <button class="icon-btn" data-up="${b.id}" ${idx===0?'disabled':''}>↑</button>
          <button class="icon-btn" data-down="${b.id}" ${idx===banners.length-1?'disabled':''}>↓</button>
          <button class="icon-btn danger" data-delete-banner="${b.id}">🗑️</button>
        </div>
      </div>
    `).join('');
    el('banner-list').querySelectorAll('[data-delete-banner]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if(confirm('Hapus banner ini?')) await db.collection('banners').doc(btn.dataset.deleteBanner).delete();
      });
    });
    el('banner-list').querySelectorAll('[data-up]').forEach(btn => {
      btn.addEventListener('click', () => swapBannerOrder(btn.dataset.up, -1));
    });
    el('banner-list').querySelectorAll('[data-down]').forEach(btn => {
      btn.addEventListener('click', () => swapBannerOrder(btn.dataset.down, 1));
    });
  }

  async function swapBannerOrder(id, direction){
    const idx = banners.findIndex(b => b.id === id);
    const swapIdx = idx + direction;
    if(swapIdx < 0 || swapIdx >= banners.length) return;
    const a = banners[idx], b = banners[swapIdx];
    const batch = db.batch();
    batch.update(db.collection('banners').doc(a.id), { order: b.order });
    batch.update(db.collection('banners').doc(b.id), { order: a.order });
    await batch.commit();
  }

  el('btn-add-banner').addEventListener('click', () => {
    bannerImageData = "";
    el('banner-image-url').value = '';
    el('banner-image-preview').style.display = 'none';
    openSheet('sheet-banner-form');
  });
  el('close-banner-form').addEventListener('click', () => closeSheet('sheet-banner-form'));

  el('banner-image-drop').addEventListener('click', () => el('banner-image-file').click());
  el('banner-image-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if(!file) return;
    bannerImageData = await compressImageFile(file, 1000, 0.7);
    el('banner-image-preview').src = bannerImageData;
    el('banner-image-preview').style.display = 'block';
  });
  el('banner-image-url').addEventListener('change', async (e) => {
    const url = e.target.value.trim();
    if(!url) return;
    try{
      bannerImageData = await compressImageFromUrl(url, 1000, 0.7);
      el('banner-image-preview').src = bannerImageData;
      el('banner-image-preview').style.display = 'block';
    }catch(err){ showToast(err.message); }
  });

  el('save-banner-btn').addEventListener('click', async () => {
    if(!bannerImageData){ showToast('Upload gambar terlebih dahulu'); return; }
    const maxOrder = banners.reduce((max,b) => Math.max(max, b.order||0), 0);
    try{
      await db.collection('banners').add({ imageBase64: bannerImageData, order: maxOrder + 1 });
      showToast('Banner ditambahkan');
      closeSheet('sheet-banner-form');
    }catch(err){ console.error(err); showToast('Gagal menyimpan banner.'); }
  });

  // ---------------- ORDER MANAGEMENT ----------------
  db.collection('orders').onSnapshot(snap => {
    orders = [];
    snap.forEach(d => orders.push({ id: d.id, ...d.data() }));
    renderOrdersList();
    updateDashboard();
  });

  document.querySelectorAll('#order-filter-tabs .category-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#order-filter-tabs .category-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      orderStatusFilter = tab.dataset.status;
      renderOrdersList();
    });
  });

  function orderCardHtml(o){
    const statusLabel = ORDER_STATUS_STEPS.find(s => s.key === o.status)?.label || o.status;
    const time = o.createdAt ? o.createdAt.toDate().toLocaleTimeString('id-ID', {hour:'2-digit',minute:'2-digit'}) : '';
    return `
      <div class="admin-card" data-order-id="${o.id}" style="cursor:pointer;">
        <div class="info">
          <div class="t">${escapeHtml(o.customerName)} ${o.tableNumber ? '• Meja '+escapeHtml(o.tableNumber) : ''}</div>
          <div class="s">#${o.orderNumber} • ${time} • ${formatRupiah(o.total)}</div>
        </div>
        <div class="actions"><span class="status-pill active">${statusLabel}</span></div>
      </div>
    `;
  }

  function attachOrderCardEvents(containerSelector){
    document.querySelectorAll(containerSelector + ' [data-order-id]').forEach(card => {
      card.addEventListener('click', () => openOrderDetail(card.dataset.orderId));
    });
  }

  function renderOrdersList(){
    const filtered = orderStatusFilter === 'semua' ? orders : orders.filter(o => o.status === orderStatusFilter);
    const sorted = [...filtered].sort((a,b) => (b.createdAt?.toMillis()||0) - (a.createdAt?.toMillis()||0));
    el('orders-list').innerHTML = sorted.length ? sorted.map(o => orderCardHtml(o)).join('') :
      `<div class="empty-cart"><div class="icon">📋</div>Tidak ada pesanan.</div>`;
    attachOrderCardEvents('#orders-list');
  }

  function openOrderDetail(orderId){
    const o = orders.find(x => x.id === orderId);
    if(!o) return;
    const itemsHtml = o.items.map(i => {
      const variantStr = Object.values(i.variants || {}).join(', ');
      return `<div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--color-border);">
        <b>${i.qty}x ${escapeHtml(i.name)}</b> — ${formatRupiah(i.subtotal)}
        ${variantStr ? `<div style="font-size:12px;color:var(--color-muted);">${escapeHtml(variantStr)}</div>` : ''}
        ${i.note ? `<div style="font-size:12px;color:var(--color-accent);font-style:italic;">Catatan: "${escapeHtml(i.note)}"</div>` : ''}
      </div>`;
    }).join('');

    el('order-detail-content').innerHTML = `
      <h3 style="font-family:var(--font-display);margin:14px 0 4px;">Pesanan #${o.orderNumber}</h3>
      <p style="font-size:13px;color:var(--color-muted);margin:0 0 14px;">
        ${escapeHtml(o.customerName)} ${o.tableNumber ? '• Meja '+escapeHtml(o.tableNumber) : ''} ${o.whatsapp ? '• WA: '+escapeHtml(o.whatsapp) : ''}
      </p>
      <div>${itemsHtml}</div>
      <div class="cart-totals"><div class="row grand"><span>Total</span><span>${formatRupiah(o.total)}</span></div></div>

      <label>Ubah Status</label>
      <div class="status-select" id="order-status-pills">
        ${ORDER_STATUS_STEPS.map(s => `<button type="button" class="status-pill ${s.key===o.status?'active':''}" data-status="${s.key}">${s.label}</button>`).join('')}
      </div>

      <label>Estimasi Waktu (menit)</label>
      <input class="input-field" id="order-estimasi-input" type="number" value="${o.estimasi || ''}" placeholder="15">

      <button class="primary-btn" id="save-order-btn">Simpan Perubahan</button>
    `;

    el('order-detail-content').querySelectorAll('#order-status-pills .status-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        el('order-detail-content').querySelectorAll('#order-status-pills .status-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
      });
    });

    el('order-detail-content').querySelector('#save-order-btn').addEventListener('click', async () => {
      const newStatus = el('order-detail-content').querySelector('#order-status-pills .status-pill.active').dataset.status;
      const estimasi = el('order-detail-content').querySelector('#order-estimasi-input').value;
      try{
        await updateOrderStatus(orderId, o, newStatus, estimasi);
        showToast('Status pesanan diperbarui');
        closeSheet('sheet-order-detail');
      }catch(err){ console.error(err); showToast('Gagal memperbarui pesanan.'); }
    });

    openSheet('sheet-order-detail');
  }
  el('close-order-detail').addEventListener('click', () => closeSheet('sheet-order-detail'));

  // ---------------- LAPORAN PENJUALAN ----------------
  db.collection('daily_sales').onSnapshot(snap => {
    dailySales = [];
    snap.forEach(d => dailySales.push({ id: d.id, ...d.data() }));
    renderReports();
  });

  function renderReports(){
    const now = new Date();
    const todayKey = formatDateKey(now);
    const todayDoc = dailySales.find(d => d.date === todayKey);
    el('report-today').textContent = formatRupiah(todayDoc ? todayDoc.totalRevenue : 0);

    const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 6); weekAgo.setHours(0,0,0,0);
    const weekDocs = dailySales.filter(d => new Date(d.date + 'T00:00:00') >= weekAgo);
    el('report-week').textContent = formatRupiah(weekDocs.reduce((s,d) => s + (d.totalRevenue||0), 0));

    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const monthDocs = dailySales.filter(d => d.date.startsWith(monthPrefix));
    el('report-month').textContent = formatRupiah(monthDocs.reduce((s,d) => s + (d.totalRevenue||0), 0));
    el('report-month-orders').textContent = monthDocs.reduce((s,d) => s + (d.totalOrders||0), 0);

    const sorted = [...dailySales].sort((a,b) => b.date.localeCompare(a.date)).slice(0, 14);
    const maxRevenue = Math.max(1, ...sorted.map(d => d.totalRevenue || 0));
    el('daily-sales-bars').innerHTML = sorted.length ? sorted.map(d => {
      const label = new Date(d.date + 'T00:00:00').toLocaleDateString('id-ID', { day:'2-digit', month:'short' });
      const pct = Math.round(((d.totalRevenue||0) / maxRevenue) * 100);
      return `<div class="sales-bar-row">
        <span class="label">${label}</span>
        <span class="bar-track"><span class="bar-fill" style="width:${pct}%"></span></span>
        <span class="value">${formatRupiah(d.totalRevenue)}</span>
      </div>`;
    }).join('') : `<div class="empty-cart"><div class="icon">📈</div>Belum ada data penjualan.</div>`;
  }

  // ---------------- QR CODE ----------------
  el('generate-qr-btn').addEventListener('click', async () => {
    let baseUrl = el('set-deployed-url').value.trim();
    if(!baseUrl){ showToast('Isi alamat website Anda dulu'); return; }
    if(!baseUrl.endsWith('/')) baseUrl += '/';
    const table = el('qr-table-number').value.trim();
    const fullUrl = table ? `${baseUrl}?table=${encodeURIComponent(table)}` : baseUrl;

    await db.collection('settings').doc('general').set({ deployedUrl: el('set-deployed-url').value.trim() }, { merge: true });

    el('qrcode').innerHTML = '';
    new QRCode(el('qrcode'), { text: fullUrl, width: 220, height: 220, colorDark: "#2B2420", colorLight: "#ffffff" });
    el('qr-url-preview').textContent = fullUrl;
    el('download-qr-btn').style.display = 'block';
  });

  el('download-qr-btn').addEventListener('click', () => {
    const img = el('qrcode').querySelector('img') || el('qrcode').querySelector('canvas');
    const link = document.createElement('a');
    link.download = 'qrcode-pesanan.png';
    link.href = img.tagName === 'CANVAS' ? img.toDataURL('image/png') : img.src;
    link.click();
  });

  // ---------------- SHEET HELPERS ----------------
  function openSheet(id){ el(id).classList.add('open'); document.body.style.overflow = 'hidden'; }
  function closeSheet(id){ el(id).classList.remove('open'); document.body.style.overflow = ''; }
  document.querySelectorAll('.sheet-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => { if(e.target === overlay) overlay.classList.remove('open'); });
  });

  checkLoginState();
})();

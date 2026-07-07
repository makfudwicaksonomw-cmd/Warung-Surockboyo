/* ============================================================
   SHARED HELPERS — dipakai oleh customer.js dan admin.js
   ============================================================ */

const DEFAULT_SETTINGS = {
  restaurantName: "Warung Saya",
  tagline: "Pesan cepat, langsung dimasak",
  logoBase64: "",
  primaryColor: "#C1432D",
  headerColor: "#2B2420",
  footerColor: "#2B2420",
  bgColor: "#FBF6EC",
  adminPassword: "admin123",
  deployedUrl: ""
};

function formatRupiah(num){
  return "Rp " + Number(num || 0).toLocaleString("id-ID");
}

function applyTheme(settings){
  const root = document.documentElement;
  if(settings.primaryColor) root.style.setProperty('--color-primary', settings.primaryColor);
  if(settings.headerColor) root.style.setProperty('--color-header', settings.headerColor);
  if(settings.footerColor) root.style.setProperty('--color-footer', settings.footerColor);
  if(settings.bgColor) root.style.setProperty('--color-bg', settings.bgColor);
}

function showToast(msg){
  let toast = document.getElementById('global-toast');
  if(!toast){
    toast = document.createElement('div');
    toast.id = 'global-toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2200);
}

/**
 * Kompres & ubah file gambar (dari input file atau URL) menjadi base64 JPEG
 * agar aman disimpan sebagai field Firestore (< ~700KB).
 */
function compressImageFile(file, maxWidth = 700, quality = 0.7){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function compressImageFromUrl(url, maxWidth = 700, quality = 0.7){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      try{
        resolve(canvas.toDataURL('image/jpeg', quality));
      }catch(err){
        reject(new Error("Gagal memuat gambar dari link (kemungkinan diblokir CORS). Coba upload file langsung."));
      }
    };
    img.onerror = () => reject(new Error("Link gambar tidak valid atau tidak bisa diakses."));
    img.src = url;
  });
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str || "";
  return div.innerHTML;
}

function generateOrderNumber(){
  const d = new Date();
  const pad = n => String(n).padStart(2,'0');
  return `${pad(d.getDate())}${pad(d.getMonth()+1)}-${Math.floor(1000 + Math.random()*9000)}`;
}

const ORDER_STATUS_STEPS = [
  { key: "menunggu", label: "Menunggu", icon: "1" },
  { key: "diproses", label: "Diproses", icon: "2" },
  { key: "dimasak", label: "Dimasak", icon: "3" },
  { key: "siap", label: "Siap Diambil", icon: "4" },
  { key: "selesai", label: "Selesai", icon: "✓" }
];

/* ============================================================
   LAPORAN PENJUALAN & PEMBERSIHAN OTOMATIS PESANAN LAMA
   ------------------------------------------------------------
   Setiap pesanan yang ditandai "Selesai" dicatat ke koleksi
   'daily_sales' (per tanggal) agar total penjualan tetap ada
   walau detail pesanannya nanti dihapus otomatis setelah 24 jam.
   ============================================================ */

function formatDateKey(date){
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
}

/**
 * Ubah status pesanan. Jika status baru "selesai" dan belum pernah dihitung
 * ke rekap harian, catat dulu ke 'daily_sales' agar tidak hilang saat
 * pesanan ini dihapus otomatis nanti.
 */
async function updateOrderStatus(orderId, order, newStatus, estimasi){
  const orderRef = db.collection('orders').doc(orderId);
  if(newStatus === 'selesai' && !order.countedInSummary){
    const dateKey = formatDateKey(order.createdAt ? order.createdAt.toDate() : new Date());
    const summaryRef = db.collection('daily_sales').doc(dateKey);
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(summaryRef);
      const prevOrders = doc.exists ? (doc.data().totalOrders || 0) : 0;
      const prevRevenue = doc.exists ? (doc.data().totalRevenue || 0) : 0;
      tx.set(summaryRef, {
        date: dateKey,
        totalOrders: prevOrders + 1,
        totalRevenue: prevRevenue + (order.total || 0)
      });
      tx.update(orderRef, { status: newStatus, estimasi, countedInSummary: true });
    });
  } else {
    await orderRef.update({ status: newStatus, estimasi });
  }
}

/** Catat total sebuah pesanan ke rekap harian tanpa menyentuh dokumen pesanan (dipakai saat cleanup). */
async function aggregateOrderToSummaryOnly(order){
  const dateKey = formatDateKey(order.createdAt ? order.createdAt.toDate() : new Date());
  const summaryRef = db.collection('daily_sales').doc(dateKey);
  await db.runTransaction(async (tx) => {
    const doc = await tx.get(summaryRef);
    const prevOrders = doc.exists ? (doc.data().totalOrders || 0) : 0;
    const prevRevenue = doc.exists ? (doc.data().totalRevenue || 0) : 0;
    tx.set(summaryRef, {
      date: dateKey,
      totalOrders: prevOrders + 1,
      totalRevenue: prevRevenue + (order.total || 0)
    });
  });
}

/**
 * Cek pesanan berstatus "Selesai" yang usianya sudah lebih dari 24 jam,
 * lalu hapus (setelah dipastikan sudah tercatat di rekap penjualan harian).
 * Dipanggil otomatis tiap kali halaman customer atau admin dibuka.
 */
async function runOrderCleanup(){
  try{
    const snap = await db.collection('orders').where('status', '==', 'selesai').get();
    const now = Date.now();
    const batch = db.batch();
    let deleteCount = 0;
    for(const doc of snap.docs){
      const order = doc.data();
      if(!order.createdAt) continue;
      const ageMs = now - order.createdAt.toMillis();
      if(ageMs >= 24 * 60 * 60 * 1000){
        if(!order.countedInSummary){
          await aggregateOrderToSummaryOnly(order);
        }
        batch.delete(doc.ref);
        deleteCount++;
      }
    }
    if(deleteCount > 0) await batch.commit();
    return deleteCount;
  }catch(err){
    console.error('Gagal membersihkan pesanan lama:', err);
    return 0;
  }
}

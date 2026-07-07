/* ============================================================
   FIREBASE CONFIG
   ------------------------------------------------------------
   INI SATU-SATUNYA FILE YANG WAJIB ANDA EDIT SEBELUM DEPLOY.

   Cara mendapatkan nilai di bawah ini:
   1. Buka https://console.firebase.google.com
   2. Buat project baru (gratis)
   3. Di dashboard project, klik ikon "</>" (Web app) untuk daftarkan web app
   4. Salin config yang muncul dan tempel di bawah ini (ganti seluruh isi objek)
   5. Aktifkan "Firestore Database" dari menu kiri (Build > Firestore Database
      > Create Database > mode "test" atau ikuti aturan di firestore.rules)

   Panduan lengkap step-by-step ada di README.md
   ============================================================ */

const firebaseConfig = {
  apiKey: "GANTI_DENGAN_API_KEY_ANDA",
  authDomain: "GANTI_DENGAN_AUTH_DOMAIN_ANDA",
  projectId: "GANTI_DENGAN_PROJECT_ID_ANDA",
  storageBucket: "GANTI_DENGAN_STORAGE_BUCKET_ANDA",
  messagingSenderId: "GANTI_DENGAN_SENDER_ID_ANDA",
  appId: "GANTI_DENGAN_APP_ID_ANDA"
};

// Jangan hapus baris di bawah ini
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

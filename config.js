// Apolaki shop settings.
// The publishable key is safe here: the shop can only call the shop_* functions,
// which return active "show online" items and accept new orders — nothing private.
window.SHOP_CONFIG = {
  supabaseUrl: "https://txukypxoascvyejfyyqv.supabase.co",
  supabaseKey: "sb_publishable_OyFHASD3MbPOACT9JN4O7Q_Fb_wBjUd",
  // product photos saved inside the Apolaki app (photos/<id>.jpg)
  photoBase: "https://apolaki.vercel.app/photos/",
  // DuitNow QR shown at checkout (file in this folder)
  duitnowQr: "duitnow-qr.png"
};

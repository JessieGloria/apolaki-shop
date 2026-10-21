# Apolaki shop

Customer-facing online shop for Apolaki. Static site (no build step) that reads from the
same Supabase project as the Apolaki app, but only through public shop functions:

- `shop_catalog()` – active items switched to **Show online**, with name, size, price, photo, and Ready to ship / Made to order
- `shop_settings()` – shipping rates, lead time, WhatsApp number, DuitNow QR and bank details
- `shop_place_order()` – saves a new order as *pending* (prices are checked in the database) and returns its private code
- `shop_order_view()`, `shop_send_message()`, `shop_set_email()` – the customer's order page, found only by that private code
- `shop-receipt` (Supabase function) – receipt uploads, checked for size and real file type

Customers can't see stock numbers, costs, retailers, sales or accounts.

## Files
- `index.html`, `shop.css`, `shop.js` – the shop
- `config.js` – Supabase address, publishable key, where product photos live
- `logo.png`, `favicon.png` – made from the Apolaki icon
- `postcodes.json` – Malaysian postcodes → town and state, used to autofill checkout. From
  [AsyrafHussin/malaysia-postcodes](https://github.com/AsyrafHussin/malaysia-postcodes), MIT licence,
  © 2020–2025 Asyraf Hussin.

## Put it online (Vercel)
1. Create a **new** GitHub repository, e.g. `apolaki-shop`, and upload the files in this folder (not into the app's repository).
2. In Vercel: Add New → Project → import `apolaki-shop` → Framework preset **Other** → Deploy.
3. The shop is live at `apolakibyjason.vercel.app` (if the address changes, update `og:url` and `og:image` in `index.html`).

## Day to day (all in the Apolaki app)
- Products → edit an item → turn on **Show online** (and add a short shop description if you like).
- Online orders → Shop settings: WhatsApp number, bank details, DuitNow QR, shipping rates, lead time.
- Online orders: confirm payment → (packed) → shipped with tracking. Stock leaves the Workshop when you mark it shipped.

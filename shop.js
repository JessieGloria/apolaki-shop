/* Apolaki online shop — Phase 1: browse, basket, checkout, pay by DuitNow / transfer, confirm on WhatsApp.
   Talks to Supabase only through the public shop_* functions (no direct table access). */
(() => {
const C = window.SHOP_CONFIG;
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const RM = n => "RM " + Number(n).toLocaleString("en-MY", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
const store = {
  get(k, d) { try { const v = localStorage.getItem("apolaki-" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("apolaki-" + k, JSON.stringify(v)); } catch { /* private mode: keep in memory only */ } }
};

async function rpc(name, body) {
  const r = await fetch(`${C.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST", headers: { apikey: C.supabaseKey, "Content-Type": "application/json" }, body: JSON.stringify(body || {})
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && j.message) || "Something went wrong, please try again.");
  return j;
}

/* ---------- sizes & grouping (same rules as the Apolaki app) ---------- */
const SIZE_SHORT = { "extra small": "XS", "small": "S", "medium": "M", "large": "L", "extra large": "XL", xxs: "XXS", xs: "XS", s: "S", m: "M", l: "L", xl: "XL", xxl: "XXL" };
const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL"];
const sizeShort = sz => SIZE_SHORT[String(sz || "").toLowerCase().trim()] || null;
const baseName = name => String(name)
  .replace(/^\s*size\s+(xxs|xs|s|m|l|xl|xxl)\s+/i, "")
  .replace(/\s*[-–]\s*(xxs|xs|s|m|l|xl|xxl)\s*$/i, "")
  .replace(/\s*\(?\b(extra small|small|medium|large|extra large|big)\b\)?\s*$/i, "")
  .replace(/\s+/g, " ").trim();
const nice = n => /[a-z]/.test(n) ? n : n.toLowerCase().replace(/(^|[\s(\-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const photoUrl = p => !p ? null : /^https?:/.test(p) ? p : C.photoBase + encodeURIComponent(p) + ".jpg";
const plural = c => { const s = String(c || "Other"); return /s$/i.test(s) ? s : s + "s"; };

function groupProducts(list) {
  const map = new Map();
  for (const p of list) {
    const sz = sizeShort(p.size);
    const key = sz ? (p.family || "") + "|" + baseName(p.name).toLowerCase() : "sku|" + p.sku;
    if (!map.has(key)) map.set(key, { key, items: [] });
    map.get(key).items.push({ ...p, label: sz || "" });
  }
  return [...map.values()].map(g => {
    g.items.sort((a, b) => SIZE_ORDER.indexOf(a.label) - SIZE_ORDER.indexOf(b.label));
    const short = (g.items.find(i => i.short_name) || {}).short_name;
    g.name = g.items.length === 1 ? nice(short || g.items[0].name) : nice(baseName(short || g.items[0].name));
    g.category = g.items[0].category || "Other";
    g.photo = photoUrl((g.items.find(i => i.photo) || {}).photo);
    g.description = (g.items.find(i => i.description) || {}).description || "";
    const prices = g.items.map(i => Number(i.price));
    g.min = Math.min(...prices); g.max = Math.max(...prices);
    g.ready = g.items.some(i => i.ready);
    g.id = g.items[0].sku;
    return g;
  }).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

/* ---------- state ---------- */
const S = { products: [], groups: [], settings: {}, cat: store.get("cat", "All"), basket: store.get("basket", []), loading: true, error: "" };
const bySku = sku => S.products.find(p => p.sku === sku);
const groupOf = sku => S.groups.find(g => g.items.some(i => i.sku === sku));
const lead = () => { const d = Number(S.settings.lead_days || 7); return d % 7 === 0 ? `${d / 7} week${d > 7 ? "s" : ""}` : `${d} days`; };
const REGIONS = [
  { id: "semenanjung", name: "Peninsular Malaysia (Semenanjung)" },
  { id: "sarawak", name: "Sarawak" },
  { id: "sabah", name: "Sabah" },
  { id: "overseas", name: "Overseas" }
];
const rate = r => r === "overseas" ? null : Number((S.settings.rates || {})[r]);

function saveBasket() {
  S.basket = S.basket.filter(l => bySku(l.sku) && l.qty > 0);
  store.set("basket", S.basket);
  const n = S.basket.reduce((t, l) => t + l.qty, 0), b = $("#basketCount");
  b.textContent = n; b.hidden = !n;
}
const basketLines = () => S.basket.map(l => { const g = groupOf(l.sku); return { ...l, g, p: g && g.items.find(i => i.sku === l.sku) }; }).filter(l => l.p);
const subtotal = () => basketLines().reduce((t, l) => t + l.qty * Number(l.p.price), 0);

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2200);
}

/* ---------- icons ---------- */
const I = {
  close: '<svg viewBox="0 0 16 16"><path d="M3 3l10 10M13 3 3 13"/></svg>',
  back: '<svg viewBox="0 0 8 13"><path d="M6.5 1.5 1.5 6.5 6.5 11.5"/></svg>',
  ready: '<svg viewBox="0 0 24 24"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/></svg>',
  made: '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/></svg>',
  tick: '<svg viewBox="0 0 24 24"><path d="M5 12.5 10 17.5 19 7"/></svg>',
  wa: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2l-.4-.2z"/></svg>'
};
const availBox = (ready, qty = 1) => ready
  ? `<div class="avail ready">${I.ready}<div><strong>Ready to ship</strong>Already made — posted soon after payment.</div></div>`
  : `<div class="avail made">${I.made}<div><strong>Made to order</strong>Handmade for you and shipped within ${lead()} after payment.</div></div>`;

/* ---------- catalogue ---------- */
function renderShop() {
  const cats = ["All", ...new Set(S.groups.map(g => g.category))];
  if (!cats.includes(S.cat)) S.cat = "All";
  const list = S.groups.filter(g => S.cat === "All" || g.category === S.cat);
  const grid = S.loading
    ? `<div class="grid skeleton">${Array.from({ length: 8 }, () => `<div class="card"><div class="ph"></div><div class="line" style="width:70%"></div><div class="line" style="width:35%"></div></div>`).join("")}</div>`
    : S.error ? `<div class="empty-state"><img src="logo.png" alt=""><p>${esc(S.error)}</p><button class="btn ghost" id="retry" type="button">Try again</button></div>`
    : !list.length ? `<div class="empty-state"><img src="logo.png" alt=""><p>New pieces are coming soon.</p></div>`
    : `<div class="grid">${list.map((g, i) => `
      <button class="card" type="button" data-open="${esc(g.id)}" style="animation-delay:${Math.min(i, 12) * 40}ms">
        <div class="ph${g.photo ? "" : " empty"}">${g.photo ? `<img src="${esc(g.photo)}" alt="${esc(g.name)}" loading="lazy">` : `<img src="logo.png" alt="">`}
          <span class="tag${g.ready ? " ready" : ""}">${g.ready ? "Ready to ship" : "Made to order"}</span></div>
        <div class="meta"><h3>${esc(g.name)}</h3>
          <div class="price">${g.min === g.max ? RM(g.min) : "From " + RM(g.min)}</div>
          ${g.items.length > 1 ? `<div class="sizes">Sizes ${g.items.map(i => esc(i.label)).join(" · ")}</div>` : ""}</div>
      </button>`).join("")}</div>`;
  $("#view").innerHTML = `
    <section class="hero">
      <p class="eyebrow">Handmade brass jewellery</p>
      <h1>Pieces shaped by hand, made for you.</h1>
      <p>Bracelets, earrings and rings crafted in brass by Jason Labunda. Each piece is made in small batches, and many are made to order.</p>
      <ul class="perks"><li>Made to order within ${lead()}</li><li>Shipping across Malaysia from ${RM(Math.min(...Object.values(S.settings.rates || { a: 10 }).map(Number)))}</li><li>Pay by DuitNow or bank transfer</li></ul>
    </section>
    ${cats.length > 2 ? `<div class="chips" role="toolbar" aria-label="Categories">${cats.map(c => `<button class="chip" type="button" data-cat="${esc(c)}" aria-pressed="${c === S.cat}">${c === "All" ? "All pieces" : esc(plural(c))}</button>`).join("")}</div>` : ""}
    ${grid}`;
  $("#view").querySelectorAll("[data-cat]").forEach(b => b.onclick = () => { S.cat = b.dataset.cat; store.set("cat", S.cat); renderShop(); });
  $("#view").querySelectorAll("[data-open]").forEach(b => b.onclick = () => openProduct(b.dataset.open));
  const r = $("#retry"); if (r) r.onclick = load;
}

/* ---------- overlay helpers ---------- */
let lastFocus = null;
function openLayer(el, html) {
  closeLayers(true);
  lastFocus = document.activeElement;
  el.innerHTML = html; el.hidden = false; $("#overlay").hidden = false; document.body.classList.add("locked");
  const f = el.querySelector("button, [href], input"); if (f) f.focus({ preventScroll: true });
}
function closeLayers(silent) {
  ["#sheet", "#drawer"].forEach(s => { $(s).hidden = true; $(s).innerHTML = ""; });
  $("#overlay").hidden = true; document.body.classList.remove("locked");
  if (!silent && lastFocus) lastFocus.focus({ preventScroll: true });
}
$("#overlay").onclick = () => closeLayers();
document.addEventListener("keydown", e => { if (e.key === "Escape") closeLayers(); });

/* ---------- product sheet ---------- */
function openProduct(id, pickSku) {
  const g = groupOf(id); if (!g) return;
  let sel = g.items.find(i => i.sku === pickSku) || g.items.find(i => i.ready) || g.items[0], qty = 1, first = true;
  const draw = () => {
    const html = `
      <button class="sheet-close" type="button" aria-label="Close">${I.close}</button>
      <div class="pd">
        <div class="ph${g.photo ? "" : " empty"}">${g.photo ? `<img src="${esc(g.photo)}" alt="${esc(g.name)}">` : `<img src="logo.png" alt="">`}</div>
        <div class="info">
          <p class="cat">${esc(g.category)}</p>
          <h2 id="sheetTitle">${esc(g.name)}</h2>
          <p class="big-price">${RM(sel.price)}</p>
          ${g.description ? `<p class="desc">${esc(g.description)}</p>` : ""}
          ${g.items.length > 1 ? `<p class="label">Size</p><div class="size-row">${g.items.map(i => `<button class="size" type="button" data-sku="${esc(i.sku)}" aria-pressed="${i.sku === sel.sku}">${esc(i.label)}</button>`).join("")}</div>`
            : sel.size && !/^(free|assorted|one size)$/i.test(sel.size) ? `<p class="small muted" style="margin:-6px 0 16px">Size: ${esc(sel.size)}</p>` : ""}
          ${availBox(sel.ready)}
          <div class="buy">
            <div class="qty" aria-label="Quantity"><button type="button" data-q="-1" aria-label="Fewer" ${qty <= 1 ? "disabled" : ""}>−</button><span>${qty}</span><button type="button" data-q="1" aria-label="More" ${qty >= 10 ? "disabled" : ""}>+</button></div>
            <button class="btn grow" type="button" id="add">Add to basket · ${RM(sel.price * qty)}</button>
          </div>
        </div>
      </div>`;
    if (first) { openLayer($("#sheet"), html); first = false; } else $("#sheet").innerHTML = html;
    const sh = $("#sheet");
    sh.querySelector(".sheet-close").onclick = () => closeLayers();
    sh.querySelectorAll("[data-sku]").forEach(b => b.onclick = () => { sel = g.items.find(i => i.sku === b.dataset.sku); draw(); });
    sh.querySelectorAll("[data-q]").forEach(b => b.onclick = () => { qty = Math.min(10, Math.max(1, qty + Number(b.dataset.q))); draw(); });
    $("#add").onclick = () => {
      const l = S.basket.find(x => x.sku === sel.sku);
      if (l) l.qty = Math.min(10, l.qty + qty); else S.basket.push({ sku: sel.sku, qty });
      saveBasket(); closeLayers(); toast(`Added ${g.name}${sel.label ? " (" + sel.label + ")" : ""}`);
      const b = $("#basketBtn"); b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump");
    };
  };
  draw();
}

/* ---------- basket drawer ---------- */
function lineHtml(l, editable) {
  return `<div class="line">
    <div class="ph${l.g.photo ? "" : " empty"}">${l.g.photo ? `<img src="${esc(l.g.photo)}" alt="">` : `<img src="logo.png" alt="">`}</div>
    <div><h4>${esc(l.g.name)}</h4><div class="sub">${l.p.label ? "Size " + esc(l.p.label) + " · " : ""}${l.p.ready ? "Ready to ship" : "Made to order"}</div>
      <div class="sub">${RM(l.p.price)} each</div></div>
    <div class="right">${editable
      ? `<div class="qty sm"><button type="button" data-dq="-1" data-s="${esc(l.sku)}" aria-label="Fewer">−</button><span>${l.qty}</span><button type="button" data-dq="1" data-s="${esc(l.sku)}" aria-label="More" ${l.qty >= 10 ? "disabled" : ""}>+</button></div><button class="rm" type="button" data-rm="${esc(l.sku)}">Remove</button>`
      : `<span>× ${l.qty}</span>`}<strong>${RM(l.qty * l.p.price)}</strong></div>
  </div>`;
}
function openBasket() {
  const lines = basketLines();
  openLayer($("#drawer"), `
    <button class="drawer-close" type="button" aria-label="Close">${I.close}</button>
    <header><h2>Your basket</h2></header>
    <div class="lines">${lines.length ? lines.map(l => lineHtml(l, true)).join("") : `<div class="empty-state"><img src="logo.png" alt=""><p>Your basket is empty.</p></div>`}</div>
    ${lines.length ? `<footer>
      <div class="sumrow"><span>Subtotal</span><strong>${RM(subtotal())}</strong></div>
      <p class="small muted" style="margin:0 0 14px">Shipping is added at checkout.</p>
      <button class="btn block" type="button" id="toCheckout">Checkout</button></footer>` : ""}`);
  const d = $("#drawer");
  d.querySelector(".drawer-close").onclick = () => closeLayers();
  d.querySelectorAll("[data-dq]").forEach(b => b.onclick = () => { const l = S.basket.find(x => x.sku === b.dataset.s); l.qty = Math.min(10, l.qty + Number(b.dataset.dq)); saveBasket(); openBasket(); });
  d.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { S.basket = S.basket.filter(x => x.sku !== b.dataset.rm); saveBasket(); openBasket(); });
  const c = $("#toCheckout"); if (c) c.onclick = () => { closeLayers(true); location.hash = "#/checkout"; };
}
$("#basketBtn").onclick = openBasket;

/* ---------- checkout ---------- */
const form = store.get("details", { region: "semenanjung" });
function renderCheckout(errMsg) {
  const lines = basketLines();
  if (!lines.length) { location.hash = "#/"; return; }
  const ship = rate(form.region), sub = subtotal(), anyMade = lines.some(l => !l.p.ready);
  const f = k => esc(form[k] || "");
  $("#view").innerHTML = `
    <div class="page-head"><button class="back" type="button" id="back">${I.back} Continue shopping</button></div>
    <h1 class="page-title">Checkout</h1>
    <form class="checkout" id="co" novalidate>
      <div>
        <div class="panel">
          <h3>Your details</h3>
          <div class="field"><label for="name">Full name</label><input id="name" name="name" autocomplete="name" required value="${f("name")}"></div>
          <div class="two">
            <div class="field"><label for="phone">WhatsApp number</label><input id="phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="012-345 6789" required value="${f("phone")}"></div>
            <div class="field"><label for="email">Email <span class="opt">(optional)</span></label><input id="email" name="email" type="email" autocomplete="email" value="${f("email")}"></div>
          </div>
        </div>
        <div class="panel" style="margin-top:16px">
          <h3>Shipping</h3>
          <div class="regions" role="radiogroup" aria-label="Ship to">${REGIONS.map(r => `
            <label class="region"><span class="l"><input type="radio" name="region" value="${r.id}" ${form.region === r.id ? "checked" : ""}>${esc(r.name)}</span>
              <span class="fee">${r.id === "overseas" ? "Quoted on WhatsApp" : RM(rate(r.id))}</span></label>`).join("")}</div>
          ${form.region === "overseas" ? `<div class="field"><label for="country">Country</label><input id="country" name="country" autocomplete="country-name" required value="${f("country")}"></div>
            <p class="note">Overseas postage depends on the country. We'll WhatsApp you the shipping cost before you pay.</p>` : ""}
          <div class="field"><label for="address">Address</label><textarea id="address" name="address" autocomplete="street-address" required>${f("address")}</textarea></div>
          <div class="two">
            <div class="field"><label for="postcode">Postcode</label><input id="postcode" name="postcode" autocomplete="postal-code" inputmode="numeric" value="${f("postcode")}"></div>
            <div class="field"><label for="city">City</label><input id="city" name="city" autocomplete="address-level2" value="${f("city")}"></div>
          </div>
          <div class="field"><label for="state">State</label><input id="state" name="state" autocomplete="address-level1" value="${f("state")}"></div>
          <div class="field"><label for="note">Note <span class="opt">(optional)</span></label><textarea id="note" name="note" placeholder="Gift message, ring size questions, anything else">${f("note")}</textarea></div>
        </div>
      </div>
      <div class="panel summary">
        <h3>Order summary</h3>
        ${lines.map(l => `<div class="sline"><span class="n">${esc(l.g.name)}${l.p.label ? " (" + esc(l.p.label) + ")" : ""} × ${l.qty}<small>${l.p.ready ? "Ready to ship" : "Made to order"}</small></span><span>${RM(l.qty * l.p.price)}</span></div>`).join("")}
        <div style="margin-top:12px">
          <div class="sumrow"><span>Subtotal</span><span>${RM(sub)}</span></div>
          <div class="sumrow"><span>Shipping</span><span>${ship == null ? "To be quoted" : RM(ship)}</span></div>
          <div class="sumrow total"><span>Total</span><span>${RM(sub + (ship || 0))}${ship == null ? " + shipping" : ""}</span></div>
        </div>
        ${anyMade ? `<p class="note">Made-to-order pieces are handmade after payment and shipped within ${lead()}.</p>` : ""}
        <p class="note">You'll pay by DuitNow QR or bank transfer on the next page, then send us the receipt on WhatsApp.</p>
        ${errMsg ? `<p class="err" role="alert">${esc(errMsg)}</p>` : ""}
        <button class="btn block" type="submit" id="place">Place order</button>
      </div>
    </form>`;
  $("#back").onclick = () => { location.hash = "#/"; };
  const co = $("#co");
  co.addEventListener("input", e => { if (e.target.name) { form[e.target.name] = e.target.value; store.set("details", form); } });
  co.querySelectorAll("[name=region]").forEach(r => r.onchange = () => { form.region = r.value; store.set("details", form); renderCheckout(); });
  co.onsubmit = async e => {
    e.preventDefault();
    const need = ["name", "phone", "address", ...(form.region === "overseas" ? ["country"] : [])];
    const miss = need.find(k => !String(form[k] || "").trim());
    if (miss) { renderCheckout("Please fill in your " + ({ name: "name", phone: "WhatsApp number", address: "address", country: "country" }[miss]) + "."); $("#" + miss).focus(); return; }
    const btn = $("#place"); btn.disabled = true; btn.textContent = "Placing order…";
    try {
      const res = await rpc("shop_place_order", { p: { ...form, items: S.basket.map(l => ({ sku: l.sku, qty: l.qty })) } });
      const order = { ...res, region: form.region, country: form.country, name: form.name, phone: form.phone,
        address: [form.address, [form.postcode, form.city].filter(Boolean).join(" "), form.state, form.region === "overseas" ? form.country : ""].filter(Boolean).join(", ") };
      store.set("lastOrder", order);
      S.basket = []; saveBasket();
      location.hash = "#/order";
    } catch (err) { renderCheckout(err.message); }
  };
}

/* ---------- confirmation ---------- */
function waLink(o) {
  const num = String(S.settings.whatsapp || "").replace(/\D/g, "").replace(/^0/, "60");
  if (!num) return null;
  const region = (REGIONS.find(r => r.id === o.region) || {}).name || o.region;
  const msg = [`Hi Apolaki! I've placed order ${o.order_no}:`, "",
    ...o.items.map(i => `• ${nice(baseName(i.name))}${sizeShort(i.size) ? " (" + sizeShort(i.size) + ")" : ""} × ${i.qty} — ${RM(i.qty * i.price)}`), "",
    `Shipping to ${region}${o.region === "overseas" && o.country ? " (" + o.country + ")" : ""}: ${o.shipping_fee == null ? "please quote" : RM(o.shipping_fee)}`,
    `Total: ${RM(o.total)}${o.shipping_fee == null ? " + shipping" : ""}`, "",
    `Name: ${o.name}`, `Phone: ${o.phone}`, `Address: ${o.address}`, "",
    o.shipping_fee == null ? "Please let me know the shipping cost." : "Here is my payment receipt:"].join("\n");
  return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
}
function renderDone() {
  const o = store.get("lastOrder", null);
  if (!o) { location.hash = "#/"; return; }
  const s = S.settings, wa = waLink(o), quote = o.shipping_fee == null;
  const bank = s.account_no ? `<dl class="kv"><dt>Bank</dt><dd>${esc(s.bank_name)}</dd><dt>Name</dt><dd>${esc(s.account_name)}</dd>
      <dt>Account</dt><dd>${esc(s.account_no)}<button class="copy" type="button" data-copy="${esc(s.account_no)}">Copy</button></dd>
      <dt>Reference</dt><dd>${esc(o.order_no)}<button class="copy" type="button" data-copy="${esc(o.order_no)}">Copy</button></dd></dl>` : "";
  const pay = s.duitnow_qr || bank
    ? `<div class="paybox${s.duitnow_qr ? " has-qr" : ""}">${s.duitnow_qr ? `<img src="${esc(s.duitnow_qr)}" alt="DuitNow QR code for Apolaki">` : ""}<div>${s.duitnow_qr ? `<p class="small muted" style="margin:0 0 8px">Scan with any banking or e-wallet app${bank ? ", or transfer to:" : "."}</p>` : ""}${bank}</div></div>`
    : `<p class="muted">We'll send you our DuitNow / bank details on WhatsApp.</p>`;
  $("#view").innerHTML = `
    <section class="done">
      <div class="tick">${I.tick}</div>
      <h1>Thank you, ${esc(String(o.name).split(" ")[0])}!</h1>
      <p>Your order <span class="ordno">${esc(o.order_no)}</span> has been received. Total <strong>${RM(o.total)}${quote ? " + shipping" : ""}</strong>.</p>
      <ol class="steps">
        ${quote ? `<li><div><h4>Wait for your shipping quote</h4><p class="muted">Send us the order on WhatsApp and we'll reply with the overseas postage.</p></div></li>` : ""}
        <li><div><h4>Pay ${quote ? "the total" : RM(o.total)} by DuitNow or bank transfer</h4>${pay}</div></li>
        <li><div><h4>Send us your receipt on WhatsApp</h4><p class="muted">Your order details are already written in the message.</p>
          ${wa ? `<a class="btn wa" href="${esc(wa)}" target="_blank" rel="noopener">${I.wa} Send order on WhatsApp</a>` : `<p class="muted">Please message us with your order number.</p>`}</div></li>
        <li><div><h4>We make & ship it</h4><p class="muted">${o.items.some(i => !i.ready) ? `Made-to-order pieces ship within ${lead()} after payment.` : "Ready pieces are posted soon after payment."} You'll get the tracking number on WhatsApp.</p></div></li>
      </ol>
      <div class="panel">
        <h3>Your order</h3>
        ${o.items.map(i => `<div class="sline"><span class="n">${esc(nice(baseName(i.name)))}${sizeShort(i.size) ? " (" + sizeShort(i.size) + ")" : ""} × ${i.qty}<small>${i.ready ? "Ready to ship" : "Made to order"}</small></span><span>${RM(i.qty * i.price)}</span></div>`).join("")}
        <div style="margin-top:12px"><div class="sumrow"><span>Shipping</span><span>${quote ? "To be quoted" : RM(o.shipping_fee)}</span></div>
        <div class="sumrow total" style="margin-bottom:0"><span>Total</span><span>${RM(o.total)}${quote ? " + shipping" : ""}</span></div></div>
      </div>
      <p style="margin-top:22px"><a href="#/" class="btn ghost">Back to the shop</a></p>
    </section>`;
  $("#view").querySelectorAll("[data-copy]").forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast("Copied"); } catch { toast(b.dataset.copy); } });
}

/* ---------- routing & loading ---------- */
function route() {
  closeLayers(true);
  const h = location.hash;
  if (h === "#/checkout") renderCheckout();
  else if (h === "#/order") renderDone();
  else {
    renderShop();
    const m = h.match(/^#\/item\/(.+)$/); if (m && !S.loading) openProduct(decodeURIComponent(m[1]));
  }
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
/* a missing photo falls back to the logo placeholder */
document.addEventListener("error", e => {
  const img = e.target;
  if (img.tagName !== "IMG" || img.dataset.fb || !img.closest(".ph")) return;
  img.dataset.fb = "1"; img.alt = ""; img.src = "logo.png"; img.closest(".ph").classList.add("empty");
}, true);
window.addEventListener("scroll", () => $(".top").classList.toggle("scrolled", window.scrollY > 4), { passive: true });

async function load() {
  S.loading = true; S.error = ""; route();
  try {
    const [cat, set] = await Promise.all([rpc("shop_catalog"), rpc("shop_settings")]);
    S.products = cat || []; S.settings = set || {}; S.groups = groupProducts(S.products);
    const wa = String(S.settings.whatsapp || "").replace(/\D/g, "").replace(/^0/, "60");
    $("#footContact").innerHTML = wa ? `Questions? <a href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp us</a>` : "";
  } catch (e) { S.error = "We couldn't load the shop just now. Please check your connection."; }
  S.loading = false; saveBasket(); route();
}
load();
})();

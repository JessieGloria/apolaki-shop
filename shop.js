/* Apolaki online shop
   Home · Shop (search, filters, sort) · Collections · Wishlist · Cart · Product · Checkout · Order confirmation.
   Talks to Supabase only through the public shop_* functions (no direct table access).
   Pay by DuitNow / transfer and confirm on WhatsApp; the Apolaki app records the sale when payment is confirmed. */
(() => {
const C = window.SHOP_CONFIG;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const RM = n => "RM " + Number(n).toLocaleString("en-MY", { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
const store = {
  get(k, d) { try { const v = localStorage.getItem("apolaki-" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("apolaki-" + k, JSON.stringify(v)); } catch { /* private mode: memory only */ } },
  del(k) { try { localStorage.removeItem("apolaki-" + k); } catch {} }
};
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

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
const plainSize = s => !s || /^(free|assorted|one size)$/i.test(s);

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
    g.collection = (g.items.find(i => i.collection) || {}).collection || "";
    g.family = g.items[0].family || "";
    g.photos = [...new Set(g.items.map(i => photoUrl(i.photo)).filter(Boolean))];
    g.photo = g.photos[0] || null;
    g.description = (g.items.find(i => i.description) || {}).description || "";
    g.material = (g.items.find(i => i.material) || {}).material || "";
    g.dimensions = (g.items.find(i => i.dimensions) || {}).dimensions || "";
    const prices = g.items.map(i => Number(i.price));
    g.min = Math.min(...prices); g.max = Math.max(...prices);
    g.ready = g.items.some(i => i.ready);
    const ranks = g.items.map(i => i.popularity).filter(r => r != null);
    g.pop = ranks.length ? Math.min(...ranks) : null;            /* best rank among its sizes; null = no recorded sales */
    g.released = g.items.map(i => i.released || "").sort().pop() || "";
    g.id = g.items[0].sku;
    g.text = [g.name, g.category, plural(g.category), g.collection, g.family, g.description, g.material, ...g.items.map(i => i.name + " " + (i.size || ""))].join(" ").toLowerCase();
    return g;
  }).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

/* ---------- state ---------- */
const S = { products: [], groups: [], settings: {}, basket: store.get("basket", []), wish: store.get("wishlist", []), loading: true, error: "",
  f: { q: "", cat: "", col: "", price: "", ready: false, sort: "popular" } };
const groupOf = sku => S.groups.find(g => g.items.some(i => i.sku === sku));
const lead = () => { const d = Number(S.settings.lead_days || 7); return d % 7 === 0 ? `${d / 7} week${d > 7 ? "s" : ""}` : `${d} days`; };
const REGIONS = [
  { id: "semenanjung", name: "Peninsular Malaysia (Semenanjung)", short: "Peninsular Malaysia" },
  { id: "sarawak", name: "Sarawak", short: "Sarawak" },
  { id: "sabah", name: "Sabah", short: "Sabah" },
  { id: "overseas", name: "Overseas", short: "Overseas" }
];
const rate = r => r === "overseas" ? null : Number((S.settings.rates || {})[r]);
const waNum = () => String(S.settings.whatsapp || "").replace(/\D/g, "").replace(/^0/, "60");
const PRICES = [["", "Any price"], ["0-80", "Under RM 80"], ["80-150", "RM 80 – 150"], ["150-", "Over RM 150"]];
const SORTS = [["popular", "Bestselling"], ["new", "Newest"], ["low", "Price: low to high"], ["high", "Price: high to low"]];

function saveBasket() {
  S.basket = S.basket.filter(l => groupOf(l.sku) && l.qty > 0);
  store.set("basket", S.basket);
  const n = S.basket.reduce((t, l) => t + l.qty, 0);
  $$("[data-count=cart]").forEach(b => { b.textContent = n; b.hidden = !n; });
}
function saveWish() {
  S.wish = S.wish.filter(id => groupOf(id));
  store.set("wishlist", S.wish);
  $$("[data-count=wish]").forEach(b => { b.textContent = S.wish.length; b.hidden = !S.wish.length; });
}
const wished = g => S.wish.includes(g.id);
function toggleWish(id) {
  const g = groupOf(id); if (!g) return;
  if (wished(g)) { S.wish = S.wish.filter(x => x !== g.id); toast("Removed from wishlist"); }
  else { S.wish.push(g.id); toast("Saved to wishlist"); }
  saveWish();
  $$(`[data-wish="${CSS.escape(g.id)}"]`).forEach(b => { b.setAttribute("aria-pressed", wished(g)); b.setAttribute("aria-label", wished(g) ? "Remove from wishlist" : "Save to wishlist"); });
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
  next: '<svg viewBox="0 0 8 13"><path d="M1.5 1.5 6.5 6.5 1.5 11.5"/></svg>',
  ready: '<svg viewBox="0 0 24 24"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/></svg>',
  made: '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/></svg>',
  tick: '<svg viewBox="0 0 24 24"><path d="M5 12.5 10 17.5 19 7"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7.5-4.6-9.3-9.2C1.5 7.6 3.6 4.5 6.9 4.5c2 0 3.4 1.1 5.1 3 1.7-1.9 3.1-3 5.1-3 3.3 0 5.4 3.1 4.2 6.3C19.5 15.4 12 20 12 20z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>',
  filter: '<svg viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
  zoom: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M11 8v6M8 11h6"/></svg>',
  wa: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2l-.4-.2z"/></svg>'
};
const availBox = ready => ready
  ? `<div class="avail ready">${I.ready}<div><strong>Ready to ship</strong>Already made, posted soon after payment.</div></div>`
  : `<div class="avail made">${I.made}<div><strong>Made to order</strong>Handmade for you and shipped within ${lead()} after payment.</div></div>`;
const phHtml = (src, alt, cls = "ph", lazy = true) => `<div class="${cls}${src ? "" : " empty"}">${src ? `<img src="${esc(src)}" alt="${esc(alt)}"${lazy ? ' loading="lazy" decoding="async"' : ""}>` : `<img src="logo.png" alt="">`}`;
const priceText = g => g.min === g.max ? RM(g.min) : "From " + RM(g.min);

function card(g, i = 0) {
  return `<article class="card" style="animation-delay:${Math.min(i, 12) * 35}ms">
    <a href="#/p/${encodeURIComponent(g.id)}" class="card-link" aria-label="${esc(g.name)}, ${esc(priceText(g))}">
      ${phHtml(g.photo, g.name)}${g.ready ? `<span class="tag ready">Ready to ship</span>` : ""}</div>
      <div class="meta"><h3>${esc(g.name)}</h3><div class="price">${priceText(g)}</div>
        ${g.items.length > 1 ? `<div class="sizes">${g.items.map(i => esc(i.label)).join(" · ")}</div>` : ""}</div>
    </a>
    <button class="heart" type="button" data-wish="${esc(g.id)}" aria-pressed="${wished(g)}" aria-label="${wished(g) ? "Remove from wishlist" : "Save to wishlist"}">${I.heart}</button>
  </article>`;
}
const grid = list => `<div class="grid">${list.map(card).join("")}</div>`;
const rail = list => `<div class="rail">${list.map(card).join("")}</div>`;
const skeleton = n => `<div class="grid skeleton">${Array.from({ length: n }, () => `<div class="card"><div class="ph"></div><div class="line" style="width:70%"></div><div class="line" style="width:35%"></div></div>`).join("")}</div>`;
const emptyState = (msg, btn) => `<div class="empty-state"><img src="logo.png" alt=""><p>${msg}</p>${btn || ""}</div>`;

/* ---------- lists ---------- */
const bestsellers = () => S.groups.filter(g => g.pop != null).sort((a, b) => a.pop - b.pop);
const newest = () => S.groups.slice().sort((a, b) => b.released.localeCompare(a.released) || (a.pop ?? 1e9) - (b.pop ?? 1e9));
function collections() {
  const m = new Map();
  S.groups.forEach(g => { if (!g.collection) return; const c = m.get(g.collection) || { name: g.collection, groups: [] }; c.groups.push(g); m.set(g.collection, c); });
  return [...m.values()].map(c => {
    c.groups.sort((a, b) => (a.pop ?? 1e9) - (b.pop ?? 1e9));
    c.photo = (c.groups.find(g => g.photo) || {}).photo || null;
    c.pop = Math.min(...c.groups.map(g => g.pop ?? 1e9));
    return c;
  }).sort((a, b) => a.pop - b.pop || b.groups.length - a.groups.length || a.name.localeCompare(b.name));
}
function categories() {
  const m = new Map();
  S.groups.forEach(g => { const c = m.get(g.category) || { name: g.category, groups: [] }; c.groups.push(g); m.set(g.category, c); });
  return [...m.values()].map(c => {
    c.groups.sort((a, b) => (a.pop ?? 1e9) - (b.pop ?? 1e9));
    c.photo = (c.groups.find(g => g.photo) || {}).photo || null;
    return c;
  }).sort((a, b) => b.groups.length - a.groups.length);
}
function filtered(f = S.f) {
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean).map(w => w.replace(/s$/, ""));
  const [lo, hi] = (f.price || "-").split("-").map(x => x === "" ? null : Number(x));
  let list = S.groups.filter(g =>
    (!f.cat || g.category === f.cat) && (!f.col || g.collection === f.col) && (!f.ready || g.ready) &&
    (lo == null || g.max >= lo) && (hi == null || g.min < hi) &&
    words.every(w => g.text.includes(w)));
  const by = {
    popular: (a, b) => (a.pop ?? 1e9) - (b.pop ?? 1e9) || b.released.localeCompare(a.released),
    new: (a, b) => b.released.localeCompare(a.released) || (a.pop ?? 1e9) - (b.pop ?? 1e9),
    low: (a, b) => a.min - b.min || a.name.localeCompare(b.name),
    high: (a, b) => b.max - a.max || a.name.localeCompare(b.name)
  }[f.sort] || (() => 0);
  return list.sort(by);
}
function related(g) {
  const used = new Set([g.key]);
  const pick = (list, n) => { const out = []; for (const x of list) { if (out.length >= n) break; if (!used.has(x.key)) { used.add(x.key); out.push(x); } } return out; };
  const byPop = (a, b) => (a.pop ?? 1e9) - (b.pop ?? 1e9);
  const look = g.collection ? pick(S.groups.filter(x => x.collection === g.collection && x.category !== g.category).sort(byPop), 6) : [];
  const like = pick([
    ...S.groups.filter(x => x.category === g.category && (x.collection === g.collection || x.family === g.family)).sort(byPop),
    ...S.groups.filter(x => x.category === g.category).sort(byPop),
    ...S.groups.filter(x => x.collection && x.collection === g.collection).sort(byPop)
  ], 8);
  return { look, like };
}

/* ---------- home ---------- */
function renderHome() {
  if (S.loading || S.error) return renderState();
  const s = S.settings, best = bestsellers().slice(0, 8), fresh = newest().slice(0, 8), cols = collections().filter(c => c.photo).slice(0, 6), cats = categories();
  const hero = (best.find(g => g.photo) || S.groups.find(g => g.photo) || {}).photo;
  const minRate = Math.min(...Object.values(s.rates || {}).map(Number).filter(n => !isNaN(n)));
  const reviews = (Array.isArray(s.reviews) ? s.reviews : []).filter(r => r && r.text && r.name);
  $("#view").innerHTML = `
    <section class="banner">
      ${hero ? `<img src="${esc(hero)}" alt="" fetchpriority="high">` : ""}
      <div class="banner-text">
        <p class="eyebrow">${esc(s.banner_eyebrow || "Handmade brass jewellery")}</p>
        <h1>${esc(s.banner_title || "Shaped by hand, made for you.")}</h1>
        <p>${esc(s.banner_text || "Bracelets, earrings and rings crafted in brass by Jason Labunda.")}</p>
        <a class="btn light" href="#/shop">Shop now</a>
      </div>
    </section>
    <ul class="perks">
      <li>Made to order within ${lead()}</li>
      ${isFinite(minRate) ? `<li>Shipping in Malaysia from ${RM(minRate)}</li>` : ""}
      <li>Pay by DuitNow or bank transfer</li>
    </ul>

    <section class="sec">
      <div class="sec-head"><h2>Shop by category</h2></div>
      <div class="cat-row">${cats.map(c => `<a class="cat-tile" href="#/shop?cat=${encodeURIComponent(c.name)}">${phHtml(c.photo, c.name)}</div><span>${esc(plural(c.name))}</span></a>`).join("")}</div>
    </section>

    ${best.length ? `<section class="sec">
      <div class="sec-head"><h2>Bestsellers</h2><a href="#/shop?sort=popular">See all</a></div>
      ${rail(best)}
    </section>` : ""}

    <section class="sec">
      <div class="sec-head"><h2>New arrivals</h2><a href="#/shop?sort=new">See all</a></div>
      ${rail(fresh)}
    </section>

    ${cols.length ? `<section class="sec">
      <div class="sec-head"><h2>Collections</h2><a href="#/collections">See all</a></div>
      <div class="col-grid">${cols.map(colTile).join("")}</div>
    </section>` : ""}

    ${reviews.length ? `<section class="sec">
      <div class="sec-head"><h2>From our customers</h2></div>
      <div class="reviews">${reviews.slice(0, 6).map(r => `<figure class="review"><blockquote>${esc(r.text)}</blockquote><figcaption>${esc(r.name)}${r.place ? " · " + esc(r.place) : ""}</figcaption></figure>`).join("")}</div>
    </section>` : ""}`;
}
const colTile = c => `<a class="col-tile" href="#/c/${encodeURIComponent(c.name)}">${phHtml(c.photo, c.name)}</div>
  <span class="col-name">${esc(c.name)}</span><span class="col-count">${c.groups.length} piece${c.groups.length > 1 ? "s" : ""}</span></a>`;

/* ---------- shop (search, filters, sort) ---------- */
function parseShopQuery() {
  const q = new URLSearchParams((location.hash.split("?")[1]) || "");
  S.f = { q: q.get("q") || "", cat: q.get("cat") || "", col: "", price: q.get("price") || "", ready: q.get("ready") === "1", sort: q.get("sort") || "popular" };
}
function shopHash(f = S.f) {
  const q = new URLSearchParams();
  if (f.q) q.set("q", f.q); if (f.cat) q.set("cat", f.cat); if (f.price) q.set("price", f.price);
  if (f.ready) q.set("ready", "1"); if (f.sort && f.sort !== "popular") q.set("sort", f.sort);
  const s = q.toString(); return "#/shop" + (s ? "?" + s : "");
}
function renderShop(opts = {}) {
  if (S.loading || S.error) return renderState();
  const f = S.f, list = filtered(f), cats = categories().map(c => c.name);
  const nActive = (f.price ? 1 : 0) + (f.ready ? 1 : 0);
  const title = opts.col ? opts.col : f.cat ? plural(f.cat) : "Shop";
  $("#view").innerHTML = `
    ${opts.col ? `<div class="page-head"><a class="back" href="#/collections">${I.back} Collections</a></div>` : ""}
    <h1 class="page-title">${esc(title)}</h1>
    ${opts.col ? "" : `<div class="searchbar"><span aria-hidden="true">${I.search}</span>
      <input id="q" type="search" placeholder="Search earrings, TLV, rings…" value="${esc(f.q)}" autocomplete="off" enterkeyhint="search" aria-label="Search products">
    </div>
    <div class="chips" role="toolbar" aria-label="Categories">
      <button class="chip" type="button" data-cat="" aria-pressed="${!f.cat}">All</button>
      ${cats.map(c => `<button class="chip" type="button" data-cat="${esc(c)}" aria-pressed="${f.cat === c}">${esc(plural(c))}</button>`).join("")}
    </div>`}
    <div class="toolbar">
      <span class="count" id="count">${list.length} piece${list.length === 1 ? "" : "s"}</span>
      <button class="filter-btn" type="button" id="openFilters">${I.filter} Filter &amp; sort${nActive ? ` <b>${nActive}</b>` : ""}</button>
    </div>
    <div id="results">${list.length ? grid(list) : emptyState(f.q ? `Nothing found for “${esc(f.q)}”.` : "No pieces match these filters.", `<button class="btn ghost" type="button" id="clearAll">Clear filters</button>`)}</div>`;
  const q = $("#q");
  if (q) {
    q.oninput = () => { S.f.q = q.value; clearTimeout(q.t); q.t = setTimeout(() => { history.replaceState(null, "", shopHash()); drawResults(); }, 120); };
    if (opts.focus) q.focus();
  }
  $$("[data-cat]").forEach(b => b.onclick = () => { S.f.cat = b.dataset.cat; history.replaceState(null, "", shopHash()); renderShop(); });
  $("#openFilters").onclick = () => openFilters(opts);
  const ca = $("#clearAll"); if (ca) ca.onclick = () => { S.f = { ...S.f, q: "", price: "", ready: false }; if (!opts.col) history.replaceState(null, "", shopHash()); renderShop(opts); };
  function drawResults() {
    const l = filtered();
    $("#count").textContent = `${l.length} piece${l.length === 1 ? "" : "s"}`;
    $("#results").innerHTML = l.length ? grid(l) : emptyState(`Nothing found for “${esc(S.f.q)}”.`, `<button class="btn ghost" type="button" id="clearAll">Clear search</button>`);
    const c = $("#clearAll"); if (c) c.onclick = () => { S.f.q = ""; q.value = ""; history.replaceState(null, "", shopHash()); drawResults(); };
  }
}
function openFilters(opts) {
  const f = { ...S.f };
  const draw = () => `
    <div class="sheet-grip"></div>
    <button class="sheet-close" type="button" aria-label="Close">${I.close}</button>
    <div class="sheet-body">
      <h2 id="sheetTitle">Filter &amp; sort</h2>
      <p class="label">Sort by</p>
      <div class="opt-list">${SORTS.map(([k, l]) => `<button type="button" class="opt" data-sort="${k}" aria-pressed="${f.sort === k}">${l}</button>`).join("")}</div>
      <p class="label">Price</p>
      <div class="opt-list">${PRICES.map(([k, l]) => `<button type="button" class="opt" data-price="${k}" aria-pressed="${f.price === k}">${l}</button>`).join("")}</div>
      <p class="label">Availability</p>
      <div class="opt-list"><button type="button" class="opt" data-ready="0" aria-pressed="${!f.ready}">All pieces</button><button type="button" class="opt" data-ready="1" aria-pressed="${f.ready}">Ready to ship only</button></div>
      <div class="sheet-actions">
        <button type="button" class="btn ghost" id="reset">Reset</button>
        <button type="button" class="btn grow" id="apply">Show ${filtered({ ...f, col: opts.col || "" }).length} pieces</button>
      </div>
    </div>`;
  const bind = () => {
    const sh = $("#sheet");
    sh.querySelector(".sheet-close").onclick = () => closeLayers();
    $$("[data-sort]", sh).forEach(b => b.onclick = () => { f.sort = b.dataset.sort; redraw(); });
    $$("[data-price]", sh).forEach(b => b.onclick = () => { f.price = b.dataset.price; redraw(); });
    $$("[data-ready]", sh).forEach(b => b.onclick = () => { f.ready = b.dataset.ready === "1"; redraw(); });
    $("#reset").onclick = () => { f.sort = "popular"; f.price = ""; f.ready = false; redraw(); };
    $("#apply").onclick = () => {
      S.f = { ...S.f, sort: f.sort, price: f.price, ready: f.ready };
      closeLayers(true);
      if (!opts.col) history.replaceState(null, "", shopHash());
      renderShop(opts);
    };
  };
  const redraw = () => { $("#sheet").innerHTML = draw(); bind(); };
  openLayer($("#sheet"), draw()); bind();
}

/* ---------- collections ---------- */
function renderCollections() {
  if (S.loading || S.error) return renderState();
  const cols = collections();
  $("#view").innerHTML = `<h1 class="page-title">Collections</h1>
    <p class="lead muted">Each collection shares a motif, so pieces wear well together.</p>
    ${cols.length ? `<div class="col-grid">${cols.map(colTile).join("")}</div>` : emptyState("Collections are coming soon.")}`;
}
function renderCollection(name) {
  if (S.loading || S.error) return renderState();
  S.f = { q: "", cat: "", col: name, price: "", ready: false, sort: "popular" };
  renderShop({ col: name });
}

/* ---------- product page ---------- */
function renderProduct(id, pickSku) {
  if (S.loading || S.error) return renderState();
  const g = groupOf(id);
  if (!g) { $("#view").innerHTML = emptyState("This piece is no longer available.", `<a class="btn ghost" href="#/shop">Browse the shop</a>`); return; }
  let sel = g.items.find(i => i.sku === pickSku) || g.items.find(i => i.ready) || g.items[0], qty = 1;
  const s = S.settings, rel = related(g), rates = s.rates || {};
  const details = [
    ["Material", g.material], ["Dimensions", g.dimensions],
    ["Sizes", g.items.length > 1 ? g.items.map(i => i.label).join(", ") : plainSize(sel.size) ? (sel.size && !/^free$/i.test(sel.size) ? sel.size : "") : sel.size],
    ["Collection", g.collection], ["Category", g.category]
  ].filter(d => d[1]);
  document.title = `${g.name} · Apolaki`;
  $("#view").innerHTML = `
    <div class="page-head"><a class="back" href="#/shop">${I.back} Shop</a></div>
    <div class="pd">
      <div class="gallery">
        <div class="main-ph${g.photo ? "" : " empty"}">
          ${g.photo ? `<button type="button" class="zoom-btn" id="zoom" aria-label="Zoom photo"><img id="mainImg" src="${esc(g.photo)}" alt="${esc(g.name)}"><span class="zoom-hint">${I.zoom}</span></button>` : `<img src="logo.png" alt="">`}
          <button class="heart big" type="button" data-wish="${esc(g.id)}" aria-pressed="${wished(g)}" aria-label="${wished(g) ? "Remove from wishlist" : "Save to wishlist"}">${I.heart}</button>
        </div>
        ${g.photos.length > 1 ? `<div class="thumbs">${g.photos.map((p, i) => `<button type="button" class="thumb" data-img="${i}" aria-pressed="${i === 0}" aria-label="Photo ${i + 1}"><img src="${esc(p)}" alt=""></button>`).join("")}</div>` : ""}
      </div>
      <div class="info">
        <p class="cat">${esc(g.category)}${g.collection ? " · " + esc(g.collection) : ""}</p>
        <h1 class="pd-name">${esc(g.name)}</h1>
        <p class="big-price" id="price">${RM(sel.price)}</p>
        ${g.items.length > 1 ? `<p class="label">Size</p><div class="size-row" role="radiogroup" aria-label="Size">${g.items.map(i => `<button class="size" type="button" role="radio" data-sku="${esc(i.sku)}" aria-checked="${i.sku === sel.sku}">${esc(i.label)}</button>`).join("")}</div>` : ""}
        <div id="avail">${availBox(sel.ready)}</div>
        <div class="buy" id="buy">
          <div class="qty" aria-label="Quantity"><button type="button" data-q="-1" aria-label="Fewer">−</button><span id="qty">1</span><button type="button" data-q="1" aria-label="More">+</button></div>
          <button class="btn grow" type="button" id="add">Add to cart</button>
        </div>
        ${g.description ? `<p class="desc">${esc(g.description)}</p>` : ""}
        ${details.length ? `<dl class="details">${details.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : ""}
        <details class="acc" open><summary>Delivery</summary><div>
          <ul class="plain">${REGIONS.filter(r => r.id !== "overseas" && rates[r.id] != null).map(r => `<li><span>${esc(r.short)}</span><span>${RM(rates[r.id])}</span></li>`).join("")}<li><span>Overseas</span><span>Quoted on WhatsApp</span></li></ul>
          <p>Made-to-order pieces are handmade after payment and shipped within ${lead()}. Ready pieces are posted soon after payment. You'll get the tracking number on WhatsApp.</p>
        </div></details>
        ${s.returns_text ? `<details class="acc"><summary>Returns &amp; exchanges</summary><div><p class="pre">${esc(s.returns_text)}</p></div></details>` : ""}
        <details class="acc"><summary>Payment</summary><div><p>Pay by DuitNow QR or bank transfer after you place your order, then send the receipt on WhatsApp. No account needed.</p></div></details>
        ${waNum() ? `<a class="ask" href="https://wa.me/${waNum()}?text=${encodeURIComponent(`Hi Apolaki! I have a question about ${g.name}.`)}" target="_blank" rel="noopener">${I.wa} Ask about this piece</a>` : ""}
      </div>
    </div>
    ${rel.look.length ? `<section class="sec"><div class="sec-head"><h2>Complete the look</h2>${g.collection ? `<a href="#/c/${encodeURIComponent(g.collection)}">${esc(g.collection)} collection</a>` : ""}</div>${rail(rel.look)}</section>` : ""}
    ${rel.like.length ? `<section class="sec"><div class="sec-head"><h2>You may also like</h2></div>${rail(rel.like)}</section>` : ""}
    <div class="sticky-buy" id="stickyBuy" hidden><div><strong id="sbName">${esc(g.name)}${sel.label ? " · " + esc(sel.label) : ""}</strong><span id="sbPrice">${RM(sel.price)}</span></div><button class="btn" type="button" id="add2">Add to cart</button></div>`;

  const upd = () => {
    $("#price").textContent = RM(sel.price * qty);
    $("#qty").textContent = qty;
    $("#avail").innerHTML = availBox(sel.ready);
    $$("[data-sku]").forEach(b => b.setAttribute("aria-checked", b.dataset.sku === sel.sku));
    $("#sbName").textContent = g.name + (sel.label ? " · " + sel.label : "");
    $("#sbPrice").textContent = RM(sel.price * qty);
    const ph = photoUrl(sel.photo); if (ph && $("#mainImg")) { $("#mainImg").src = ph; $$(".thumb").forEach(t => t.setAttribute("aria-pressed", g.photos[t.dataset.img] === ph)); }
  };
  $$("[data-sku]").forEach(b => b.onclick = () => { sel = g.items.find(i => i.sku === b.dataset.sku); upd(); });
  $$("[data-q]").forEach(b => b.onclick = () => { qty = Math.min(10, Math.max(1, qty + Number(b.dataset.q))); upd(); });
  $$(".thumb").forEach(t => t.onclick = () => { $("#mainImg").src = g.photos[t.dataset.img]; $$(".thumb").forEach(x => x.setAttribute("aria-pressed", x === t)); });
  const add = () => {
    const l = S.basket.find(x => x.sku === sel.sku);
    if (l) l.qty = Math.min(10, l.qty + qty); else S.basket.push({ sku: sel.sku, qty });
    saveBasket();
    showAdded(g, sel, qty);
  };
  $("#add").onclick = add; $("#add2").onclick = add;
  const z = $("#zoom"); if (z) z.onclick = () => openZoom(g.photos, Math.max(0, g.photos.indexOf($("#mainImg").src)));
  /* sticky Add to cart once the main button scrolls away (mobile) */
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(([e]) => { const sb = $("#stickyBuy"); if (sb) sb.hidden = e.isIntersecting || e.boundingClientRect.top > 0; });
    io.observe($("#buy")); S.io = io;
  }
}
function showAdded(g, sel, qty) {
  const n = S.basket.reduce((t, l) => t + l.qty, 0);
  openLayer($("#sheet"), `
    <div class="sheet-grip"></div>
    <button class="sheet-close" type="button" aria-label="Close">${I.close}</button>
    <div class="sheet-body added">
      <p class="ok">${I.tick} Added to cart</p>
      <div class="line">${phHtml(g.photo, "", "ph")}</div><div><h4>${esc(g.name)}</h4><div class="sub">${sel.label ? "Size " + esc(sel.label) + " · " : ""}Qty ${qty}</div></div><strong>${RM(sel.price * qty)}</strong></div>
      <div class="sheet-actions">
        <button type="button" class="btn ghost" id="keep">Keep shopping</button>
        <a class="btn grow" href="#/cart" id="goCart">View cart (${n})</a>
      </div>
    </div>`);
  $("#sheet .sheet-close").onclick = () => closeLayers(); $("#keep").onclick = () => closeLayers();
  bumpCart();
}
function bumpCart() { $$(".nav-cart").forEach(b => { b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump"); }); }

/* ---------- zoom viewer: tap / double-tap to zoom, pinch, drag, swipe ---------- */
function openZoom(photos, idx) {
  const el = $("#zoomer");
  let i = idx, sc = 1, tx = 0, ty = 0;
  el.innerHTML = `<button class="z-close" type="button" aria-label="Close">${I.close}</button>
    ${photos.length > 1 ? `<button class="z-nav prev" type="button" aria-label="Previous photo">${I.back}</button><button class="z-nav next" type="button" aria-label="Next photo">${I.next}</button>` : ""}
    <div class="z-stage"><img alt=""></div><p class="z-hint">Pinch or double-tap to zoom</p>`;
  el.hidden = false; document.body.classList.add("locked");
  const img = el.querySelector("img"), stage = el.querySelector(".z-stage");
  const apply = () => { img.style.transform = `translate(${tx}px, ${ty}px) scale(${sc})`; };
  const show = () => { img.src = photos[i]; sc = 1; tx = ty = 0; apply(); };
  const close = () => { el.hidden = true; el.innerHTML = ""; document.body.classList.remove("locked"); document.removeEventListener("keydown", key); };
  const go = d => { i = (i + d + photos.length) % photos.length; show(); };
  const key = e => { if (e.key === "Escape") close(); if (e.key === "ArrowRight") go(1); if (e.key === "ArrowLeft") go(-1); };
  document.addEventListener("keydown", key);
  el.querySelector(".z-close").onclick = close;
  $$(".z-nav", el).forEach(b => b.onclick = () => go(b.classList.contains("next") ? 1 : -1));
  const pts = new Map(); let start = null, lastTap = 0;
  stage.addEventListener("pointerdown", e => { stage.setPointerCapture(e.pointerId); pts.set(e.pointerId, e); start = { sc, tx, ty, pts: [...pts.values()].map(p => ({ x: p.clientX, y: p.clientY })) }; });
  stage.addEventListener("pointermove", e => {
    if (!pts.has(e.pointerId) || !start) return; pts.set(e.pointerId, e);
    const now = [...pts.values()].map(p => ({ x: p.clientX, y: p.clientY }));
    if (now.length >= 2 && start.pts.length >= 2) {
      const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
      sc = Math.min(5, Math.max(1, start.sc * d(now[0], now[1]) / d(start.pts[0], start.pts[1]))); apply();
    } else if (now.length === 1 && start.pts.length === 1) {
      const dx = now[0].x - start.pts[0].x, dy = now[0].y - start.pts[0].y;
      if (sc > 1) { tx = start.tx + dx; ty = start.ty + dy; apply(); } else { img.style.transform = `translateX(${dx}px)`; }
    }
  });
  const up = e => {
    if (!pts.has(e.pointerId)) return;
    const s0 = start, p0 = s0 && s0.pts[0];
    pts.delete(e.pointerId);
    if (pts.size) { start = { sc, tx, ty, pts: [...pts.values()].map(p => ({ x: p.clientX, y: p.clientY })) }; return; }
    if (s0 && s0.pts.length === 1 && p0) {
      const dx = e.clientX - p0.x, dy = e.clientY - p0.y, moved = Math.hypot(dx, dy) > 10;
      if (sc === 1 && moved && Math.abs(dx) > 60 && photos.length > 1) { go(dx < 0 ? 1 : -1); start = null; return; }
      if (!moved) {
        const t = Date.now();
        if (t - lastTap < 320 || e.pointerType === "mouse") {
          if (sc > 1) { sc = 1; tx = ty = 0; }
          else { const r = img.getBoundingClientRect(); sc = 2.5; tx = (r.left + r.width / 2 - e.clientX) * 1.5; ty = (r.top + r.height / 2 - e.clientY) * 1.5; }
          apply(); lastTap = 0;
        } else lastTap = t;
      }
    }
    if (sc <= 1) { sc = 1; tx = ty = 0; apply(); }
    start = null;
  };
  stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up);
  show();
}

/* ---------- wishlist ---------- */
function renderWishlist() {
  if (S.loading || S.error) return renderState();
  const list = S.wish.map(groupOf).filter(Boolean);
  $("#view").innerHTML = `<h1 class="page-title">Wishlist</h1>
    ${list.length ? `<p class="lead muted">Saved on this phone. Tap a piece to choose a size and add it to your cart.</p>${grid(list)}`
      : emptyState("Tap the heart on any piece to save it here.", `<a class="btn" href="#/shop">Browse the shop</a>`)}`;
}

/* ---------- cart ---------- */
function renderCart() {
  if (S.loading || S.error) return renderState();
  const lines = basketLines();
  const ship = Object.values(S.settings.rates || {}).map(Number).filter(n => !isNaN(n));
  $("#view").innerHTML = `<h1 class="page-title">Cart</h1>
    ${lines.length ? `<div class="cart">
      <div class="panel lines">${lines.map(l => `<div class="line">
        <a href="#/p/${encodeURIComponent(l.g.id)}">${phHtml(l.g.photo, "", "ph")}</div></a>
        <div><h4><a href="#/p/${encodeURIComponent(l.g.id)}">${esc(l.g.name)}</a></h4><div class="sub">${l.p.label ? "Size " + esc(l.p.label) + " · " : ""}${l.p.ready ? "Ready to ship" : "Made to order"}</div>
          <div class="qty sm"><button type="button" data-dq="-1" data-s="${esc(l.sku)}" aria-label="Fewer">−</button><span>${l.qty}</span><button type="button" data-dq="1" data-s="${esc(l.sku)}" aria-label="More" ${l.qty >= 10 ? "disabled" : ""}>+</button></div></div>
        <div class="right"><strong>${RM(l.qty * l.p.price)}</strong><button class="rm" type="button" data-rm="${esc(l.sku)}">Remove</button></div>
      </div>`).join("")}</div>
      <div class="panel summary">
        <div class="sumrow"><span>Subtotal</span><strong>${RM(subtotal())}</strong></div>
        <div class="sumrow muted"><span>Shipping</span><span>${ship.length ? `From ${RM(Math.min(...ship))}` : "At checkout"}</span></div>
        <a class="btn block" href="#/checkout">Checkout</a>
        <p class="small muted center">No account needed · Pay by DuitNow or transfer</p>
      </div>
    </div>` : emptyState("Your cart is empty.", `<a class="btn" href="#/shop">Start shopping</a>`)}`;
  $$("[data-dq]").forEach(b => b.onclick = () => { const l = S.basket.find(x => x.sku === b.dataset.s); l.qty = Math.min(10, l.qty + Number(b.dataset.dq)); saveBasket(); renderCart(); });
  $$("[data-rm]").forEach(b => b.onclick = () => { S.basket = S.basket.filter(x => x.sku !== b.dataset.rm); saveBasket(); renderCart(); toast("Removed"); });
}

/* ---------- checkout ---------- */
const form = store.get("details", { region: "semenanjung" });
function renderCheckout(errMsg) {
  if (S.loading || S.error) return renderState();
  const lines = basketLines();
  if (!lines.length) { location.hash = "#/cart"; return; }
  if (!store.get("checkoutRef", null)) store.set("checkoutRef", uid());   /* one reference per order: a double tap can't create two orders */
  const ship = rate(form.region), sub = subtotal(), anyMade = lines.some(l => !l.p.ready);
  const f = k => esc(form[k] || "");
  $("#view").innerHTML = `
    <div class="page-head"><a class="back" href="#/cart">${I.back} Cart</a></div>
    <h1 class="page-title">Checkout</h1>
    <form class="checkout" id="co" novalidate>
      <div>
        <div class="panel">
          <h3>Contact</h3>
          <div class="field"><label for="name">Full name</label><input id="name" name="name" autocomplete="name" required value="${f("name")}"></div>
          <div class="field"><label for="phone">WhatsApp number</label><input id="phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" placeholder="012-345 6789" required value="${f("phone")}"></div>
          <details class="more"${form.email ? " open" : ""}><summary>Add email for a receipt (optional)</summary>
            <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="email" value="${f("email")}"></div></details>
        </div>
        <div class="panel">
          <h3>Delivery</h3>
          <div class="regions" role="radiogroup" aria-label="Ship to">${REGIONS.map(r => `
            <label class="region"><span class="l"><input type="radio" name="region" value="${r.id}" ${form.region === r.id ? "checked" : ""}>${esc(r.name)}</span>
              <span class="fee">${r.id === "overseas" ? "Quoted" : RM(rate(r.id))}</span></label>`).join("")}</div>
          ${form.region === "overseas" ? `<div class="field"><label for="country">Country</label><input id="country" name="country" autocomplete="country-name" required value="${f("country")}"></div>
            <p class="note">Overseas postage depends on the country. We'll WhatsApp you the shipping cost before you pay.</p>` : ""}
          <div class="field"><label for="address">Address</label><textarea id="address" name="address" autocomplete="street-address" rows="2" required>${f("address")}</textarea></div>
          <div class="two">
            <div class="field"><label for="postcode">Postcode</label><input id="postcode" name="postcode" autocomplete="postal-code" inputmode="numeric" value="${f("postcode")}"></div>
            <div class="field"><label for="city">City</label><input id="city" name="city" autocomplete="address-level2" value="${f("city")}"></div>
          </div>
          <details class="more"${form.note ? " open" : ""}><summary>Add a note (optional)</summary>
            <div class="field"><label for="note">Note</label><textarea id="note" name="note" rows="2" placeholder="Gift message, size questions…">${f("note")}</textarea></div></details>
        </div>
      </div>
      <div class="panel summary">
        <h3>Order summary</h3>
        ${lines.map(l => `<div class="sline"><span class="n">${esc(l.g.name)}${l.p.label ? " (" + esc(l.p.label) + ")" : ""} × ${l.qty}<small>${l.p.ready ? "Ready to ship" : "Made to order"}</small></span><span>${RM(l.qty * l.p.price)}</span></div>`).join("")}
        <div class="totals">
          <div class="sumrow"><span>Subtotal</span><span>${RM(sub)}</span></div>
          <div class="sumrow"><span>Shipping</span><span>${ship == null ? "To be quoted" : RM(ship)}</span></div>
          <div class="sumrow total"><span>Total</span><span>${RM(sub + (ship || 0))}${ship == null ? " + shipping" : ""}</span></div>
        </div>
        ${anyMade ? `<p class="note">Made-to-order pieces are handmade after payment and shipped within ${lead()}.</p>` : ""}
        <p class="note">Next you'll see our DuitNow QR and bank details. Pay, then send the receipt on WhatsApp.</p>
        ${errMsg ? `<p class="err" role="alert">${esc(errMsg)}</p>` : ""}
        <button class="btn block" type="submit" id="place">Place order · ${RM(sub + (ship || 0))}</button>
      </div>
    </form>`;
  const co = $("#co");
  co.addEventListener("input", e => { if (e.target.name && e.target.name !== "region") { form[e.target.name] = e.target.value; store.set("details", form); } });
  $$("[name=region]", co).forEach(r => r.onchange = () => { form.region = r.value; store.set("details", form); renderCheckout(); });
  co.onsubmit = async e => {
    e.preventDefault();
    const btn = $("#place"); if (btn.disabled) return;
    const need = ["name", "phone", "address", ...(form.region === "overseas" ? ["country"] : [])];
    const miss = need.find(k => !String(form[k] || "").trim());
    if (miss) { renderCheckout("Please fill in your " + ({ name: "name", phone: "WhatsApp number", address: "address", country: "country" }[miss]) + "."); $("#" + miss).focus(); return; }
    if (String(form.phone).replace(/\D/g, "").length < 9) { renderCheckout("Please check your WhatsApp number."); $("#phone").focus(); return; }
    btn.disabled = true; btn.textContent = "Placing order…";
    try {
      const res = await rpc("shop_place_order", { p: { ...form, ref: store.get("checkoutRef", null), items: S.basket.map(l => ({ sku: l.sku, qty: l.qty })) } });
      const order = { ...res, region: form.region, country: form.country, name: form.name, phone: form.phone,
        address: [form.address, [form.postcode, form.city].filter(Boolean).join(" "), form.region === "overseas" ? form.country : ""].filter(Boolean).join(", ") };
      store.set("lastOrder", order); store.del("checkoutRef");
      S.basket = []; saveBasket();
      location.hash = "#/order";
    } catch (err) { renderCheckout(err.message); }
  };
}

/* ---------- confirmation ---------- */
function waLink(o) {
  const num = waNum(); if (!num) return null;
  const region = (REGIONS.find(r => r.id === o.region) || {}).short || o.region;
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
  if (S.loading) return renderState();
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
        <li><div><h4>We make &amp; ship it</h4><p class="muted">${o.items.some(i => !i.ready) ? `Made-to-order pieces ship within ${lead()} after payment.` : "Ready pieces are posted soon after payment."} You'll get the tracking number on WhatsApp.</p></div></li>
      </ol>
      <div class="panel">
        <h3>Your order</h3>
        ${o.items.map(i => `<div class="sline"><span class="n">${esc(nice(baseName(i.name)))}${sizeShort(i.size) ? " (" + sizeShort(i.size) + ")" : ""} × ${i.qty}<small>${i.ready ? "Ready to ship" : "Made to order"}</small></span><span>${RM(i.qty * i.price)}</span></div>`).join("")}
        <div class="totals"><div class="sumrow"><span>Shipping</span><span>${quote ? "To be quoted" : RM(o.shipping_fee)}</span></div>
        <div class="sumrow total" style="margin-bottom:0"><span>Total</span><span>${RM(o.total)}${quote ? " + shipping" : ""}</span></div></div>
      </div>
      <p style="margin-top:22px"><a href="#/" class="btn ghost">Back to the shop</a></p>
    </section>`;
  $$("[data-copy]").forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast("Copied"); } catch { toast(b.dataset.copy); } });
}

/* ---------- loading / error ---------- */
function renderState() {
  $("#view").innerHTML = S.error
    ? emptyState(esc(S.error), `<button class="btn ghost" type="button" id="retry">Try again</button>`)
    : `<div class="line" style="height:180px;border-radius:18px;margin:16px 0"></div>${skeleton(6)}`;
  const r = $("#retry"); if (r) r.onclick = load;
}

/* ---------- overlays ---------- */
let lastFocus = null;
function openLayer(el, html) {
  closeLayers(true);
  lastFocus = document.activeElement;
  el.innerHTML = html; el.hidden = false; $("#overlay").hidden = false; document.body.classList.add("locked");
  const f = el.querySelector(".sheet-body button, .sheet-body a, button"); if (f) f.focus({ preventScroll: true });
}
function closeLayers(silent) {
  const sh = $("#sheet"); sh.hidden = true; sh.innerHTML = "";
  $("#overlay").hidden = true;
  if ($("#zoomer").hidden) document.body.classList.remove("locked");
  if (!silent && lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
}
$("#overlay").onclick = () => closeLayers();
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#sheet").hidden) closeLayers(); });

/* ---------- routing ---------- */
function route() {
  closeLayers(true);
  if (S.io) { S.io.disconnect(); S.io = null; }
  const h = location.hash || "#/", path = h.split("?")[0];
  $("#view").focus({ preventScroll: true });   /* move focus to the new page (before rendering, so a search box can take it) */
  document.title = "Apolaki · Handmade brass jewellery";
  let tab = "home", m;
  if (path === "#/shop") { parseShopQuery(); renderShop({ focus: /[?&]focus=1/.test(h) }); tab = "shop"; }
  else if (path === "#/collections") { renderCollections(); tab = "collections"; }
  else if ((m = path.match(/^#\/c\/(.+)$/))) { renderCollection(decodeURIComponent(m[1])); tab = "collections"; }
  else if ((m = path.match(/^#\/(?:p|item)\/(.+)$/))) { renderProduct(decodeURIComponent(m[1])); tab = "shop"; }
  else if (path === "#/wishlist") { renderWishlist(); tab = "wishlist"; }
  else if (path === "#/cart") { renderCart(); tab = "cart"; }
  else if (path === "#/checkout") { renderCheckout(); tab = "cart"; }
  else if (path === "#/order") { renderDone(); tab = ""; }
  else renderHome();
  $$("[data-tab]").forEach(a => a.toggleAttribute("aria-current", a.dataset.tab === tab));
  document.body.classList.toggle("on-product", path.startsWith("#/p/") || path.startsWith("#/item/"));
  document.body.classList.toggle("on-checkout", path === "#/checkout");
  if (!/[?&]keep=1/.test(h)) window.scrollTo(0, 0);
}
window.addEventListener("hashchange", route);
document.addEventListener("click", e => {
  const w = e.target.closest("[data-wish]"); if (w) { e.preventDefault(); toggleWish(w.dataset.wish); return; }
  const sb = e.target.closest("[data-search]"); if (sb) { e.preventDefault(); if (location.hash.startsWith("#/shop")) { const q = $("#q"); if (q) q.focus(); } else location.hash = "#/shop?focus=1"; }
});
/* a missing photo falls back to the logo placeholder */
document.addEventListener("error", e => {
  const img = e.target;
  if (img.tagName !== "IMG" || img.dataset.fb || !img.closest(".ph, .main-ph")) return;
  img.dataset.fb = "1"; img.alt = ""; img.src = "logo.png"; img.closest(".ph, .main-ph").classList.add("empty");
}, true);
window.addEventListener("scroll", () => $(".top").classList.toggle("scrolled", window.scrollY > 4), { passive: true });

function footer() {
  const s = S.settings, wa = waNum(), rates = s.rates || {};
  $("#footInfo").innerHTML = `
    <div><h4>Contact</h4>${wa ? `<p><a href="https://wa.me/${wa}" target="_blank" rel="noopener">WhatsApp ${esc(s.whatsapp)}</a></p>` : ""}<p class="muted">Questions about sizes or custom pieces are welcome.</p></div>
    <div><h4>Delivery</h4><ul class="plain">${REGIONS.filter(r => r.id !== "overseas" && rates[r.id] != null).map(r => `<li><span>${esc(r.short)}</span><span>${RM(rates[r.id])}</span></li>`).join("")}<li><span>Overseas</span><span>Quoted</span></li></ul>
      <p class="muted">Made-to-order pieces ship within ${lead()}.</p></div>
    <div><h4>Payment</h4><p class="muted">DuitNow QR or bank transfer. No account needed.</p>${s.returns_text ? `<h4>Returns</h4><p class="muted pre">${esc(s.returns_text)}</p>` : ""}</div>`;
}

async function load() {
  S.loading = true; S.error = ""; route();
  try {
    const [cat, set] = await Promise.all([rpc("shop_catalog"), rpc("shop_settings")]);
    S.products = cat || []; S.settings = set || {}; S.groups = groupProducts(S.products);
    footer();
  } catch (e) { S.error = "We couldn't load the shop just now. Please check your connection."; }
  S.loading = false; saveBasket(); saveWish(); route();
}
saveBasket(); saveWish();
load();
})();

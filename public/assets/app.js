/* 餐饮图鉴 · 前台 */
"use strict";

const $ = s => document.querySelector(s);
const state = { q: "", category: "", sort: "updated", shops: [], categories: [], total: 0 };
const TOKEN_KEY = "canyin_admin_token";
let token = localStorage.getItem(TOKEN_KEY) || "";
let publicAdd = true;
let addImages = [];

/* ---------- 小工具 ---------- */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
function stars(n) {
  const k = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  return '<span class="stars">' + "★".repeat(k) + '<span class="off">' + "★".repeat(5 - k) + "</span></span>";
}
function timeAgo(ms) {
  if (!ms) return "";
  const d = Math.floor((Date.now() - ms) / 1000);
  if (d < 60) return "刚刚";
  if (d < 3600) return Math.floor(d / 60) + " 分钟前";
  if (d < 86400) return Math.floor(d / 3600) + " 小时前";
  if (d < 86400 * 30) return Math.floor(d / 86400) + " 天前";
  return new Date(ms).toLocaleDateString("zh-CN");
}
function coverTag(url, name, cls) {
  const ch = esc((name || "食").slice(0, 1));
  return '<div class="' + (cls || "cover") + '">' +
    '<div class="ph">' + ch + "</div>" +
    (url ? '<img src="' + esc(imgSrc(url, 640)) + '" alt="' + esc(name) + '" onerror="coverFallback(this)">' : "") +
    "</div>";
}
/* 本地图片换成小图（?w=），外链原样返回；服务器没装 sharp 时 ?w= 会被忽略等价原图 */
function imgSrc(u, w) {
  if (!u || !w || !/^\/files\//.test(u)) return u;
  return u + "?w=" + w;
}
/* 封面加载失败兜底：改取该店详情的第一张图（列表 cover 与详情不一致时自动修复） */
function coverFallback(img) {
  if (img.dataset.tried) { img.remove(); return; }
  img.dataset.tried = "1";
  const card = img.closest(".card");
  const id = card && card.dataset.id;
  if (!id) { img.remove(); return; }
  fetch("/api/shops/" + encodeURIComponent(id))
    .then(r => (r.ok ? r.json() : null))
    .then(s => {
      const u = s && s.images && s.images[0];
      if (u && u !== img.getAttribute("src")) img.src = u;
      else img.remove();
    })
    .catch(() => img.remove());
}

function toast(msg, kind) {
  const el = document.createElement("div");
  el.className = "toast " + (kind || "");
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; }, 2400);
  setTimeout(() => el.remove(), 2800);
}

async function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  const t = opts.token === undefined ? token : opts.token;
  if (t) headers["x-admin-token"] = t;
  const init = { method: opts.method || "GET", headers, cache: "no-store" };
  if (opts.form) init.body = opts.form;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  const r = await fetch(path, init);
  let d = null;
  try { d = await r.json(); } catch (_) { /* 非 JSON */ }
  if (!r.ok) {
    const e = new Error((d && d.error) || ("请求失败（" + r.status + "）"));
    e.status = r.status;
    throw e;
  }
  return d;
}

function geoOf(s) {
  const lat = Number(s && s.lat);
  const lng = Number(s && s.lng);
  if (!s || String(s.lat).trim() === "" || String(s.lng).trim() === "") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}
function markerUrl(lat, lng, name, withApp) {
  const q = ["coordinate=gaode", "src=canyintujian"];
  if (lat !== undefined && lng !== undefined) {
    q.unshift("position=" + lng + "," + lat);
    if (name) q.push("name=" + encodeURIComponent(name));
  }
  if (withApp) q.push("callnative=1");
  return "https://uri.amap.com/marker?" + q.join("&");
}
function navUrl(lat, lng, name) {
  return "https://uri.amap.com/navigation?to=" + lng + "," + lat + "," + encodeURIComponent(name || "目的地") +
    "&mode=car&policy=1&src=canyintujian&coordinate=gaode&callnative=1";
}

/* ---------- 渲染 ---------- */
function renderStats(s) {
  $("#stats").innerHTML =
    '<div class="stat"><b>' + s.shops + '</b><span>家商家</span></div>' +
    '<div class="stat"><b>' + s.images + '</b><span>张实拍</span></div>' +
    '<div class="stat"><b>' + s.dishes + '</b><span>道招牌菜</span></div>' +
    '<div class="stat"><b>' + (s.avgRating || 0).toFixed(1) + '</b><span>平均分 / 5</span></div>';
}

function renderChips() {
  const all = ["全部"].concat(state.categories);
  $("#chips").innerHTML = all.map(c =>
    '<button class="chip' + ((state.category === c || (c === "全部" && !state.category)) ? " on" : "") +
    '" data-cat="' + esc(c) + '">' + esc(c) + "</button>"
  ).join("");
}

function renderList() {
  const grid = $("#grid");
  if (!state.shops.length) {
    grid.innerHTML = '<div class="empty"><div class="big">🥢</div>' +
      (state.q || state.category
        ? "<b>没找到符合条件的小店</b><p>换个关键词，或点「全部」看看别的。</p>"
        : "<b>册子还是空的</b><p>点右上角「＋ 登记商户」，或去「管理端」登记第一家店吧。</p>") + "</div>";
    return;
  }
  grid.innerHTML = state.shops.map(s => {
    const dishes = (s.dishes || []).slice(0, 3).map(d =>
      '<span class="dish">' + esc(d.name) + (d.price ? " ¥" + esc(d.price) : "") + "</span>"
    ).join("");
    return '<button class="card" data-id="' + esc(s.id) + '" aria-label="查看 ' + esc(s.name) + '">' +
      coverTag(s.cover, s.name) +
      (s.category ? '<span class="badge-cat">' + esc(s.category) + "</span>" : "") +
      (s.imageCount ? '<span class="badge-img">' + s.imageCount + " 张</span>" : "") +
      '<div class="body">' +
        "<h3>" + esc(s.name) + "</h3>" +
        '<div class="rate"><b>' + (s.rating || 0).toFixed(1) + "</b>" + stars(s.rating) +
          '<span style="color:var(--ink-3);font-size:12px">推荐 ' + (s.recommend || 0) + "/5</span></div>" +
        '<div class="addr">' + esc(s.address || "地址待补") + "</div>" +
        (dishes ? '<div class="dishes">' + dishes + "</div>" : "") +
        '<div class="foot"><span>' + esc(s.phone || "无电话") + "</span><span>" + timeAgo(s.updatedAt) + "</span></div>" +
      "</div></button>";
  }).join("");
}

/* ---------- 取数 ---------- */
async function load() {
  $("#count").textContent = "正在翻册子…";
  const qs = new URLSearchParams({ q: state.q, category: state.category, sort: state.sort, pageSize: "200" });
  try {
    const r = await fetch("/api/shops?" + qs);
    const d = await r.json();
    if (!r.ok) throw Object.assign(new Error(d.error || "加载失败"), { payload: d, status: r.status });
    state.shops = d.shops || [];
    state.categories = d.categories || [];
    state.total = d.total || 0;
    renderChips();
    renderList();
    $("#count").textContent = state.total
      ? "共 " + state.total + " 家" + (state.q || state.category ? "（已筛选）" : "") + " · 点卡片看详情"
      : "还没有记录";
  } catch (e) {
    $("#grid").innerHTML =
      '<div class="errorbox"><h3>没能连上数据库</h3>' +
      "<div>" + esc(e.message) + "</div>" +
      (e.payload && e.payload.hint ? '<div class="hint">' + esc(e.payload.hint) + "</div>" : "") +
      '<pre>1) 启动 MySQL：net start mysql（Windows）/ systemctl start mysql（Linux）\n' +
      "2) 建库导入：mysql -u root -p &lt; sql/schema.sql\n" +
      "3) 配好 .env 后重启：npm start</pre></div>";
    $("#count").textContent = "加载失败";
  }
}

async function loadStats() {
  try {
    const r = await fetch("/api/stats");
    if (r.ok) renderStats(await r.json());
  } catch (_) { /* 统计失败不影响列表 */ }
}

/* ---------- 详情 ---------- */
async function openDetail(id) {
  const overlay = $("#overlay");
  const sheet = $("#sheet");
  sheet.innerHTML = '<div style="padding:40px;text-align:center;color:var(--ink-3)">正在打开…</div>';
  overlay.classList.add("on");
  document.body.style.overflow = "hidden";
  try {
    const r = await fetch("/api/shops/" + encodeURIComponent(id));
    const s = await r.json();
    if (!r.ok) throw new Error(s.error || "打不开");
    sheet.innerHTML = detailHTML(s);
    detailShop = s;
    initCarousel((s.images || []).length);
    if (location.hash !== "#" + s.id) history.replaceState(null, "", "#" + s.id);
  } catch (e) {
    sheet.innerHTML = '<div style="padding:40px;text-align:center">' +
      '<p style="color:var(--wine)">' + esc(e.message) + "</p>" +
      '<button class="btn" onclick="closeDetail()">关闭</button></div>';
  }
}

function detailHTML(s) {
  const imgs = s.images || [];
  const n = imgs.length;
  const track = n
    ? '<div class="gal-track" id="galTrack">' + imgs.map((u, i) =>
        '<div class="gal-slide"><img src="' + esc(imgSrc(u, 1280)) + '" alt="' + esc(s.name) + " 图 " + (i + 1) + '"' +
        ' draggable="false" onerror="this.parentNode.style.display=\'none\'"></div>'
      ).join("") + "</div>"
    : '<div class="ph-main">' + esc((s.name || "食").slice(0, 1)) + "</div>";
  const arrows = n > 1
    ? '<button class="gal-nav prev" id="galPrev" type="button" aria-label="上一张">‹</button>' +
      '<button class="gal-nav next" id="galNext" type="button" aria-label="下一张">›</button>'
    : "";
  const dots = n > 1
    ? '<div class="gal-dots" id="galDots">' + imgs.map((_, i) =>
        '<span class="' + (i === 0 ? "on" : "") + '" data-i="' + i + '" role="button" aria-label="第 ' + (i + 1) + ' 张"></span>'
      ).join("") + "</div>"
    : "";
  const meta = n > 1
    ? '<div class="gal-meta"><span class="gal-count" id="galCount">1 / ' + n + "</span>" +
      '<button class="gal-cover-btn" id="galCoverBtn" type="button" title="把当前图片设为首页封面">设为封面</button></div>'
    : "";
  const main = '<div class="gal-main" id="galMain">' + track + arrows + dots + meta + "</div>";
  const thumbs = n > 1
    ? '<div class="thumbs" id="galThumbs">' + imgs.map((u, i) =>
        '<img src="' + esc(imgSrc(u, 320)) + '" alt="图 ' + (i + 1) + '" class="' + (i === 0 ? "on" : "") +
        '" data-i="' + i + '" onerror="this.remove()">').join("") + "</div>"
    : "";

  const dishes = (s.dishes || []).length
    ? '<div class="sect"><h4>招牌菜</h4><div class="dishgrid">' +
      s.dishes.map(d => '<div class="dishcard"><span>' + esc(d.name) + "</span><span>" +
        (d.price ? "¥" + esc(d.price) : "") + "</span></div>").join("") + "</div></div>"
    : "";

  const kv = [];
  if (s.address) kv.push("<dt>地址</dt><dd>" + esc(s.address) + "</dd>");
  if (s.phone) kv.push("<dt>电话</dt><dd><a href=\"tel:" + esc(s.phone.replace(/\s/g, "")) + "\">" + esc(s.phone) + "</a></dd>");
  if (s.hours) kv.push("<dt>营业</dt><dd>" + esc(s.hours) + "</dd>");
  kv.push("<dt>评分</dt><dd>" + (s.rating || 0).toFixed(1) + " / 5 " + stars(s.rating) + "</dd>");
  kv.push("<dt>推荐</dt><dd>" + "★".repeat(s.recommend || 0) + '<span style="color:#e2d6c6">' +
    "★".repeat(5 - (s.recommend || 0)) + "</span> " + (s.recommend || 0) + " / 5</dd>");
  const geo = geoOf(s);
  if (geo) {
    kv.push("<dt>位置</dt><dd>" + esc(s.lat) + ", " + esc(s.lng) +
      '<div class="geo-actions">' +
        '<a class="linkbtn primary" target="_blank" rel="noopener" href="' + navUrl(geo.lat, geo.lng, s.name) + '">高德导航</a>' +
        '<a class="linkbtn" target="_blank" rel="noopener" href="' + markerUrl(geo.lat, geo.lng, s.name, true) + '">查看地图</a>' +
      "</div>" +
      '<div class="hint">手机上点「高德导航」会直接唤起高德地图 App；未安装则打开网页版。</div></dd>');
  }

  return '<div class="gallery">' + main + thumbs +
    '<button class="close-x" onclick="closeDetail()" aria-label="关闭">×</button></div>' +
    '<div class="detail">' +
      '<div class="top"><h2>' + esc(s.name) + "</h2>" +
        (s.category ? '<span class="tag">' + esc(s.category) + "</span>" : "") + "</div>" +
      '<dl class="kv">' + kv.join("") + "</dl>" +
      (s.note ? '<div class="note">' + esc(s.note) + "</div>" : "") +
      dishes +
      '<div class="sect" style="color:var(--ink-3);font-size:12.5px">更新于 ' +
        new Date(s.updatedAt || Date.now()).toLocaleString("zh-CN") + " · 共 " + imgs.length + " 张图</div>" +
    "</div>";
}

function closeDetail() {
  galStop();
  $("#overlay").classList.remove("on");
  document.body.style.overflow = "";
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
}

/* ---------- 详情画廊轮播 ---------- */
let gal = null; // { n, idx, timer, paused }
let detailShop = null;

function galGo(i, byUser) {
  if (!gal || gal.n < 2) return;
  gal.idx = ((i % gal.n) + gal.n) % gal.n;
  const track = $("#galTrack");
  if (track) track.style.transform = "translateX(-" + gal.idx * 100 + "%)";
  document.querySelectorAll("#galDots span").forEach(d =>
    d.classList.toggle("on", Number(d.dataset.i) === gal.idx));
  const on = document.querySelector('#galThumbs img[data-i="' + gal.idx + '"]');
  document.querySelectorAll("#galThumbs img").forEach(t => t.classList.toggle("on", t === on));
  if (on && on.scrollIntoView)
    on.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  const c = $("#galCount");
  if (c) c.textContent = gal.idx + 1 + " / " + gal.n;
  if (byUser) galRestart();
}
function galNext(byUser) { if (gal) galGo(gal.idx + 1, byUser); }
function galPrev(byUser) { if (gal) galGo(gal.idx - 1, byUser); }
function galStop() {
  if (gal && gal.timer) { clearInterval(gal.timer); gal.timer = null; }
}
function galRestart() {
  galStop();
  if (!gal || gal.n < 2) return;
  gal.timer = setInterval(() => { if (!gal.paused) galGo(gal.idx + 1); }, 1000);
}

function initCarousel(n) {
  galStop();
  gal = { n, idx: 0, timer: null, paused: false };
  if (n < 2) return;

  $("#galPrev").addEventListener("click", () => galPrev(true));
  $("#galNext").addEventListener("click", () => galNext(true));
  const coverBtn = $("#galCoverBtn");
  if (coverBtn) coverBtn.addEventListener("click", setCoverFromDetail);
  $("#galDots").addEventListener("click", e => {
    const d = e.target.closest("span[data-i]");
    if (d) galGo(Number(d.dataset.i), true);
  });

  const main = $("#galMain");
  main.addEventListener("mouseenter", () => { gal.paused = true; });
  main.addEventListener("mouseleave", () => { gal.paused = false; });

  /* 手势左右滑动 */
  let sx = 0, dx = 0, touching = false;
  main.addEventListener("touchstart", e => {
    touching = true;
    sx = e.touches[0].clientX;
    dx = 0;
    gal.paused = true;
    $("#galTrack").classList.add("drag");
  }, { passive: true });
  main.addEventListener("touchmove", e => {
    if (!touching) return;
    dx = e.touches[0].clientX - sx;
    $("#galTrack").style.transform =
      "translateX(calc(-" + gal.idx * 100 + "% + " + dx + "px))";
  }, { passive: true });
  const endTouch = () => {
    if (!touching) return;
    touching = false;
    $("#galTrack").classList.remove("drag");
    if (Math.abs(dx) > 44) galGo(gal.idx + (dx < 0 ? 1 : -1), true);
    else galGo(gal.idx, true);
    gal.paused = false;
  };
  main.addEventListener("touchend", endTouch);
  main.addEventListener("touchcancel", endTouch);

  galRestart();
}

/* ---------- 详情页：把当前轮播图设为首页封面 ---------- */
async function ensureDetailToken() {
  if (token) return token;
  const t = (window.prompt("把这张图设为封面需要管理口令（服务器 .env 里的 ADMIN_TOKEN）") || "").trim();
  if (!t) return null;
  try {
    await api("/api/admin/verify", { method: "POST", token: t });
  } catch (e) {
    toast(e.status === 401 ? "口令不正确" : e.message, "err");
    return null;
  }
  token = t;
  localStorage.setItem(TOKEN_KEY, t);
  return t;
}

async function setCoverFromDetail() {
  if (!detailShop || !gal || gal.n < 2) return;
  const btn = $("#galCoverBtn");
  const imgs = detailShop.images || [];
  const cur = imgs[gal.idx];
  if (!cur) return;
  if (imgs[0] === cur) return toast("这张已经是封面了");

  const t = await ensureDetailToken();
  if (!t) return;

  const reordered = [cur].concat(imgs.filter((_, i) => i !== gal.idx));
  if (btn) { btn.disabled = true; btn.textContent = "设置中…"; }
  try {
    await api("/api/shops/" + detailShop.id, {
      method: "PUT",
      body: {
        name: detailShop.name,
        category: detailShop.category,
        address: detailShop.address,
        phone: detailShop.phone,
        hours: detailShop.hours,
        note: detailShop.note,
        lat: detailShop.lat,
        lng: detailShop.lng,
        rating: detailShop.rating,
        recommend: detailShop.recommend,
        dishes: detailShop.dishes || [],
        images: reordered,
      },
    });
    toast("已设为封面", "ok");
    await openDetail(detailShop.id); // 重新渲染，封面图排到第一张
    load(); // 刷新首页卡片封面
  } catch (e) {
    toast("设置失败：" + e.message, "err");
    if (btn) { btn.disabled = false; btn.textContent = "设为封面"; }
  }
}

/* ---------- 事件 ---------- */
let timer;
$("#q").addEventListener("input", e => {
  clearTimeout(timer);
  const v = e.target.value.trim();
  timer = setTimeout(() => { state.q = v; load(); }, 240);
});
$("#sort").addEventListener("change", e => { state.sort = e.target.value; load(); });
$("#chips").addEventListener("click", e => {
  const b = e.target.closest(".chip");
  if (!b) return;
  const c = b.dataset.cat;
  state.category = c === "全部" ? "" : c;
  load();
});
$("#grid").addEventListener("click", e => {
  const card = e.target.closest(".card");
  if (card) openDetail(card.dataset.id);
});
$("#overlay").addEventListener("click", e => {
  if (e.target.id === "overlay") { closeDetail(); return; }
  const t = e.target.closest(".thumbs img");
  if (t) galGo(Number(t.dataset.i), true);
});
document.addEventListener("keydown", e => {
  if ($("#addDrawer").classList.contains("on")) {
    if (e.key === "Escape") closeAdd();
    return;
  }
  if (!$("#overlay").classList.contains("on")) return;
  if (e.key === "Escape") closeDetail();
  else if (e.key === "ArrowLeft") galPrev(true);
  else if (e.key === "ArrowRight") galNext(true);
});

/* ---------- 前台登记商户 ---------- */
$("#addBtn").addEventListener("click", openAdd);

function openAdd() {
  addImages = [];
  const cats = state.categories.map(c => '<option value="' + esc(c) + '">').join("");
  const rec = [0, 1, 2, 3, 4, 5].map(n => '<option value="' + n + '">' + n + " 星</option>").join("");

  $("#addPane").innerHTML =
    '<div class="pane-head"><h3>登记商户</h3><div style="flex:1"></div>' +
      '<button class="btn sm" type="button" onclick="closeAdd()">取消</button></div>' +
    '<div class="pane-body">' +
      '<div class="field token-box" id="af_tokenBox"' + (publicAdd || token ? " hidden" : "") + '>' +
        '<label>管理口令（新增商户需要）</label>' +
        '<input id="af_token" type="password" autocomplete="current-password" placeholder="服务器 .env 里的 ADMIN_TOKEN">' +
        '<p class="hint" id="af_tokenMsg">验证一次后，这台设备会记住口令。</p>' +
      "</div>" +
      '<div class="field"><label>店名 *</label><input id="af_name" maxlength="60" placeholder="老王牛肉面"></div>' +
      '<div class="row2">' +
        '<div class="field"><label>分类</label><input id="af_category" maxlength="20" list="af_catList" placeholder="面食 / 火锅 / 烧烤">' +
          '<datalist id="af_catList">' + cats + "</datalist></div>" +
        '<div class="field"><label>电话</label><input id="af_phone" maxlength="40" placeholder="0571-8888 1234"></div>' +
      "</div>" +
      '<div class="field"><label>地址</label><input id="af_address" maxlength="200" placeholder="解放路 128 号"></div>' +
      '<div class="row3">' +
        '<div class="field"><label>评分（0–5）</label><input id="af_rating" type="number" min="0" max="5" step="0.1" value="0"></div>' +
        '<div class="field"><label>推荐指数</label><select id="af_recommend">' + rec + "</select></div>" +
        '<div class="field"><label>营业时间</label><input id="af_hours" maxlength="60" placeholder="11:00 - 22:00"></div>' +
      "</div>" +
      '<div class="field">' +
        '<label>位置（点「获取当前位置」直接写入经纬度）</label>' +
        '<div class="geo-row">' +
          '<button class="btn" type="button" id="af_locate">📍 获取当前位置</button>' +
          '<span class="geo-status" id="af_geoMsg">还没定位，也可以手动填写坐标</span>' +
        "</div>" +
        '<div class="row2" style="margin-top:8px">' +
          '<input id="af_lat" inputmode="decimal" maxlength="20" placeholder="纬度 lat，如 30.2741000">' +
          '<input id="af_lng" inputmode="decimal" maxlength="20" placeholder="经度 lng，如 120.1551000">' +
        "</div>" +
        '<div class="geo-links">' +
          '<a class="linkbtn" id="af_mapLink" target="_blank" rel="noopener" href="' + markerUrl(undefined, undefined, "", true) + '">在高德地图确认位置</a>' +
          '<button class="linkbtn" type="button" id="af_geoClear">清除坐标</button>' +
        "</div>" +
        '<p class="hint">手机浏览器只允许在 HTTPS 页面获取定位；本地 localhost 不受此限制。高德导航链接会直接唤起手机上的高德地图 App。</p>' +
      "</div>" +
      '<div class="field"><label>招牌菜</label>' +
        '<div class="dish-rows" id="af_dishRows"></div>' +
        '<button class="btn sm" type="button" id="af_addDish" style="align-self:flex-start">＋ 再加一道</button>' +
      "</div>" +
      '<div class="field"><label>备注</label><textarea id="af_note" maxlength="1000" placeholder="什么时候去不用排队、什么必点…"></textarea></div>' +
      '<div class="field"><label>照片（可多选，第一张作封面；点小图可换封面）</label>' +
        '<div class="img-grid" id="af_imgGrid"></div>' +
        '<div style="margin-top:9px">' +
          '<label class="btn sm" style="display:inline-flex;align-items:center;margin:0">上传 / 拍照<input id="af_file" type="file" accept="image/*" multiple hidden></label>' +
        "</div>" +
      "</div>" +
    "</div>" +
    '<div class="pane-foot">' +
      '<button class="btn" type="button" onclick="closeAdd()">取消</button>' +
      '<button class="btn primary" type="button" id="af_save" onclick="saveAdd()">保存并查看</button>' +
    "</div>";

  addAddDishRow();
  renderAddImgs();
  updateMapLink();

  $("#af_locate").addEventListener("click", locateMe);
  $("#af_geoClear").addEventListener("click", () => {
    $("#af_lat").value = "";
    $("#af_lng").value = "";
    geoMsg("已清除坐标", "");
    updateMapLink();
  });
  $("#af_lat").addEventListener("input", updateMapLink);
  $("#af_lng").addEventListener("input", updateMapLink);
  $("#af_name").addEventListener("input", updateMapLink);
  $("#af_addDish").addEventListener("click", () => addAddDishRow());
  $("#af_file").addEventListener("change", uploadAddFiles);

  const drawer = $("#addDrawer");
  drawer.classList.add("on");
  drawer.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  setTimeout(() => { if (!token) $("#af_token").focus(); else $("#af_name").focus(); }, 80);
}

function closeAdd() {
  const drawer = $("#addDrawer");
  drawer.classList.remove("on");
  drawer.setAttribute("aria-hidden", "true");
  document.body.style.overflow = $("#overlay").classList.contains("on") ? "hidden" : "";
}

function geoMsg(text, kind) {
  const el = $("#af_geoMsg");
  if (!el) return;
  el.textContent = text;
  el.className = "geo-status" + (kind ? " " + kind : "");
}

function addAddDishRow(name, price) {
  const row = document.createElement("div");
  row.className = "dish-row";
  row.innerHTML =
    '<input class="d-name" placeholder="菜名，如 红烧牛肉面" maxlength="40" value="' + esc(name || "") + '">' +
    '<input class="d-price" placeholder="价格" maxlength="20" value="' + esc(price || "") + '">' +
    '<button class="mini-x" type="button" title="删除这道">×</button>';
  row.querySelector(".mini-x").addEventListener("click", () => row.remove());
  $("#af_dishRows").appendChild(row);
}

function renderAddImgs() {
  const grid = $("#af_imgGrid");
  if (!grid) return;
  grid.innerHTML = addImages.map((u, i) =>
    '<div class="img-item"><img src="' + esc(imgSrc(u, 320)) + '" alt="" title="点击设为封面" data-acover="' + i +
      '" style="cursor:pointer" onerror="this.parentNode.style.opacity=.35">' +
      (i === 0 ? '<span class="cover-flag">封面</span>' : "") +
      '<button type="button" data-aimg="' + i + '" title="移除">×</button></div>'
  ).join("") || '<span class="hint">还没有照片</span>';
}

function updateMapLink() {
  const link = $("#af_mapLink");
  if (!link) return;
  const lat = Number($("#af_lat").value);
  const lng = Number($("#af_lng").value);
  const name = ($("#af_name") && $("#af_name").value.trim()) || "";
  if ($("#af_lat").value.trim() && $("#af_lng").value.trim() &&
      Number.isFinite(lat) && Number.isFinite(lng) &&
      lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
    link.href = markerUrl(lat, lng, name, true);
    link.textContent = "在高德地图确认这个位置";
  } else {
    link.href = markerUrl(undefined, undefined, "", true);
    link.textContent = "打开高德地图";
  }
}

function locateMe() {
  const btn = $("#af_locate");
  if (!navigator.geolocation) return geoMsg("这个浏览器不支持定位，请手动填写坐标", "err");
  const secure = window.isSecureContext || location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (!secure) geoMsg("当前是 HTTP 访问，手机浏览器通常会拦截定位；若失败请改用 HTTPS 或手动填写", "warn");

  btn.disabled = true;
  btn.textContent = "定位中…";
  navigator.geolocation.getCurrentPosition(
    pos => {
      const lat = pos.coords.latitude.toFixed(7);
      const lng = pos.coords.longitude.toFixed(7);
      const acc = Math.round(pos.coords.accuracy || 0);
      $("#af_lat").value = lat;
      $("#af_lng").value = lng;
      updateMapLink();
      geoMsg(acc > 100 ? "已获取位置（精度约 " + acc + " 米，偏粗，可用高德确认）" : "已获取当前位置，精度约 " + acc + " 米", acc > 100 ? "warn" : "ok");
      btn.disabled = false;
      btn.textContent = "📍 重新定位";
    },
    err => {
      const map = { 1: "定位权限被拒绝", 2: "暂时拿不到位置", 3: "定位超时" };
      let msg = map[err.code] || "定位失败";
      if (err.code === 1) msg += "，请在浏览器设置里允许本站定位";
      if (!secure) msg += "；手机端请用 HTTPS 打开本页";
      geoMsg(msg + "，可手动填写坐标", "err");
      btn.disabled = false;
      btn.textContent = "📍 重新定位";
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
  );
}

function showTokenBox(msg) {
  const box = $("#af_tokenBox");
  if (!box) return;
  box.hidden = false;
  const m = $("#af_tokenMsg");
  if (m) {
    m.textContent = msg || "验证一次后，这台设备会记住口令。";
    m.style.color = msg ? "#a11224" : "";
  }
}

async function ensureToken() {
  if (publicAdd || token) return true;
  const input = $("#af_token");
  const v = input ? input.value.trim() : "";
  if (!v) {
    showTokenBox("请先填写管理口令");
    if (input) input.focus();
    toast("新增商户需要管理口令", "err");
    return false;
  }
  try {
    await api("/api/admin/verify", { method: "POST", token: v });
    token = v;
    localStorage.setItem(TOKEN_KEY, v);
    $("#af_tokenBox").hidden = true;
    return true;
  } catch (e) {
    showTokenBox(e.status === 401 ? "口令不正确，再试一次" : "验证失败：" + e.message);
    toast(e.status === 401 ? "管理口令不正确" : e.message, "err");
    return false;
  }
}

async function uploadAddFiles(e) {
  const files = Array.from(e.target.files || []);
  e.target.value = "";
  if (!files.length) return;
  if (!publicAdd && !(await ensureToken())) return;
  for (const f of files) {
    const fd = new FormData();
    fd.append("file", f, f.name);
    try {
      const d = await api("/api/upload", { method: "POST", form: fd });
      addImages.push(d.url);
      renderAddImgs();
    } catch (err) {
      toast("上传失败：" + err.message, "err");
    }
  }
  if (addImages.length) toast("已添加 " + addImages.length + " 张照片", "ok");
}

async function saveAdd() {
  const btn = $("#af_save");
  const name = $("#af_name").value.trim();
  if (!name) { toast("店名不能为空", "err"); $("#af_name").focus(); return; }

  const latRaw = $("#af_lat").value.trim();
  const lngRaw = $("#af_lng").value.trim();
  if (!!latRaw !== !!lngRaw) { toast("纬度和经度要一起填", "err"); return; }
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (latRaw && (!Number.isFinite(lat) || !Number.isFinite(lng) ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180)) {
    toast("经纬度超出有效范围（lat -90~90，lng -180~180）", "err");
    return;
  }

  if (!publicAdd && !(await ensureToken())) return;

  const dishes = Array.from(document.querySelectorAll("#af_dishRows .dish-row")).map(r => ({
    name: r.querySelector(".d-name").value.trim(),
    price: r.querySelector(".d-price").value.trim(),
  })).filter(d => d.name);

  const payload = {
    name,
    category: $("#af_category").value.trim(),
    phone: $("#af_phone").value.trim(),
    address: $("#af_address").value.trim(),
    hours: $("#af_hours").value.trim(),
    rating: Number($("#af_rating").value) || 0,
    recommend: Number($("#af_recommend").value) || 0,
    lat: latRaw,
    lng: lngRaw,
    note: $("#af_note").value.trim(),
    dishes,
    images: addImages,
  };

  btn.disabled = true;
  btn.textContent = "保存中…";
  try {
    const d = await api("/api/shops", { method: "POST", body: payload });
    toast("已登记「" + name + "」", "ok");
    closeAdd();
    await load();
    loadStats();
    if (d && d.shop && d.shop.id) openDetail(d.shop.id);
  } catch (e) {
    if (e.status === 401) {
      publicAdd = false;
      token = "";
      localStorage.removeItem(TOKEN_KEY);
      showTokenBox("服务器要求管理口令，请重新输入");
    }
    toast("保存失败：" + e.message, "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "保存并查看";
  }
}

/* 删除待上传照片 / 点图设为封面 / 关闭登记抽屉 */
document.addEventListener("click", e => {
  const del = e.target.closest("[data-aimg]");
  if (del) {
    addImages.splice(Number(del.dataset.aimg), 1);
    renderAddImgs();
    return;
  }
  const cov = e.target.closest("[data-acover]");
  if (cov) {
    const i = Number(cov.dataset.acover);
    if (i > 0) {
      const [u] = addImages.splice(i, 1);
      addImages.unshift(u);
      renderAddImgs();
      toast("已设为封面", "ok");
    }
  }
});
$("#addDrawer").addEventListener("click", e => {
  if (e.target.id === "addDrawer") closeAdd();
});

/* ---------- 启动 ---------- */
async function loadConfig() {
  try {
    const r = await fetch("/api/config", { cache: "no-store" });
    if (!r.ok) return;
    const d = await r.json();
    publicAdd = d.publicAdd !== false;
  } catch (_) { /* 旧版服务端没有 /api/config，按公开新增处理 */ }
}

loadConfig();
loadStats();
load();
if (/^#[0-9a-f-]{8,}$/i.test(location.hash)) openDetail(location.hash.slice(1));

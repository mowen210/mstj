/* 餐饮图鉴 · 管理端 */
"use strict";

const $ = s => document.querySelector(s);
const TOKEN_KEY = "canyin_admin_token";
let TOKEN = localStorage.getItem(TOKEN_KEY) || "";
let shops = [];
let categories = [];
let filter = { q: "", category: "" };
let editImages = [];
let editId = null;

/* ---------- 基础 ---------- */
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

function toast(msg, kind) {
  const el = document.createElement("div");
  el.className = "toast " + (kind || "");
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; }, 2400);
  setTimeout(() => el.remove(), 2800);
}

function timeAgo(ms) {
  const d = Math.floor((Date.now() - ms) / 1000);
  if (d < 60) return "刚刚";
  if (d < 3600) return Math.floor(d / 60) + " 分钟前";
  if (d < 86400) return Math.floor(d / 3600) + " 小时前";
  if (d < 86400 * 30) return Math.floor(d / 86400) + " 天前";
  return new Date(ms).toLocaleDateString("zh-CN");
}

async function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  if (TOKEN) headers["x-admin-token"] = TOKEN;
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
    e.payload = d;
    throw e;
  }
  return d;
}

/* ---------- 登录 ---------- */
async function login(token) {
  const btn = $("#loginBtn");
  btn.disabled = true;
  $("#loginMsg").textContent = "正在校验…";
  try {
    TOKEN = token;
    await api("/api/admin/verify", { method: "POST" });
    localStorage.setItem(TOKEN_KEY, token);
    $("#login").hidden = true;
    $("#app").hidden = false;
    await loadAll();
  } catch (e) {
    TOKEN = "";
    localStorage.removeItem(TOKEN_KEY);
    $("#loginMsg").innerHTML = '<span style="color:#a11224">' + esc(e.message) +
      (e.status === 401 ? "（口令不对，看看服务器 .env 里的 ADMIN_TOKEN）" : "") + "</span>";
  } finally {
    btn.disabled = false;
  }
}

$("#loginBtn").addEventListener("click", () => {
  const v = $("#tokenInput").value.trim();
  if (!v) return toast("先填口令", "err");
  login(v);
});
$("#tokenInput").addEventListener("keydown", e => {
  if (e.key === "Enter") $("#loginBtn").click();
});
$("#logoutBtn").addEventListener("click", () => {
  localStorage.removeItem(TOKEN_KEY);
  location.reload();
});

/* ---------- 列表 ---------- */
async function loadAll() {
  try {
    const qs = new URLSearchParams({ q: filter.q, category: filter.category, pageSize: "200", sort: "updated" });
    const d = await api("/api/shops?" + qs);
    shops = d.shops || [];
    categories = d.categories || [];
    renderCats();
    renderRows();
    const s = await api("/api/stats");
    $("#summary").textContent = "共 " + s.shops + " 家 · " + s.images + " 张图 · 平均 " + (s.avgRating || 0).toFixed(1) + " 分";
  } catch (e) {
    if (e.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      TOKEN = "";
      $("#app").hidden = true;
      $("#login").hidden = false;
      $("#loginMsg").textContent = "口令已失效，请重新输入。";
      return;
    }
    $("#rows").innerHTML = '<tr><td colspan="6" style="padding:20px;color:#a11224">' + esc(e.message) + "</td></tr>";
    toast(e.message, "err");
  }
}

function renderCats() {
  const cur = filter.category;
  $("#acat").innerHTML = '<option value="">全部分类</option>' +
    categories.map(c => '<option value="' + esc(c) + '"' + (c === cur ? " selected" : "") + ">" + esc(c) + "</option>").join("");
}

function renderRows() {
  if (!shops.length) {
    $("#rows").innerHTML = '<tr><td colspan="6" class="hint" style="padding:26px;text-align:center">还没有商家，点右上角「＋ 新增商家」登记第一家。</td></tr>';
    return;
  }
  $("#rows").innerHTML = shops.map(s => {
    const thumb = s.cover
      ? '<img class="thumb" src="' + esc(s.cover) + '" alt="" onerror="this.style.display=\'none\'">'
      : '<div class="thumb ph">' + esc((s.name || "食").slice(0, 1)) + "</div>";
    const dishes = (s.dishes || []).slice(0, 4).map(d => esc(d.name)).join("、") || "—";
    return "<tr>" +
      "<td>" + thumb + "</td>" +
      '<td><div class="name">' + esc(s.name) + "</div>" +
        '<div class="sub">' + dishes + (s.imageCount ? " · 图 " + s.imageCount : "") + "</div></td>" +
      "<td>" + esc(s.category || "—") + "</td>" +
      "<td><b style=\"color:var(--wine)\">" + (s.rating || 0).toFixed(1) + "</b>" +
        '<div class="sub">推荐 ' + (s.recommend || 0) + "/5</div></td>" +
      '<td class="sub">' + timeAgo(s.updatedAt) + "</td>" +
      '<td><div class="acts"><button class="btn sm" onclick="openEditor(\'' + esc(s.id) + '\')">编辑</button>' +
        '<button class="btn sm danger" onclick="delShop(\'' + esc(s.id) + '\')">删除</button></div></td>' +
      "</tr>";
  }).join("");
}

$("#aq").addEventListener("input", e => {
  clearTimeout(window.__t);
  const v = e.target.value.trim();
  window.__t = setTimeout(() => { filter.q = v; loadAll(); }, 240);
});
$("#acat").addEventListener("change", e => { filter.category = e.target.value; loadAll(); });
$("#newBtn").addEventListener("click", () => openEditor(null));

async function delShop(id) {
  const s = shops.find(x => x.id === id);
  if (!confirm("确定删除「" + (s ? s.name : "该商家") + "」？\n该店的招牌菜和图片记录会一起删除，本地图片文件也会清理。")) return;
  try {
    await api("/api/shops/" + id, { method: "DELETE" });
    toast("已删除", "ok");
    loadAll();
  } catch (e) { toast(e.message, "err"); }
}

/* ---------- 编辑抽屉 ---------- */
async function openEditor(id) {
  let s = null;
  if (id) {
    s = shops.find(x => x.id === id) || null;
    try {
      // 列表只带封面，编辑需要完整图片列表，回源查详情
      s = await api("/api/shops/" + id);
    } catch (e) {
      return toast("打不开详情：" + e.message, "err");
    }
  }
  editId = s ? s.id : null;
  editImages = s ? (s.images || []).slice() : [];
  if (s && !editImages.length && s.cover) editImages = [s.cover];

  const dishList = s && s.dishes && s.dishes.length ? s.dishes : [{ name: "", price: "" }];
  const opt = [0, 1, 2, 3, 4, 5].map(n =>
    '<option value="' + n + '"' + (s && s.recommend === n ? " selected" : "") + ">" + n + " 星</option>").join("");

  $("#pane").innerHTML =
    '<div class="pane-head"><h3>' + (s ? "编辑商家" : "新增商家") + "</h3><div style=\"flex:1\"></div>" +
      '<button class="btn sm" onclick="closeEditor()">取消</button></div>' +
    '<div class="pane-body">' +
      '<div class="field"><label>店名 *</label><input id="f_name" maxlength="60" value="' + esc(s ? s.name : "") + '" placeholder="老王牛肉面"></div>' +
      '<div class="row2">' +
        '<div class="field"><label>分类</label><input id="f_category" maxlength="20" list="catList" value="' + esc(s ? s.category : "") + '" placeholder="面食 / 火锅 / 烧烤">' +
          '<datalist id="catList">' + categories.map(c => '<option value="' + esc(c) + '">').join("") + "</datalist></div>" +
        '<div class="field"><label>电话</label><input id="f_phone" maxlength="40" value="' + esc(s ? s.phone : "") + '" placeholder="0571-8888 1234"></div>' +
      "</div>" +
      '<div class="field"><label>地址</label><input id="f_address" maxlength="200" value="' + esc(s ? s.address : "") + '" placeholder="解放路 128 号"></div>' +
      '<div class="row2">' +
        '<div class="field"><label>营业时间</label><input id="f_hours" maxlength="60" value="' + esc(s ? s.hours : "") + '" placeholder="11:00 - 22:00"></div>' +
        '<div class="field"><label>评分（0–5，可填 4.6）</label><input id="f_rating" type="number" min="0" max="5" step="0.1" value="' + (s ? s.rating : 0) + '"></div>' +
      "</div>" +
      '<div class="row3">' +
        '<div class="field"><label>推荐指数</label><select id="f_recommend">' + opt + "</select></div>" +
        '<div class="field"><label>纬度 lat</label><input id="f_lat" value="' + esc(s ? s.lat : "") + '" placeholder="30.2741000"></div>' +
        '<div class="field"><label>经度 lng</label><input id="f_lng" value="' + esc(s ? s.lng : "") + '" placeholder="120.1551000"></div>' +
      "</div>" +
      '<div class="field"><label>备注</label><textarea id="f_note" maxlength="1000" placeholder="什么时候去不用排队、什么必点…">' + esc(s ? s.note : "") + "</textarea></div>" +
      '<div class="field"><label>招牌菜（菜名 + 参考价）</label>' +
        '<div class="dish-rows" id="dishRows"></div>' +
        '<button class="btn sm" type="button" onclick="addDishRow()" style="align-self:flex-start">＋ 再加一道</button>' +
      "</div>" +
      '<div class="field"><label>图片（第一张是封面；点小图设为封面，上传为原图不压缩）</label>' +
        '<div class="img-grid" id="imgGrid"></div>' +
        '<div style="display:flex;gap:8px;margin-top:9px;flex-wrap:wrap">' +
          '<input id="imgUrl" placeholder="/files/xxx.jpg 或 https://…" style="flex:1 1 220px;border:1px solid var(--line);border-radius:9px;padding:8px 11px;background:#fff">' +
          '<button class="btn sm" type="button" onclick="addImageUrl()">添加地址</button>' +
          '<label class="btn sm" style="display:inline-flex;align-items:center;margin:0">上传图片<input id="fileUp" type="file" accept="image/*" hidden></label>' +
        "</div>" +
      "</div>" +
      (s ? '<p class="hint">创建于 ' + new Date(s.createdAt || Date.now()).toLocaleString("zh-CN") + "</p>" : "") +
    "</div>" +
    '<div class="pane-foot">' +
      '<button class="btn" type="button" onclick="closeEditor()">取消</button>' +
      '<button class="btn primary" type="button" id="saveBtn" onclick="saveShop()">保存</button>' +
    "</div>";

  dishList.forEach(d => addDishRow(d.name, d.price));
  renderImgs();

  $("#fileUp").addEventListener("change", uploadFile);
  $("#imgUrl").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addImageUrl(); } });

  const drawer = $("#drawer");
  drawer.classList.add("on");
  drawer.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  setTimeout(() => $("#f_name").focus(), 60);
}

function closeEditor() {
  $("#drawer").classList.remove("on");
  $("#drawer").setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function addDishRow(name, price) {
  const row = document.createElement("div");
  row.className = "dish-row";
  row.innerHTML =
    '<input class="d-name" placeholder="菜名，如 红烧牛肉面" maxlength="40" value="' + esc(name || "") + '">' +
    '<input class="d-price" placeholder="价格" maxlength="20" value="' + esc(price || "") + '">' +
    '<button class="mini-x" type="button" title="删除这道">×</button>';
  row.querySelector(".mini-x").addEventListener("click", () => row.remove());
  $("#dishRows").appendChild(row);
}

function renderImgs() {
  $("#imgGrid").innerHTML = editImages.map((u, i) =>
    '<div class="img-item"><img src="' + esc(u) + '" alt="" title="点击设为封面" data-i="' + i + '" ' +
      'onerror="this.parentNode.style.opacity=.35">' +
      '<button type="button" data-del="' + i + '" title="移除">×</button></div>'
  ).join("") || '<span class="hint">还没有图片</span>';
}

function addImageUrl() {
  const v = $("#imgUrl").value.trim();
  if (!v) return;
  if (editImages.includes(v)) { $("#imgUrl").value = ""; return toast("这张图已经在列表里了"); }
  if (!/^(\/files\/[\w.-]+|https?:\/\/\S{4,})$/i.test(v)) return toast("只支持 /files/… 或 http(s) 地址", "err");
  editImages.push(v);
  $("#imgUrl").value = "";
  renderImgs();
}

async function uploadFile(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  for (const f of files) {
    const fd = new FormData();
    fd.append("file", f, f.name);
    try {
      const d = await api("/api/upload", { method: "POST", form: fd });
      if (!editImages.includes(d.url)) editImages.push(d.url);
      renderImgs();
      toast("已上传 " + (f.name || "图片"), "ok");
    } catch (err) {
      toast("上传失败：" + err.message, "err");
    }
  }
  e.target.value = "";
}

async function saveShop() {
  const btn = $("#saveBtn");
  const name = $("#f_name").value.trim();
  if (!name) { toast("店名不能为空", "err"); $("#f_name").focus(); return; }

  const dishes = Array.from(document.querySelectorAll("#dishRows .dish-row")).map(r => ({
    name: r.querySelector(".d-name").value.trim(),
    price: r.querySelector(".d-price").value.trim(),
  })).filter(d => d.name);

  const payload = {
    name,
    category: $("#f_category").value.trim(),
    phone: $("#f_phone").value.trim(),
    address: $("#f_address").value.trim(),
    hours: $("#f_hours").value.trim(),
    rating: Number($("#f_rating").value) || 0,
    recommend: Number($("#f_recommend").value) || 0,
    lat: $("#f_lat").value.trim(),
    lng: $("#f_lng").value.trim(),
    note: $("#f_note").value.trim(),
    dishes,
    images: editImages,
  };

  btn.disabled = true;
  btn.textContent = "保存中…";
  try {
    if (editId) await api("/api/shops/" + editId, { method: "PUT", body: payload });
    else await api("/api/shops", { method: "POST", body: payload });
    toast(editId ? "已更新" : "已新增", "ok");
    closeEditor();
    await loadAll();
  } catch (e) {
    toast("保存失败：" + e.message, "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "保存";
  }
}

/* 图片点击设为封面 / 删除（委托到 document，图片区是打开抽屉后才生成的） */
document.addEventListener("click", e => {
  const grid = e.target.closest("#imgGrid");
  if (!grid) return;
  const del = e.target.closest("[data-del]");
  if (del) {
    editImages.splice(Number(del.dataset.del), 1);
    renderImgs();
    return;
  }
  const img = e.target.closest("img[data-i]");
  if (img) {
    const i = Number(img.dataset.i);
    if (i > 0) {
      const [u] = editImages.splice(i, 1);
      editImages.unshift(u);
      renderImgs();
      toast("已设为封面", "ok");
    }
  }
});

/* Esc 关闭 */
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && $("#drawer").classList.contains("on")) closeEditor();
});
$("#drawer").addEventListener("click", e => {
  if (e.target.id === "drawer") closeEditor();
});

/* ---------- 启动 ---------- */
(async function init() {
  if (!TOKEN) {
    $("#login").hidden = false;
    return;
  }
  try {
    await api("/api/admin/verify", { method: "POST" });
    $("#login").hidden = true;
    $("#app").hidden = false;
    loadAll();
  } catch (e) {
    TOKEN = "";
    localStorage.removeItem(TOKEN_KEY);
    $("#login").hidden = false;
    $("#loginMsg").textContent = "上次的口令已失效，请重新输入。";
  }
})();

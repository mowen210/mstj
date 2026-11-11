/**
 * 餐饮图鉴 · Web 版后端（Node 18+ / MySQL 8）
 *
 *   cp .env.example .env   # 改数据库账号、口令
 *   npm install
 *   npm start              # http://127.0.0.1:3000/
 *
 * 接口（JSON）：
 *   GET    /api/config                 前台公开能力（是否允许免口令新增）
 *   GET    /api/health                 健康检查（含数据库连通性）
 *   GET    /api/stats                  统计（首页顶部数据卡）
 *   GET    /api/categories             分类列表
 *   GET    /api/shops?q=&category=&sort=&page=&pageSize=
 *   GET    /api/shops/:id              详情（含图片、招牌菜）
 *   POST   /api/shops                  新增    [公开，PUBLIC_ADD=0 时需口令]
 *   PUT    /api/shops/:id              修改    [需口令]
 *   DELETE /api/shops/:id              删除    [需口令]
 *   POST   /api/upload                 上传图片 [公开，PUBLIC_ADD=0 时需口令] -> { url }
 *   DELETE /api/upload?url=...         删除图片 [需口令]
 *   POST   /api/admin/verify           校验管理口令 [需口令]
 *   GET    /files/<name>               图片原图
 *   GET    /                           前台图鉴
 *   GET    /admin                      管理端
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("./db");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "change-me";
// 前台可直接登记商户与上传配图；设为 0 后恢复为需要管理口令
const PUBLIC_ADD = !/^(0|false|no|off)$/i.test(String(process.env.PUBLIC_ADD || "1").trim());
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const CACHE_DIR = path.join(UPLOAD_DIR, ".cache");
const MAX_BODY = 64 * 1024 * 1024; // 单次 64MB，够放手机原图
// sharp 用于生成小图：上传时与启动时预生成，浏览时直接读缓存（未安装则回退原图并打警告）
let sharp = null;
try { sharp = require("sharp"); } catch (_) { sharp = null; }
const WIDTH_STEPS = [320, 640, 1280];
const RESIZE_EXTS = /\.(jpe?g|png|webp)$/i;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ---------------- 小图预生成（磁盘缓存，缺哪个补哪个） ---------------- */
const resizeJobs = new Map(); // name -> Promise，避免同一张图并发重复生成

function resizeOne(name, w) {
  return new Promise((resolve, reject) => {
    const orig = path.join(UPLOAD_DIR, name);
    const dir = path.join(CACHE_DIR, "w" + w);
    // 统一输出 WebP：照片类 PNG 用 PNG 压不下去（实测 640 宽仍 690KB），WebP 只有其约 1/10
    const cached = path.join(dir, name + ".webp");
    if (fs.existsSync(cached)) return resolve(cached);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, "." + Date.now() + crypto.randomBytes(3).toString("hex") + ".tmp");
    sharp(orig).rotate().resize({ width: w, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(tmp)
      .then(() => {
        try { fs.renameSync(tmp, cached); }
        catch (_) { if (!fs.existsSync(cached)) fs.copyFileSync(tmp, cached); }
        if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
        resolve(cached);
      })
      .catch(e => { if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true }); reject(e); });
  });
}

function ensureResized(name, w) {
  if (!sharp || !RESIZE_EXTS.test(name)) return Promise.resolve(null);
  const key = name + "@" + w;
  if (!resizeJobs.has(key)) {
    const p = resizeOne(name, w).catch(e => {
      console.warn("[resize]", name, "w" + w, "→", e.message);
      return null; // 失败回退原图
    }).finally(() => resizeJobs.delete(key));
    resizeJobs.set(key, p);
  }
  return resizeJobs.get(key);
}

/* 启动时把 uploads/ 里所有图片的小图补齐（一次性的回填，不阻塞服务） */
function backfillResized() {
  if (!sharp) return console.warn("⚠ 未安装 sharp（npm install），页面将直接下载原图，首次打开会较慢");
  let names;
  try {
    names = fs.readdirSync(UPLOAD_DIR).filter(f =>
      RESIZE_EXTS.test(f) && fs.statSync(path.join(UPLOAD_DIR, f)).isFile());
  } catch (_) { return; }
  console.log("小图预生成：" + names.length + " 张图片 × " + WIDTH_STEPS.length + " 档位…");
  (async () => {
    for (const n of names) for (const w of WIDTH_STEPS) await ensureResized(n, w);
    console.log("小图预生成完成，浏览时将直接命中缓存");
  })();
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".mp4": "video/mp4",
};

/* ---------------- HTTP 小工具 ---------------- */
function json(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type,x-admin-token",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  });
  res.end(body);
}
const fail = (res, code, msg, extra) => json(res, code, Object.assign({ error: msg }, extra || {}));

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let len = 0;
    req.on("data", c => {
      len += c.length;
      if (len > MAX_BODY) {
        reject(Object.assign(new Error("内容过大（单次上限 64MB）"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function tokenOk(req, url) {
  const got = String(req.headers["x-admin-token"] || url.searchParams.get("token") || "");
  const a = Buffer.from(got);
  const b = Buffer.from(ADMIN_TOKEN);
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

/* ---------------- multipart/form-data 解析 ---------------- */
function parseMultipart(buf, boundary) {
  const delim = Buffer.from("--" + boundary);
  const parts = [];
  let pos = buf.indexOf(delim);
  if (pos < 0) return parts;
  pos += delim.length;
  for (;;) {
    if (buf[pos] === 0x2d && buf[pos + 1] === 0x2d) break;
    if (buf[pos] === 0x0d && buf[pos + 1] === 0x0a) pos += 2;
    else break;
    const next = buf.indexOf(delim, pos);
    if (next < 0) break;
    const chunk = buf.slice(pos, next - 2);
    const hEnd = chunk.indexOf("\r\n\r\n");
    if (hEnd >= 0) {
      const head = chunk.slice(0, hEnd).toString("utf8");
      const name = /name="([^"]*)"/i.exec(head);
      const filename = /filename="([^"]*)"/i.exec(head);
      const ct = /content-type:\s*([^\r\n]+)/i.exec(head);
      parts.push({
        name: name ? name[1] : "",
        filename: filename ? filename[1] : null,
        contentType: ct ? ct[1].trim() : "",
        data: chunk.slice(hEnd + 4),
      });
    }
    pos = next + delim.length;
  }
  return parts;
}

/* ---------------- 字段清洗 ---------------- */
const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0;
};
const round1 = n => Math.round(n * 10) / 10;

const IMG_RE = /^(\/files\/[A-Za-z0-9._-]+|https?:\/\/[^\s"'<>]{4,500})$/i;

function cleanShop(input, old) {
  const o = old || {};
  const has = k => Object.prototype.hasOwnProperty.call(input, k);

  const dishes = Array.isArray(input.dishes)
    ? input.dishes
        .map(d => ({ name: str(d && d.name, 40), price: str(d && d.price, 20) }))
        .filter(d => d.name)
        .slice(0, 40)
    : o.dishes || [];

  const images = Array.isArray(input.images)
    ? input.images
        .map(u => String(u || "").trim())
        .filter(u => IMG_RE.test(u))
        .filter((u, i, arr) => arr.indexOf(u) === i)
        .slice(0, 200)
    : o.images || [];

  return {
    id: o.id || db.newId(),
    name: str(input.name, 60) || o.name || "未命名",
    category: str(input.category, 20) || (has("category") ? "" : o.category || ""),
    address: str(input.address, 200) || (has("address") ? "" : o.address || ""),
    phone: str(input.phone, 40) || (has("phone") ? "" : o.phone || ""),
    hours: str(input.hours, 60) || (has("hours") ? "" : o.hours || ""),
    note: str(input.note, 1000) || (has("note") ? "" : o.note || ""),
    lat: (has("lat") ? str(input.lat, 20) : o.lat || ""),
    lng: (has("lng") ? str(input.lng, 20) : o.lng || ""),
    rating: has("rating") ? round1(num(input.rating, 0, 5)) : Number(o.rating || 0),
    recommend: has("recommend") ? Math.round(num(input.recommend, 0, 5)) : Number(o.recommend || 0),
    dishes,
    images,
  };
}

/* ---------------- 静态文件 ---------------- */
function sendFile(res, file, cache) {
  const ext = path.extname(file).toLowerCase();
  const stat = fs.statSync(file);
  res.writeHead(200, {
    "content-type": MIME[ext] || "application/octet-stream",
    "content-length": stat.size,
    "cache-control": cache || "no-cache",
    "access-control-allow-origin": "*",
  });
  fs.createReadStream(file).pipe(res);
}

function serveStatic(res, pathname) {
  const rel = pathname === "/" ? "/index.html" : pathname === "/admin" || pathname === "/admin/" ? "/admin.html" : pathname;
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== path.join(PUBLIC_DIR, "index.html")) {
    return false;
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  sendFile(res, file, /\.(css|js|png|jpg|svg|ico|woff2?)$/i.test(file) ? "public, max-age=3600" : "no-cache");
  return true;
}

/* ---------------- 路由 ---------------- */
async function handle(req, res) {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  const p = decodeURIComponent(url.pathname);
  const method = (req.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type,x-admin-token",
      "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    });
    return res.end();
  }

  /* ---- 健康检查 ---- */
  if (p === "/api/health") {
    try {
      await db.ping();
      const s = await db.stats();
      return json(res, 200, {
        ok: true, driver: "mysql", database: db.CFG.database,
        shops: s.shops, images: s.images, version: 2, time: Date.now(),
      });
    } catch (e) {
      return json(res, 503, {
        ok: false, driver: "mysql",
        error: "数据库连接失败：" + e.code + " " + e.message,
        hint: "检查 .env 里的 MYSQL_HOST / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE，并确认已导入 sql/schema.sql",
      });
    }
  }

  /* ---- 前台能力配置 ---- */
  if (p === "/api/config" && method === "GET") {
    return json(res, 200, { publicAdd: PUBLIC_ADD });
  }

  /* ---- 统计 / 分类 ---- */
  if (p === "/api/stats" && method === "GET") return json(res, 200, await db.stats());
  if (p === "/api/categories" && method === "GET") return json(res, 200, { categories: await db.categories() });

  /* ---- 列表 ---- */
  if (p === "/api/shops" && method === "GET") {
    const data = await db.listShops({
      q: (url.searchParams.get("q") || "").trim(),
      category: (url.searchParams.get("category") || "").trim(),
      sort: url.searchParams.get("sort") || "updated",
      page: Number(url.searchParams.get("page") || 1),
      pageSize: Number(url.searchParams.get("pageSize") || 60),
    });
    data.categories = await db.categories();
    return json(res, 200, data);
  }

  /* ---- 详情 / 修改 / 删除 ---- */
  const m = /^\/api\/shops\/([\w-]{8,64})$/.exec(p);
  if (m) {
    const id = m[1];
    if (method === "GET") {
      const shop = await db.getShop(id);
      if (!shop) return fail(res, 404, "商家不存在");
      return json(res, 200, shop);
    }
    if (method === "PUT" || method === "PATCH") {
      if (!tokenOk(req, url)) return fail(res, 401, "管理口令不正确");
      const old = await db.getShop(id);
      if (!old) return fail(res, 404, "商家不存在");
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const shop = cleanShop(body, old);
      const updated = await db.updateShop(id, shop);
      if (!updated) return fail(res, 404, "商家不存在");
      return json(res, 200, { ok: true, shop: updated });
    }
    if (method === "DELETE") {
      if (!tokenOk(req, url)) return fail(res, 401, "管理口令不正确");
      const r = await db.deleteShop(id);
      if (!r) return fail(res, 404, "商家不存在");
      // 删掉只被这家店引用的本地图片文件
      for (const u of r.removedImages) {
        if (await db.imageUsedElsewhere(u)) continue;
        removeLocalFile(u);
      }
      return json(res, 200, { ok: true });
    }
  }

  /* ---- 新增（默认公开；PUBLIC_ADD=0 时需口令） ---- */
  if (p === "/api/shops" && method === "POST") {
    if (!PUBLIC_ADD && !tokenOk(req, url)) return fail(res, 401, "管理口令不正确");
    const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    const shop = cleanShop(body, null);
    const created = await db.createShop(shop);
    return json(res, 201, { ok: true, shop: created });
  }

  /* ---- 上传图片（原图不压缩；默认公开，PUBLIC_ADD=0 时需口令） ---- */
  if (p === "/api/upload" && method === "POST") {
    if (!PUBLIC_ADD && !tokenOk(req, url)) return fail(res, 401, "管理口令不正确");
    const ct = req.headers["content-type"] || "";
    const bm = /boundary=([^;]+)/i.exec(ct);
    if (!bm) return fail(res, 400, "需要 multipart/form-data");
    const parts = parseMultipart(await readBody(req), bm[1].trim());
    const file = parts.find(x => x.data && x.data.length);
    if (!file) return fail(res, 400, "没有收到文件");
    const ext = (path.extname(file.filename || "") || ".jpg").toLowerCase();
    if (!MIME[ext] || !/^image\//.test(MIME[ext])) return fail(res, 400, "只支持图片：" + ext);
    const name = crypto.randomUUID().replace(/-/g, "") + ext;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), file.data);
    ensureResized(name, 320); // 上传即预生成小图（异步，不阻塞响应）
    ensureResized(name, 640);
    ensureResized(name, 1280);
    return json(res, 200, {
      ok: true, url: "/files/" + name, size: file.data.length, name: file.filename || name,
    });
  }

  /* ---- 删除图片 ---- */
  if (p === "/api/upload" && method === "DELETE") {
    if (!tokenOk(req, url)) return fail(res, 401, "管理口令不正确");
    const u = url.searchParams.get("url") || "";
    if (!/^\/files\/[A-Za-z0-9._-]+$/.test(u)) return fail(res, 400, "参数不合法");
    if (await db.imageUsedElsewhere(u)) return fail(res, 409, "还有商家在用这张图，先解除引用");
    removeLocalFile(u);
    return json(res, 200, { ok: true });
  }

  /* ---- 口令校验（管理端登录用） ---- */
  if (p === "/api/admin/verify" && method === "POST") {
    if (!tokenOk(req, url)) return fail(res, 401, "管理口令不正确");
    return json(res, 200, { ok: true });
  }

  /* ---- 图片（原图 + ?w= 小图，小图来自预生成缓存） ---- */
  if (p.startsWith("/files/")) {
    const name = p.slice("/files/".length);
    if (!/^[A-Za-z0-9._-]+$/.test(name)) return fail(res, 400, "参数不合法");
    const orig = path.join(UPLOAD_DIR, name);
    if (!fs.existsSync(orig)) return fail(res, 404, "文件不存在");
    const IMMUTABLE = "public, max-age=31536000, immutable";
    let w = Number(url.searchParams.get("w")) || 0;
    if (w > 0) w = WIDTH_STEPS.find(s => s >= w) || WIDTH_STEPS[WIDTH_STEPS.length - 1];
    if (w && sharp && RESIZE_EXTS.test(name)) {
      const cached = await ensureResized(name, w); // 命中缓存即时返回；个别未预生成的现补
      if (cached) return sendFile(res, cached, IMMUTABLE);
    }
    return sendFile(res, orig, IMMUTABLE);
  }

  /* ---- 静态页面 ---- */
  if (method === "GET" || method === "HEAD") {
    if (serveStatic(res, p)) return;
  }

  return fail(res, 404, "接口不存在");
}

function removeLocalFile(u) {
  const name = String(u || "").replace(/^\/files\//, "");
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return;
  const f = path.join(UPLOAD_DIR, name);
  if (f.startsWith(UPLOAD_DIR + path.sep)) fs.promises.unlink(f).catch(() => {});
  for (const w of WIDTH_STEPS) fs.promises.unlink(path.join(CACHE_DIR, "w" + w, name)).catch(() => {});
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(e => {
    const code = e.status || (e.code === "ER_DUP_ENTRY" ? 409 : 500);
    console.error("[ERR]", req.method, req.url, "→", e.code || "", e.message);
    if (res.headersSent) return res.end();
    if (e instanceof SyntaxError) return fail(res, 400, "请求体不是合法 JSON");
    if (String(e.code || "").startsWith("ER_") || e.code === "ECONNREFUSED" || e.code === "ETIMEDOUT") {
      return json(res, 503, {
        error: "数据库错误：" + e.message,
        code: e.code,
        hint: "确认 MySQL 已启动、库已建（sql/schema.sql），且 .env 账号有权限",
      });
    }
    fail(res, code, e.message || "服务器内部错误");
  });
});

server.listen(PORT, HOST, async () => {
  console.log("餐饮图鉴（MySQL 版）已启动  http://127.0.0.1:" + PORT + "/");
  console.log("管理端：http://127.0.0.1:" + PORT + "/admin");
  console.log("数据库：" + db.CFG.user + "@" + db.CFG.host + ":" + db.CFG.port + "/" + db.CFG.database);
  try {
    await db.ping();
    const s = await db.stats();
    console.log("连接成功，当前有 " + s.shops + " 家商家、" + s.images + " 张图片");
  } catch (e) {
    console.warn("⚠ 数据库暂时连不上：" + (e.code || "") + " " + e.message);
    console.warn("  请检查 .env，并执行：mysql -u root -p < sql/schema.sql");
  }
  backfillResized(); // 后台补齐所有小图，不阻塞服务启动
  if (ADMIN_TOKEN === "change-me") console.warn("⚠ ADMIN_TOKEN 还是默认值，上线前务必修改");
});

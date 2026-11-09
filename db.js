/**
 * 餐饮图鉴 · MySQL 数据访问层
 *
 * 全部 SQL 都集中在这里，server.js 只负责 HTTP。
 * 依赖只有一个：mysql2（npm i mysql2）
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/* ---------- 极简 .env 读取（不引第三方库） ---------- */
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  text.split(/\r?\n/).forEach(line => {
    const s = line.trim();
    if (!s || s.startsWith("#")) return;
    const i = s.indexOf("=");
    if (i < 0) return;
    const k = s.slice(0, i).trim();
    let v = s.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  });
}
loadEnv(path.join(__dirname, ".env"));

/* ---------- 连接池 ---------- */
let mysql;
try {
  mysql = require("mysql2/promise");
} catch (e) {
  console.error("\n[缺少依赖] 请先执行：npm install\n（只需要 mysql2 一个包）\n");
  process.exit(1);
}

const CFG = {
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  database: process.env.MYSQL_DATABASE || "canyin",
  charset: "utf8mb4",
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_POOL || 10),
  queueLimit: 0,
  dateStrings: true,
  decimalNumbers: true,
  timezone: "local",
};

const pool = mysql.createPool(CFG);

/* ---------- 行 → 前端结构 ---------- */
const TS = s => {
  if (!s) return 0;
  const t = new Date(String(s).replace(" ", "T"));
  return Number.isNaN(t.getTime()) ? 0 : t.getTime();
};

function mapShop(row) {
  const r = {
    id: row.id,
    name: row.name,
    category: row.category || "",
    address: row.address || "",
    phone: row.phone || "",
    hours: row.hours || "",
    note: row.note || "",
    lat: row.lat === null || row.lat === undefined ? "" : String(row.lat),
    lng: row.lng === null || row.lng === undefined ? "" : String(row.lng),
    rating: Number(row.rating || 0),
    recommend: Number(row.recommend || 0),
    cover: row.cover || "",
    imageCount: Number(row.image_count || 0),
    dishCount: Number(row.dish_count || 0),
    dishes: [],
    images: [],
    createdAt: TS(row.created_at),
    updatedAt: TS(row.updated_at),
  };
  return r;
}

/* ---------- 查询 ---------- */
function likeEscape(q) {
  return q.replace(/[\\%_]/g, c => "\\" + c);
}

async function ping() {
  const [rows] = await pool.query("SELECT 1 AS ok");
  return rows[0].ok === 1;
}

async function categories() {
  const [rows] = await pool.query(
    "SELECT category FROM shops WHERE category <> '' GROUP BY category ORDER BY COUNT(*) DESC, category"
  );
  return rows.map(r => r.category);
}

async function stats() {
  const [[sum]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM shops)                    AS shops,
       (SELECT COUNT(DISTINCT category) FROM shops
          WHERE category <> '')                        AS categories,
       (SELECT COUNT(*) FROM shop_images)              AS images,
       (SELECT COUNT(*) FROM shop_dishes)              AS dishes,
       (SELECT ROUND(AVG(rating), 2) FROM shops)       AS avg_rating,
       (SELECT COUNT(*) FROM shops WHERE recommend = 5) AS five_star`
  );
  const [byCat] = await pool.query(
    `SELECT category, COUNT(*) AS n FROM shops
      WHERE category <> '' GROUP BY category ORDER BY n DESC, category LIMIT 6`
  );
  return {
    shops: Number(sum.shops || 0),
    categories: Number(sum.categories || 0),
    images: Number(sum.images || 0),
    dishes: Number(sum.dishes || 0),
    avgRating: Number(sum.avg_rating || 0),
    fiveStar: Number(sum.five_star || 0),
    byCategory: byCat.map(r => ({ category: r.category, count: Number(r.n) })),
  };
}

async function listShops({ q = "", category = "", sort = "updated", page = 1, pageSize = 60 } = {}) {
  const where = [];
  const params = [];

  if (q) {
    const like = `%${likeEscape(q)}%`;
    where.push(
      `(s.name LIKE ? OR s.address LIKE ? OR s.note LIKE ? OR s.category LIKE ?
        OR EXISTS (SELECT 1 FROM shop_dishes d WHERE d.shop_id = s.id AND d.name LIKE ?))`
    );
    params.push(like, like, like, like, like);
  }
  if (category && category !== "全部") {
    where.push("s.category = ?");
    params.push(category);
  }
  const w = where.length ? "WHERE " + where.join(" AND ") : "";

  const ORDER = {
    updated: "s.updated_at DESC",
    rating: "s.rating DESC, s.recommend DESC, s.updated_at DESC",
    recommend: "s.recommend DESC, s.rating DESC, s.updated_at DESC",
    name: "s.name ASC",
  };
  const order = ORDER[sort] || ORDER.updated;

  const limit = Math.min(200, Math.max(1, Number(pageSize) || 60));
  const offset = Math.max(0, (Number(page) || 1) - 1) * limit;

  const [[cnt]] = await pool.query(
    `SELECT COUNT(*) AS n FROM v_shop_list s ${w}`, params
  );

  const [rows] = await pool.query(
    `SELECT * FROM v_shop_list s ${w} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  const list = rows.map(mapShop);

  const ids = list.map(s => s.id);
  if (ids.length) {
    const [dishes] = await pool.query(
      `SELECT shop_id, name, price FROM shop_dishes
        WHERE shop_id IN (?) ORDER BY shop_id, sort_no, id`, [ids]
    );
    const byShop = new Map();
    dishes.forEach(d => {
      if (!byShop.has(d.shop_id)) byShop.set(d.shop_id, []);
      byShop.get(d.shop_id).push({ name: d.name, price: d.price });
    });
    list.forEach(s => { s.dishes = byShop.get(s.id) || []; });
  }

  return { total: Number(cnt.n || 0), page: Number(page) || 1, pageSize: limit, shops: list };
}

async function getShop(id) {
  const [rows] = await pool.query("SELECT * FROM shops WHERE id = ?", [id]);
  if (!rows.length) return null;
  const shop = mapShop(rows[0]);

  const [imgs] = await pool.query(
    "SELECT url FROM shop_images WHERE shop_id = ? ORDER BY sort_no, id", [id]
  );
  const [dishes] = await pool.query(
    "SELECT name, price FROM shop_dishes WHERE shop_id = ? ORDER BY sort_no, id", [id]
  );
  shop.images = imgs.map(r => r.url);
  shop.cover = shop.images[0] || "";
  shop.imageCount = shop.images.length;
  shop.dishes = dishes.map(d => ({ name: d.name, price: d.price }));
  shop.dishCount = shop.dishes.length;
  return shop;
}

async function insertChildren(conn, shop) {
  if (shop.dishes.length) {
    const values = shop.dishes.map((d, i) => [shop.id, d.name, d.price || "", i]);
    await conn.query("INSERT INTO shop_dishes (shop_id, name, price, sort_no) VALUES ?", [values]);
  }
  if (shop.images.length) {
    const values = shop.images.map((u, i) => [shop.id, u, i]);
    await conn.query("INSERT INTO shop_images (shop_id, url, sort_no) VALUES ?", [values]);
  }
}

async function createShop(shop) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `INSERT INTO shops (id, name, category, address, phone, hours, note, lat, lng, rating, recommend)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [shop.id, shop.name, shop.category, shop.address, shop.phone, shop.hours,
       shop.note, shop.lat || null, shop.lng || null, shop.rating, shop.recommend]
    );
    await insertChildren(conn, shop);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return getShop(shop.id);
}

async function updateShop(id, shop) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.execute(
      `UPDATE shops SET name = ?, category = ?, address = ?, phone = ?, hours = ?,
              note = ?, lat = ?, lng = ?, rating = ?, recommend = ?, updated_at = NOW()
        WHERE id = ?`,
      [shop.name, shop.category, shop.address, shop.phone, shop.hours, shop.note,
       shop.lat || null, shop.lng || null, shop.rating, shop.recommend, id]
    );
    if (!r.affectedRows) {
      // 可能是字段值没变导致 affectedRows=0，再确认一次记录是否存在
      const [exists] = await conn.query("SELECT 1 AS x FROM shops WHERE id = ?", [id]);
      if (!exists.length) {
        await conn.rollback();
        return null;
      }
    }
    await conn.query("DELETE FROM shop_dishes WHERE shop_id = ?", [id]);
    await conn.query("DELETE FROM shop_images WHERE shop_id = ?", [id]);
    await insertChildren(conn, shop);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return getShop(id);
}

async function deleteShop(id) {
  const [imgs] = await pool.query("SELECT url FROM shop_images WHERE shop_id = ?", [id]);
  const [r] = await pool.execute("DELETE FROM shops WHERE id = ?", [id]);
  if (!r.affectedRows) return null;
  return { removedImages: imgs.map(x => x.url) };
}

async function imageUsedElsewhere(url) {
  const [rows] = await pool.query("SELECT COUNT(*) AS n FROM shop_images WHERE url = ?", [url]);
  return Number(rows[0].n) > 0;
}

async function allImageUrls() {
  const [rows] = await pool.query("SELECT url FROM shop_images");
  return rows.map(r => r.url);
}

module.exports = {
  pool, CFG,
  ping, stats, categories, listShops, getShop,
  createShop, updateShop, deleteShop,
  imageUsedElsewhere, allImageUrls,
  newId: () => crypto.randomUUID(),
};

/**
 * 把旧版 JSON 数据搬进 MySQL：node scripts/import-json.js [db.json 路径]
 *
 * 默认读取 ../server/data/db.json（小程序版的数据库文件）。
 * 保留原来的 id 和时间戳；已存在的 id 会跳过，不覆盖。
 */
"use strict";

const fs = require("fs");
const path = require("path");

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, "utf8").split(/\r?\n/).forEach(line => {
    const s = line.trim();
    if (!s || s.startsWith("#")) return;
    const i = s.indexOf("=");
    if (i < 0) return;
    const k = s.slice(0, i).trim();
    let v = s.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  });
}
loadEnv(path.join(__dirname, "..", ".env"));

const mysql = require("mysql2/promise");
const SRC = process.argv[2] || path.join(__dirname, "..", "..", "server", "data", "db.json");

(async () => {
  if (!fs.existsSync(SRC)) {
    console.error("找不到源文件：" + SRC);
    console.error("用法：node scripts/import-json.js 路径/to/db.json");
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(SRC, "utf8"));
  const shops = Array.isArray(raw.shops) ? raw.shops : [];
  if (!shops.length) return console.log("源文件里没有商家，什么都没做。");

  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
    database: process.env.MYSQL_DATABASE || "canyin",
    charset: "utf8mb4",
  });

  const toDate = ms => (ms ? new Date(ms) : new Date());
  let added = 0, skipped = 0;

  try {
    for (const s of shops) {
      const id = String(s.id || "").slice(0, 64) || require("crypto").randomUUID();
      const [exists] = await conn.query("SELECT 1 AS x FROM shops WHERE id = ?", [id]);
      if (exists.length) { skipped++; continue; }

      await conn.beginTransaction();
      try {
        await conn.execute(
          `INSERT INTO shops (id, name, category, address, phone, hours, note, lat, lng,
                              rating, recommend, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            id, String(s.name || "未命名").slice(0, 60), String(s.category || "").slice(0, 20),
            String(s.address || "").slice(0, 200), String(s.phone || "").slice(0, 40),
            String(s.hours || "").slice(0, 60), String(s.note || "").slice(0, 1000),
            s.lat ? Number(s.lat) : null, s.lng ? Number(s.lng) : null,
            Math.min(5, Math.max(0, Number(s.rating) || 0)),
            Math.min(5, Math.max(0, Math.round(Number(s.recommend) || 0))),
            toDate(s.createdAt), toDate(s.updatedAt),
          ]
        );
        const dishes = (s.dishes || []).filter(d => d && d.name).slice(0, 40);
        if (dishes.length) {
          await conn.query(
            "INSERT INTO shop_dishes (shop_id, name, price, sort_no) VALUES ?",
            [dishes.map((d, i) => [id, String(d.name).slice(0, 40), String(d.price || "").slice(0, 20), i])]
          );
        }
        const images = (s.images || []).filter(u => typeof u === "string").slice(0, 200);
        if (images.length) {
          await conn.query(
            "INSERT INTO shop_images (shop_id, url, sort_no) VALUES ?",
            [images.map((u, i) => [id, u.slice(0, 500), i])]
          );
        }
        await conn.commit();
        added++;
      } catch (e) {
        await conn.rollback();
        console.error("✗ " + (s.name || id) + "：" + e.message);
      }
    }
    console.log("导入完成：新增 " + added + " 家，跳过已存在 " + skipped + " 家。");
    console.log("提示：旧版图片在 server/uploads/，请把该目录整体复制到 web-mysql/uploads/ 再重启服务。");
  } finally {
    await conn.end();
  }
})();

/**
 * 一键建库：node scripts/init-db.js [--seed]
 *
 * 读取 sql/schema.sql 建库建表（IF NOT EXISTS，可重复执行）；
 * 带 --seed 时再导入 sql/seed.sql 的演示数据。
 * 数据库连接信息取自 .env（没有 .env 时用默认 root@127.0.0.1）。
 */
"use strict";

const fs = require("fs");
const path = require("path");

/* ---- 读 .env（与 db.js 同规则，独立实现，避免启动连接池） ---- */
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

const DB = process.env.MYSQL_DATABASE || "canyin";
const cfg = {
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "root",
  password: process.env.MYSQL_PASSWORD || "",
  multipleStatements: true,
  charset: "utf8mb4",
};

(async () => {
  let mysql;
  try {
    mysql = require("mysql2/promise");
  } catch (e) {
    console.error("缺少依赖，请先执行：npm install");
    process.exit(1);
  }

  const seed = process.argv.includes("--seed");
  let conn;
  try {
    conn = await mysql.createConnection(cfg);
  } catch (e) {
    console.error("连不上 MySQL：" + (e.code || "") + " " + e.message);
    console.error("请确认 MySQL 已启动，并检查 .env 里的 MYSQL_HOST / MYSQL_USER / MYSQL_PASSWORD。");
    process.exit(1);
  }

  const run = async file => {
    const sql = fs.readFileSync(path.join(__dirname, "..", "sql", file), "utf8");
    await conn.query(sql);
    console.log("✔ 已执行 sql/" + file);
  };

  try {
    await run("schema.sql");
    if (seed) await run("seed.sql");
    else console.log("  提示：加 --seed 可导入 5 家演示餐厅");

    const [[c]] = await conn.query(
      "SELECT COUNT(*) AS shops, (SELECT COUNT(*) FROM `" + DB + "`.shop_images) AS images FROM `" + DB + "`.shops"
    );
    console.log("完成：库 " + DB + " 现有 " + c.shops + " 家商家、" + c.images + " 张图片");
  } catch (e) {
    console.error("执行失败：" + e.message);
    process.exitCode = 1;
  } finally {
    await conn.end();
  }
})();

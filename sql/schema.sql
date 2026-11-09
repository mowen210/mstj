-- ============================================================
-- 餐饮图鉴 · MySQL 版数据结构
-- 适用：MySQL 8.0+ / MariaDB 10.4+（utf8mb4，中文与 emoji 均安全）
-- 执行：mysql -u root -p < sql/schema.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS `canyin`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `canyin`;

-- ------------------------------------------------------------
-- 商家主表：一行一家店
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `shops` (
  `id`          CHAR(36)         NOT NULL COMMENT 'UUID',
  `name`        VARCHAR(60)      NOT NULL COMMENT '店名',
  `category`    VARCHAR(20)      NOT NULL DEFAULT '' COMMENT '分类：面食/火锅/烧烤…',
  `address`     VARCHAR(200)     NOT NULL DEFAULT '' COMMENT '地址',
  `phone`       VARCHAR(40)      NOT NULL DEFAULT '' COMMENT '电话',
  `hours`       VARCHAR(60)      NOT NULL DEFAULT '' COMMENT '营业时间',
  `note`        VARCHAR(1000)    NOT NULL DEFAULT '' COMMENT '备注',
  `lat`         DECIMAL(10, 7)   NULL COMMENT '纬度',
  `lng`         DECIMAL(10, 7)   NULL COMMENT '经度',
  `rating`      DECIMAL(2, 1)    NOT NULL DEFAULT 0.0 COMMENT '综合评分 0~5',
  `recommend`   TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '推荐指数 0~5',
  `created_at`  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_category` (`category`),
  KEY `idx_updated`  (`updated_at`),
  KEY `idx_name`     (`name`),
  CONSTRAINT `chk_rating`    CHECK (`rating` >= 0 AND `rating` <= 5),
  CONSTRAINT `chk_recommend` CHECK (`recommend` <= 5)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci
  COMMENT = '商家（餐厅）';

-- ------------------------------------------------------------
-- 图片表：一家店多张，原图不压缩、张数不限
-- 拆表而不是塞 JSON 字段：可按张排序、可单独删除、可统计
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `shop_images` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `shop_id`    CHAR(36)        NOT NULL,
  `url`        VARCHAR(500)    NOT NULL COMMENT '/files/xxx.jpg 或 http(s) 外链',
  `sort_no`    SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '展示顺序',
  `created_at` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_shop_sort` (`shop_id`, `sort_no`),
  CONSTRAINT `fk_image_shop` FOREIGN KEY (`shop_id`)
    REFERENCES `shops` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci
  COMMENT = '商家图片';

-- ------------------------------------------------------------
-- 招牌菜表：店名 → 多道菜（菜名 + 参考价）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `shop_dishes` (
  `id`      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `shop_id` CHAR(36)        NOT NULL,
  `name`    VARCHAR(40)     NOT NULL,
  `price`   VARCHAR(20)     NOT NULL DEFAULT '',
  `sort_no` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_shop_sort` (`shop_id`, `sort_no`),
  CONSTRAINT `fk_dish_shop` FOREIGN KEY (`shop_id`)
    REFERENCES `shops` (`id`) ON DELETE CASCADE
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_unicode_ci
  COMMENT = '招牌菜';

-- ------------------------------------------------------------
-- 便捷视图：列表页需要的封面 / 图片张数 / 菜名，一次查完
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW `v_shop_list` AS
SELECT
  s.`id`, s.`name`, s.`category`, s.`address`, s.`phone`, s.`hours`,
  s.`note`, s.`lat`, s.`lng`, s.`rating`, s.`recommend`,
  s.`created_at`, s.`updated_at`,
  (SELECT i.`url` FROM `shop_images` i
    WHERE i.`shop_id` = s.`id`
    ORDER BY i.`sort_no`, i.`id` LIMIT 1)                       AS `cover`,
  (SELECT COUNT(*) FROM `shop_images` i
    WHERE i.`shop_id` = s.`id`)                                 AS `image_count`,
  (SELECT COUNT(*) FROM `shop_dishes` d
    WHERE d.`shop_id` = s.`id`)                                 AS `dish_count`
FROM `shops` s;

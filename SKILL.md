---
name: xianyu-monitor
description: 闲鱼商品监控与捡漏工具。定时搜索闲鱼，发现新商品后推送 Discord 通知。Use when: user wants to monitor 闲鱼/Xianyu/Goofish for specific items, set up price alerts, track second-hand goods, or find rental listings on 闲鱼. Supports keyword search, price range, text filters (exclude/include), time filter, dedup via SQLite.
---

# 闲鱼监控 (xianyu-monitor)

## 前置条件
1. Chrome 实例运行在 CDP 端口 18803（profile: `~/.chrome-debug-xianyu`）
2. **不需要登录**——闲鱼搜索页无需登录即可获取结果
3. `puppeteer-core` 和 `better-sqlite3` 已安装

## 启动 Chrome
```bash
bash scripts/setup-chrome.sh start    # headless 模式
bash scripts/setup-chrome.sh status   # 检查状态
bash scripts/setup-chrome.sh stop     # 停止
```

## 核心脚本: scripts/xianyu.js

### 添加监控任务
```bash
node scripts/xianyu.js add --keyword "搜索词" \
  [--max-price 3000] [--min-price 500] \
  [--filter "排除词1,排除词2"] \
  [--only "必含词1,必含词2"]
```

### 执行扫描
```bash
node scripts/xianyu.js scan [--id <task_id>] [--hours 3]
```
- `--hours N`: 只返回 N 小时内发布的商品
- 连接 CDP Chrome → 访问闲鱼搜索页 → 拦截 API 响应 → 解析+过滤+去重
- 新商品输出在 `--- NEW_ITEMS_JSON ---` 和 `--- END_NEW_ITEMS_JSON ---` 之间

### 其他命令
- `list` — 查看所有活跃任务
- `remove --id <N>` — 停用任务
- `history [--id <N>] [--limit 20]` — 查看发现历史

## 建立监控流程

1. **Jerry 提需求**：关键词、价格范围、地区、排除词等
2. **添加任务**：`node scripts/xianyu.js add --keyword "iPhone 16" --max-price 5000 --min-price 3000`
3. **测试扫描**：`node scripts/xianyu.js scan --hours 24` 确认能正常抓到结果
4. **创建 cron**：设定扫描频率（如每小时），推送新商品到 Discord 指定频道
5. **Jerry 看推送就行**

## Cron 任务模板

```
闲鱼监控扫描任务。工作目录: /Users/chaos/.openclaw/workspace

## 步骤 1：确保 Chrome 运行
运行：bash skills/xianyu-monitor/scripts/setup-chrome.sh start

## 步骤 2：执行扫描
运行：node skills/xianyu-monitor/scripts/xianyu.js scan --hours 24

## 步骤 3：推送结果
解析输出中 --- NEW_ITEMS_JSON --- 和 --- END_NEW_ITEMS_JSON --- 之间的 JSON 数组。

如果有新商品，逐条用 message 工具推送：
- action=send, channel=discord, accountId=xiaov, target=<频道ID>
- 格式：
🛒 **标题**（截取前60字）
💰 ¥价格 | 📍 地区 | 👤 卖家
⏰ 发布时间
🔗 https://www.goofish.com/item?id=商品ID

如果没有新商品，安静结束，不发消息。

🔴 完成后只回复一句确认（发现N条/无新商品），不贴原始数据
```

## 异常处理
- 如果闲鱼反爬（弹登录框、返回空结果），脚本会检测并输出 `--- COOKIE_EXPIRED ---`
- 此时需要在 Chrome 18803 访问 goofish.com 手动过一下验证（不一定要登录）
- 正常情况下不需要登录账号

## 数据存储
- SQLite: `data/xianyu-monitor.db`
- tasks 表: 监控任务配置
- items 表: 已发现商品（自动去重）

## API 参考
详见 `references/api-notes.md`

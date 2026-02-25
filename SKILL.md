---
name: xianyu-monitor
description: 闲鱼商品监控与捡漏工具。定时搜索闲鱼，发现新商品后推送通知。Use when: user wants to monitor 闲鱼/Xianyu/Goofish for specific items, set up price alerts, track second-hand goods, or find rental listings on 闲鱼. Supports keyword search, price range, text filters (exclude/include), time filter, dedup via SQLite.
---

# 闲鱼监控 (xianyu-monitor)

## 架构

**核心原理**：非 headless Chrome + CDP 搜索框输入 + DOM 被动读取

闲鱼（goofish.com）有严格的反自动化检测：
- ❌ `page.goto(searchURL)` → 被 baxia 风控拦截
- ❌ headless Chrome → 检测到 "非法访问"
- ✅ **非 headless Chrome** + `page.click(搜索框)` + `page.keyboard.type()` + `Enter` → 正常返回结果
- ✅ 首次访问用 **AppleScript 地址栏导航**（模拟人类在地址栏输入 URL）

不需要登录、不需要 cookie 管理、不需要 cliclick。

## 前置条件

1. **macOS**（需要 AppleScript 控制 Chrome 地址栏）
2. Chrome 非 headless 实例运行在 CDP 端口 18803（profile: `~/.chrome-debug-xianyu`）
3. `puppeteer-core` 和 `better-sqlite3` 已安装
4. Chrome 需要有**辅助功能权限**（System Events keystroke 需要）

## 启动 Chrome

```bash
bash scripts/setup-chrome.sh start    # 非 headless 模式
bash scripts/setup-chrome.sh status   # 检查状态
bash scripts/setup-chrome.sh stop     # 停止
```

⚠️ Chrome 必须以**非 headless** 模式运行，headless 会被闲鱼拦截。

## 核心脚本: scripts/xianyu.js

### 添加监控任务
```bash
node scripts/xianyu.js add --keyword "搜索词" \
  [--max-price 3000] [--min-price 500] \
  [--filter "排除词1,排除词2"] \
  [--only "必含词1,必含词2"] \
  [--region "深圳,龙华"]
```

### 执行扫描
```bash
node scripts/xianyu.js scan [--id <task_id>] [--hours 3]
```
- `--hours N`: 只返回 N 小时内发布的商品
- 搜索流程：复用已有闲鱼 tab → 搜索框输入关键词 → Enter → 等待结果 → DOM 提取
- 冷启动时自动用 AppleScript 导航到 goofish.com 建立 session
- 新商品输出在 `--- NEW_ITEMS_JSON ---` 和 `--- END_NEW_ITEMS_JSON ---` 之间

### 其他命令
- `list` — 查看所有活跃任务
- `remove --id <N>` — 停用任务
- `history [--id <N>] [--limit 20]` — 查看发现历史

## 建立监控流程

1. **确认需求**：关键词、价格范围、地区、排除词等
2. **启动 Chrome**：`bash scripts/setup-chrome.sh start`
3. **添加任务**：`node scripts/xianyu.js add --keyword "iPhone 16" --max-price 5000`
4. **测试扫描**：`node scripts/xianyu.js scan --hours 24`
5. **创建 cron**：设定扫描频率（如每小时），推送新商品到 Discord 指定频道

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

## 反爬要点

| 操作 | 结果 |
|------|------|
| `page.goto(searchURL)` | ❌ 被 baxia 拦截，显示登录墙 |
| `page.click(搜索框) + type + Enter` | ✅ 正常返回结果 |
| headless Chrome | ❌ "非法访问" |
| 非 headless Chrome | ✅ 正常 |
| AppleScript 设置 tab URL | ❌ 被拦截 |
| AppleScript Cmd+L 地址栏输入 | ✅ 正常（仅用于首次导航到首页） |

## 数据存储
- SQLite: `data/xianyu-monitor.db`
- tasks 表: 监控任务配置
- items 表: 已发现商品（自动去重）

## 故障排查

1. **"No element found for selector: input[class*=search-input]"**
   - Chrome 可能没有闲鱼 tab，或者首页加载失败
   - 重启 Chrome 后再试一次（第一次建立 session，第二次正常）

2. **搜索结果为 0**
   - 可能是过滤条件太严格
   - 用 `scan` 不带 `--hours` 试试

3. **Chrome 进程消失**
   - 检查: `bash scripts/setup-chrome.sh status`
   - 重启: `bash scripts/setup-chrome.sh stop && bash scripts/setup-chrome.sh start`

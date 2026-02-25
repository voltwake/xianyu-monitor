---
name: xianyu-monitor
description: 闲鱼商品监控与捡漏工具。定时搜索闲鱼，发现新商品后推送通知。Use when: user wants to monitor 闲鱼/Xianyu/Goofish for specific items, set up price alerts, track second-hand goods, or find rental listings on 闲鱼. Supports keyword search, price range, text filters (exclude/include), time filter, dedup via SQLite.
---

# 闲鱼监控 (xianyu-monitor)

## 架构

**核心原理**：非 headless Chrome + CDP 搜索框输入 + DOM 被动读取

闲鱼（goofish.com）有严格的反自动化检测，本工具通过以下方式绕过：

1. **非 headless Chrome**：headless 模式会被拦截（"非法访问"）
2. **AppleScript 地址栏导航**：首次访问用 Cmd+L 输入 URL（`page.goto()` 被 baxia 拦截）
3. **CDP Input 搜索**：用 `page.click(搜索框)` + `page.keyboard.type()` + `Enter` 搜索（产生 `isTrusted=true` 事件，前端无法区分真人）
4. **两步排序**：点击"新发布"展开下拉菜单 → 点击"最新"选项
5. **DOM 被动读取**：从 `a[class*="feeds-item-wrap"]` 卡片中提取数据

## 登录 vs 未登录

| 状态 | 搜索结果范围 | 排序 |
|------|-------------|------|
| **未登录** | 只能看到 **6小时以上** 发布的商品 | 有限 |
| **已登录** | 可以看到 **实时发布** 的商品（含最近几分钟） | 完整（新发布→最新） |

**⚠️ 强烈建议登录闲鱼账号**，否则监控不到最新发布的商品，失去实效性。

### 登录方法
1. 启动 Chrome：`bash scripts/setup-chrome.sh start`
2. 在弹出的 Chrome 窗口中访问 `goofish.com`
3. 用手机扫码或短信验证码登录
4. Cookie 保存在 `~/.chrome-debug-xianyu` profile 中，约 **7 天有效**
5. 过期后需重新登录（脚本会输出 `COOKIE_EXPIRED` 提示）

### 登录状态检测
脚本扫描时会自动检测登录状态：
- 搜索结果中有"分钟前发布"的商品 → 已登录 ✅
- 搜索结果中最新的也是"6小时前发布" → 未登录或 cookie 过期 ⚠️

## 前置条件

1. **macOS**（需要 AppleScript 控制 Chrome 地址栏）
2. Chrome 非 headless 实例运行在 CDP 端口 18803（profile: `~/.chrome-debug-xianyu`）
3. `puppeteer-core` 和 `better-sqlite3` 已安装
4. Chrome 需要有**辅助功能权限**（System Events keystroke 需要）
5. **建议登录闲鱼账号**（用小号，防封号风险）

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
- 搜索流程：复用已有闲鱼 tab → 搜索框输入关键词 → Enter → 点击"新发布→最新" → DOM 提取
- 冷启动时自动用 AppleScript 导航到 goofish.com 建立 session
- 新商品输出在 `--- NEW_ITEMS_JSON ---` 和 `--- END_NEW_ITEMS_JSON ---` 之间

### 其他命令
- `list` — 查看所有活跃任务
- `remove --id <N>` — 停用任务
- `history [--id <N>] [--limit 20]` — 查看发现历史

## 建立监控流程

1. **启动 Chrome**：`bash scripts/setup-chrome.sh start`
2. **首次登录**：在 Chrome 窗口中访问 goofish.com，扫码登录
3. **添加任务**：`node scripts/xianyu.js add --keyword "iPhone 16" --max-price 5000`
4. **测试扫描**：`node scripts/xianyu.js scan --hours 24`（确认能拿到最新商品）
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
💰 ¥价格 | 📍 地区
⏰ 发布时间
🔗 https://www.goofish.com/item?id=商品ID

如果没有新商品，安静结束，不发消息。

🔴 完成后只回复一句确认（发现N条/无新商品），不贴原始数据
```

## 反爬要点

| 操作 | 结果 |
|------|------|
| `page.goto(searchURL)` | ❌ 被 baxia 拦截，显示登录墙 |
| `page.click(搜索框) + type + Enter` | ✅ 正常（CDP Input，isTrusted=true） |
| headless Chrome | ❌ "非法访问" |
| 非 headless Chrome | ✅ 正常 |
| AppleScript 设置 tab URL | ❌ 被拦截 |
| AppleScript Cmd+L 地址栏输入 | ✅ 正常（仅用于首次导航到首页） |
| JS `element.click()` | ⚠️ 风险（isTrusted=false，可被检测） |
| CDP `page.click()` | ✅ 安全（isTrusted=true，与真人点击无差别） |

## 数据存储
- SQLite: `data/xianyu-monitor.db`
- tasks 表: 监控任务配置
- items 表: 已发现商品（自动去重）

## 故障排查

1. **"No element found for selector: input[class*=search-input]"**
   - Chrome 可能没有闲鱼 tab，或首页加载失败
   - 重启 Chrome 再试（第一次建立 session，第二次正常）

2. **只能看到 6 小时前的商品**
   - Cookie 过期或未登录
   - 在 Chrome 窗口中重新扫码登录

3. **搜索结果为 0**
   - 过滤条件太严格，用 `scan` 不带 `--hours` 试试
   - 或者所有商品已经在数据库中（正常去重）

4. **Chrome 进程消失**
   - `bash scripts/setup-chrome.sh status` 检查
   - `bash scripts/setup-chrome.sh stop && bash scripts/setup-chrome.sh start` 重启

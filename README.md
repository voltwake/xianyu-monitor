# 🐟 xianyu-monitor — 闲鱼商品监控 OpenClaw Skill

让你的 AI agent 自动监控闲鱼（Goofish），新上架商品实时推送到 Discord / Telegram。

**零成本。不需要 API Key。不需要闲鱼账号。**

## ✨ 功能

- 🔍 **关键词搜索**：设定关键词，自动搜索闲鱼
- 💰 **价格过滤**：设定最低/最高价格范围
- 🚫 **排除关键词**：过滤掉"中介"、"碎屏"等不想要的结果
- ✅ **必含关键词**：只看包含"国行"、"256G"等特定词的商品
- 📍 **地区过滤**：限定搜索地区
- 🔄 **自动去重**：SQLite 数据库记录已发现商品，不会重复推送
- 📱 **实时推送**：新商品自动推送到 Discord / Telegram
- 🎯 **多任务并行**：同时监控多个关键词，互不干扰

## 📋 前置条件

- **macOS**（需要 AppleScript 控制 Chrome 地址栏）
- [OpenClaw](https://github.com/openclaw/openclaw) 已安装并运行
- Google Chrome（脚本会启动一个独立实例，不影响你日常使用的浏览器）
- Node.js 依赖：`puppeteer-core`、`better-sqlite3`

```bash
npm install puppeteer-core better-sqlite3
```

## 🚀 快速开始

### 1. 启动 Chrome 实例

```bash
bash scripts/setup-chrome.sh start
```

> ⚠️ Chrome 以**非 headless** 模式启动（闲鱼检测 headless 浏览器）

### 2. 添加监控任务

```bash
# 监控 iPhone 16，价格 3000-5000
node scripts/xianyu.js add --keyword "iPhone 16" --min-price 3000 --max-price 5000

# 监控租房，排除中介
node scripts/xianyu.js add --keyword "南山租房" --max-price 3000 --filter "中介费,中介勿扰"

# 监控稀缺品，不限价格
node scripts/xianyu.js add --keyword "Steam Deck 512G"
```

### 3. 手动测试

```bash
node scripts/xianyu.js scan --hours 24
```

### 4. 配置 OpenClaw Cron 定时任务

在 OpenClaw 对话中告诉 agent：

> "帮我建一个 cron 任务，每小时跑一次闲鱼监控，有新商品推送到 Discord #xxx 频道"

或手动配置 cron，payload 示例：

```
运行：bash scripts/setup-chrome.sh start
运行：node scripts/xianyu.js scan --hours 24

解析输出中 --- NEW_ITEMS_JSON --- 和 --- END_NEW_ITEMS_JSON --- 之间的 JSON 数组。
如果有新商品，逐条推送到 Discord。
格式：
🛒 **标题**
💰 ¥价格 | 📍 地区
⏰ 发布时间
🔗 https://www.goofish.com/item?id=商品ID
```

## 📖 完整命令

```bash
# 添加监控任务
node scripts/xianyu.js add --keyword "搜索词" \
  [--min-price 500] [--max-price 3000] \
  [--filter "排除词1,排除词2"] \
  [--only "必含词1,必含词2"] \
  [--region "深圳,龙华"]

# 查看所有任务
node scripts/xianyu.js list

# 执行扫描
node scripts/xianyu.js scan [--id <task_id>] [--hours 24]

# 查看发现历史
node scripts/xianyu.js history [--id <task_id>] [--limit 20]

# 停用任务
node scripts/xianyu.js remove --id <task_id>

# Chrome 管理
bash scripts/setup-chrome.sh start    # 启动
bash scripts/setup-chrome.sh status   # 检查状态
bash scripts/setup-chrome.sh stop     # 停止
```

## 🏗️ 技术原理

闲鱼（goofish.com）有严格的反自动化检测，本工具通过以下方式绕过：

1. **非 headless Chrome**：headless 模式会被闲鱼直接拦截（"非法访问"）
2. **AppleScript 地址栏导航**：首次访问闲鱼时，用 AppleScript 模拟在 Chrome 地址栏输入 URL（`page.goto()` 会被 baxia 风控拦截）
3. **CDP 搜索框输入**：用 `page.click()` + `page.keyboard.type()` 在闲鱼页面的搜索框中输入关键词并按 Enter（这不会触发反爬检测）
4. **DOM 被动读取**：从渲染后的页面 DOM 中提取商品卡片数据（`a[class*="feeds-item-wrap"]`）
5. **SQLite 去重**：与本地数据库比对，筛出新商品

| 操作 | 结果 |
|------|------|
| `page.goto(searchURL)` | ❌ 被 baxia 拦截 |
| `page.click(搜索框) + type + Enter` | ✅ 正常 |
| headless Chrome | ❌ "非法访问" |
| 非 headless Chrome | ✅ 正常 |

## 💰 成本

**零。** 不使用任何付费 API，不需要闲鱼账号。

唯一消耗：Chrome 实例约 200MB 内存 + OpenClaw cron 的模型费用（用 Kimi/Gemini 等便宜模型几乎免费）。

## ⚠️ 注意事项

- 扫描间隔建议 ≥ 30 分钟，过于频繁可能触发闲鱼反爬
- 冷启动（首次运行）可能需要两次 scan 才能成功（第一次建立 session）
- 当前仅支持 macOS（依赖 AppleScript 控制 Chrome）
- 不需要登录闲鱼账号

## 📄 License

MIT

## 🔗 相关

- [OpenClaw](https://github.com/openclaw/openclaw) — 开源 AI Agent 框架
- [ClewHub](https://clawhub.com) — OpenClaw Skills 市场

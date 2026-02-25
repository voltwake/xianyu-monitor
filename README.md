# 🐟 xianyu-monitor — 闲鱼商品监控 OpenClaw Skill

让你的 AI agent 自动监控闲鱼（Goofish），新上架商品实时推送到 Discord / Telegram。

**零成本。不需要 API Key。不需要闲鱼账号。**

## ✨ 功能

- 🔍 **关键词搜索**：设定关键词，自动搜索闲鱼
- 💰 **价格过滤**：设定最低/最高价格范围
- 🚫 **排除关键词**：过滤掉"碎屏"、"配件"等不想要的结果
- ✅ **必含关键词**：只看包含"国行"、"256G"等特定词的商品
- 🔄 **自动去重**：SQLite 数据库记录已发现商品，不会重复推送
- 📱 **实时推送**：新商品自动推送到 Discord / Telegram
- 🎯 **多任务并行**：同时监控多个关键词，互不干扰

## 📋 前置条件

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

### 2. 添加监控任务

```bash
# 监控 iPhone 16，价格 3000-5000
node scripts/xianyu.js add --keyword "iPhone 16" --min-price 3000 --max-price 5000

# 监控租房，排除"求租"帖
node scripts/xianyu.js add --keyword "南山租房" --max-price 3000 --filter "求租,转租费"

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

或者手动配置 cron，payload 示例：

```
运行：bash scripts/setup-chrome.sh start
运行：node scripts/xianyu.js scan --hours 24

解析输出中 --- NEW_ITEMS_JSON --- 和 --- END_NEW_ITEMS_JSON --- 之间的 JSON 数组。
如果有新商品，逐条推送到 Discord。
格式：
🛒 **标题**
💰 ¥价格 | 📍 地区 | 👤 卖家
⏰ 发布时间
🔗 https://www.goofish.com/item?id=商品ID
```

## 📖 完整命令

```bash
# 添加监控任务
node scripts/xianyu.js add --keyword "搜索词" \
  [--min-price 500] [--max-price 3000] \
  [--filter "排除词1,排除词2"] \
  [--only "必含词1,必含词2"]

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

1. 通过 Chrome CDP（Chrome DevTools Protocol）控制 headless 浏览器
2. 访问 `goofish.com/search?q=关键词` 搜索页面
3. 拦截闲鱼搜索 API（`h5api.m.goofish.com`）的响应数据
4. 解析商品信息（标题、价格、地区、卖家、发布时间等）
5. 与本地 SQLite 数据库比对，筛出新商品
6. 通过 OpenClaw 的消息工具推送到 Discord / Telegram

详细的 API 结构见 [references/api-notes.md](references/api-notes.md)。

## 💰 成本

**零。** 不使用任何付费 API，不需要闲鱼会员账号。

唯一消耗的是 Chrome 实例占用的约 200MB 内存，以及 OpenClaw cron 执行时的模型费用（用 Kimi 等便宜模型几乎免费）。

## ⚠️ 注意事项

- 扫描间隔建议 ≥ 30 分钟，过于频繁可能触发闲鱼反爬
- 如果搜索返回空结果，可能需要在 Chrome 中手动访问一次 goofish.com 过验证
- 正常情况下不需要登录闲鱼账号

## 📄 License

MIT

## 🔗 相关

- [OpenClaw](https://github.com/openclaw/openclaw) — 开源 AI Agent 框架
- [ClewHub](https://clawhub.com) — OpenClaw Skills 市场

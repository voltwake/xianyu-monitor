#!/usr/bin/env node
/**
 * xianyu.js - 闲鱼商品监控工具
 * 
 * 用法:
 *   node xianyu.js add --keyword "关键词" [--max-price 3000] [--min-price 500] [--region "广东/深圳"] [--filter "排除词1,排除词2"] [--only "必含词1,必含词2"]
 *   node xianyu.js remove --id <task_id>
 *   node xianyu.js list
 *   node xianyu.js scan [--id <task_id>] [--limit 30]
 *   node xianyu.js history [--id <task_id>] [--limit 20]
 * 
 * 环境变量:
 *   XIANYU_CDP_PORT  - Chrome CDP 端口 (默认 18803)
 *   XIANYU_DB_PATH   - SQLite 数据库路径 (默认 data/xianyu-monitor.db)
 */

const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

// ============ Config ============
const CDP_PORT = process.env.XIANYU_CDP_PORT || 18803;
const DB_PATH = process.env.XIANYU_DB_PATH || path.join(__dirname, '..', '..', '..', 'data', 'xianyu-monitor.db');
const SEARCH_API_PATTERN = 'h5api.m.goofish.com/h5/mtop.taobao.idlemtopsearch.pc.search';
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

// ============ DB Setup ============
let Database;
try {
  Database = require('better-sqlite3');
} catch {
  console.error('Error: better-sqlite3 not found. Run: npm install better-sqlite3');
  process.exit(1);
}

function getDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL,
      min_price REAL,
      max_price REAL,
      region TEXT,
      filter_out TEXT,
      must_include TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      last_scan TEXT,
      consecutive_empty INTEGER DEFAULT 0
    );
    
    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      task_id INTEGER,
      title TEXT,
      price REAL,
      area TEXT,
      seller TEXT,
      link TEXT,
      publish_time TEXT,
      want_count INTEGER,
      tags TEXT,
      original_price TEXT,
      image_url TEXT,
      discovered_at TEXT DEFAULT (datetime('now', 'localtime')),
      notified INTEGER DEFAULT 0,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_items_task ON items(task_id);
    CREATE INDEX IF NOT EXISTS idx_items_discovered ON items(discovered_at);
  `);
  
  return db;
}

// ============ Task Management ============
function cmdAdd(args) {
  if (!args.keyword) {
    console.error('Error: --keyword is required');
    process.exit(1);
  }
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO tasks (keyword, min_price, max_price, region, filter_out, must_include)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    args.keyword,
    args.minPrice || null,
    args.maxPrice || null,
    args.region || null,
    args.filter || null,
    args.only || null
  );
  console.log(`✅ 监控任务已创建 (ID: ${result.lastInsertRowid})`);
  console.log(`   关键词: ${args.keyword}`);
  if (args.maxPrice) console.log(`   最高价: ¥${args.maxPrice}`);
  if (args.minPrice) console.log(`   最低价: ¥${args.minPrice}`);
  if (args.region) console.log(`   地区: ${args.region}`);
  if (args.filter) console.log(`   排除: ${args.filter}`);
  if (args.only) console.log(`   必含: ${args.only}`);
  db.close();
}

function cmdRemove(args) {
  if (!args.id) { console.error('Error: --id is required'); process.exit(1); }
  const db = getDb();
  const result = db.prepare('UPDATE tasks SET active = 0 WHERE id = ?').run(args.id);
  if (result.changes) console.log(`✅ 任务 #${args.id} 已停用`);
  else console.log(`❌ 未找到任务 #${args.id}`);
  db.close();
}

function cmdList() {
  const db = getDb();
  const tasks = db.prepare('SELECT * FROM tasks WHERE active = 1').all();
  if (!tasks.length) {
    console.log('暂无活跃监控任务');
    db.close();
    return;
  }
  console.log(`📋 活跃监控任务 (${tasks.length} 个):\n`);
  for (const t of tasks) {
    const itemCount = db.prepare('SELECT COUNT(*) as cnt FROM items WHERE task_id = ?').get(t.id).cnt;
    console.log(`  #${t.id} | ${t.keyword}`);
    if (t.max_price) console.log(`     价格: ${t.min_price ? '¥' + t.min_price + '~' : '≤'}¥${t.max_price}`);
    if (t.region) console.log(`     地区: ${t.region}`);
    if (t.filter_out) console.log(`     排除: ${t.filter_out}`);
    if (t.must_include) console.log(`     必含: ${t.must_include}`);
    console.log(`     已发现: ${itemCount} 件 | 上次扫描: ${t.last_scan || '从未'}`);
    console.log();
  }
  db.close();
}

function cmdHistory(args) {
  const db = getDb();
  const limit = args.limit || 20;
  let query = 'SELECT i.*, t.keyword FROM items i JOIN tasks t ON i.task_id = t.id';
  const params = [];
  if (args.id) {
    query += ' WHERE i.task_id = ?';
    params.push(args.id);
  }
  query += ' ORDER BY i.discovered_at DESC LIMIT ?';
  params.push(limit);
  
  const items = db.prepare(query).all(...params);
  if (!items.length) {
    console.log('暂无发现记录');
    db.close();
    return;
  }
  console.log(`📦 最近发现 (${items.length} 件):\n`);
  for (const item of items) {
    console.log(`  [${item.keyword}] ${item.title}`);
    console.log(`    💰 ¥${item.price} | 📍 ${item.area} | 👤 ${item.seller}`);
    console.log(`    🔗 ${item.link}`);
    console.log(`    ⏰ ${item.publish_time} | 发现于 ${item.discovered_at}`);
    console.log();
  }
  db.close();
}

// ============ Core Scanner ============
async function cmdScan(args) {
  const db = getDb();
  let tasks;
  if (args.id) {
    tasks = db.prepare('SELECT * FROM tasks WHERE id = ? AND active = 1').all(args.id);
  } else {
    tasks = db.prepare('SELECT * FROM tasks WHERE active = 1').all();
  }
  
  if (!tasks.length) {
    console.log('没有需要扫描的任务');
    db.close();
    return;
  }
  
  let browser;
  try {
    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${CDP_PORT}` });
  } catch (e) {
    console.error(`❌ 无法连接 Chrome (端口 ${CDP_PORT}): ${e.message}`);
    console.error('请确保 Chrome 已启动: chrome --remote-debugging-port=' + CDP_PORT);
    db.close();
    process.exit(1);
  }
  
  const allNewItems = [];
  let cookieExpired = false;
  
  for (const task of tasks) {
    console.log(`\n🔍 扫描任务 #${task.id}: "${task.keyword}" ...`);
    try {
      const newItems = await scanTask(browser, db, task, args.limit || 30, args);
      allNewItems.push(...newItems);
      db.prepare("UPDATE tasks SET last_scan = datetime('now', 'localtime'), consecutive_empty = 0 WHERE id = ?").run(task.id);
      console.log(`   ✅ 发现 ${newItems.length} 件新商品`);
    } catch (e) {
      const msg = e.message || '';
      if (msg.includes('RGV587') || msg.includes('Cookie') || msg.includes('登录') || msg.includes('COOKIE_EXPIRED')) {
        cookieExpired = true;
        console.error(`   ⚠️ Cookie 可能过期: ${msg}`);
      } else {
        // Track consecutive empty/error scans
        db.prepare("UPDATE tasks SET last_scan = datetime('now', 'localtime'), consecutive_empty = consecutive_empty + 1 WHERE id = ?").run(task.id);
        const count = db.prepare("SELECT consecutive_empty FROM tasks WHERE id = ?").get(task.id)?.consecutive_empty || 0;
        if (count >= 2) {
          cookieExpired = true;
          console.error(`   ⚠️ 连续 ${count} 次扫描失败，Cookie 可能已过期`);
        }
        console.error(`   ❌ 扫描失败: ${msg}`);
      }
    }
  }
  
  browser.disconnect();
  db.close();
  
  // Output summary as JSON for cron consumption
  if (allNewItems.length > 0) {
    console.log('\n--- NEW_ITEMS_JSON ---');
    console.log(JSON.stringify(allNewItems, null, 2));
    console.log('--- END_NEW_ITEMS_JSON ---');
  } else {
    console.log('\n本次扫描无新商品');
  }
  
  if (cookieExpired) {
    console.log('\n--- COOKIE_EXPIRED ---');
  }
  
  return allNewItems;
}

async function scanTask(browser, db, task, limit, args = {}) {
  const page = await browser.newPage();
  const newItems = [];
  
  try {
    await page.setViewport({ width: 1280, height: 900 });
    
    // Anti-detection
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en-US', 'en'] });
      window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
    });
    
    // Step 1: Visit homepage first (anti-detection)
    await page.goto('https://www.goofish.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(1500 + Math.random() * 1500);
    
    // Step 2: Navigate to search
    const searchUrl = `https://www.goofish.com/search?q=${encodeURIComponent(task.keyword)}`;
    
    // Set up API response interception - collect ALL search responses
    const searchResponses = [];
    const searchErrors = [];
    page.on('response', async (resp) => {
      if (resp.url().includes(SEARCH_API_PATTERN)) {
        try {
          const json = await resp.json();
          const ret = JSON.stringify(json?.ret || []);
          if (ret.includes('RGV587') || ret.includes('FAIL_SYS_USER_VALIDATE') || ret.includes('SM::')) {
            searchErrors.push(ret);
          }
          if (json?.data?.resultList?.length > 0) {
            searchResponses.push(json);
          }
        } catch {}
      }
    });
    
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
    
    // Close login popup if it appears
    try {
      const closeBtn = await page.$('div[class*="closeIconBg"], button[class*="close"], .bax-close, [class*="modal"] [class*="close"]');
      if (closeBtn) {
        await closeBtn.click();
        console.log('   关闭了登录弹窗');
        await sleep(1000);
      }
    } catch {}
    
    // Also try pressing Escape to dismiss any popup
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(2000);
    
    // Close login popup if visible
    try {
      const closeBtn2 = await page.$('div[class*="closeIconBg"]');
      if (closeBtn2) { await closeBtn2.click(); await sleep(1000); }
    } catch {}
    
    // Click "新发布" to sort by newest
    try {
      await page.click('text=新发布');
      console.log('   已切换为"新发布"排序');
      await sleep(3000);
    } catch {
      console.log('   未找到"新发布"按钮，使用默认排序');
    }
    
    // If no results yet, try scrolling or re-searching
    if (searchResponses.length === 0) {
      await page.evaluate(() => window.scrollBy(0, 300));
      await sleep(3000);
    }
    
    if (searchResponses.length === 0) {
      console.log('   首次搜索无结果，尝试重新搜索...');
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(5000);
      await page.keyboard.press('Escape').catch(() => {});
      await sleep(1000);
      try { await page.click('text=新发布'); await sleep(3000); } catch {}
    }
    
    // Wait a bit more for any pending responses
    await sleep(2000);
    
    const apiData = searchResponses.length > 0 ? searchResponses[searchResponses.length - 1] : null;
    if (!apiData) {
      // Check if we got an auth error in any response
      if (searchErrors.length > 0) {
        throw new Error('COOKIE_EXPIRED: ' + searchErrors[0]);
      }
      console.log('   未获取到搜索数据（可能需要重新登录）');
      return newItems;
    }
    
    // Parse results
    const resultList = apiData?.data?.resultList || [];
    if (!resultList.length) {
      console.log('   搜索结果为空');
      return newItems;
    }
    
    console.log(`   获取到 ${resultList.length} 条搜索结果，开始过滤...`);
    
    const filterOut = task.filter_out ? task.filter_out.split(',').map(s => s.trim().toLowerCase()) : [];
    const mustInclude = task.must_include ? task.must_include.split(',').map(s => s.trim().toLowerCase()) : [];
    
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO items (id, task_id, title, price, area, seller, link, publish_time, want_count, tags, original_price, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    let count = 0;
    for (const item of resultList) {
      if (count >= limit) break;
      
      const main = item?.data?.item?.main;
      if (!main) continue;
      
      const exContent = main.exContent || {};
      const clickArgs = main.clickParam?.args || {};
      
      const itemId = exContent.itemId || clickArgs.itemId;
      if (!itemId) continue;
      
      const title = exContent.title || '未知标题';
      const titleLower = title.toLowerCase();
      
      // Price parsing
      const priceParts = exContent.price || [];
      let priceStr = '';
      if (Array.isArray(priceParts)) {
        priceStr = priceParts.map(p => (typeof p === 'object' ? p.text || '' : '')).join('').replace('当前价', '').trim();
      }
      let price = parseFloat(priceStr.replace(/[¥￥,]/g, ''));
      if (priceStr.includes('万')) price = parseFloat(priceStr.replace(/[¥￥万,]/g, '')) * 10000;
      if (isNaN(price)) price = 0;
      
      const area = exContent.area || '未知';
      const seller = exContent.userNickName || '匿名';
      const rawLink = main.targetUrl || '';
      const link = rawLink.replace('fleamarket://', 'https://www.goofish.com/');
      const pubTs = clickArgs.publishTime;
      const publishTime = pubTs && /^\d+$/.test(pubTs) 
        ? new Date(parseInt(pubTs)).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
        : '未知';
      const wantCount = parseInt(clickArgs.wantNum) || 0;
      const originalPrice = exContent.oriPrice || '';
      const imageUrl = exContent.picUrl || '';
      
      // Tags
      const tags = [];
      if (clickArgs.tag === 'freeship') tags.push('包邮');
      const r1Tags = exContent.fishTags?.r1?.tagList || [];
      for (const t of r1Tags) {
        if (t?.data?.content?.includes('验货宝')) tags.push('验货宝');
      }
      
      // ---- Filters ----
      // Time filter (--hours)
      if (args.hours && pubTs && /^\d+$/.test(pubTs)) {
        const pubDate = new Date(parseInt(pubTs));
        const hoursAgo = (Date.now() - pubDate.getTime()) / (1000 * 60 * 60);
        if (hoursAgo > args.hours) continue;
      }
      
      // Price filter
      if (task.max_price && price > task.max_price) continue;
      if (task.min_price && price < task.min_price) continue;
      
      // Region filter: title or area must contain region keyword
      if (task.region) {
        const regionWords = task.region.split(',').map(s => s.trim().toLowerCase());
        const textToCheck = (title + ' ' + area).toLowerCase();
        if (!regionWords.some(r => textToCheck.includes(r))) continue;
      }
      
      // Text filter: exclude
      if (filterOut.length && filterOut.some(f => titleLower.includes(f))) continue;
      
      // Text filter: must include (any match)
      if (mustInclude.length && !mustInclude.some(f => titleLower.includes(f))) continue;
      
      // Dedup check
      const existing = db.prepare('SELECT id FROM items WHERE id = ?').get(String(itemId));
      if (existing) continue;
      
      // Insert
      insertStmt.run(
        String(itemId), task.id, title, price, area, seller, link,
        publishTime, wantCount, JSON.stringify(tags), originalPrice, imageUrl
      );
      
      const newItem = {
        id: itemId, taskId: task.id, taskKeyword: task.keyword,
        title, price, area, seller, link, publishTime, wantCount, 
        tags, originalPrice, imageUrl
      };
      newItems.push(newItem);
      count++;
    }
    
  } finally {
    await page.close().catch(() => {});
  }
  
  return newItems;
}

// ============ Helpers ============
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ============ CLI ============
function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0];
  const parsed = { command };
  
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--keyword' || arg === '-k') parsed.keyword = args[++i];
    else if (arg === '--max-price') parsed.maxPrice = parseFloat(args[++i]);
    else if (arg === '--min-price') parsed.minPrice = parseFloat(args[++i]);
    else if (arg === '--region' || arg === '-r') parsed.region = args[++i];
    else if (arg === '--filter' || arg === '-f') parsed.filter = args[++i];
    else if (arg === '--only' || arg === '-o') parsed.only = args[++i];
    else if (arg === '--id') parsed.id = parseInt(args[++i]);
    else if (arg === '--limit' || arg === '-l') parsed.limit = parseInt(args[++i]);
    else if (arg === '--hours') parsed.hours = parseFloat(args[++i]);
    else if (arg === '--help' || arg === '-h') { printHelp(); process.exit(0); }
  }
  return parsed;
}

function printHelp() {
  console.log(`
闲鱼监控工具 - xianyu.js

用法:
  node xianyu.js <command> [options]

命令:
  add       添加监控任务
  remove    停用监控任务
  list      查看所有活跃任务
  scan      执行扫描（所有任务或指定任务）
  history   查看发现历史

add 选项:
  --keyword, -k  搜索关键词（必填）
  --max-price    最高价格
  --min-price    最低价格
  --region, -r   地区筛选
  --filter, -f   标题排除词（逗号分隔）
  --only, -o     标题必含词（逗号分隔，满足任一即可）

scan 选项:
  --id           只扫描指定任务
  --limit, -l    每个任务最多处理条数（默认30）

history 选项:
  --id           只看指定任务
  --limit, -l    显示条数（默认20）

环境变量:
  XIANYU_CDP_PORT  Chrome CDP 端口（默认 18803）
  XIANYU_DB_PATH   数据库路径（默认 data/xianyu-monitor.db）

示例:
  node xianyu.js add -k "深圳龙华租房" --max-price 3000 -f "中介,房产,地产"
  node xianyu.js scan
  node xianyu.js list
  node xianyu.js history --limit 10
`);
}

async function main() {
  const args = parseArgs();
  
  switch (args.command) {
    case 'add': cmdAdd(args); break;
    case 'remove': cmdRemove(args); break;
    case 'list': cmdList(); break;
    case 'scan': await cmdScan(args); break;
    case 'history': cmdHistory(args); break;
    default:
      if (!args.command) printHelp();
      else console.error(`未知命令: ${args.command}\n运行 --help 查看帮助`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });

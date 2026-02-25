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
  const newItems = [];
  
  try {
    // Get or create a goofish tab
    const pages = await browser.pages();
    let page = pages.find(p => p.url().includes('goofish.com'));
    if (!page) {
      // No existing goofish tab — use AppleScript to navigate (page.goto gets blocked by baxia)
      const { execSync } = require('child_process');
      // Use whichever tab is available, or the first one
      page = pages.find(p => !p.url().startsWith('chrome://')) || pages[0];
      if (!page) page = await browser.newPage();
      console.log('   首次访问闲鱼，使用地址栏导航...');
      execSync(`osascript -e 'tell application "Google Chrome" to activate'`);
      await sleep(300);
      execSync(`osascript -e 'tell application "System Events" to keystroke "l" using command down'`);
      await sleep(200);
      execSync(`osascript -e 'tell application "System Events" to keystroke "goofish.com"'`);
      await sleep(200);
      execSync(`osascript -e 'tell application "System Events" to key code 36'`); // Enter
      await sleep(6000);
      // Re-find the page after navigation
      const newPages = await browser.pages();
      page = newPages.find(p => p.url().includes('goofish.com'));
      if (!page) {
        console.log('   ❌ 无法打开闲鱼');
        return newItems;
      }
      // Close login popup and wait for search input to be ready
      await page.evaluate(() => {
        document.querySelectorAll('[class*="closeIcon"], [class*="close-btn"], [class*="dialog"] [class*="close"]')
          .forEach(btn => btn.click());
      }).catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
      await sleep(1000);
    }
    
    // Close login popups via DOM click + Escape
    await page.evaluate(() => {
      document.querySelectorAll('[class*="closeIcon"], [class*="close-btn"], [class*="dialog"] [class*="close"]')
        .forEach(btn => btn.click());
    }).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(500);
    
    // KEY INSIGHT: page.goto() gets blocked by baxia, but typing in the search box works!
    // Use CDP Input events (page.click/type/press) to search via the on-page search box
    // Wait for search input to appear (may take time on first load)
    try {
      await page.waitForSelector('input[class*="search-input"]', { timeout: 10000 });
    } catch {
      console.log('   等待搜索框超时，尝试关闭弹窗...');
      await page.evaluate(() => {
        document.querySelectorAll('[class*="closeIcon"], [class*="close-btn"], [class*="dialog"] [class*="close"]')
          .forEach(btn => btn.click());
      }).catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
      await sleep(2000);
    }
    await page.click('input[class*="search-input"]');
    await page.click('input[class*="search-input"]', { clickCount: 3 }); // select all existing text
    await sleep(200);
    await page.keyboard.type(task.keyword, { delay: 50 + Math.random() * 80 });
    await sleep(300 + Math.random() * 300);
    await page.keyboard.press('Enter');
    console.log('   使用搜索框输入关键词');
    
    // Wait for results to load
    await sleep(5000 + Math.random() * 2000);
    
    // Close popup again (goofish shows login popup on every page change)
    await page.evaluate(() => {
      document.querySelectorAll('[class*="closeIcon"], [class*="close-btn"], [class*="dialog"] [class*="close"]')
        .forEach(btn => btn.click());
    }).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(500);
    
    // Click "新发布" to sort by newest — use page.click (CDP Input event) not JS el.click()
    try {
      // Find the "新发布" button
      const foundNew = await page.evaluate(() => {
        const els = document.querySelectorAll('div, span, a');
        for (const el of els) {
          if (el.textContent?.trim() === '新发布' && el.offsetParent !== null) {
            el.setAttribute('data-xianyu-sort', 'new');
            return true;
          }
        }
        return false;
      });
      if (foundNew) {
        await page.click('[data-xianyu-sort="new"]');
        await sleep(1000);
        
        // Now click "最新" from the dropdown menu
        const foundLatest = await page.evaluate(() => {
          const els = document.querySelectorAll('div, span, a, li');
          for (const el of els) {
            if (el.textContent?.trim() === '最新' && el.offsetParent !== null) {
              el.setAttribute('data-xianyu-sort', 'latest');
              return true;
            }
          }
          return false;
        });
        
        if (foundLatest) {
          await page.click('[data-xianyu-sort="latest"]');
          console.log('   已切换为"新发布 -> 最新"排序');
          await sleep(3000 + Math.random() * 1000);
        } else {
          console.log('   点击了"新发布"，但未找到"最新"选项');
        }
      } else {
        console.log('   未找到"新发布"按钮');
      }
    } catch (e) {
      console.log('   切换排序失败:', e.message);
    }
    
    // Wait for items to appear
    let retries = 3;
    let domItems = [];
    while (retries-- > 0) {
      domItems = await page.evaluate(() => {
        const results = [];
        const cards = document.querySelectorAll('a[class*="feeds-item-wrap"]');
        for (const card of cards) {
          const href = card.href || '';
          const idMatch = href.match(/id=(\d+)/);
          if (!idMatch) continue;
          const id = idMatch[1];
          const text = card.innerText || '';
          const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
          
          // Title: longest meaningful line
          let title = '';
          for (const line of lines) {
            if (line.length > 10 && !line.match(/^[¥￥\d]/) && !line.match(/^\d+[小时天分钟]+/)) {
              title = line; break;
            }
          }
          if (!title) title = lines[0] || '';
          
          const priceMatch = text.match(/[¥￥]\s*([\d,.]+)/);
          const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : 0;
          
          const timeMatch = text.match(/(\d+[小时天分钟]+前发布)/);
          const publishTime = timeMatch ? timeMatch[0] : '';
          
          const areaPatterns = text.match(/([\u4e00-\u9fa5]{2,}[市省区县])/g);
          const area = areaPatterns ? areaPatterns[0] : '';
          
          const wantMatch = text.match(/(\d+)人想要/);
          const wantCount = wantMatch ? parseInt(wantMatch[1]) : 0;
          
          const img = card.querySelector('img[src*="alicdn"], img[src*="goofish"]');
          const imageUrl = img ? img.src : '';
          
          results.push({ id, title, price, area, publishTime, wantCount, imageUrl });
        }
        return results;
      });
      
      if (domItems.length > 0) break;
      console.log('   等待页面加载...');
      await sleep(3000);
    }
    
    if (domItems.length === 0) {
      console.log('   未获取到搜索数据');
      return newItems;
    }
    
    console.log(`   获取到 ${domItems.length} 条搜索结果，开始过滤...`);
    
    const filterOut = task.filter_out ? task.filter_out.split(',').map(s => s.trim().toLowerCase()) : [];
    const mustInclude = task.must_include ? task.must_include.split(',').map(s => s.trim().toLowerCase()) : [];
    
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO items (id, task_id, title, price, area, seller, link, publish_time, want_count, tags, original_price, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    let count = 0;
    for (const item of domItems) {
      if (count >= limit) break;
      
      const { id: itemId, title, price, area, publishTime, wantCount, imageUrl } = item;
      if (!itemId) continue;
      
      const titleLower = title.toLowerCase();
      const link = `https://www.goofish.com/item?id=${itemId}`;
      
      // ---- Filters ----
      // Time filter (--hours) — parse relative time like "16小时前发布"
      if (args.hours && publishTime) {
        const hMatch = publishTime.match(/(\d+)小时/);
        const dMatch = publishTime.match(/(\d+)天/);
        const mMatch = publishTime.match(/(\d+)分钟/);
        let hoursAgo = 0;
        if (hMatch) hoursAgo = parseInt(hMatch[1]);
        else if (dMatch) hoursAgo = parseInt(dMatch[1]) * 24;
        else if (mMatch) hoursAgo = parseInt(mMatch[1]) / 60;
        if (hoursAgo > args.hours) continue;
      }
      
      // Price filter
      if (task.max_price && price > task.max_price) continue;
      if (task.min_price && price < task.min_price) continue;
      
      // Region filter
      if (task.region) {
        const regionWords = task.region.split(',').map(s => s.trim().toLowerCase());
        const textToCheck = (title + ' ' + area).toLowerCase();
        if (!regionWords.some(r => textToCheck.includes(r))) continue;
      }
      
      // Text filter: exclude
      if (filterOut.length && filterOut.some(f => titleLower.includes(f))) continue;
      
      // Text filter: must include
      if (mustInclude.length && !mustInclude.some(f => titleLower.includes(f))) continue;
      
      // Dedup check
      const existing = db.prepare('SELECT id FROM items WHERE id = ?').get(String(itemId));
      if (existing) continue;
      
      // Insert
      insertStmt.run(
        String(itemId), task.id, title, price, area, '未知', link,
        publishTime, wantCount, '[]', '', imageUrl
      );
      
      const newItem = {
        id: itemId, taskId: task.id, taskKeyword: task.keyword,
        title, price, area, seller: '未知', link, publishTime, wantCount,
        tags: [], originalPrice: '', imageUrl
      };
      newItems.push(newItem);
      count++;
    }
    
  } catch (err) {
    console.log(`   ❌ 扫描失败: ${err.message}`);
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

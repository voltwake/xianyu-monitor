# 闲鱼 API 端点 & 数据结构

## 搜索 API
- **URL**: `h5api.m.goofish.com/h5/mtop.taobao.idlemtopsearch.pc.search`
- **触发方式**: 浏览器访问 `goofish.com/search?q=关键词` 时自动请求
- **响应路径**: `data.resultList[]`

### 搜索结果结构
```
data.resultList[].data.item.main
  ├── exContent
  │   ├── title        - 商品标题
  │   ├── price[]      - 价格数组 [{text: "¥3000"}]
  │   ├── oriPrice     - 原价
  │   ├── area         - 发货地区
  │   ├── userNickName - 卖家昵称
  │   ├── itemId       - 商品 ID
  │   ├── picUrl       - 主图 URL
  │   └── fishTags.r1.tagList[].data.content - 标签(验货宝等)
  ├── clickParam.args
  │   ├── publishTime  - 发布时间戳(ms)
  │   ├── wantNum      - "想要"人数
  │   └── tag          - "freeship"=包邮
  └── targetUrl        - 商品链接(fleamarket:// 或 https://)
```

## 详情 API
- **URL**: `h5api.m.goofish.com/h5/mtop.taobao.idle.pc.detail`
- **响应路径**: `data.itemDO`, `data.sellerDO`

## 反检测要点
- 必须先访问首页建立 session
- 模拟移动端 UA + viewport + touch
- `navigator.webdriver = undefined`
- 随机延迟(1-5s)
- Cookie 有效期约 7 天，过期需重新扫码

## 风控标识
- `baxia-dialog` 弹窗 → 验证码
- `FAIL_SYS_USER_VALIDATE` → 账号被拦截
- 建议扫描间隔 ≥ 30 分钟

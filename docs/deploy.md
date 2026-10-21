# 部署与运维手册

## 一、飞书通知是怎么工作的

```
买家点「提交需求」
   ↓
index.html 里 submitInquiry() 收集字段
   ↓
fetch POST /.netlify/functions/inquiry   （JSON）
   ↓
inquiry.mjs 组装「交互卡片」
   ↓
POST FEISHU_WEBHOOK  →  飞书群 📩 卡片
```

**你收到的通知长这样：**

> 📩 **新询价 · 汇采国际官网**
> 客户类型：贸易商 / Importer
> 联系人：Jean
> 邮箱：jean@example.com
> 电话：+257 79 000 000
> 目的国：Burundi
> 采购需求：日用百货 / 日化、物流与单证
> 采购预算：US$20,000 – 50,000
> 期望交货：1–3 个月
> 补充说明：需要 2000 件塑料椅…
> ─────────────
> 语言 fr · 来源 … · IP … · 时间 …

## 二、首次配置（只需做一次）

### 1. 拿到飞书 Webhook

1. 打开要接收通知的**飞书群**
2. 右上角 **设置** → **群机器人** → **添加机器人**
3. 选 **自定义机器人** → 起名（如「官网询价」）
4. **安全设置**二选一：
   - **最简单**：选「自定义关键词」，填 `询价`（卡片标题里含「新询价」，能匹配）
   - **更安全**：选「签名校验」，复制密钥
5. 复制 **Webhook 地址**（`https://open.feishu.cn/open-apis/bot/v2/hook/...`）

### 2. 填进 Netlify

Netlify 后台 → 你的站点 → **Site configuration** → **Environment variables**：

| Key | Value |
| --- | --- |
| `FEISHU_WEBHOOK` | 上一步复制的地址 |
| `FEISHU_SECRET` | 仅当选了「签名校验」时填，否则留空 |

> ⚠️ 群 ID `idoc_532a8bb2172c84a6d343380f9e61cc2b` 是**群标识**，
> 自定义机器人 Webhook 与它是两回事 —— Webhook 才是实际推送通道。

### 3. 重新部署

环境变量改动后需要 **Deploys → Trigger deploy → Clear cache and deploy site** 才会生效。

## 三、验证链路

```bash
curl -X POST https://你的域名/.netlify/functions/inquiry \
  -H 'Content-Type: application/json' \
  -d '{"name":"测试","email":"test@example.com","country":"Test","details":"链路测试"}'
```

期望返回：

```json
{"ok":true,"feishu":{"status":200,"body":"{\"code\":0,\"msg\":\"success\"}"}}
```

看到 `code: 0` + `msg: success` 就说明**卡片已进群**。

## 四、三级保险机制

| 级别 | 通道 | 触发条件 |
| --- | --- | --- |
| ① | `localStorage` 本地留档 | 永远执行，没网也不丢单 |
| ② | **飞书直推**（主通道） | 默认走这条 |
| ③ | Netlify Forms 兜底 | ② 抛错时自动退回 |

②③ 都失败才退回「复制摘要 + 打开邮件客户端」。

## 五、附件上传

- 前端：拖拽/点选，**≤4MB / 最多 3 个**
- 允许格式：`xls xlsx csv doc docx pdf ppt pptx jpg jpeg png webp gif zip rar 7z txt`
- 存储：Netlify Blobs，store 名 `inquiry-files`
- 下载：`GET /.netlify/functions/upload?id=<id>`

## 六、常见问题

**Q：飞书没收到通知？**

1. 先跑第三节的 curl 验证
2. 看返回里 `feishu.body` 的 `code`：
   - `19021` → 签名不对，检查 `FEISHU_SECRET`
   - `19024` → 关键词不匹配，把关键词改成 `询价`
   - `9499` → Webhook 地址写错
3. 确认改环境变量后**重新部署过**

**Q：本地怎么调试？**

```bash
npm i -g netlify-cli
netlify dev
# 访问 http://localhost:8888
```

**Q：怎么换通知群？**

在新群里建个机器人，把新的 Webhook 换进 `FEISHU_WEBHOOK`，重新部署即可。

## 七、安全清单

- [ ] `FEISHU_WEBHOOK` 只存在 Netlify 环境变量里，**不要写进 `index.html`**
- [ ] `.env` 已在 `.gitignore` 中，不会误提交
- [ ] 表单只收集询价所需信息，不收身份证 / 银行账号
- [ ] 页面无任何收款按钮 / 收款码（避免被误认为资金代收方）
- [ ] `robots.txt` 已屏蔽搜索引擎收录（审核期）

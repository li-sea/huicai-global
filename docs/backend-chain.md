# 询价表单 · 后端链路说明

> 对应文件：`outputs/index.html` 里的 `#contact` 询价表单
> 一句话：**前端只负责收集，后端负责「存下来 + 通知你」**。当前网页默认走「零后端」模式，接后端时只改一行。

---

## 一、链路总图

```
【客户端】                          【传输】                【服务端】                     【数据 / 通知】
买家打开网页（无需注册）
    │
    ├─ 填写：姓名 / 邮箱 / 目的国 / 品类 / 需求描述
    │
    └─ 点击「提交需求」
            │
            ├── ① 本地留档：localStorage['inquiries']   ← 没网也不会丢单
            │
            └── ② 判断 FORM_CONFIG.endpoint
                    │
           ┌────────┴─────────┐
     endpoint 为空          endpoint 有值
     （阶段 1 默认）         （阶段 2/3 之后）
           │                     │
   复制摘要 + 打开邮件     fetch POST (JSON)
   mailto:contact@...          │
           │                   ▼
           │            /api/inquiry（Serverless 或 Node 服务）
           │                   │
           │         ┌─────────┼──────────┐
           │         ▼         ▼          ▼
           │     写数据库   发邮件通知   回执给前端
           │   (Supabase/    (Resend/   200 {ok:true}
           │    MySQL/KV)   阿里云邮件)      │
           │                   │           │
           └───────────────────┴───────────┘
                               │
                               ▼
                    前端显示「✓ 已收到，24 小时内联系您」
```

---

## 二、字段契约（前后端约定，不要随意改名）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `clientType` | string | — | 客户类型：企业采购 / 贸易商 / 政府公共机构 / NGO / 个人小微 / 其他 |
| `needs` | string | — | 采购需求，可多选，用「、」拼接：中国商品代买、机械设备、建材…物流与单证 |
| `budget` | string | — | 预算阶梯：US$5,000 以下 / 5,000–20,000 / 20,000–50,000 / 50,000–100,000 / 100,000–500,000 / 500,000 以上 |
| `timeline` | string | — | 期望交货：30 天内 / 1–3 个月 / 3–6 个月 / 尚未确定 |
| `name` | string | ✅ | 联系人姓名 |
| `company` | string | — | 公司 / 机构名称 |
| `email` | string | ✅ | 回信邮箱 |
| `country` | string | — | 目的国（布隆迪 / 越南 / 哈萨克斯坦…） |
| `phoneCode` | string | — | 电话区号（从带国旗的快捷选择器选，如 `+257`） |
| `phone` | string | — | 完整电话（区号 + 号码，如 `+257 79 000 000`）；没填电话时为空 |
| `channel` | string | — | 常用通讯工具：WhatsApp / WeChat 微信 / Telegram / X（推特）/ 电话 / 仅用邮箱 |
| `channelId` | string | — | 对应通讯工具的账号或号码（选了「仅用邮箱」时为空） |
| `details` | string | — | 补充说明（数量、规格、目标价、交货港等） |
| `lang` | string | — | 提交时的界面语言 zh/en/fr/pt，用于判断回信语种 |
| `page` | string | — | 提交页 URL，便于判断来源渠道 |
| `time` | string | — | ISO 时间戳，服务端应再存一份服务器时间 |

POST 示例：

```json
{
  "clientType": "贸易商 / Importer",
  "needs": "日用百货 / 日化、物流与单证",
  "budget": "US$20,000 – 50,000",
  "timeline": "1–3 个月",
  "name": "Jean",
  "company": "Burundi Trading SARL",
  "email": "jean@example.com",
  "country": "Burundi",
  "phoneCode": "+257",
  "phone": "+257 79 000 000",
  "channel": "WhatsApp",
  "channelId": "+257 79 000 000",
  "details": "需要 2000 件塑料椅，目标价 USD 3.2/件，交货港 Bujumbura",
  "lang": "fr",
  "page": "https://huicai-global.com/#contact",
  "time": "2026-09-29T06:12:00.000Z"
}
```

响应约定：成功 `200 {"ok":true}`；参数错误 `400`；服务异常 `500`。前端对非 2xx 会提示「提交失败 + 邮箱/微信兜底」。

---

## 三、三个阶段，按你的节奏升级

### 阶段 1 · 零成本（0–2 月启动期）— 现在就能用

不写后端。`FORM_CONFIG.endpoint` 留空，表单自动走：

```
提交 → 本地留档 → 复制需求摘要到剪贴板 → 打开邮件客户端（收件人已填好）
```

买家只要点一下发送，你就收到邮件。同时页面上还有「复制需求文本」按钮，方便非洲买家用 WhatsApp / 微信直接粘贴发你。

**成本：0 元。缺点：依赖买家本机装了邮件客户端；数据只存在买家浏览器里。**

---

### 阶段 2 · 第三方表单服务（想立刻收到结构化数据时）

用 Formspree / Web3Forms，把 endpoint 填成它们给的地址即可，**代码一行不用改**：

```js
const FORM_CONFIG = { endpoint: "https://formspree.io/f/xxxxxxx" };
```

```
表单 → Formspree API → 你的邮箱（含全部字段）+ 后台列表
```

免费额度约 50 条/月，够启动期跑通验证。

---

### 阶段 3 · 自建后端（3–6 月验证期 → 6–12 月扩张期）

```
买家提交
   ↓
Vercel Serverless Function  /api/inquiry   （或自有云服务器 Node/Express）
   ↓                    ↘
Supabase / MySQL 落库     Resend / 阿里云邮件推送（通知你）
   ↓
（扩张期再加）询价管理后台：列表 / 状态流转 / 导出 Excel
```

推荐栈与费用：

| 组件 | 服务 | 费用 |
| --- | --- | --- |
| 前端托管 | Vercel | 免费 |
| API | Vercel Serverless Functions | 免费 |
| 数据库 | Supabase / Vercel KV | 免费层够用 |
| 邮件通知 | Resend（3000 封/月）或阿里云邮件推送 | 免费层够用 |
| 自建服务器（扩张期） | 阿里云轻量 2核2G + 域名 + SSL | ≈ 600 元/年 |

后端最小实现见同目录 `inquiry-api-example.js`（Vercel Serverless，可直接改域名上线）。

---

## 四、接后端只改这一行

`outputs/index.html` 里的配置块：

```js
const FORM_CONFIG = {
  endpoint: "",                              // ← 只改这里
  toEmail : "contact@huicai-global.com",     // 无后端时的收件邮箱
  wechat  : "huicai-global"                  // 失败兜底提示用
};
```

改成：

```js
const FORM_CONFIG = { endpoint: "https://your-app.vercel.app/api/inquiry", ... };
```

前端会自动从「复制 + 打开邮件」切换到 `fetch POST`，成功文案也自动变成「已提交成功」。**其余代码不用动。**

---

## 五、上线路径（域名与链接）

1. **本地预览**：双击 `index.html`，或浏览器打开
   `file:///Users/apple/Documents/Codex/2026-09-29/the-user-says-the-link-doesn/outputs/index.html`
2. **临时外链（发给客户看）**：文件拖到 Netlify Drop / Vercel，10 秒出 `https://xxx.netlify.app` 链接
3. **正式域名**：买 `huicai-global.com`（.com 约 100 元/年），DNS 解析到 Vercel/Netlify，自动签发 SSL
4. **邮箱**：沿用同一域名开 `contact@huicai-global.com`（腾讯企业邮免费版 / 阿里云邮箱），保证回信不落到垃圾箱
5. **静态资源注意**：本页是单文件 HTML（CSS/JS 全内联），任何静态托管都能直接跑，无需构建

---

## 六、上线前检查清单

- [ ] 把页面里的占位信息换成真实信息：邮箱 `contact@huicai-global.com`、WhatsApp 号码、微信号、办公地址
- [ ] 社交链接目前是 `href="#"`，替换成真实主页地址
- [ ] 手机端打开检查一次导航菜单与表单（已在 ≤980px 断点适配）
- [ ] 用真实邮箱提交一次测试，确认能收到
- [ ] 接后端后，确认数据库有记录且邮件通知到达（含垃圾箱）
- [ ] 隐私说明：至少一句「我们仅将你提交的信息用于回复采购需求，不向第三方披露」

---

## 七、安全与合规红线（与你业务模式一致）

- 表单只收集**询价所需信息**，不收集身份证、银行账号等敏感数据
- 不代收货款 ⇒ 页面上不出现任何收款按钮/收款码，避免被误认为资金代收方
- 邮件通知里不要直接带买家完整邮箱明文进群聊，用后台查看
- 后端接口做基础防刷：同 IP 限频 + 隐藏蜜罐字段（可后续加）

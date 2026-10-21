# 汇采国际 HuiCai Global · 官网

> 以**国际贸易服务咨询**为中心、以**中国商品代买**为重点的跨境采购服务平台官网。
>
> **不囤货、不垫资、不代收货款** —— 只做采购代理与贸易咨询。

线上地址：<https://huicai-global-site.netlify.app>

---

## 一、技术栈

| 项目 | 说明 |
| --- | --- |
| 前端 | 单文件静态页 `index.html`（CSS/JS 全内联，零依赖、零构建） |
| 托管 | Netlify（免备案、自带 HTTPS） |
| 后端 | Netlify Functions（Serverless，Node.js ESM） |
| 通知 | **飞书群自定义机器人 Webhook** |
| 存储 | Netlify Blobs（采购资料附件） |
| 设计 | Apple 风格：`-apple-system` 字体栈、毛玻璃导航、主色 `#0071e3` |

## 二、目录结构

```
huicai-global/
├── index.html                      # 网站本体（1742 行，单文件）
├── images/                         # 配图（6 张图库图 + 1 张微信二维码）
│   ├── hero-port-night.jpg         #   首屏大图（CC0）
│   ├── cranes-sunset.jpg           #   跨境物流（CC BY 4.0）
│   ├── factory-line.jpg            #   商品代买（CC BY 2.0）
│   ├── warehouse-racks.jpg         #   验厂验货（CC BY 2.0）
│   ├── yiwu-market.jpg             #   义乌市场（CC BY 3.0）
│   ├── team-meeting.jpg            #   服务咨询（CC0）
│   └── wechat-qr.png               #   微信二维码
├── netlify/
│   └── functions/
│       ├── inquiry.mjs             # ⭐ 询价表单 → 飞书卡片
│       └── upload.mjs              # 附件上传 → Netlify Blobs
├── netlify.toml                    # Netlify 构建/函数/响应头配置
├── package.json                    # 依赖：@netlify/blobs
├── robots.txt                      # 屏蔽搜索引擎收录
├── .env.example                    # 环境变量模板（飞书 Webhook）
└── docs/
    ├── backend-chain.md            # 后端链路设计文档
    ├── photo-credits.md            # 图片版权署名清单
    └── deploy.md                   # 部署与运维手册
```

## 三、页面结构

```
topbar      顶部公告条（无需注册 · 免费提交采购需求）
nav         吸顶毛玻璃导航 · 6 语切换 · 移动端 ☰ 菜单
#hero       首屏（大图 + 渐变标题 + 双 CTA）
#business   四大业务模块
            ① 中国商品代买  ② 国际贸易服务咨询
            ③ 供应商筛选与验厂验货  ④ 跨境物流与单证
#process    服务流程「十步闭环，双通道获客」
#advantages 核心优势
#cases      成交案例（义乌日用百货 / 小型机械 / 建材）
#about      关于我们（四大纵深：供应链 / 合规 / 本地化 / 履约）
#contact    询价表单 + 联系方式（含微信二维码）
footer      页脚 + 图片署名
privacy     隐私政策弹层（GDPR 友好，不占主页版面）
```

## 四、多语言（6 种）

| 代码 | 语言 |
| --- | --- |
| `zh` | 中文 |
| `en` | English |
| `fr` | Français |
| `pt` | Português |
| `ru` | Русский |
| `sw` | Kiswahili（斯瓦希里语） |

实现：`data-i18n="key"` 属性 + JS 字典（`index.html` 内 `i18n` 对象），切换时改写 DOM。

## 五、询价表单链路（核心）

```
买家填表（无需注册）
   │
   ├─ ① 本地留档 localStorage['inquiries']        ← 没网也不丢单
   │
   ├─ ② POST /.netlify/functions/inquiry          ← 主通道
   │        └─ 飞书群自定义机器人 Webhook → 📩 卡片进群
   │              （失败自动退回 ③）
   │
   └─ ③ POST / （Netlify Forms）                  ← 兜底通道
            └─ Netlify 后台表单列表 + 邮件通知

附件：POST /.netlify/functions/upload → Netlify Blobs → 卡片里给下载链接
```

### 字段契约（前后端约定，不可随意改名）

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `name` | ✅ | 联系人姓名 |
| `email` | ✅ | 回信邮箱 |
| `clientType` | | 客户类型：企业采购 / 贸易商 / 政府 / NGO / 个人小微 / 其他 |
| `needs` | | 采购需求，多选，用「、」拼接 |
| `budget` | | 预算阶梯 |
| `timeline` | | 期望交货周期 |
| `company` | | 公司 / 机构名称 |
| `country` | | 目的国 |
| `phoneCode` / `phone` | | 带国旗的区号 + 完整电话 |
| `channel` / `channelId` | | 常用通讯工具 + 对应账号 |
| `details` | | 补充说明（数量、规格、目标价、交货港） |
| `files` | | 附件清单（`文件名 \| 大小 \| id`，分号分隔） |
| `consent` | | 隐私政策勾选 |
| `lang` | | 提交时界面语言，用于判断回信语种 |
| `page` | | 提交页 URL |

## 六、部署

### 环境变量（Netlify 后台必配）

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `FEISHU_WEBHOOK` | ✅ | 飞书群机器人 Webhook 地址 |
| `FEISHU_SECRET` | 可选 | 机器人开启签名校验时填 |

配置路径：Netlify 后台 → Site configuration → Environment variables

### 部署方式

**方式 A · Git 联动（推荐）**：推送到 GitHub，Netlify 自动构建部署。

**方式 B · 手动拖拽**：把整个文件夹拖到 <https://app.netlify.com/drop>。

**方式 C · CLI**：

```bash
npm i -g netlify-cli
netlify deploy --prod
```

## 七、待办

- [ ] **换成自己的实拍图**（工厂走访 / 装柜现场 / 团队合影 / 展会摊位），换完删掉页脚署名行
- [ ] 绑定正式域名 `huicai-global.com`（约 100 元/年）
- [ ] 开通企业邮箱 `contact@huicai-global.com`
- [ ] 页脚社交媒体链接（当前部分为 `href="#"`）
- [ ] 询价管理后台（列表 / 状态流转 / 导出 Excel）

## 八、图片版权

配图来自 Wikimedia Commons 与 Stocksnap 免费授权图库，可商用。
其中 CC BY 类图片**必须署名**，署名行已放在页脚。详见 `docs/photo-credits.md`。

> ⚠️ 若把图片挪用到 PPT、宣传册、社媒，请一并带上署名；或换成自己的实拍图后删除署名。

## 九、许可

本项目代码采用 MIT 许可。第三方依赖见 `package.json`。

/**
 * 汇采国际 · 官网询价函数
 * 路由：POST /.netlify/functions/inquiry
 *
 * 设计原则（A 方案：先入库、后通知）
 *  1. 网页直连本函数时，先把询价写入 Netlify Forms（后台可查、可导出）；
 *  2. 入库成功后推送飞书卡片；入库失败也在卡片上明确标记；
 *  3. 入库失败返回 502 + notified 标记，网页据此用原生表单兜底；
 *  4. 原生表单兜底带 viaFn=1，Netlify Forms 回调时不再重复推飞书；
 *  5. 附件只传文件 ID，下载走 /.netlify/functions/file?id=...
 *
 * 环境变量：
 *  FEISHU_WEBHOOK   飞书群机器人 Webhook（必填，否则只入库不通知）
 *  FEISHU_SECRET    机器人开启签名校验时填写（选填）
 *  SITE_URL         站点地址（选填，默认生产域名）
 */
import crypto from "node:crypto";

const SITE_URL = (process.env.SITE_URL || "https://huicai-global-site.netlify.app").replace(/\/+$/, "");
const FEISHU = process.env.FEISHU_WEBHOOK || "";
const FEISHU_SECRET = process.env.FEISHU_SECRET || "";
const FORMS_ADMIN = "https://app.netlify.com/sites/huicai-global-site/forms";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_LEN = {
  name: 80,
  company: 120,
  email: 120,
  country: 60,
  clientType: 60,
  needs: 300,
  budget: 40,
  timeline: 40,
  phoneCode: 12,
  phone: 40,
  channel: 30,
  channelId: 80,
  details: 3000,
  files: 600,
  subject: 200,
  lang: 8,
  page: 300,
  time: 40,
  inquiryId: 40,
  consent: 10,
};

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_IP = 6;
const RATE_MAX_EMAIL = 3;
const rateBuckets = new Map();

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clean(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim()
    .slice(0, max);
}

function parseDate(value) {
  const d = value ? new Date(value) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function shanghaiParts(d) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type) => (parts.find((p) => p.type === type) || {}).value || "00";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") === "24" ? "00" : get("hour"),
    minute: get("minute"),
  };
}

function makeInquiryId(value) {
  const p = shanghaiParts(parseDate(value));
  return `HC-INQ-${p.year}${p.month}${p.day}-${p.hour}${p.minute}`;
}

function fmtCN(value) {
  try {
    const p = shanghaiParts(parseDate(value));
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} (UTC+8)`;
  } catch {
    return parseDate(value).toISOString();
  }
}

function fmtUTC(value) {
  return parseDate(value).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

function sanitize(raw = {}) {
  const d = {};
  for (const [key, max] of Object.entries(MAX_LEN)) d[key] = clean(raw[key], max);
  if (!d.lang) d.lang = "en";
  if (!d.inquiryId) d.inquiryId = makeInquiryId(d.time);
  return d;
}

function validate(d) {
  if (!d.name) return { ok: false, field: "name", error: "Please fill in the contact name." };
  if (!d.email) return { ok: false, field: "email", error: "Please fill in the email address." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) {
    return { ok: false, field: "email", error: "The email address looks invalid." };
  }
  return { ok: true };
}

function rateHit(key, max) {
  const now = Date.now();
  const list = (rateBuckets.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= max) {
    rateBuckets.set(key, list);
    return false;
  }
  list.push(now);
  rateBuckets.set(key, list);
  // 防止长时间运行的实例无限增长
  if (rateBuckets.size > 2000) {
    for (const [k, v] of rateBuckets) {
      if (!v.some((t) => now - t < RATE_WINDOW_MS)) rateBuckets.delete(k);
    }
  }
  return true;
}

function clientIp(req) {
  return (
    (req.headers.get("x-nf-client-connection-ip") || "").trim() ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown"
  );
}

function escapeMd(value) {
  return String(value ?? "")
    .replace(/[*_~`]/g, "")
    .replace(/</g, "＜")
    .replace(/>/g, "＞");
}

function clip(value, max = 1000) {
  const text = escapeMd(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// "文件名 | 大小 | 文件ID; …" → [{name,size,id}]
function parseFiles(raw) {
  if (!raw) return [];
  return String(raw)
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [name, size, id] = s.split("|").map((x) => (x || "").trim());
      return { name: name || "附件 attachment", size, id };
    })
    .filter((f) => f.id && /^[A-Za-z0-9_-]{8,80}$/.test(f.id));
}

function signFeishu(secret, timestamp) {
  const stringToSign = `${timestamp}\n${secret}`;
  return crypto.createHmac("sha256", stringToSign).update("").digest("base64");
}

function buildCard(d, meta) {
  const files = parseFiles(d.files);
  const field = (cn, en, value) => ({
    is_short: true,
    text: {
      tag: "lark_md",
      content: `**${cn}**\n${en}\n${clip(value) || "—"}`,
    },
  });
  const block = (cn, en, value) => ({
    tag: "div",
    text: {
      tag: "lark_md",
      content: `**${cn}**\n${en}\n${clip(value, 1400) || "—"}`,
    },
  });

  const storedLine = meta.stored
    ? "✅ **已入库 Netlify Forms**\nSaved to Netlify Forms — visible in the site dashboard."
    : "⚠️ **未入库 Netlify Forms**\nNot saved to Netlify Forms yet — the browser will retry automatically.";

  const attachmentRows = files.map((f) => ({
    tag: "action",
    actions: [
      {
        tag: "button",
        text: {
          tag: "plain_text",
          content: `📄 ${f.name}${f.size ? "  " + f.size : ""}`.slice(0, 60),
        },
        type: "default",
        url: `${SITE_URL}/.netlify/functions/file?id=${encodeURIComponent(f.id)}`,
      },
    ],
  }));

  const actions = [
    {
      tag: "button",
      text: { tag: "plain_text", content: "📊 全部询价 All inquiries" },
      type: "primary",
      url: FORMS_ADMIN,
    },
  ];
  if (d.email) {
    actions.push({
      tag: "button",
      text: { tag: "plain_text", content: "✉️ 回邮件 Reply by email" },
      type: "default",
      url: `mailto:${encodeURIComponent(d.email)}?subject=${encodeURIComponent(
        `Re: ${d.inquiryId} — HuiCai Global sourcing inquiry`
      )}`,
    });
  }
  if (d.phone) {
    actions.push({
      tag: "button",
      text: { tag: "plain_text", content: "💬 WhatsApp" },
      type: "default",
      url: "https://wa.me/" + String(d.phone).replace(/[^0-9]/g, ""),
    });
  }

  const noteLines = [
    `提交时间 Submitted: ${fmtCN(d.time)}　·　${fmtUTC(d.time)}`,
    `来源 Source: ${d.page || "官网 Website"}　·　语言 Language: ${d.lang || "—"}`,
  ];
  if (meta.storeError) noteLines.push(`入库错误 Store error: ${clip(meta.storeError, 180)}`);

  return {
    config: { wide_screen_mode: true },
    header: {
      template: meta.stored ? "green" : "orange",
      title: { tag: "plain_text", content: "🆕 收到新的采购询价 / New sourcing inquiry" },
    },
    elements: [
      { tag: "div", text: { tag: "lark_md", content: storedLine } },
      { tag: "hr" },
      {
        tag: "div",
        fields: [
          field("询价编号", "Inquiry ID", d.inquiryId),
          field("客户类型", "Client type", d.clientType),
          field("联系人", "Contact person", d.name),
          field("公司 / 机构", "Company / Organisation", d.company),
          field("目的国", "Country", d.country),
          field("语言", "Language", d.lang),
        ],
      },
      { tag: "hr" },
      {
        tag: "div",
        fields: [
          field("邮箱", "Email", d.email),
          field("电话", "Phone", d.phone),
          field("通讯工具", "Messenger", d.channel),
          field("通讯账号", "Messenger ID", d.channelId),
        ],
      },
      { tag: "hr" },
      {
        tag: "div",
        fields: [
          field("采购需求", "What they need", d.needs),
          field("采购预算", "Budget", d.budget),
          field("期望交期", "Required timeline", d.timeline),
          field("上传材料", "Attachments", files.length ? `${files.length} 个文件` : "无 None"),
        ],
      },
      { tag: "hr" },
      block("需求描述", "Requirement details", d.details),
      ...(files.length
        ? [
            { tag: "hr" },
            {
              tag: "div",
              text: {
                tag: "lark_md",
                content: `**📎 客户上传的资料（${files.length}）**\n**Attachments from the client (${files.length})**`,
              },
            },
            ...attachmentRows,
          ]
        : []),
      { tag: "hr" },
      { tag: "action", actions },
      {
        tag: "note",
        elements: [{ tag: "plain_text", content: noteLines.join("\n") }],
      },
    ],
  };
}

async function pushFeishu(d, meta) {
  if (!FEISHU) return { ok: false, skipped: "no-webhook" };

  const payload = { msg_type: "interactive", card: buildCard(d, meta) };
  if (FEISHU_SECRET) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    payload.timestamp = timestamp;
    payload.sign = signFeishu(FEISHU_SECRET, timestamp);
  }

  let last = { ok: false, error: "not-sent" };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(FEISHU, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const text = (await res.text()).slice(0, 500);
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      const code = body && (body.code ?? body.StatusCode);
      if (res.ok && (code === 0 || code === undefined)) {
        return { ok: true, status: res.status };
      }
      last = { ok: false, status: res.status, body: text };
    } catch (err) {
      last = { ok: false, error: String(err).slice(0, 200) };
    } finally {
      clearTimeout(timer);
    }
    if (attempt === 0) await sleep(250);
  }
  console.error("[inquiry] Feishu push failed", last);
  return last;
}

async function forwardToNetlifyForms(d) {
  const body = new URLSearchParams();
  body.set("form-name", "inquiry");
  body.set("subject", `【官网询价】${d.country || "未填目的国"} · ${d.needs || "未选需求"}`);
  for (const [key, value] of Object.entries(d)) {
    if (key === "form-name") continue;
    body.set(key, value == null ? "" : String(value));
  }
  // 标记来源：Netlify Forms 回调时用于去重，避免飞书收到两张卡片
  body.set("viaFn", "1");

  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(`${SITE_URL}/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8",
          Referer: `${SITE_URL}/`,
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        },
        body: body.toString(),
      });
      const text = (await res.text()).slice(0, 2000);
      if (!res.ok) {
        lastError = new Error(`Netlify Forms HTTP ${res.status}: ${text.slice(0, 180)}`);
      } else if (/form not found|page not found/i.test(text)) {
        lastError = new Error("Netlify Forms did not recognise the inquiry form.");
      } else {
        return { status: res.status };
      }
    } catch (err) {
      lastError = err;
    }
    if (attempt === 0) await sleep(300);
  }
  throw lastError || new Error("Netlify Forms forwarding failed.");
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const contentType = req.headers.get("content-type") || "";
    let raw = {};
    let fromNetlifyForms = false;

    if (contentType.includes("application/json")) {
      const parsed = await req.json().catch(() => ({}));
      if (parsed && parsed.data && typeof parsed.data === "object") {
        // Netlify Forms outgoing webhook 的格式
        raw = { ...parsed.data, ...(parsed.human_fields || {}) };
        fromNetlifyForms = true;
      } else {
        raw = parsed || {};
      }
    } else {
      const form = await req.formData();
      for (const [key, value] of form.entries()) {
        raw[key] = typeof value === "string" ? value : "";
      }
    }

    // 蜜罐：正常用户不会填，填了当机器人丢弃
    if (raw["bot-field"]) return json({ ok: true, skipped: "bot" });

    const viaFn = String(raw.viaFn ?? "") === "1";
    const notifyOnly = String(raw.notifyOnly ?? "") === "1";
    const d = sanitize(raw);
    const checked = validate(d);
    if (!checked.ok) {
      return json(
        { ok: false, code: "invalid", field: checked.field, error: checked.error, fallback: false },
        400
      );
    }

    const ip = clientIp(req);

    // 只对网页直连做频率限制；Netlify Forms 回调不限制
    if (!fromNetlifyForms) {
      const ipOk = rateHit(`ip:${ip}`, RATE_MAX_IP);
      const emailOk = rateHit(`email:${d.email.toLowerCase()}`, RATE_MAX_EMAIL);
      if (!ipOk || !emailOk) {
        return json(
          {
            ok: false,
            code: "rate_limited",
            error: "Too many submissions. Please try again later or contact us by email.",
            fallback: false,
          },
          429
        );
      }
    }

    // Netlify Forms 回调：入库已经完成
    if (fromNetlifyForms) {
      if (viaFn) return json({ ok: true, stored: true, skipped: "duplicate" });
      const feishu = await pushFeishu(d, { ip, stored: true, source: "netlify-forms" });
      return json({ ok: true, stored: true, notified: feishu.ok === true, feishu });
    }

    // 网页原生表单已入库，这里只补发飞书通知
    if (notifyOnly) {
      const feishu = await pushFeishu(d, { ip, stored: true, source: "native-form" });
      return json({ ok: true, stored: true, notified: feishu.ok === true, feishu });
    }

    // 网页直连：先入库，再通知
    let stored = false;
    let storeError = null;
    try {
      await forwardToNetlifyForms(d);
      stored = true;
    } catch (err) {
      storeError = String(err).slice(0, 300);
      console.error("[inquiry] Netlify Forms store failed", err);
    }

    const feishu = await pushFeishu(d, { ip, stored, source: "website", storeError });
    const notified = feishu.ok === true;

    if (!stored) {
      return json(
        {
          ok: false,
          code: "form_store_failed",
          stored: false,
          notified,
          error: "The inquiry could not be saved to Netlify Forms.",
          detail: storeError,
          fallback: true,
        },
        502
      );
    }

    return json({ ok: true, stored: true, notified, feishu });
  } catch (err) {
    console.error("[inquiry] internal error", err);
    return json(
      { ok: false, code: "internal_error", error: String(err).slice(0, 200), fallback: true },
      500
    );
  }
};

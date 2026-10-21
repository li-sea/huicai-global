/**
 * 询价表单 → 飞书群机器人（自定义机器人 Webhook）
 * ------------------------------------------------------------------
 * 作用：官网「提交需求」直接推一张飞书卡片到群里，不依赖任何第三方表单服务。
 *
 * 环境变量（Netlify 后台 → Site configuration → Environment variables）：
 *   FEISHU_WEBHOOK   飞书群自定义机器人的 Webhook 地址
 *                    形如 https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx
 *   FEISHU_SECRET    机器人开启「签名校验」时填；未开启可留空
 *
 * 路由：POST /.netlify/functions/inquiry
 * ------------------------------------------------------------------
 */

import crypto from 'node:crypto';

const MAX_LEN = {
  name: 80, company: 120, email: 120, country: 60,
  clientType: 60, needs: 300, budget: 40, timeline: 40,
  phoneCode: 10, phone: 30, channel: 30, channelId: 80,
  details: 3000, files: 600, subject: 200
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function sanitize(body = {}) {
  const out = {};
  for (const key of Object.keys(MAX_LEN)) {
    out[key] = String(body[key] ?? '').slice(0, MAX_LEN[key]).trim();
  }
  out.lang = String(body.lang ?? 'zh').slice(0, 5);
  out.page = String(body.page ?? '').slice(0, 300);
  return out;
}

function isValid(data) {
  return data.name.length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email);
}

/** 飞书自定义机器人签名校验（开启签名时才需要） */
function sign(secret, timestamp) {
  const stringToSign = `${timestamp}\n${secret}`;
  return crypto.createHmac('sha256', stringToSign).update('').digest('base64');
}

/** 组装飞书交互卡片 */
function buildCard(d, meta) {
  const line = (label, value) =>
    value ? `**${label}：**${value}\n` : '';

  const body =
    line('客户类型', d.clientType) +
    line('联系人', d.name) +
    line('公司', d.company) +
    line('邮箱', d.email) +
    line('电话', d.phone || d.phoneCode) +
    line('目的国', d.country) +
    line('采购需求', d.needs) +
    line('采购预算', d.budget) +
    line('期望交货', d.timeline) +
    line('通讯工具', d.channel + (d.channelId ? `  |  ID: ${d.channelId}` : '')) +
    line('附件', d.files) +
    line('补充说明', d.details);

  return {
    msg_type: 'interactive',
    card: {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: '📩 新询价 · 汇采国际官网' },
        template: 'blue'
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: body || '（无内容）'
          }
        },
        { tag: 'hr' },
        {
          tag: 'note',
          elements: [{
            tag: 'plain_text',
            content: `语言 ${d.lang} · 来源 ${d.page || '-'} · IP ${meta.ip || '-'} · ${new Date().toISOString()}`
          }]
        }
      ]
    }
  };
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== 'POST') {
    return Response.json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: CORS });
  }

  try {
    const raw = await req.text();
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch { body = {}; }

    // 蜜罐字段：正常用户不会填，填了当机器人丢弃
    if (body['bot-field']) {
      return Response.json({ ok: true, skipped: 'bot' }, { headers: CORS });
    }

    const d = sanitize(body);
    if (!isValid(d)) {
      return Response.json(
        { ok: false, error: 'name and a valid email are required' },
        { status: 400, headers: CORS }
      );
    }

    const meta = {
      ip: (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    };

    const hook = process.env.FEISHU_WEBHOOK;
    if (!hook) {
      console.error('[inquiry] FEISHU_WEBHOOK 未配置');
      return Response.json({ ok: false, error: 'webhook-not-configured' }, { status: 500, headers: CORS });
    }

    const payload = buildCard(d, meta);

    // 若机器人开启了「签名校验」，补上 timestamp + sign
    const secret = process.env.FEISHU_SECRET;
    if (secret) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      payload.timestamp = timestamp;
      payload.sign = sign(secret, timestamp);
    }

    const res = await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const text = await res.text();

    console.log('[inquiry]', JSON.stringify({ name: d.name, country: d.country, feishu: res.status }));

    return Response.json(
      { ok: true, feishu: { status: res.status, body: text } },
      { headers: CORS }
    );
  } catch (err) {
    console.error('[inquiry] error', err);
    return Response.json({ ok: false, error: 'internal error' }, { status: 500, headers: CORS });
  }
};

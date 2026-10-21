/**
 * 询价表单后端接口 · 最小可用示例
 * ------------------------------------------------------------------
 * 部署方式 A（推荐，零服务器）：放到 Vercel 项目的 api/inquiry.js
 *   1) npm i -g vercel && vercel
 *   2) 在 Vercel 项目里配置环境变量（见下方 ENV）
 *   3) 部署后得到 https://<项目>.vercel.app/api/inquiry
 *   4) 把这个地址填进 index.html 的 FORM_CONFIG.endpoint
 *
 * 部署方式 B：自有服务器 Node/Express
 *   把 handler(req,res) 挂到 app.post('/api/inquiry', handler) 即可
 *
 * 环境变量 ENV：
 *   RESEND_API_KEY   Resend 邮件服务密钥（https://resend.com，免费 3000 封/月）
 *   NOTIFY_TO        接收询价通知的邮箱，如 contact@huicai-global.com
 *   NOTIFY_FROM      发信人，如 noreply@huicai-global.com（需在 Resend 验证域名）
 *   SUPABASE_URL     Supabase 项目地址（可选，不配则只发邮件不落库）
 *   SUPABASE_KEY     Supabase service role key（可选）
 * ------------------------------------------------------------------
 */

const MAX_LEN = {
  name: 80, company: 120, email: 120, country: 60,
  clientType: 60, needs: 300, budget: 40, timeline: 40,
  phoneCode: 10, phone: 30, channel: 30, channelId: 80, details: 3000
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

/** 落库（可选）：Supabase REST，不配环境变量就跳过 */
async function saveToDb(data, meta) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) return { skipped: true };

  const res = await fetch(`${url}/rest/v1/inquiries`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({
      name: data.name,
      company: data.company,
      email: data.email,
      country: data.country,
      phone_code: data.phoneCode,
      phone: data.phone,
      client_type: data.clientType,
      needs: data.needs,
      budget: data.budget,
      timeline: data.timeline,
      channel: data.channel,
      channel_id: data.channelId,
      details: data.details,
      lang: data.lang,
      page: data.page,
      source_ip: meta.ip
    })
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return { saved: true };
}

/** 邮件通知 */
async function notify(data, meta) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.NOTIFY_TO;
  const from = process.env.NOTIFY_FROM;
  if (!apiKey || !to || !from) return { skipped: true };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: data.email,
      subject: `【新询价】${data.country || '未填目的国'} · ${data.needs || '未选需求'} · ${data.budget || '未填预算'}`,
      text: [
        '收到一条新的采购需求：',
        '',
        `客户类型：${data.clientType || '-'}`,
        `联系人：  ${data.name}`,
        `公司：    ${data.company || '-'}`,
        `邮箱：    ${data.email}`,
        `电话：    ${data.phone || '-'}`,
        `目的国：  ${data.country || '-'}`,
        `采购需求：${data.needs || '-'}`,
        `采购预算：${data.budget || '-'}`,
        `期望交货：${data.timeline || '-'}`,
        `通讯工具：${data.channel || '-'}${data.channelId ? '  |  ID: ' + data.channelId : ''}`,
        `语言：    ${data.lang}`,
        '',
        '补充说明：',
        data.details || '-',
        '',
        `提交时间：${new Date().toISOString()}`,
        `来源页面：${data.page || '-'}`
      ].join('\n')
    })
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return { sent: true };
}

export default async function handler(req, res) {
  // 允许网页跨域调用（上线后建议把 * 换成你的正式域名）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const data = sanitize(body);

    // 蜜罐字段：正常用户不会填 company_url，填了就当机器人丢弃
    if (body.company_url) return res.status(200).json({ ok: true });

    if (!isValid(data)) {
      return res.status(400).json({ ok: false, error: 'name and a valid email are required' });
    }

    const meta = {
      ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    };

    // 落库与通知并行，互不阻塞；任一失败也保留另一方的能力
    const [db, mail] = await Promise.allSettled([saveToDb(data, meta), notify(data, meta)]);

    console.log('[inquiry]', JSON.stringify({
      name: data.name,
      country: data.country,
      category: data.category,
      db: db.status,
      mail: mail.status
    }));

    return res.status(200).json({
      ok: true,
      stored: db.status === 'fulfilled' && !db.value.skipped,
      notified: mail.status === 'fulfilled' && !mail.value.skipped
    });
  } catch (err) {
    console.error('[inquiry] error', err);
    return res.status(500).json({ ok: false, error: 'internal error' });
  }
}

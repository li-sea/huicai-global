/**
 * 采购资料上传 → Netlify Blobs
 * ------------------------------------------------------------------
 * 前端上传文件（≤4MB，最多 3 个），这里存进 Netlify Blobs，
 * 返回一个 id；id 会被写进询价表单的 files 字段，
 * 飞书卡片里带上下载链接，点开即可下载。
 *
 * 路由：POST /.netlify/functions/upload   （multipart/form-data，字段名 file）
 *
 * 说明：线上实现只接受 POST；附件下载走 Netlify Blobs 的公开链接
 *      （由 inquiry.mjs 在飞书卡片里给出），本函数不提供 GET 下载路由。
 *
 * 无需额外环境变量，Netlify Blobs 开箱即用。
 * ------------------------------------------------------------------
 */

import { getStore } from '@netlify/blobs';

const MAX_SIZE = 4 * 1024 * 1024; // 4MB
const OK_EXT = [
  'xls', 'xlsx', 'csv', 'doc', 'docx', 'pdf', 'ppt', 'pptx',
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'zip', 'rar', '7z', 'txt'
];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const STORE = 'inquiry-files';

function extOf(name) {
  return (String(name).split('.').pop() || '').toLowerCase();
}

function safeName(name) {
  // 只保留文件名本身，去掉路径与危险字符
  return String(name).split(/[\\/]/).pop().replace(/[^\w.\-\u4e00-\u9fa5]/g, '_').slice(0, 120);
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== 'POST') {
    return Response.json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: CORS });
  }

  const store = getStore(STORE);

  /* ---------- 上传 ---------- */
  try {
    const type = req.headers.get('content-type') || '';
    if (!type.includes('multipart/form-data') && !type.includes('application/x-www-form-urlencoded')) {
      return Response.json(
        { ok: false, error: 'Content-Type was not one of "multipart/form-data" or "application/x-www-form-urlencoded".' },
        { status: 400, headers: CORS }
      );
    }

    const form = await req.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') {
      return Response.json({ ok: false, error: 'no-file' }, { status: 400, headers: CORS });
    }

    const name = safeName(file.name || 'file');
    const ext = extOf(name);

    if (!OK_EXT.includes(ext)) {
      return Response.json({ ok: false, error: 'type-not-allowed' }, { status: 400, headers: CORS });
    }
    if (file.size > MAX_SIZE) {
      return Response.json({ ok: false, error: 'too-large' }, { status: 400, headers: CORS });
    }

    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const buf = await file.arrayBuffer();

    await store.set(id, buf, {
      metadata: { name, size: file.size, type: file.type || 'application/octet-stream' }
    });

    return Response.json(
      { ok: true, id, name, size: file.size },
      { headers: CORS }
    );
  } catch (err) {
    console.error('[upload] error', err);
    return Response.json({ ok: false, error: 'internal error' }, { status: 500, headers: CORS });
  }
};

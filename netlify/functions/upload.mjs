/**
 * 采购资料上传 → Netlify Blobs
 * 路由：POST /.netlify/functions/upload   （multipart/form-data，字段名 file）
 *
 * 单文件 ≤ 4MB，最多 3 个（前端限制）。返回文件 ID，写入询价表单的 files 字段；
 * 飞书卡片里的「📄 文件名」按钮通过 /.netlify/functions/file?id=... 下载。
 *
 * 本函数与 file.mjs 必须使用同一个 store 名称：inquiry-files
 */
import { getStore } from "@netlify/blobs";

const STORE_NAME = "inquiry-files";
const MAX_SIZE = 4 * 1024 * 1024;
const OK_EXT = [
  "xls", "xlsx", "csv", "doc", "docx", "pdf", "ppt", "pptx",
  "jpg", "jpeg", "png", "webp", "gif", "zip", "rar", "7z", "txt",
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });

function extOf(name) {
  return (String(name).split(".").pop() || "").toLowerCase();
}

function safeName(name) {
  return String(name)
    .split(/[\\/]/)
    .pop()
    .replace(/[^\w.\-\u4e00-\u9fa5]/g, "_")
    .slice(0, 120) || "file";
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const type = req.headers.get("content-type") || "";
    if (!type.includes("multipart/form-data")) {
      return json({ ok: false, error: "multipart/form-data required" }, 400);
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") return json({ ok: false, error: "no-file" }, 400);
    if (file.size <= 0) return json({ ok: false, error: "empty-file" }, 400);
    if (file.size > MAX_SIZE) {
      return json({ ok: false, error: "too-large", limitMB: MAX_SIZE / 1024 / 1024 }, 413);
    }

    const name = safeName(file.name || "file");
    const ext = extOf(name);
    if (!OK_EXT.includes(ext)) return json({ ok: false, error: "type-not-allowed" }, 415);

    // 兼容两种 ID：时间戳-随机串（线上旧版）与 UUID
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

    const store = getStore(STORE_NAME);
    await store.set(id, await file.arrayBuffer(), {
      metadata: {
        name,
        size: String(file.size),
        type: file.type || "application/octet-stream",
        uploadedAt: new Date().toISOString(),
      },
    });

    return json({ ok: true, id, name, size: file.size });
  } catch (err) {
    console.error("[upload] error", err);
    return json({ ok: false, error: String(err).slice(0, 200) }, 500);
  }
};

/**
 * 下载客户上传的采购资料
 * 路由：GET /.netlify/functions/file?id=<fileId>
 *
 * 与 upload.mjs 共用 store：inquiry-files
 * 只允许下载已上传的文件；文件名按 RFC 5987 编码，中文名可正常显示。
 */
import { getStore } from "@netlify/blobs";

const STORE_NAME = "inquiry-files";

export default async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405 });
  }

  const id = new URL(req.url).searchParams.get("id") || "";
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) {
    return new Response("Invalid id", { status: 400 });
  }

  try {
    const store = getStore(STORE_NAME);
    const res = await store.getWithMetadata(id, { type: "arrayBuffer" });
    if (!res || !res.data) return new Response("File not found", { status: 404 });

    const meta = res.metadata || {};
    const name = meta.name || "attachment";
    const headers = {
      "content-type": meta.type || "application/octet-stream",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
    };
    if (meta.size) headers["content-length"] = String(meta.size);

    if (req.method === "HEAD") return new Response(null, { status: 200, headers });
    return new Response(res.data, { status: 200, headers });
  } catch (err) {
    console.error("[file] error", err);
    return new Response("Error", { status: 500 });
  }
};

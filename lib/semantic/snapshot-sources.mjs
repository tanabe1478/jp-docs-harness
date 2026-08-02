import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { writeEvidenceSnapshot } from "./evidence-lock.mjs";

const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 5;
const ALLOWED_CONTENT_TYPES = [
  "text/",
  "application/json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/javascript",
];

export async function snapshotUrlSources({
  cwd,
  sources,
  fetchImpl = globalThis.fetch,
  assertSafeUrl = assertPublicHttpUrl,
  now = () => new Date().toISOString(),
}) {
  if (typeof fetchImpl !== "function") throw new Error("fetchが利用できません");
  const results = [];

  for (const source of sources.filter((item) => item.url && !item.path)) {
    const fetched = await fetchTextWithRedirects(source.url, { fetchImpl, assertSafeUrl });
    const entry = await writeEvidenceSnapshot({
      cwd,
      url: source.url,
      content: fetched.content,
      metadata: {
        fetchedAt: now(),
        resolvedUrl: fetched.url,
        contentType: fetched.contentType,
        etag: fetched.etag,
        lastModified: fetched.lastModified,
      },
    });
    results.push({
      id: source.id,
      url: source.url,
      resolvedUrl: fetched.url,
      path: entry.path,
      contentHash: entry.contentHash,
    });
  }

  return results;
}

async function fetchTextWithRedirects(initialUrl, { fetchImpl, assertSafeUrl }) {
  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    await assertSafeUrl(currentUrl);
    const response = await fetchImpl(currentUrl, {
      redirect: "manual",
      headers: { accept: "text/plain,text/markdown,application/json,application/xml;q=0.9,*/*;q=0.1" },
      signal: AbortSignal.timeout(15_000),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`リダイレクト先がありません: ${currentUrl}`);
      if (redirectCount === MAX_REDIRECTS) throw new Error(`リダイレクト回数が上限を超えました: ${initialUrl}`);
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }
    if (!response.ok) throw new Error(`根拠資料の取得に失敗しました: ${response.status} ${currentUrl}`);

    const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType && !ALLOWED_CONTENT_TYPES.some((allowed) => contentType.startsWith(allowed))) {
      throw new Error(`テキストではない根拠資料です: ${contentType} ${currentUrl}`);
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_SOURCE_BYTES) {
      throw new Error(`根拠資料が1 MiBを超えています: ${currentUrl}`);
    }

    const bytes = await readLimitedBody(response, currentUrl);
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return {
      url: currentUrl,
      content,
      contentType,
      etag: response.headers.get("etag") ?? undefined,
      lastModified: response.headers.get("last-modified") ?? undefined,
    };
  }
  throw new Error(`根拠資料を取得できませんでした: ${initialUrl}`);
}

async function readLimitedBody(response, url) {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SOURCE_BYTES) {
      await reader.cancel();
      throw new Error(`根拠資料が1 MiBを超えています: ${url}`);
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

export async function assertPublicHttpUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`HTTP(S)以外のURLは取得できません: ${value}`);
  }
  if (url.username || url.password) throw new Error(`認証情報を含むURLは取得できません: ${value}`);
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error(`localhostは取得できません: ${value}`);
  }

  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0) throw new Error(`URLのホストを解決できません: ${value}`);
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) throw new Error(`private networkのURLは取得できません: ${value}`);
  }
}

function isPrivateAddress(address) {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith("::ffff:")) return isPrivateAddress(normalized.slice(7));
  if (isIP(normalized) !== 4) return false;
  const [a, b] = normalized.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

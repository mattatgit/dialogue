const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_ASSET_BYTES = 16 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

class FigmaError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function parseFigmaUrl(input) {
  if (typeof input !== 'string' || !input.trim()) {
    throw new FigmaError(400, 'Provide a Figma design or file URL.');
  }

  const original = input.trim();
  // URL normalizes dot segments (including encoded variants), so reject them first.
  if (/(?:^|\/)(?:\.|%2e){1,2}(?:\/|[?#]|$)/i.test(original)) {
    throw new FigmaError(400, 'Provide a Figma design or file URL with a valid path.');
  }
  let url;
  try {
    url = new URL(original);
  } catch {
    throw new FigmaError(400, 'Provide a valid Figma design or file URL.');
  }

  if (url.protocol !== 'https:' || !['figma.com', 'www.figma.com'].includes(url.hostname) ||
      url.username || url.password || url.port || url.hash) {
    throw new FigmaError(400, 'Only HTTPS figma.com design and file URLs are supported.');
  }

  const match = /^\/(design|file)\/([a-zA-Z0-9]+)(?:\/([^/]+))?\/?$/.exec(url.pathname);
  if (!match || (match[3] && /%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f)/i.test(match[3]))) {
    throw new FigmaError(400, 'Provide a Figma design or file URL with a valid file key.');
  }

  const ids = url.searchParams.getAll('node-id');
  if (ids.length > 1 || (ids.length === 1 && !/^\d+[:-]\d+$/.test(ids[0]))) {
    throw new FigmaError(400, 'The Figma node-id must identify one frame or node.');
  }

  const nodeId = ids.length ? ids[0].replace('-', ':') : null;
  const fileKey = match[2];
  const canonical = new URL(`https://www.figma.com/${match[1]}/${fileKey}`);
  if (nodeId) canonical.searchParams.set('node-id', nodeId.replace(':', '-'));
  return { url: canonical.href, fileKey, nodeId };
}

function restError(response) {
  switch (response.status) {
    case 400:
      return new FigmaError(400, 'Figma rejected the file or node request.');
    case 401:
    case 403:
      return new FigmaError(response.status, 'Figma access was denied. Check FIGMA_ACCESS_TOKEN and file permissions.');
    case 404:
      return new FigmaError(404, 'Figma could not find this file or node, or access is restricted.');
    case 429: {
      const retryAfter = response.headers?.get?.('retry-after');
      const delay = retryAfter && /^\d{1,8}$/.test(retryAfter) ? ` Retry after ${retryAfter} seconds.` : '';
      return new FigmaError(429, `Figma rate limit reached.${delay}`);
    }
    default:
      return new FigmaError(response.status >= 400 && response.status < 500 ? response.status : 502, 'Figma could not complete the read request.');
  }
}

async function readBounded(response, maxBytes, tooLarge) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (declaredLength > maxBytes) {
    await response.body?.cancel?.();
    throw new FigmaError(502, tooLarge);
  }

  if (!response.body?.getReader) throw new FigmaError(502, 'Figma returned an invalid response.');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new FigmaError(502, tooLarge);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}

async function readBoundedJson(response) {
  const bytes = await readBounded(response, MAX_RESPONSE_BYTES, 'Figma response is too large to read safely.');
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new FigmaError(502, 'Figma returned an invalid JSON response.');
  }
}

async function readFigma(input, { token, fetchImpl = globalThis.fetch } = {}) {
  const reference = parseFigmaUrl(input);
  if (typeof token !== 'string' || !token.trim()) {
    throw new FigmaError(503, 'Set FIGMA_ACCESS_TOKEN in the local Dialogue .env or server environment to read Figma designs.');
  }

  const endpoint = new URL(`https://api.figma.com/v1/files/${reference.fileKey}`);
  if (reference.nodeId) {
    endpoint.pathname += '/nodes';
    endpoint.searchParams.set('ids', reference.nodeId);
  } else {
    endpoint.searchParams.set('depth', '2');
  }

  let response;
  try {
    response = await fetchImpl(endpoint.href, {
      method: 'GET',
      headers: { 'X-Figma-Token': token.trim(), Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'error'
    });
    if (!response.ok) throw restError(response);
    const data = await readBoundedJson(response);
    if (reference.nodeId ? !data?.nodes?.[reference.nodeId] : !data?.document) {
      throw new FigmaError(404, reference.nodeId ? 'Figma could not find this node in the file.' : 'Figma did not return a file document.');
    }
    return { reference, data };
  } catch (error) {
    if (error instanceof FigmaError) throw error;
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new FigmaError(504, 'Figma did not respond in time.');
    }
    throw new FigmaError(502, 'Could not reach Figma.');
  } finally {
    if (response && !response.ok) await response.body?.cancel?.().catch(() => {});
  }
}

// Figma's image API returns a short-lived download URL, not the image bytes.
// Never follow arbitrary URLs from the response or forward the server token to a CDN.
async function exportFigmaAsset(fileKey, nodeId, format, scale, { token, fetchImpl = globalThis.fetch } = {}) {
  if (typeof token !== 'string' || !token.trim()) {
    throw new FigmaError(503, 'Set FIGMA_ACCESS_TOKEN in the local Dialogue .env or server environment to export Figma assets.');
  }
  if (!/^[a-zA-Z0-9]+$/.test(fileKey) || !/^(?:I)?\d+:\d+(?:;\d+:\d+)*$/.test(nodeId) ||
      !['svg', 'png'].includes(format) || !Number.isFinite(scale) || scale < 0.01 || scale > 4) {
    throw new FigmaError(400, 'Provide a valid SVG or PNG export setting and node.');
  }
  const endpoint = new URL(`https://api.figma.com/v1/images/${fileKey}`);
  endpoint.searchParams.set('ids', nodeId);
  endpoint.searchParams.set('format', format);
  endpoint.searchParams.set('scale', String(scale));

  try {
    const response = await fetchImpl(endpoint.href, {
      method: 'GET', headers: { 'X-Figma-Token': token.trim(), Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'error'
    });
    if (!response.ok) {
      await response.body?.cancel?.();
      throw restError(response);
    }
    const data = await readBoundedJson(response);
    const imageUrl = data?.images?.[nodeId];
    if (typeof imageUrl !== 'string') throw new FigmaError(502, 'Figma could not render this export.');
    let url;
    try { url = new URL(imageUrl); } catch { throw new FigmaError(502, 'Figma returned an invalid asset URL.'); }
    if (url.protocol !== 'https:' || !['figma-alpha-api.s3.us-west-2.amazonaws.com', 's3-alpha.figma.com'].includes(url.hostname) ||
        url.username || url.password || url.port || url.hash) {
      throw new FigmaError(502, 'Figma returned an untrusted asset URL.');
    }
    const image = await fetchImpl(url.href, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'error' });
    if (!image.ok) {
      await image.body?.cancel?.();
      throw new FigmaError(502, 'Figma asset download failed.');
    }
    const expectedType = format === 'svg' ? 'image/svg+xml' : 'image/png';
    if (image.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== expectedType) {
      await image.body?.cancel?.();
      throw new FigmaError(502, 'Figma returned an unexpected asset type.');
    }
    const bytes = await readBounded(image, MAX_ASSET_BYTES, 'Figma asset is too large to download safely.');
    if (!bytes.length || (format === 'png' && !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))) {
      throw new FigmaError(502, 'Figma returned an invalid asset.');
    }
    return { bytes, contentType: expectedType };
  } catch (error) {
    if (error instanceof FigmaError) throw error;
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new FigmaError(504, 'Figma did not respond in time.');
    throw new FigmaError(502, 'Could not reach Figma.');
  }
}

module.exports = { FigmaError, parseFigmaUrl, readFigma, exportFigmaAsset };

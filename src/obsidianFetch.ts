import { requestUrl } from "obsidian";

export async function obsidianFetch(url: string, init: RequestInit): Promise<Response> {
  const response = await requestUrl({
    url,
    method: init.method,
    headers: normalizeRequestHeaders(init.headers),
    body: await normalizeRequestBody(init.body),
    throw: false,
  });

  return new Response(response.arrayBuffer, {
    status: response.status,
    headers: response.headers,
  });
}

function normalizeRequestHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const normalizedHeaders: Record<string, string> = {};

  if (!headers) {
    return normalizedHeaders;
  }

  if (headers instanceof Headers) {
    for (const [key, value] of headers.entries()) {
      normalizedHeaders[key] = value;
    }

    return normalizedHeaders;
  }

  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      normalizedHeaders[key] = value;
    }

    return normalizedHeaders;
  }

  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) {
      normalizedHeaders[key] = String(value);
    }
  }

  return normalizedHeaders;
}

async function normalizeRequestBody(body: BodyInit | null | undefined): Promise<string | ArrayBuffer | undefined> {
  if (body === null || body === undefined) {
    return undefined;
  }

  if (typeof body === "string" || body instanceof ArrayBuffer) {
    return body;
  }

  if (ArrayBuffer.isView(body)) {
    return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
  }

  if (body instanceof URLSearchParams) {
    return body.toString();
  }

  if (body instanceof Blob) {
    return body.arrayBuffer();
  }

  throw new Error("Unsupported Streaming Availability request body type.");
}

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body exceeds the upload limit.");
    this.name = "RequestBodyTooLargeError";
  }
}

export async function readLimitedText(request: Request, maxBytes: number) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError("Invalid request body limit.");
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await request.body?.cancel().catch(() => undefined);
    throw new RequestBodyTooLargeError();
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new RequestBodyTooLargeError();
      chunks.push(value);
    }
    return Buffer.concat(chunks, size).toString("utf8");
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

// Count actual incoming bytes before they reach the multipart parser. A missing
// or understated Content-Length must not allow an unbounded body to be buffered.
export async function readLimitedFormData(request: Request, maxBytes: number) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError("Invalid request body limit.");
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await request.body?.cancel().catch(() => undefined);
    throw new RequestBodyTooLargeError();
  }
  if (!request.body) return request.formData();

  let received = 0;
  let exceeded = false;
  const abort = new AbortController();
  const limited = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > maxBytes) {
        exceeded = true;
        throw new RequestBodyTooLargeError();
      }
      controller.enqueue(chunk);
    },
  }), { signal: abort.signal });
  try {
    return await new Response(limited, { headers: request.headers }).formData();
  } catch (error) {
    // Some multipart implementations wrap a stream error in a parser error.
    if (exceeded) throw new RequestBodyTooLargeError();
    throw error;
  } finally {
    // Also cancel the source when parsing rejects before consuming the body.
    abort.abort();
  }
}

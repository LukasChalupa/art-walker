const overpassEndpoints = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

async function readJsonBody(request) {
  if (request.body && typeof request.body === "object") return request.body;

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(response, status, payload) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Content-Type", "application/json");
  response.status(status).send(JSON.stringify(payload));
}

function safeTimeoutMs(value) {
  const timeoutMs = Number(value);
  if (!Number.isFinite(timeoutMs)) return 9_000;
  return Math.max(2_000, Math.min(15_000, timeoutMs));
}

function overpassErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return "Unknown Overpass request failure.";
}

export default async function handler(request, response) {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Use POST." });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const query = typeof body.query === "string" ? body.query.trim() : "";
    const timeoutMs = safeTimeoutMs(body.timeoutMs);

    if (!query || query.length > 20_000 || !query.includes("[out:json]")) {
      sendJson(response, 400, { error: "Invalid Overpass query." });
      return;
    }

    const failures = [];
    for (const endpoint of overpassEndpoints) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const overpassResponse = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "User-Agent": "krokomalba-road-loader/1.0",
          },
          body: query,
          signal: controller.signal,
        });

        const text = await overpassResponse.text();
        if (!overpassResponse.ok) {
          throw new Error(text.slice(0, 240) || `Overpass returned ${overpassResponse.status}.`);
        }

        sendJson(response, 200, JSON.parse(text));
        return;
      } catch (error) {
        failures.push({
          endpoint,
          error: overpassErrorMessage(error),
        });
      } finally {
        clearTimeout(timeout);
      }
    }

    sendJson(response, 502, {
      error: "Road data request failed.",
      failures,
    });
  } catch (error) {
    sendJson(response, 500, { error: overpassErrorMessage(error) });
  }
}

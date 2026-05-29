const AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";

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

function parseJsonContent(content) {
  if (typeof content !== "string") return content;

  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI response did not contain JSON.");
    return JSON.parse(match[0]);
  }
}

function finitePoint(value) {
  if (Array.isArray(value) && value.length >= 2) {
    const x = Number(value[0]);
    const y = Number(value[1]);
    return Number.isFinite(x) && Number.isFinite(y)
      ? [Math.max(-1.4, Math.min(1.4, x)), Math.max(-1.4, Math.min(1.4, y))]
      : null;
  }

  if (value && typeof value === "object") {
    const x = Number(value.x);
    const y = Number(value.y);
    return Number.isFinite(x) && Number.isFinite(y)
      ? [Math.max(-1.4, Math.min(1.4, x)), Math.max(-1.4, Math.min(1.4, y))]
      : null;
  }

  return null;
}

function normalizeShapes(value) {
  const shapes = Array.isArray(value?.shapes) ? value.shapes : [];
  return shapes
    .map((shape, index) => {
      const label = typeof shape?.label === "string" && shape.label.trim()
        ? shape.label.trim().slice(0, 48)
        : "shape " + (index + 1);
      const description = typeof shape?.description === "string" ? shape.description.trim().slice(0, 220) : "";
      const rawStrokes = Array.isArray(shape?.strokes)
        ? shape.strokes
        : Array.isArray(shape?.points)
          ? [shape.points]
          : [];
      const strokes = rawStrokes
        .map((stroke) => Array.isArray(stroke)
          ? stroke.map(finitePoint).filter(Boolean).slice(0, 80)
          : [])
        .filter((stroke) => stroke.length >= 2)
        .slice(0, 5);

      if (!strokes.length) return null;

      return {
        closed: Boolean(shape?.closed),
        description,
        label,
        strokes,
      };
    })
    .filter(Boolean)
    .slice(0, 12);
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

  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    sendJson(response, 501, { error: "AI_GATEWAY_API_KEY is not configured." });
    return;
  }

  try {
    const body = await readJsonBody(request);
    const shapeQuery = typeof body.shapeQuery === "string" ? body.shapeQuery.trim().slice(0, 160) : "";
    const count = Math.max(4, Math.min(10, Number(body.count) || 8));
    const language = body.language === "cs" ? "Czech" : "English";

    if (!shapeQuery) {
      sendJson(response, 400, { error: "Missing shapeQuery." });
      return;
    }

    const model = process.env.AI_SHAPE_MODEL || "openai/gpt-4.1-mini";
    const prompt = [
      "Create simple vector sketches for walking-route art.",
      "The user wants this subject: " + shapeQuery + ".",
      "Return " + count + " different routeable line-art variants. These are not final roads; another algorithm will fit them to walkable streets.",
      "Coordinates must be normalized around the origin, usually between -1 and 1. Use x right, y down.",
      "Each sketch must be drawable as one walking route. Multiple strokes are allowed only when their nearest endpoints can be connected naturally.",
      "Prefer recognizable silhouettes with few strong features over detailed drawings: examples include ears/tail for cat, petals/stem for flower, wings/tail for dragon.",
      "Use 8 to 34 points per sketch total, unless a smooth curve needs more.",
      "Use closed true for loops such as heads, flowers, stars, hearts, and closed animal outlines. Use closed false for open routes such as snakes, waves, or letters.",
      "Avoid random zigzags, grids, labels, text, shading, filled areas, and tiny decorative details.",
      "Return only JSON with this exact shape: {\"shapes\":[{\"label\":\"cat head\",\"description\":\"Round head with two pointed ears and a small tail-like cheek stroke.\",\"closed\":true,\"strokes\":[[[-0.75,0.2],[-0.45,-0.45],[-0.2,-0.2],[0,-0.72],[0.2,-0.2],[0.45,-0.45],[0.75,0.2],[0.45,0.65],[0,0.78],[-0.45,0.65],[-0.75,0.2]]]}]}",
      "Use " + language + " labels and descriptions.",
    ].join("\n");

    const gatewayResponse = await fetch(AI_GATEWAY_BASE_URL + "/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: 1800,
        temperature: 0.55,
      }),
    });

    const gatewayJson = await gatewayResponse.json().catch(() => null);
    if (!gatewayResponse.ok) {
      sendJson(response, gatewayResponse.status, {
        error: gatewayJson?.error?.message || gatewayJson?.message || "AI Gateway request failed.",
      });
      return;
    }

    const content = gatewayJson?.choices?.[0]?.message?.content;
    const parsed = parseJsonContent(content);
    sendJson(response, 200, { shapes: normalizeShapes(parsed) });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "AI vector sketch generation failed." });
  }
}

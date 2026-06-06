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

  try {
    const body = await readJsonBody(request);
    const shapeQuery = typeof body.shapeQuery === "string" ? body.shapeQuery.trim().slice(0, 160) : "";
    const count = Math.max(4, Math.min(10, Number(body.count) || 8));
    const language = body.language === "cs" ? "Czech" : "English";

    if (!shapeQuery) {
      sendJson(response, 400, { error: "Missing shapeQuery." });
      return;
    }

    const apiKey = process.env.AI_GATEWAY_API_KEY;
    if (!apiKey) {
      sendJson(response, 501, { error: "AI_GATEWAY_API_KEY is not configured." });
      return;
    }

    const model = process.env.AI_SHAPE_MODEL || "openai/gpt-4.1-mini";
    const prompt = [
      "Create high-recognition vector sketches for GPS walking-route art.",
      "Requested subject: " + shapeQuery + ".",
      "Return exactly " + count + " distinct routeable line-art variants as JSON. These sketches are not final roads; another algorithm will fit them to walkable streets.",
      "Before writing JSON, internally choose 3-5 visual features that make the requested subject recognizable. Every returned sketch must include at least 2 of those features in the coordinates, not just in the label.",
      "Reject weak variants internally. Do not return a shape if it looks like a generic blob, shield, bell, triangle, wavy line, random zigzag, grid, spiral, or abstract loop unless the requested subject is exactly that thing.",
      "Use iconic silhouettes, not decorative detail. Good variants are front/icon view, side profile, simplified whole-body outline, emblem view, or a strongly recognizable symbol related to the subject.",
      "Category guidance: animals need head plus species-specific ears/beak/horns/wings/tail/body; vehicles need wheels plus frame/body/handlebars; flowers need petals plus stem/leaves; musical objects need the distinctive instrument body/neck/keys; fantasy creatures need wings/tail/horns/body shape.",
      "Repeated features must be visually repeated in the points: two ears should make two clear peaks, two wheels should make two clear loops, petals should make several rounded lobes, wings should make two broad side lobes.",
      "Coordinates: normalized around origin, usually -1 to 1. Use x right, y down. Fill most of the 2x2 canvas; avoid tiny marks and cramped features.",
      "Routeability: prefer one continuous stroke. Multiple strokes are allowed only when endpoints are close enough to connect naturally in one walk. Use 10-32 total points per sketch; each point should change direction or silhouette meaningfully.",
      "Closed shapes: set closed true only for actual closed outlines. If closed is true, the first and last points should match or nearly match. Use closed false for open routes like notes, snakes, waves, letters, or side profiles with a natural start/end.",
      "Descriptions must name the concrete visible evidence, for example 'two pointed ears, rounded head, curled tail'. If the evidence is not visible in the points, redesign the sketch before returning it.",
      "Do not mention internal details such as eyes, spokes, whiskers, windows, or keys unless the coordinates include separate strokes or clear points for those details. Prefer external silhouette features because they survive road matching.",
      "Labels must be specific variants of the requested subject, not generic words like abstract shape, loop, blob, zigzag, or outline.",
      "Return only JSON with this exact shape: {\"shapes\":[{\"label\":\"cat head with ears\",\"description\":\"Rounded head with two pointed ears and cheek curves.\",\"closed\":true,\"strokes\":[[[-0.75,0.2],[-0.55,-0.55],[-0.25,-0.25],[0,-0.78],[0.25,-0.25],[0.55,-0.55],[0.75,0.2],[0.45,0.68],[0,0.82],[-0.45,0.68],[-0.75,0.2]]]}]}",
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
        max_tokens: 2400,
        temperature: 0.32,
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
    sendJson(response, 200, { shapes: normalizeShapes(parsed).slice(0, count) });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "AI vector sketch generation failed." });
  }
}

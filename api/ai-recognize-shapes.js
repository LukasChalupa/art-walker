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

function normalizeResults(value) {
  const results = Array.isArray(value?.results) ? value.results : [];
  return results
    .map((result) => ({
      confidence: typeof result.confidence === "number" ? Math.max(0, Math.min(1, result.confidence)) : 0,
      id: Number(result.id),
      description: typeof result.description === "string" ? result.description.slice(0, 240) : "",
      label: typeof result.label === "string" ? result.label.slice(0, 32) : "unknown",
      matchesTarget: Boolean(result.matchesTarget),
      reason: typeof result.reason === "string" ? result.reason.slice(0, 160) : "",
      targetConfidence: typeof result.targetConfidence === "number" ? Math.max(0, Math.min(1, result.targetConfidence)) : undefined,
    }))
    .filter((result) => Number.isFinite(result.id));
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
    const candidates = Array.isArray(body.candidates) ? body.candidates.slice(0, 24) : [];
    const contactSheetImage = typeof body.contactSheetImage === "string" ? body.contactSheetImage : "";
    const contactSheetSvg = typeof body.contactSheetSvg === "string" ? body.contactSheetSvg : "";
    const shapeQuery = typeof body.shapeQuery === "string" ? body.shapeQuery.trim().slice(0, 180) : "";
    const language = body.language === "cs" ? "Czech" : "English";

    if (!candidates.length || (!contactSheetImage && !contactSheetSvg)) {
      sendJson(response, 400, { error: "Missing candidates or contactSheetImage." });
      return;
    }

    const imageUrl = contactSheetImage || "data:image/svg+xml;base64," + Buffer.from(contactSheetSvg, "utf8").toString("base64");
    const model = process.env.AI_SHAPE_MODEL || "openai/gpt-4.1-mini";
    const prompt = [
      "You are a strict visual judge for walking-route silhouette thumbnails.",
      "The image is a numbered contact sheet. Each black route is one continuous candidate.",
      "First inspect all numbered routes visually. Do not name anything yet. Compare the whole silhouette, aspect ratio, loops, protrusions, tails, ears, symmetry, and negative space.",
      "Second, score each route. confidence means how clearly the visible route resembles its label. targetConfidence means how clearly it resembles the requested target.",
      shapeQuery
        ? "Requested target: " + shapeQuery + ". The main job is to find only candidates that actually look like this target."
        : "No requested target was supplied. Find the strongest genuinely recognizable concrete silhouettes.",
      shapeQuery
        ? "Set matchesTarget true only when targetConfidence is at least 0.68 and the route has at least two visible target-specific features. For " + shapeQuery + ", random rectangles, ladders, zigzags, street grids, and generic loops are not matches."
        : "Give high confidence only to silhouettes a human would likely name the same way without seeing your answer.",
      shapeQuery
        ? "If a candidate does not clearly resemble " + shapeQuery + ", set matchesTarget false and targetConfidence 0.25 or lower, even if you can invent a different object name for it."
        : "Weak silhouettes should receive confidence below 0.35.",
      "Do not force a cute label onto a weak or random route. It is better to give low confidence than to pretend the shape is clear.",
      "Use labels based only on the route drawing. Do not use distance or localScore to choose labels.",
      "Heavily downgrade repeated street tracing, out-and-back strokes, and rectangular street-grid scribbles.",
      "Use metadata reusedStreetPercent, backtrackPercent, and uniqueNodePercent only as quality warnings after visual judging.",
      "Do not default to zigzag. Use zigzag only for a route mainly made of alternating Z-like strokes.",
      "Return one result for every candidate id, sorted from best visual match to worst.",
      "Return only JSON with this exact shape: {\"results\":[{\"id\":1,\"label\":\"cat\",\"confidence\":0.82,\"matchesTarget\":true,\"targetConfidence\":0.82,\"reason\":\"round head with two ear-like corners\",\"description\":\"The route reads as a cat because it has a rounded head, two ear points, and a tail-like stroke.\"}]}",
      "Use " + language + " labels, reasons, and descriptions.",
      "Description should be one short sentence with concrete visual evidence. Do not describe hopes or possible interpretations without evidence.",
      "Candidates metadata: " + JSON.stringify(candidates),
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
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
            ],
          },
        ],
        max_tokens: 1800,
        temperature: 0.05,
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
    sendJson(response, 200, { results: normalizeResults(parsed) });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "AI shape recognition failed." });
  }
}

import React, { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./styles.css";

type Point = {
  x: number;
  y: number;
};

type LatLng = {
  lat: number;
  lng: number;
};

type RoutePoint = Point & LatLng;

type RoadSegment = {
  a: RoutePoint;
  b: RoutePoint;
  name: string;
};

type GraphNode = RoutePoint & {
  id: string;
};

type GraphEdge = {
  to: string;
  weight: number;
};

type NodeGrid = {
  cellSize: number;
  cells: Map<string, GraphNode[]>;
  nodes: GraphNode[];
};

type RoadGraph = {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge[]>;
  edgeKeys: Set<string>;
  edgeGeometries: Map<string, RoutePoint[]>;
  nodeGrid: NodeGrid;
  segments: RoadSegment[];
  rejectedSegments: number;
};

type LocationSuggestion = LatLng & {
  id: string;
  label: string;
  type: string;
};

type TileJson = {
  tiles?: string[];
  attribution?: string;
  minzoom?: number;
  maxzoom?: number;
};

type MatchTiming = {
  totalMs: number;
  roadSearchMs: number;
  routeMs: number;
  placements?: number;
  rankedRoutes?: number;
};

type GraphInfo = {
  cacheVersion: string;
  spacingMeters: number;
  nodes: number;
  edges: number;
  rejectedSegments: number;
};

type SavedLocation = {
  location: string;
  selectedLocation: LocationSuggestion | null;
};

type ShapeVariant = {
  name: string;
  points: Point[];
  penalty: number;
};

type ObstaclePolygon = {
  points: Point[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

const locationPresets: Record<string, LatLng> = {
  "litomerice": { lat: 50.5335, lng: 14.1318 },
  "litoměřice": { lat: 50.5335, lng: 14.1318 },
  "prague": { lat: 50.0755, lng: 14.4378 },
  "praha": { lat: 50.0755, lng: 14.4378 },
  "london": { lat: 51.5072, lng: -0.1276 },
  "new york": { lat: 40.7128, lng: -74.006 },
  "san francisco": { lat: 37.7749, lng: -122.4194 },
  "berlin": { lat: 52.52, lng: 13.405 },
  "paris": { lat: 48.8566, lng: 2.3522 },
  "tokyo": { lat: 35.6762, lng: 139.6503 },
};

const defaultLocation: LocationSuggestion = {
  id: "preset-litomerice",
  label: "Litoměřice, Czechia",
  lat: 50.5335,
  lng: 14.1318,
  type: "city",
};

const templates = [
  "heart",
  "star",
  "flower",
  "mountains",
  "spiral",
  "cat",
  "bolt",
  "wave",
] as const;

type TemplateName = typeof templates[number];

const roadGraphCache = new Map<string, RoadGraph>();
const savedLocationKey = "route-canvas.location";

const matchConfig = {
  graphCacheVersion: "variance-ranked-20m-v1",
  roadNodeSpacingMeters: 20,
  maxRenderedSegmentMeters: 10,
  targetPoints: 40,
  topCandidates: 56,
  scales: [0.78, 0.86, 0.94, 1, 1.08, 1.16],
  rotations: [
    0,
    Math.PI / 12,
    -Math.PI / 12,
    Math.PI / 6,
    -Math.PI / 6,
    Math.PI / 4,
    -Math.PI / 4,
    Math.PI / 2,
    -Math.PI / 2,
    Math.PI,
  ],
  pathBudgetFactor: 2.55,
  pathBudgetPaddingMeters: 180,
  minPathBudgetMeters: 200,
  minSegmentBudgetMeters: 620,
  segmentBudgetDivisor: 7.5,
  heuristicWeight: 1.25,
  shapeVariantLimit: 6,
  shapeVariantPenalty: 520,
  randomCandidatesPerVariant: 520,
  randomScaleMin: 0.66,
  randomScaleMax: 1.32,
  waypointLookahead: 7,
  stitchBeamWidth: 3,
  futureFitLookahead: 3,
  futureFitPenalty: 0.12,
  maxSkippedWaypointRatio: 0.85,
  skippedWaypointPenalty: 260,
};

const templateAlternates: Record<TemplateName, TemplateName[]> = {
  heart: ["flower", "spiral", "wave"],
  star: ["flower", "bolt", "spiral"],
  flower: ["star", "spiral", "heart"],
  mountains: ["wave", "bolt", "star"],
  spiral: ["flower", "heart", "wave"],
  cat: ["heart", "flower", "spiral"],
  bolt: ["star", "mountains", "wave"],
  wave: ["mountains", "spiral", "bolt"],
};

function distance(points: Point[]) {
  return points.slice(1).reduce((total, point, index) => {
    const prev = points[index];
    return total + Math.hypot(point.x - prev.x, point.y - prev.y);
  }, 0);
}

function normalize(points: Point[]) {
  const { minX, maxX, minY, maxY } = boundsOf(points);
  const width = Math.max(maxX - minX, 0.001);
  const height = Math.max(maxY - minY, 0.001);
  const scale = 1 / Math.max(width, height);

  return points.map((point) => ({
    x: (point.x - minX - width / 2) * scale,
    y: (point.y - minY - height / 2) * scale,
  }));
}

function boundsOf(points: Point[]) {
  return points.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      maxX: Math.max(bounds.maxX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
}

function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false;

  for (let index = 0, prevIndex = polygon.length - 1; index < polygon.length; prevIndex = index, index += 1) {
    const current = polygon[index];
    const prev = polygon[prevIndex];
    const crosses = current.y > point.y !== prev.y > point.y;
    if (!crosses) continue;

    const xAtY = (prev.x - current.x) * (point.y - current.y) / (prev.y - current.y || 0.000001) + current.x;
    if (point.x < xAtY) inside = !inside;
  }

  return inside;
}

function resample(points: Point[], count: number) {
  if (points.length < 2) return points;

  const totalDistance = distance(points);
  const step = totalDistance / Math.max(count - 1, 1);
  const sampled: Point[] = [points[0]];
  let segmentStart = points[0];
  let sourceIndex = 1;
  let remaining = step;

  while (sourceIndex < points.length && sampled.length < count) {
    const segmentEnd = points[sourceIndex];
    const segmentLength = Math.hypot(segmentEnd.x - segmentStart.x, segmentEnd.y - segmentStart.y);

    if (segmentLength >= remaining) {
      const ratio = remaining / segmentLength;
      const next = {
        x: segmentStart.x + (segmentEnd.x - segmentStart.x) * ratio,
        y: segmentStart.y + (segmentEnd.y - segmentStart.y) * ratio,
      };
      sampled.push(next);
      segmentStart = next;
      remaining = step;
    } else {
      remaining -= segmentLength;
      segmentStart = segmentEnd;
      sourceIndex += 1;
    }
  }

  return sampled;
}

function selectedTemplate(description: string): TemplateName {
  const text = description.toLowerCase();
  return templates.find((template) => text.includes(template)) ?? "heart";
}

function templatePath(description: string, forcedTemplate?: TemplateName) {
  const selected = forcedTemplate ?? selectedTemplate(description);

  if (selected === "star") {
    return normalize(Array.from({ length: 11 }, (_, index) => {
      const angle = -Math.PI / 2 + index * Math.PI * 2 / 10;
      const radius = index % 2 === 0 ? 1 : 0.42;
      return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    }));
  }

  if (selected === "flower") {
    return normalize(Array.from({ length: 260 }, (_, index) => {
      const angle = index / 259 * Math.PI * 2;
      const radius = 0.42 + 0.32 * Math.sin(6 * angle);
      return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    }));
  }

  if (selected === "mountains") {
    return normalize([
      { x: -1, y: 0.55 }, { x: -0.62, y: -0.2 }, { x: -0.42, y: 0.05 },
      { x: -0.12, y: -0.72 }, { x: 0.08, y: -0.2 }, { x: 0.32, y: -0.48 },
      { x: 0.96, y: 0.55 }, { x: -1, y: 0.55 },
    ]);
  }

  if (selected === "spiral") {
    return normalize(Array.from({ length: 260 }, (_, index) => {
      const progress = index / 259;
      const angle = progress * Math.PI * 7.5;
      const radius = 0.08 + progress * 0.9;
      return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
    }));
  }

  if (selected === "cat") {
    const head = Array.from({ length: 180 }, (_, index) => {
      const angle = index / 179 * Math.PI * 2;
      return { x: Math.cos(angle) * 0.58, y: Math.sin(angle) * 0.48 + 0.12 };
    });
    return normalize([
      ...head,
      { x: -0.38, y: -0.28 }, { x: -0.5, y: -0.78 }, { x: -0.12, y: -0.42 },
      { x: 0.12, y: -0.42 }, { x: 0.5, y: -0.78 }, { x: 0.38, y: -0.28 },
      { x: 0.12, y: 0.08 }, { x: 0.18, y: 0.16 }, { x: 0.06, y: 0.18 },
      { x: -0.06, y: 0.18 }, { x: -0.18, y: 0.16 }, { x: -0.12, y: 0.08 },
    ]);
  }

  if (selected === "bolt") {
    return normalize([
      { x: 0.05, y: -1 }, { x: -0.45, y: 0.05 }, { x: -0.06, y: 0.05 },
      { x: -0.2, y: 1 }, { x: 0.55, y: -0.25 }, { x: 0.12, y: -0.25 },
      { x: 0.05, y: -1 },
    ]);
  }

  if (selected === "wave") {
    return normalize(Array.from({ length: 220 }, (_, index) => {
      const progress = index / 219;
      return { x: progress * 2 - 1, y: Math.sin(progress * Math.PI * 5) * 0.42 };
    }));
  }

  return normalize(Array.from({ length: 240 }, (_, index) => {
    const t = index / 239 * Math.PI * 2;
    return {
      x: 16 * Math.sin(t) ** 3,
      y: -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)),
    };
  }));
}

function parseLocation(value: string) {
  const coords = value.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (coords) {
    return { lat: Number(coords[1]), lng: Number(coords[2]) };
  }

  return locationPresets[value.trim().toLowerCase()] ?? locationPresets.litomerice;
}

async function resolveLocation(value: string) {
  const coords = value.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
  if (coords) {
    return { lat: Number(coords[1]), lng: Number(coords[2]) };
  }

  const preset = locationPresets[value.trim().toLowerCase()];
  if (preset) return preset;

  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(value)}`,
  );
  if (!response.ok) {
    throw new Error("Location search failed.");
  }

  const results: Array<{ lat: string; lon: string }> = await response.json();
  if (!results[0]) {
    throw new Error("No location found. Try a more specific place or paste latitude, longitude.");
  }

  return { lat: Number(results[0].lat), lng: Number(results[0].lon) };
}

async function searchLocations(value: string, signal?: AbortSignal): Promise<LocationSuggestion[]> {
  const query = value.trim();
  if (query.length < 3 || /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(query)) {
    return [];
  }

  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=6&q=${encodeURIComponent(query)}`,
    { signal },
  );
  if (!response.ok) return [];

  const results: Array<{
    place_id: number;
    display_name: string;
    lat: string;
    lon: string;
    type: string;
  }> = await response.json();

  return results.map((result) => ({
    id: String(result.place_id),
    label: result.display_name,
    lat: Number(result.lat),
    lng: Number(result.lon),
    type: result.type,
  }));
}

function shortLocationLabel(label: string) {
  const parts = label.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.slice(0, 4).join(", ");
}

function pathPreviewPoints(points: Point[]) {
  return normalize(points)
    .map((point) => `${50 + point.x * 78},${50 + point.y * 78}`)
    .join(" ");
}

function toMeters(point: LatLng, center: LatLng): Point {
  const metersPerLat = 111_320;
  const metersPerLng = metersPerLat * Math.cos(center.lat * Math.PI / 180);

  return {
    x: (point.lng - center.lng) * metersPerLng,
    y: -(point.lat - center.lat) * metersPerLat,
  };
}

function fromMeters(point: Point, center: LatLng): LatLng {
  const metersPerLat = 111_320;
  const metersPerLng = metersPerLat * Math.cos(center.lat * Math.PI / 180);

  return {
    lat: center.lat - point.y / metersPerLat,
    lng: center.lng + point.x / metersPerLng,
  };
}

function projectToLatLng(points: Point[], center: LatLng, kilometers: number) {
  const normalized = normalize(points);
  const currentDistance = distance(normalized);
  const targetMeters = kilometers * 1000;
  const scaleMeters = targetMeters / Math.max(currentDistance, 0.001);
  const metersPerLat = 111_320;
  const metersPerLng = metersPerLat * Math.cos(center.lat * Math.PI / 180);

  return normalized.map((point) => ({
    ...point,
    lat: center.lat - point.y * scaleMeters / metersPerLat,
    lng: center.lng + point.x * scaleMeters / metersPerLng,
  }));
}

function routeStats(points: RoutePoint[]) {
  const meters = points.slice(1).reduce((total, point, index) => {
    const prev = points[index];
    const latMeters = (point.lat - prev.lat) * 111_320;
    const lngMeters = (point.lng - prev.lng) * 111_320 * Math.cos(point.lat * Math.PI / 180);
    return total + Math.hypot(latMeters, lngMeters);
  }, 0);

  const minutes = meters / 1000 / 4.8 * 60;
  return { kilometers: meters / 1000, minutes };
}

function withPreviewPoints(points: LatLng[], center: LatLng, referencePoints = points): RoutePoint[] {
  const local = points.map((point) => toMeters(point, center));
  const referenceLocal = referencePoints.map((point) => toMeters(point, center));
  const fallback = [{ x: 0, y: 0 }];
  const normalizedReference = normalize(referenceLocal.length ? referenceLocal : fallback);
  const { minX, maxX, minY, maxY } = boundsOf(referenceLocal.length ? referenceLocal : fallback);
  const width = Math.max(maxX - minX, 0.001);
  const height = Math.max(maxY - minY, 0.001);
  const scale = 1 / Math.max(width, height);

  return points.map((point, index) => ({
    ...point,
    x: local[index] ? (local[index].x - minX - width / 2) * scale : normalizedReference[index]?.x ?? 0,
    y: local[index] ? (local[index].y - minY - height / 2) * scale : normalizedReference[index]?.y ?? 0,
  }));
}

function targetMeters(points: Point[], kilometers: number) {
  const sampled = resample(points, matchConfig.targetPoints);
  const normalized = normalize(sampled);
  const scale = (kilometers * 1000) / Math.max(distance(normalized), 0.001);

  return normalized.map((point) => ({
    x: point.x * scale,
    y: point.y * scale,
  }));
}

function transformPoints(points: Point[], scale: number, rotation: number, offset: Point) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  return points.map((point) => ({
    x: (point.x * cos - point.y * sin) * scale + offset.x,
    y: (point.x * sin + point.y * cos) * scale + offset.y,
  }));
}

function startAnchors(startRangeMeters: number) {
  const half = startRangeMeters * 0.5;
  const diagonal = startRangeMeters * 0.7;

  return [
    { x: 0, y: 0 },
    { x: half, y: 0 },
    { x: -half, y: 0 },
    { x: 0, y: half },
    { x: 0, y: -half },
    { x: startRangeMeters, y: 0 },
    { x: -startRangeMeters, y: 0 },
    { x: 0, y: startRangeMeters },
    { x: 0, y: -startRangeMeters },
    { x: diagonal, y: diagonal },
    { x: -diagonal, y: diagonal },
    { x: diagonal, y: -diagonal },
    { x: -diagonal, y: -diagonal },
  ];
}

function textShapeVariants(description: string): ShapeVariant[] {
  const selected = selectedTemplate(description);
  const ordered = [
    selected,
    ...templateAlternates[selected],
    ...templates.filter((template) => template !== selected && !templateAlternates[selected].includes(template)),
  ].slice(0, matchConfig.shapeVariantLimit);

  return ordered.map((template, index) => ({
    name: template,
    points: templatePath(template, template),
    penalty: index * matchConfig.shapeVariantPenalty,
  }));
}

function uploadedShapeVariants(points: Point[]): ShapeVariant[] {
  const normalized = normalize(points);
  const reversed = [...normalized].reverse();
  const simplified = normalize(resample(normalized, Math.min(48, Math.max(12, normalized.length))));

  return [
    { name: "uploaded", points: normalized, penalty: 0 },
    { name: "uploaded reversed", points: reversed, penalty: matchConfig.shapeVariantPenalty * 0.5 },
    { name: "uploaded simplified", points: simplified, penalty: matchConfig.shapeVariantPenalty * 0.75 },
  ];
}

function shapeVariants(description: string, imagePath: Point[] | null): ShapeVariant[] {
  return imagePath?.length ? uploadedShapeVariants(imagePath) : textShapeVariants(description);
}

function randomStartAnchor(startRangeMeters: number) {
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.sqrt(Math.random()) * startRangeMeters;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

function gridKey(x: number, y: number, cellSize: number) {
  return `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
}

function buildNodeGrid(nodes: Map<string, GraphNode>, edges: Map<string, GraphEdge[]>, cellSize = 180): NodeGrid {
  const cells = new Map<string, GraphNode[]>();
  const nodeList = Array.from(nodes.values()).filter((node) => (edges.get(node.id) ?? []).length > 0);

  nodeList.forEach((node) => {
    const key = gridKey(node.x, node.y, cellSize);
    cells.set(key, [...(cells.get(key) ?? []), node]);
  });

  return { cellSize, cells, nodes: nodeList };
}

async function fetchRoadGraph(center: LatLng, radiusMeters: number): Promise<RoadGraph> {
  const cacheKey = [
    matchConfig.graphCacheVersion,
    `spacing-${matchConfig.roadNodeSpacingMeters}`,
    center.lat.toFixed(4),
    center.lng.toFixed(4),
    Math.round(radiusMeters / 100) * 100,
  ].join(":");
  const cached = roadGraphCache.get(cacheKey);
  if (cached) return cached;

  const query = `
    [out:json][timeout:12];
    (
      way(around:${Math.round(radiusMeters)},${center.lat},${center.lng})
        ["highway"~"footway|path|pedestrian|residential|living_street|service|tertiary|unclassified|cycleway|steps|track"]
        ["access"!~"private|no"]
        ["foot"!~"no"]
        ["area"!="yes"];
    );
    out body qt;
    >;
    out skel qt;
  `;

  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];

  async function fetchEndpoint(endpoint: string) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 13_000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: query,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Road search failed at ${endpoint}`);
      return response;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  const response = await Promise.any(endpoints.map((endpoint) => fetchEndpoint(endpoint))).catch(() => null);

  if (!response) {
    throw new Error("Road search failed. OpenStreetMap road data may be busy; try again in a moment.");
  }

  const data: {
    elements: Array<
      | { type: "way"; id: number; tags?: Record<string, string>; nodes?: number[] }
      | { type: "node"; id: number; lat: number; lon: number }
    >;
  } = await response.json();

  const graphNodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge[]>();
  const edgeKeys = new Set<string>();
  const edgeGeometries = new Map<string, RoutePoint[]>();
  const segments: RoadSegment[] = [];
  const osmNodes = new Map<number, LatLng>();
  const obstacles: ObstaclePolygon[] = [];
  let rejectedSegments = 0;

  data.elements.forEach((element) => {
    if (element.type === "node") {
      osmNodes.set(element.id, { lat: element.lat, lng: element.lon });
    }
  });

  data.elements.forEach((element) => {
    if (element.type !== "way" || !element.tags?.building) return;
    const points = (element.nodes ?? [])
      .flatMap((nodeId) => {
        const node = osmNodes.get(nodeId);
        return node ? [toMeters(node, center)] : [];
      });
    if (points.length < 4) return;

    const bounds = boundsOf(points);
    obstacles.push({
      points,
      minX: bounds.minX - 1,
      maxX: bounds.maxX + 1,
      minY: bounds.minY - 1,
      maxY: bounds.maxY + 1,
    });
  });

  function ensureNode(key: string, point: LatLng) {
    if (!graphNodes.has(key)) {
      const local = toMeters(point, center);
      graphNodes.set(key, { id: key, ...point, ...local });
      edges.set(key, []);
    }
    return key;
  }

  function addEdge(from: string, to: string, weight: number, points: RoutePoint[]) {
    if (from === to) return;
    const edgeKey = `${from}->${to}`;
    if (edgeKeys.has(edgeKey)) return;
    const fromEdges = edges.get(from)!;
    fromEdges.push({ to, weight });
    edgeKeys.add(edgeKey);
    edgeGeometries.set(edgeKey, points);
  }

  function addDenseSegment(fromId: number, toId: number, fromPoint: LatLng, toPoint: LatLng, name: string) {
    const from = ensureNode(String(fromId), fromPoint);
    const to = ensureNode(String(toId), toPoint);
    const fromNode = graphNodes.get(from)!;
    const toNode = graphNodes.get(to)!;
    const totalWeight = Math.hypot(toNode.x - fromNode.x, toNode.y - fromNode.y);
    const steps = Math.max(1, Math.ceil(totalWeight / matchConfig.roadNodeSpacingMeters));
    let prevKey = from;
    let prevNode = fromNode;

    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps;
      const key = step === steps ? to : `v:${fromId}:${toId}:${step}`;
      const densePoint = {
        lat: fromPoint.lat + (toPoint.lat - fromPoint.lat) * progress,
        lng: fromPoint.lng + (toPoint.lng - fromPoint.lng) * progress,
      };
      const denseLocal = toMeters(densePoint, center);
      const crossesObstacle = obstacles.some((polygon) =>
        denseLocal.x >= polygon.minX
        && denseLocal.x <= polygon.maxX
        && denseLocal.y >= polygon.minY
        && denseLocal.y <= polygon.maxY
        && pointInPolygon(denseLocal, polygon.points)
      );

      if (crossesObstacle) {
        rejectedSegments += 1;
        prevKey = "";
        continue;
      }

      ensureNode(key, densePoint);

      const currentNode = graphNodes.get(key)!;
      const weight = Math.hypot(currentNode.x - prevNode.x, currentNode.y - prevNode.y);
      if (prevKey) {
        addEdge(prevKey, key, weight, [{ ...prevNode }, { ...currentNode }]);
        addEdge(key, prevKey, weight, [{ ...currentNode }, { ...prevNode }]);
        segments.push({
          a: { ...prevNode },
          b: { ...currentNode },
          name,
        });
      }

      prevKey = key;
      prevNode = currentNode;
    }
  }

  data.elements.forEach((element) => {
    if (element.type !== "way" || !element.tags?.highway) return;
    const name = element.tags?.name ?? element.tags?.highway ?? "road";
    const nodeIds = element.nodes ?? [];

    nodeIds.slice(1).forEach((nodeId, index) => {
      const prevNodeId = nodeIds[index];
      const prev = osmNodes.get(prevNodeId);
      const current = osmNodes.get(nodeId);
      if (!prev || !current) return;

      addDenseSegment(prevNodeId, nodeId, prev, current, name);
    });
  });

  if (segments.length < 2) {
    throw new Error("Not enough walkable streets found nearby. Try a larger distance or a denser location.");
  }

  const graph = { nodes: graphNodes, edges, edgeKeys, edgeGeometries, nodeGrid: buildNodeGrid(graphNodes, edges), segments, rejectedSegments };
  roadGraphCache.set(cacheKey, graph);
  return graph;
}

function nearestNode(graph: RoadGraph, point: Point): { node: GraphNode | null; distance: number } {
  let best: GraphNode | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const { cellSize, cells, nodes } = graph.nodeGrid;
  const cellX = Math.floor(point.x / cellSize);
  const cellY = Math.floor(point.y / cellSize);
  let checkedAny = false;

  function checkNode(node: GraphNode) {
    const current = Math.hypot(node.x - point.x, node.y - point.y);
    if (current < bestDistance) {
      best = node;
      bestDistance = current;
    }
  }

  for (let ring = 0; ring <= 8; ring += 1) {
    for (let x = cellX - ring; x <= cellX + ring; x += 1) {
      for (let y = cellY - ring; y <= cellY + ring; y += 1) {
        if (ring > 0 && x !== cellX - ring && x !== cellX + ring && y !== cellY - ring && y !== cellY + ring) {
          continue;
        }

        const candidates = cells.get(`${x},${y}`) ?? [];
        candidates.forEach(checkNode);
        checkedAny = checkedAny || candidates.length > 0;
      }
    }

    if (checkedAny && bestDistance <= Math.max(0, ring - 0.5) * cellSize) break;
  }

  if (!best) {
    nodes.forEach(checkNode);
  }

  return { node: best, distance: bestDistance };
}

function graphDistance(route: GraphNode[]) {
  return route.slice(1).reduce((total, node, index) => {
    const prev = route[index];
    return total + Math.hypot(node.x - prev.x, node.y - prev.y);
  }, 0);
}

function routeUsesOnlyGraphEdges(graph: RoadGraph, route: GraphNode[]) {
  return route.slice(1).every((node, index) => {
    const prev = route[index];
    return graph.edgeKeys.has(`${prev.id}->${node.id}`);
  });
}

function expandRouteGeometry(graph: RoadGraph, route: GraphNode[]) {
  const expanded: RoutePoint[] = [];

  route.slice(1).forEach((node, index) => {
    const prev = route[index];
    const geometry = graph.edgeGeometries.get(`${prev.id}->${node.id}`);
    if (!geometry?.length) return;
    expanded.push(...(expanded.length ? geometry.slice(1) : geometry));
  });

  return expanded;
}

function densifyLatLngRoute(points: LatLng[], center: LatLng, maxSegmentMeters: number) {
  if (points.length < 2) return points;

  const dense: LatLng[] = [points[0]];

  points.slice(1).forEach((point, index) => {
    const prev = points[index];
    const prevLocal = toMeters(prev, center);
    const currentLocal = toMeters(point, center);
    const length = Math.hypot(currentLocal.x - prevLocal.x, currentLocal.y - prevLocal.y);
    const steps = Math.max(1, Math.ceil(length / maxSegmentMeters));

    for (let step = 1; step <= steps; step += 1) {
      const progress = step / steps;
      dense.push(fromMeters({
        x: prevLocal.x + (currentLocal.x - prevLocal.x) * progress,
        y: prevLocal.y + (currentLocal.y - prevLocal.y) * progress,
      }, center));
    }
  });

  return dense;
}

function pushHeap<T>(heap: T[], item: T, priority: (item: T) => number) {
  heap.push(item);
  let index = heap.length - 1;

  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (priority(heap[parent]) <= priority(heap[index])) break;
    [heap[parent], heap[index]] = [heap[index], heap[parent]];
    index = parent;
  }
}

function popHeap<T>(heap: T[], priority: (item: T) => number) {
  if (!heap.length) return null;
  const top = heap[0];
  const last = heap.pop()!;
  if (!heap.length) return top;

  heap[0] = last;
  let index = 0;

  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let smallest = index;

    if (left < heap.length && priority(heap[left]) < priority(heap[smallest])) smallest = left;
    if (right < heap.length && priority(heap[right]) < priority(heap[smallest])) smallest = right;
    if (smallest === index) break;

    [heap[index], heap[smallest]] = [heap[smallest], heap[index]];
    index = smallest;
  }

  return top;
}

function shortestWalkablePath(graph: RoadGraph, start: GraphNode, end: GraphNode, maxMeters: number) {
  if (start.id === end.id) return [start];

  const directDistance = Math.hypot(end.x - start.x, end.y - start.y);
  const budget = Math.max(
    matchConfig.minPathBudgetMeters,
    Math.min(maxMeters, directDistance * matchConfig.pathBudgetFactor + matchConfig.pathBudgetPaddingMeters),
  );
  const distances = new Map<string, number>([[start.id, 0]]);
  const previous = new Map<string, string>();
  const open: Array<{ id: string; priority: number }> = [{ id: start.id, priority: directDistance }];
  const closed = new Set<string>();

  while (open.length) {
    const current = popHeap(open, (item) => item.priority)!;
    if (closed.has(current.id)) continue;
    closed.add(current.id);

    const currentDistance = distances.get(current.id) ?? Number.POSITIVE_INFINITY;
    if (currentDistance > budget) continue;

    if (current.id === end.id) {
      const ids = [end.id];
      let cursor = end.id;
      while (cursor !== start.id) {
        const prev = previous.get(cursor);
        if (!prev) return null;
        ids.unshift(prev);
        cursor = prev;
      }
      return ids.map((id) => graph.nodes.get(id)).filter((node): node is GraphNode => Boolean(node));
    }

    const edges = graph.edges.get(current.id) ?? [];
    edges.forEach((edge) => {
      if (closed.has(edge.to)) return;
      const next = graph.nodes.get(edge.to);
      if (!next) return;

      const heuristic = Math.hypot(next.x - end.x, next.y - end.y);
      const nextDistance = currentDistance + edge.weight;
      if (nextDistance + heuristic > budget) return;
      if (nextDistance >= (distances.get(edge.to) ?? Number.POSITIVE_INFINITY)) return;

      distances.set(edge.to, nextDistance);
      previous.set(edge.to, current.id);
      pushHeap(
        open,
        { id: edge.to, priority: nextDistance + heuristic * matchConfig.heuristicWeight },
        (item) => item.priority,
      );
    });
  }

  return null;
}

function stitchWalkableRoute(graph: RoadGraph, waypoints: GraphNode[], segmentBudgetMeters: number) {
  if (waypoints.length < 2) return null;

  type StitchState = {
    connectedLegs: number;
    index: number;
    route: GraphNode[];
    score: number;
    skippedWaypoints: number;
  };

  function futureFitPenalty(node: GraphNode, startIndex: number) {
    const futureTargets = waypoints.slice(
      startIndex,
      Math.min(waypoints.length, startIndex + matchConfig.futureFitLookahead),
    );
    if (!futureTargets.length) return 0;

    return futureTargets.reduce((sum, target, offset) => {
      const distance = Math.hypot(node.x - target.x, node.y - target.y);
      return sum + distance * matchConfig.futureFitPenalty / (offset + 1);
    }, 0);
  }

  let beam: StitchState[] = [{
    connectedLegs: 0,
    index: 1,
    route: [waypoints[0]],
    score: 0,
    skippedWaypoints: 0,
  }];
  const completed: StitchState[] = [];
  const maxSkippedWaypoints = Math.floor(waypoints.length * matchConfig.maxSkippedWaypointRatio);

  for (let iteration = 0; iteration < waypoints.length && beam.length; iteration += 1) {
    const nextBeam: StitchState[] = [];

    beam.forEach((state) => {
      if (state.index >= waypoints.length) {
        completed.push(state);
        return;
      }

      if (state.skippedWaypoints < maxSkippedWaypoints) {
        nextBeam.push({
          ...state,
          index: state.index + 1,
          score: state.score + matchConfig.skippedWaypointPenalty * 1.15,
          skippedWaypoints: state.skippedWaypoints + 1,
        });
      }

      const from = state.route[state.route.length - 1];
      const lastLookaheadIndex = Math.min(waypoints.length - 1, state.index + matchConfig.waypointLookahead);

      for (let targetIndex = state.index; targetIndex <= lastLookaheadIndex; targetIndex += 1) {
        const skipped = targetIndex - state.index;
        if (state.skippedWaypoints + skipped > maxSkippedWaypoints) continue;

        const path = shortestWalkablePath(
          graph,
          from,
          waypoints[targetIndex],
          segmentBudgetMeters * (1 + skipped * 0.45),
        );
        if (!path || path.length < 2) continue;

        const end = path[path.length - 1];
        const route = [...state.route, ...path.slice(1)];
        const distancePenalty = graphDistance(path) * 0.018;
        const skippedPenalty = skipped * matchConfig.skippedWaypointPenalty;
        const fitPenalty = futureFitPenalty(end, targetIndex + 1);

        nextBeam.push({
          connectedLegs: state.connectedLegs + 1,
          index: targetIndex + 1,
          route,
          score: state.score + distancePenalty + skippedPenalty + fitPenalty,
          skippedWaypoints: state.skippedWaypoints + skipped,
        });
      }
    });

    beam = nextBeam
      .sort((a, b) => a.score - b.score)
      .slice(0, matchConfig.stitchBeamWidth);
  }

  completed.push(...beam.filter((state) => state.index >= waypoints.length || state.connectedLegs > 0));

  const best = completed
    .filter((state) => state.connectedLegs > 0)
    .sort((a, b) => a.score - b.score)[0];
  if (!best) return null;

  const deduped = best.route.filter((node, index, array) => node.id !== array[index - 1]?.id);
  if (deduped.length < 4) return null;
  if (!routeUsesOnlyGraphEdges(graph, deduped)) return null;

  const minConnectedLegs = Math.max(1, Math.floor((waypoints.length - 1) * (1 - matchConfig.maxSkippedWaypointRatio)));
  if (best.skippedWaypoints > maxSkippedWaypoints || best.connectedLegs < minConnectedLegs) return null;

  return { route: deduped, skippedWaypoints: best.skippedWaypoints, connectedLegs: best.connectedLegs };
}

function fallbackWalkableRoute(graph: RoadGraph, center: LatLng, kilometers: number) {
  const start = nearestNode(graph, { x: 0, y: 0 }).node ?? graph.nodeGrid.nodes[0];
  if (!start) return null;

  const targetMeters = kilometers * 1000;
  const route: GraphNode[] = [start];
  const edgeVisits = new Map<string, number>();
  let current = start;
  let previousId = "";
  let meters = 0;

  for (let step = 0; step < 6000 && (meters < targetMeters || route.length < 8); step += 1) {
    const edges = (graph.edges.get(current.id) ?? [])
      .flatMap((edge) => {
        const next = graph.nodes.get(edge.to);
        return next ? [{ edge, next }] : [];
      });
    if (!edges.length) break;

    const progress = meters / Math.max(targetMeters, 1);
    const preferredHeading = progress * Math.PI * 2 + Math.PI / 3;
    const best = edges
      .map(({ edge, next }) => {
        const edgeKey = `${current.id}->${next.id}`;
        const heading = Math.atan2(next.y - current.y, next.x - current.x);
        const headingPenalty = Math.abs(Math.atan2(Math.sin(heading - preferredHeading), Math.cos(heading - preferredHeading)));
        const backtrackPenalty = next.id === previousId ? 1.5 : 0;
        const usedPenalty = (edgeVisits.get(edgeKey) ?? 0) * 2.5;
        const overshootPenalty = Math.max(0, meters + edge.weight - targetMeters * 1.15) / 80;
        return { edge, next, score: headingPenalty + backtrackPenalty + usedPenalty + overshootPenalty };
      })
      .sort((a, b) => a.score - b.score)[0];

    if (!best) break;

    const edgeKey = `${current.id}->${best.next.id}`;
    edgeVisits.set(edgeKey, (edgeVisits.get(edgeKey) ?? 0) + 1);
    previousId = current.id;
    current = best.next;
    meters += best.edge.weight;
    route.push(current);
  }

  const deduped = route.filter((node, index, array) => node.id !== array[index - 1]?.id);
  if (deduped.length < 4 || !routeUsesOnlyGraphEdges(graph, deduped)) return null;
  return deduped;
}

function roadMatchedRoute(graph: RoadGraph, variants: ShapeVariant[], center: LatLng, kilometers: number) {
  const startRangeMeters = kilometers * 1000 * 0.05;
  const targetDistanceMeters = kilometers * 1000;
  const segmentBudgetMeters = Math.max(matchConfig.minSegmentBudgetMeters, targetDistanceMeters / matchConfig.segmentBudgetDivisor);
  const scales = matchConfig.scales;
  const rotations = matchConfig.rotations;
  const anchors = startAnchors(startRangeMeters);
  const rawCandidates: Array<{ targets: Point[]; startDrift: number; shapePenalty: number }> = [];

  variants.forEach((variant) => {
    const baseTargets = targetMeters(variant.points, kilometers);

    for (const scale of scales) {
      for (const rotation of rotations) {
        const rotatedStart = transformPoints([baseTargets[0]], scale, rotation, { x: 0, y: 0 })[0];

        for (const startAnchor of anchors) {
          rawCandidates.push({
            startDrift: Math.hypot(startAnchor.x, startAnchor.y),
            shapePenalty: variant.penalty,
            targets: transformPoints(baseTargets, scale, rotation, {
              x: startAnchor.x - rotatedStart.x,
              y: startAnchor.y - rotatedStart.y,
            }),
          });
        }
      }
    }

    for (let index = 0; index < matchConfig.randomCandidatesPerVariant; index += 1) {
      const scale = matchConfig.randomScaleMin + Math.random() * (matchConfig.randomScaleMax - matchConfig.randomScaleMin);
      const rotation = Math.random() * Math.PI * 2;
      const startAnchor = randomStartAnchor(startRangeMeters);
      const rotatedStart = transformPoints([baseTargets[0]], scale, rotation, { x: 0, y: 0 })[0];

      rawCandidates.push({
        startDrift: Math.hypot(startAnchor.x, startAnchor.y),
        shapePenalty: variant.penalty + 120,
        targets: transformPoints(baseTargets, scale, rotation, {
          x: startAnchor.x - rotatedStart.x,
          y: startAnchor.y - rotatedStart.y,
        }),
      });
    }
  });

  const rawRanked = rawCandidates
    .map((candidate) => {
      const snapped = candidate.targets.map((point) => nearestNode(graph, point));
      const route: GraphNode[] = snapped
        .flatMap((result) => result.node ? [result.node] : [])
        .filter((node, index, array) => node.id !== array[index - 1]?.id);
      if (route.length < 4) return null;

      const snapPenalty = snapped.reduce((sum, result) => sum + result.distance, 0) / snapped.length;
      const jumpPenalty = route.slice(1).reduce((sum, node, index) => {
        const prev = route[index];
        return sum + Math.max(0, Math.hypot(node.x - prev.x, node.y - prev.y) - 320);
      }, 0) / Math.max(route.length - 1, 1);
      const duplicatePenalty = (snapped.length - new Set(route.map((node) => node.id)).size) * 80;
      const startPenalty = Math.max(0, Math.hypot(route[0].x, route[0].y) - startRangeMeters) * 2;
      const score = snapPenalty + jumpPenalty * 0.7 + duplicatePenalty + startPenalty + candidate.startDrift * 0.2 + candidate.shapePenalty;

      return { score, route };
    })
    .filter((candidate): candidate is { score: number; route: GraphNode[] } => Boolean(candidate))
    .sort((a, b) => a.score - b.score)
    .slice(0, matchConfig.topCandidates);

  const rankedRoutes = rawRanked
    .map((candidate) => {
      const stitched = stitchWalkableRoute(graph, candidate.route, segmentBudgetMeters);
      if (!stitched) return null;

      const routeDistance = graphDistance(stitched.route);
      const distancePenalty = Math.abs(routeDistance - targetDistanceMeters) * 0.08;
      const detailPenalty = Math.max(0, stitched.route.length - 420) * 0.45;
      const skippedPenalty = stitched.skippedWaypoints * matchConfig.skippedWaypointPenalty;
      const score = candidate.score + distancePenalty + detailPenalty + skippedPenalty;

      return { score, route: stitched.route };
    })
    .filter((candidate): candidate is { score: number; route: GraphNode[] } => Boolean(candidate))
    .sort((a, b) => a.score - b.score);

  const bestRoute = rankedRoutes[0]?.route ?? fallbackWalkableRoute(graph, center, kilometers);
  const routeLatLng = bestRoute
    ? densifyLatLngRoute(
      expandRouteGeometry(graph, bestRoute).map((point) => ({ lat: point.lat, lng: point.lng })),
      center,
      matchConfig.maxRenderedSegmentMeters,
    )
    : [];

  const referencePoints = graph.segments.flatMap((segment) => [segment.a, segment.b]);
  return {
    fallbackUsed: rankedRoutes.length === 0,
    points: withPreviewPoints(routeLatLng, center, referencePoints),
    rankedRoutes: rankedRoutes.length,
  };
}

function gpx(points: RoutePoint[], name: string) {
  const safeName = name.replace(/[<>&'"]/g, "");
  const trkpts = points.map((point) =>
    `      <trkpt lat="${point.lat.toFixed(7)}" lon="${point.lng.toFixed(7)}"><ele>0</ele></trkpt>`
  ).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Strava Art Walker" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${safeName || "Walking art route"}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

function formatMs(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

function loadSavedLocation(): SavedLocation {
  if (typeof window === "undefined") {
    return { location: "Litoměřice", selectedLocation: defaultLocation };
  }

  try {
    const saved = window.localStorage.getItem(savedLocationKey);
    if (!saved) return { location: "Litoměřice", selectedLocation: defaultLocation };

    const parsed = JSON.parse(saved) as Partial<SavedLocation>;
    return {
      location: typeof parsed.location === "string" && parsed.location.trim() ? parsed.location : "Litoměřice",
      selectedLocation: parsed.selectedLocation && typeof parsed.selectedLocation.lat === "number" && typeof parsed.selectedLocation.lng === "number"
        ? parsed.selectedLocation
        : null,
    };
  } catch {
    return { location: "Litoměřice", selectedLocation: defaultLocation };
  }
}

function waitForPaint() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

async function imageToPath(file: File): Promise<Point[]> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  const size = 72;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return [];

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);
  const ratio = Math.min(size / bitmap.width, size / bitmap.height);
  const width = bitmap.width * ratio;
  const height = bitmap.height * ratio;
  context.drawImage(bitmap, (size - width) / 2, (size - height) / 2, width, height);
  const data = context.getImageData(0, 0, size, size).data;
  const points: Point[] = [];

  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const index = (y * size + x) * 4;
      const brightness = (data[index] + data[index + 1] + data[index + 2]) / 3;
      if (brightness < 185) {
        const neighborBrightness = [
          ((y - 1) * size + x) * 4,
          ((y + 1) * size + x) * 4,
          (y * size + x - 1) * 4,
          (y * size + x + 1) * 4,
        ].some((neighbor) => (data[neighbor] + data[neighbor + 1] + data[neighbor + 2]) / 3 > 200);
        if (neighborBrightness) points.push({ x: x / size - 0.5, y: y / size - 0.5 });
      }
    }
  }

  if (points.length < 8) return [];
  const center = points.reduce((acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }), { x: 0, y: 0 });
  center.x /= points.length;
  center.y /= points.length;

  return normalize(points
    .sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x))
    .concat(points[0]));
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function createBaseLayer() {
  const mapyApiKey = import.meta.env.VITE_MAPY_API_KEY as string | undefined;

  if (mapyApiKey) {
    try {
      const tileJsonUrl = `https://api.mapy.com/v1/maptiles/outdoor/tiles.json?apikey=${encodeURIComponent(mapyApiKey)}`;
      const response = await fetch(tileJsonUrl);
      if (response.ok) {
        const tileJson: TileJson = await response.json();
        const tileUrl = tileJson.tiles?.[0];
        if (tileUrl) {
          return L.tileLayer(tileUrl, {
            attribution: tileJson.attribution ?? '&copy; <a href="https://mapy.com/">Mapy.com</a>',
            minZoom: tileJson.minzoom,
            maxZoom: tileJson.maxzoom ?? 19,
          });
        }
      }
    } catch {
      // Fall through to OSM tiles when Mapy is unavailable or the key is invalid.
    }
  }

  return L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
}

function App() {
  const savedLocation = useMemo(loadSavedLocation, []);
  const [description, setDescription] = useState("star");
  const [location, setLocation] = useState(savedLocation.location);
  const [selectedLocation, setSelectedLocation] = useState<LocationSuggestion | null>(savedLocation.selectedLocation);
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestion[]>([]);
  const [isSearchingLocations, setIsSearchingLocations] = useState(false);
  const [isLocationFocused, setIsLocationFocused] = useState(false);
  const [distanceKm, setDistanceKm] = useState(5);
  const [imagePath, setImagePath] = useState<Point[] | null>(null);
  const [imageName, setImageName] = useState("");
  const [isTracing, setIsTracing] = useState(false);
  const [roadRoute, setRoadRoute] = useState<RoutePoint[] | null>(null);
  const [roadSegments, setRoadSegments] = useState<RoadSegment[]>([]);
  const [roadCenter, setRoadCenter] = useState<LatLng | null>(null);
  const [roadStatus, setRoadStatus] = useState("Use Match roads to build the GPX from real walkable streets.");
  const [isMatchingRoads, setIsMatchingRoads] = useState(false);
  const [matchPhase, setMatchPhase] = useState("");
  const [isMapLoading, setIsMapLoading] = useState(true);
  const [matchTiming, setMatchTiming] = useState<MatchTiming | null>(null);
  const [graphInfo, setGraphInfo] = useState<GraphInfo | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const mapElementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const routeLayerRef = useRef<L.Polyline | null>(null);
  const roadLayerRef = useRef<L.LayerGroup | null>(null);
  const startMarkerRef = useRef<L.CircleMarker | null>(null);
  const endMarkerRef = useRef<L.CircleMarker | null>(null);
  const matchRequestRef = useRef(0);

  const sourceVariants = useMemo(
    () => shapeVariants(description, imagePath),
    [description, imagePath],
  );
  const sourcePoints = sourceVariants[0].points;
  const templatePreviews = useMemo(
    () => templates.map((template) => ({
      name: template,
      points: pathPreviewPoints(templatePath(template)),
    })),
    [],
  );
  const center = selectedLocation ?? parseLocation(location);
  const sketchRoute = useMemo(() => {
    const sampled = resample(sourcePoints, 280);
    return projectToLatLng(sampled, center, distanceKm);
  }, [sourcePoints, center.lat, center.lng, distanceKm]);
  const hasWalkableRoute = Boolean(roadRoute?.length);
  const route = roadRoute?.length ? roadRoute : sketchRoute;
  const matchTryCount = sourceVariants.length * (
    matchConfig.scales.length
    * matchConfig.rotations.length
    * startAnchors(distanceKm * 1000 * 0.05).length
    + matchConfig.randomCandidatesPerVariant
  );
  const stats = routeStats(route);
  const bounds = {
    north: Math.max(...route.map((point) => point.lat)),
    south: Math.min(...route.map((point) => point.lat)),
    east: Math.max(...route.map((point) => point.lng)),
    west: Math.min(...route.map((point) => point.lng)),
  };
  const mapOverlayText = isTracing
    ? "Tracing image..."
    : isMatchingRoads
      ? matchPhase || "Calculating walkable route..."
      : isMapLoading
        ? "Loading map tiles..."
        : "";

  function clearRoadMatch() {
    matchRequestRef.current += 1;
    setRoadRoute(null);
    setRoadSegments([]);
    setRoadCenter(null);
    setMatchTiming(null);
    setGraphInfo(null);
    setMatchPhase("Waiting for inputs to settle...");
    setRoadStatus("Recalculating route from current inputs...");
  }

  async function handleImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsTracing(true);
    setImageName(file.name);
    const traced = await imageToPath(file);
    setImagePath(traced.length ? traced : null);
    clearRoadMatch();
    setIsTracing(false);
  }

  async function handleMatchRoads() {
    const requestId = matchRequestRef.current + 1;
    matchRequestRef.current = requestId;
    const startedAt = performance.now();
    let roadSearchMs = 0;
    let routeMs = 0;
    let hasLoadedGraph = false;
    setIsMatchingRoads(true);
    setMatchTiming(null);
    setMatchPhase("Resolving start point...");
    setRoadStatus("Searching OpenStreetMap for nearby walkable streets...");

    try {
      const resolvedCenter = selectedLocation ?? await resolveLocation(location);
      const radius = Math.min(Math.max(distanceKm * 430, 850), 4200);
      setMatchPhase("Loading walkable streets and obstacles...");
      const roadSearchStartedAt = performance.now();
      const graph = await fetchRoadGraph(resolvedCenter, radius);
      roadSearchMs = performance.now() - roadSearchStartedAt;
      hasLoadedGraph = true;
      setGraphInfo({
        cacheVersion: matchConfig.graphCacheVersion,
        spacingMeters: matchConfig.roadNodeSpacingMeters,
        nodes: graph.nodes.size,
        edges: graph.edgeKeys.size,
        rejectedSegments: graph.rejectedSegments,
      });
      if (requestId !== matchRequestRef.current) return;

      setMatchPhase(`Testing ${matchTryCount} shape placements...`);
      setRoadStatus(`Testing ${matchTryCount} placements and stitching the best ${matchConfig.topCandidates} to roads...`);
      await waitForPaint();
      const routeStartedAt = performance.now();
      const matchedResult = roadMatchedRoute(graph, sourceVariants, resolvedCenter, distanceKm);
      const matched = matchedResult.points;
      routeMs = performance.now() - routeStartedAt;
      if (requestId !== matchRequestRef.current) return;

      if (matched.length < 2) {
        throw new Error("Road data loaded, but no connected graph route could be produced.");
      }

      setRoadRoute(matched);
      setRoadSegments(graph.segments);
      setRoadCenter(resolvedCenter);
      setHasLoadedOnce(true);
      setMatchTiming({
        totalMs: performance.now() - startedAt,
        roadSearchMs,
        routeMs,
        placements: matchTryCount,
        rankedRoutes: matchedResult.rankedRoutes,
      });
      const matchedStats = routeStats(matched);
      const rankingStatus = matchedResult.fallbackUsed
        ? "No connected candidate ranked; using a fallback walk."
        : `Ranked ${matchedResult.rankedRoutes} connected candidates; chose the best route.`;
      setMatchPhase("");
      setRoadStatus(`${rankingStatus} GPX distance is ${matchedStats.kilometers.toFixed(2)} km.`);
    } catch (error) {
      if (requestId !== matchRequestRef.current) return;
      setRoadRoute(null);
      setRoadSegments([]);
      setRoadCenter(null);
      if (!hasLoadedGraph) setGraphInfo(null);
      setMatchTiming({
        totalMs: performance.now() - startedAt,
        roadSearchMs,
        routeMs,
      });
      setHasLoadedOnce(true);
      setMatchPhase("");
      setRoadStatus(
        hasLoadedOnce
          ? error instanceof Error ? error.message : "Road matching failed."
          : error instanceof Error ? error.message : "Showing the generated sketch now. Road data is slow, so use Match roads to retry.",
      );
    } finally {
      if (requestId === matchRequestRef.current) {
        setIsMatchingRoads(false);
        setMatchPhase("");
      }
    }
  }

  useEffect(() => {
    if (isTracing) return undefined;
    setRoadStatus(hasLoadedOnce ? "Recalculating route from current inputs..." : "Showing sketch route while road data loads...");
    const timer = window.setTimeout(() => {
      void handleMatchRoads();
    }, hasLoadedOnce ? 850 : 1_500);

    return () => window.clearTimeout(timer);
  }, [sourcePoints, location, selectedLocation?.lat, selectedLocation?.lng, distanceKm, isTracing]);

  useEffect(() => {
    window.localStorage.setItem(savedLocationKey, JSON.stringify({ location, selectedLocation }));
  }, [location, selectedLocation]);

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) return undefined;

    const map = L.map(mapElementRef.current, {
      center: [center.lat, center.lng],
      zoom: 14,
      zoomControl: true,
      scrollWheelZoom: true,
    });
    mapRef.current = map;

    void createBaseLayer().then((layer) => {
      setIsMapLoading(true);
      layer.on("loading", () => setIsMapLoading(true));
      layer.on("load", () => setIsMapLoading(false));
      layer.on("tileerror", () => setIsMapLoading(false));
      layer.addTo(map);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const routeLatLngs = route.map((point) => L.latLng(point.lat, point.lng));
    if (!routeLatLngs.length) return;

    if (!roadLayerRef.current) {
      roadLayerRef.current = L.layerGroup().addTo(map);
    }
    roadLayerRef.current.clearLayers();
    roadSegments.forEach((segment) => {
      L.polyline(
        [
          [segment.a.lat, segment.a.lng],
          [segment.b.lat, segment.b.lng],
        ],
        {
          color: "#8f98a6",
          weight: 1.6,
          opacity: 0.35,
          smoothFactor: 0,
          noClip: true,
          interactive: false,
        },
      ).addTo(roadLayerRef.current!);
    });

    if (routeLayerRef.current) {
      routeLayerRef.current.remove();
    }
    routeLayerRef.current = L.polyline(routeLatLngs, {
      color: hasWalkableRoute ? "#fc4c02" : "#556070",
      weight: hasWalkableRoute ? 6 : 3,
      opacity: hasWalkableRoute ? 0.92 : 0.56,
      lineCap: "round",
      lineJoin: "round",
      dashArray: hasWalkableRoute ? undefined : "8 8",
      smoothFactor: 0,
      noClip: true,
    }).addTo(map);

    const start = routeLatLngs[0];
    const end = routeLatLngs[routeLatLngs.length - 1];
    if (startMarkerRef.current) {
      startMarkerRef.current.setLatLng(start);
    } else {
      startMarkerRef.current = L.circleMarker(start, {
        radius: 7,
        color: "#ffffff",
        weight: 2,
        fillColor: "#1f8a5b",
        fillOpacity: 1,
      }).addTo(map);
    }

    if (endMarkerRef.current) {
      endMarkerRef.current.setLatLng(end);
    } else {
      endMarkerRef.current = L.circleMarker(end, {
        radius: 6,
        color: "#ffffff",
        weight: 2,
        fillColor: "#273043",
        fillOpacity: 1,
      }).addTo(map);
    }

    const routeBounds = L.latLngBounds(routeLatLngs);
    map.fitBounds(routeBounds.pad(0.18), { animate: true, maxZoom: 16 });
  }, [route, roadSegments, hasWalkableRoute]);

  useEffect(() => {
    const query = location.trim();
    if (!isLocationFocused || selectedLocation?.label === query || selectedLocation?.id.startsWith("preset-")) {
      setLocationSuggestions([]);
      setIsSearchingLocations(false);
      return undefined;
    }

    const controller = new AbortController();
    setIsSearchingLocations(query.length >= 3);
    const timer = window.setTimeout(() => {
      searchLocations(query, controller.signal)
        .then((suggestions) => {
          setLocationSuggestions(suggestions);
          setIsSearchingLocations(false);
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setLocationSuggestions([]);
          setIsSearchingLocations(false);
        });
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [location, selectedLocation, isLocationFocused]);

  return (
    <main className="app">
      <section className="workspace">
        <aside className="panel">
          <div>
            <p className="eyebrow">Walking art planner</p>
            <h1>Route Canvas</h1>
          </div>

          <label>
            Image description
            <textarea
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                setImagePath(null);
                clearRoadMatch();
              }}
              placeholder="heart, star, flower, cat, mountains, spiral, bolt, wave..."
            />
          </label>

          <div className="upload">
            <button type="button" onClick={() => fileInput.current?.click()}>
              Upload image
            </button>
            <input ref={fileInput} type="file" accept="image/*" onChange={handleImage} />
            <span>{isTracing ? "Tracing image..." : imageName || "No file selected"}</span>
          </div>

          <label>
            Start location
            <div className="locationSearch">
              <input
                value={location}
                onChange={(event) => {
                  setLocation(event.target.value);
                  setSelectedLocation(null);
                  clearRoadMatch();
                }}
                onFocus={() => setIsLocationFocused(true)}
                onBlur={() => window.setTimeout(() => setIsLocationFocused(false), 140)}
                placeholder="Search address, place, or 50.0755, 14.4378"
                autoComplete="off"
              />
              {isLocationFocused && (locationSuggestions.length > 0 || isSearchingLocations) ? (
                <div className="suggestions" role="listbox" aria-label="Location suggestions">
                  {isSearchingLocations ? <div className="suggestionMeta">Searching addresses...</div> : null}
                  {locationSuggestions.map((suggestion) => (
                    <button
                      key={suggestion.id}
                      type="button"
                      role="option"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setLocation(shortLocationLabel(suggestion.label));
                        setSelectedLocation(suggestion);
                        setLocationSuggestions([]);
                        setIsLocationFocused(false);
                        clearRoadMatch();
                      }}
                    >
                      <strong>{shortLocationLabel(suggestion.label)}</strong>
                      <span>{suggestion.type} · {suggestion.lat.toFixed(4)}, {suggestion.lng.toFixed(4)}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </label>

          <label>
            Approximate walking distance
            <div className="rangeRow">
              <input
                type="range"
                min="1"
                max="30"
                step="0.5"
                value={distanceKm}
                onChange={(event) => {
                  setDistanceKm(Number(event.target.value));
                  clearRoadMatch();
                }}
              />
              <strong>{distanceKm.toFixed(1)} km</strong>
            </div>
          </label>

          <div className="shapeGrid" aria-label="Shape presets">
            {templatePreviews.map((template) => (
              <button
                key={template.name}
                className={description.toLowerCase().includes(template.name) && !imagePath ? "selectedShape" : undefined}
                type="button"
                onClick={() => {
                  setDescription(template.name);
                  setImagePath(null);
                  clearRoadMatch();
                }}
                aria-label={`Use ${template.name} shape`}
              >
                <svg viewBox="0 0 100 100" aria-hidden="true">
                  <rect x="5" y="5" width="90" height="90" rx="8" />
                  <polyline points={template.points} />
                </svg>
                <span>{template.name}</span>
              </button>
            ))}
          </div>

          <button
            className="secondary"
            type="button"
            onClick={handleMatchRoads}
            disabled={isMatchingRoads}
          >
            {isMatchingRoads ? "Matching roads..." : "Match roads"}
          </button>

          <button
            className="primary"
            type="button"
            onClick={() => {
              if (!roadRoute?.length) return;
              download("strava-art-walk.gpx", gpx(roadRoute, description || imageName));
            }}
            disabled={!hasWalkableRoute}
          >
            Export walkable GPX
          </button>

          <p className="status">{roadStatus}</p>
          <p className="status timing">
            {isMatchingRoads
              ? "Calculating path..."
              : matchTiming
                ? `Last calculation: ${formatMs(matchTiming.totalMs)} total / ${formatMs(matchTiming.roadSearchMs)} road data / ${formatMs(matchTiming.routeMs)} path${typeof matchTiming.rankedRoutes === "number" ? ` / ${matchTiming.rankedRoutes} ranked` : ""}`
                : "Last calculation: not run yet"}
          </p>
          <p className="status timing">
            {graphInfo
              ? `Graph ${graphInfo.cacheVersion} / ${graphInfo.spacingMeters}m nodes / ${graphInfo.nodes} nodes / ${graphInfo.edges} edges / ${graphInfo.rejectedSegments} blocked`
              : `Graph ${matchConfig.graphCacheVersion} / ${matchConfig.roadNodeSpacingMeters}m nodes / not loaded`}
          </p>
        </aside>

        <section className="mapSurface" aria-label="Route preview">
          <div ref={mapElementRef} className="embeddedMap" aria-label="Interactive route map" />
          {mapOverlayText ? (
            <div className="mapOverlay" role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              <strong>{mapOverlayText}</strong>
            </div>
          ) : null}

          <div className="stats">
            <div>
              <span>Route</span>
              <strong>{stats.kilometers.toFixed(2)} km</strong>
            </div>
            <div>
              <span>Walk time</span>
              <strong>{Math.round(stats.minutes)} min</strong>
            </div>
            <div>
              <span>Points</span>
              <strong>{route.length}</strong>
            </div>
            <div>
              <span>Bounds</span>
              <strong>{bounds.south.toFixed(4)}, {bounds.west.toFixed(4)}</strong>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

import React, { useEffect, useMemo, useRef, useState } from "react";
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

type RoadGraphSource = "memory" | "persistent" | "network";

type CachedRoadGraph = {
  nodes: GraphNode[];
  edges: Array<[string, GraphEdge[]]>;
  edgeKeys: string[];
  edgeGeometries: Array<[string, RoutePoint[]]>;
  segments: RoadSegment[];
  rejectedSegments: number;
};

type RoadGraphCacheRecord = {
  key: string;
  createdAt: number;
  graph: CachedRoadGraph;
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
  selectedRouteRank?: number;
  choicePoolSize?: number;
  startOffsetMeters?: number;
};

type GraphInfo = {
  cacheVersion: string;
  source: string;
  profile: string;
  radiusMeters: number;
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

type RoadQueryProfile = {
  id: string;
  label: string;
  highways: string;
  timeoutSeconds: number;
  timeoutMs: number;
  extraFilters: string[];
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
  "diamond",
  "mountains",
  "spiral",
  "crown",
  "bolt",
  "wave",
] as const;

type TemplateName = typeof templates[number];

const roadGraphCache = new Map<string, RoadGraph>();
const savedLocationKey = "route-canvas.location";
const roadGraphDbName = "route-canvas-road-graphs";
const roadGraphStoreName = "roadGraphs";
const roadGraphCacheMaxAgeMs = 7 * 24 * 60 * 60 * 1000;
const roadGraphCacheMaxRecords = 18;
let roadGraphDbPromise: Promise<IDBDatabase | null> | null = null;

const matchConfig = {
  graphCacheVersion: "fast-road-profile-cache-v1",
  roadNodeSpacingMeters: 20,
  maxRenderedSegmentMeters: 10,
  targetPoints: 48,
  topCandidates: 84,
  minRoadSearchRadiusMeters: 700,
  maxRoadSearchRadiusMeters: 3200,
  roadSearchPaddingMeters: 220,
  compactRoadMinSegments: 80,
  compactRoadRadiusBoost: 1.18,
  startSearchRadiusRatio: 0.18,
  minStartSearchRadiusMeters: 220,
  maxStartSearchRadiusMeters: 1200,
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
  preferredRotationRadians: Math.PI / 4,
  rotationPenaltyWeight: 45,
  pathBudgetFactor: 2.55,
  pathBudgetPaddingMeters: 180,
  minPathBudgetMeters: 200,
  minSegmentBudgetMeters: 620,
  segmentBudgetDivisor: 7.5,
  distancePenaltyWeight: 0.04,
  shortRoutePenaltyWeight: 0.3,
  minRouteDistanceRatio: 0.55,
  heuristicWeight: 1.25,
  shapeVariantLimit: 6,
  shapeVariantPenalty: 520,
  randomCandidatesPerVariant: 520,
  randomScaleMin: 0.66,
  randomScaleMax: 1.32,
  routeChoicePoolSize: 8,
  routeChoiceScoreWindowRatio: 0.2,
  routeChoiceMinScoreWindow: 280,
  routeChoiceScoreSharpness: 1.1,
  waypointLookahead: 5,
  stitchBeamWidth: 5,
  futureFitLookahead: 4,
  futureFitPenalty: 0.22,
  snapPenaltyWeight: 1.35,
  jumpPenaltyWeight: 1.15,
  duplicateWaypointPenalty: 115,
  startDriftPenalty: 0.018,
  outsideStartPenalty: 0.25,
  stitchedStartPenalty: 0.012,
  gentleTurnRadians: Math.PI / 5,
  turnPenaltyWeight: 7,
  uTurnPenalty: 85,
  repeatedEdgePenalty: 34,
  reverseEdgePenalty: 105,
  deadEndPenalty: 56,
  pathCacheBudgetStepMeters: 80,
  maxSkippedWaypointRatio: 0.62,
  skippedWaypointPenalty: 420,
};

const roadQueryProfiles = {
  compact: {
    id: "compact",
    label: "compact roads",
    highways: "footway|path|pedestrian|residential|living_street|steps|tertiary|unclassified",
    timeoutSeconds: 8,
    timeoutMs: 9_000,
    extraFilters: [],
  },
  broad: {
    id: "broad",
    label: "broad roads",
    highways: "footway|path|pedestrian|residential|living_street|service|tertiary|unclassified|cycleway|steps|track",
    timeoutSeconds: 12,
    timeoutMs: 13_000,
    extraFilters: ['["service"!~"parking_aisle|driveway|drive-through"]'],
  },
} satisfies Record<string, RoadQueryProfile>;

const templateAlternates: Record<TemplateName, TemplateName[]> = {
  heart: ["diamond", "spiral", "wave"],
  star: ["crown", "bolt", "spiral"],
  diamond: ["star", "heart", "bolt"],
  mountains: ["wave", "bolt", "star"],
  spiral: ["heart", "wave", "diamond"],
  crown: ["star", "mountains", "bolt"],
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

  if (selected === "diamond") {
    return normalize([
      { x: 0, y: -1 },
      { x: 0.82, y: 0 },
      { x: 0, y: 1 },
      { x: -0.82, y: 0 },
      { x: 0, y: -1 },
    ]);
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

  if (selected === "crown") {
    return normalize([
      { x: -1, y: 0.5 },
      { x: -0.82, y: -0.35 },
      { x: -0.48, y: 0.05 },
      { x: -0.18, y: -0.78 },
      { x: 0.14, y: 0.05 },
      { x: 0.48, y: -0.38 },
      { x: 0.86, y: 0.5 },
      { x: -1, y: 0.5 },
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

function coordinateLabel(point: LatLng) {
  return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
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

function rotationPreferencePenalty(rotation: number) {
  const normalized = Math.abs(Math.atan2(Math.sin(rotation), Math.cos(rotation)));
  const excess = Math.max(0, normalized - matchConfig.preferredRotationRadians);
  return excess / Math.PI * matchConfig.rotationPenaltyWeight;
}

function startSearchRadiusMeters(kilometers: number) {
  return Math.min(
    Math.max(kilometers * 1000 * matchConfig.startSearchRadiusRatio, matchConfig.minStartSearchRadiusMeters),
    matchConfig.maxStartSearchRadiusMeters,
  );
}

function roadSearchRadiusMeters(points: Point[], kilometers: number, startSearchMeters: number) {
  const shapeRadius = targetMeters(points, kilometers).reduce(
    (radius, point) => Math.max(radius, Math.hypot(point.x, point.y)),
    0,
  );

  return Math.min(
    Math.max(shapeRadius + startSearchMeters + matchConfig.roadSearchPaddingMeters, matchConfig.minRoadSearchRadiusMeters),
    matchConfig.maxRoadSearchRadiusMeters,
  );
}

function startAnchors(startRangeMeters: number) {
  const anchors: Point[] = [{ x: 0, y: 0 }];
  const rings = [
    { radius: startRangeMeters * 0.35, count: 8 },
    { radius: startRangeMeters * 0.7, count: 12 },
    { radius: startRangeMeters, count: 16 },
  ];

  rings.forEach(({ radius, count }, ringIndex) => {
    const angleOffset = ringIndex % 2 === 0 ? 0 : Math.PI / count;
    for (let index = 0; index < count; index += 1) {
      const angle = angleOffset + index * Math.PI * 2 / count;
      anchors.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    }
  });

  return anchors;
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

function customShapeVariants(points: Point[]): ShapeVariant[] {
  const normalized = normalize(points);
  const reversed = [...normalized].reverse();
  const simplified = normalize(resample(normalized, Math.min(48, Math.max(12, normalized.length))));

  return [
    { name: "drawn path", points: normalized, penalty: 0 },
    { name: "drawn path reversed", points: reversed, penalty: matchConfig.shapeVariantPenalty * 0.5 },
    { name: "drawn path simplified", points: simplified, penalty: matchConfig.shapeVariantPenalty * 0.75 },
  ];
}

function shapeVariants(description: string, customPath: Point[] | null): ShapeVariant[] {
  return customPath?.length ? customShapeVariants(customPath) : textShapeVariants(description);
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

function serializeRoadGraph(graph: RoadGraph): CachedRoadGraph {
  return {
    nodes: Array.from(graph.nodes.values()),
    edges: Array.from(graph.edges.entries()),
    edgeKeys: Array.from(graph.edgeKeys.values()),
    edgeGeometries: Array.from(graph.edgeGeometries.entries()),
    segments: graph.segments,
    rejectedSegments: graph.rejectedSegments,
  };
}

function reviveRoadGraph(cached: CachedRoadGraph): RoadGraph {
  const nodes = new Map(cached.nodes.map((node) => [node.id, node]));
  const edges = new Map(cached.edges);

  return {
    nodes,
    edges,
    edgeKeys: new Set(cached.edgeKeys),
    edgeGeometries: new Map(cached.edgeGeometries),
    nodeGrid: buildNodeGrid(nodes, edges),
    segments: cached.segments,
    rejectedSegments: cached.rejectedSegments,
  };
}

function idbRequest<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbTransactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openRoadGraphDb() {
  if (typeof window === "undefined" || !window.indexedDB) return Promise.resolve(null);
  if (roadGraphDbPromise) return roadGraphDbPromise;

  roadGraphDbPromise = new Promise<IDBDatabase | null>((resolve) => {
    const request = window.indexedDB.open(roadGraphDbName, 1);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(roadGraphStoreName)) {
        const store = database.createObjectStore(roadGraphStoreName, { keyPath: "key" });
        store.createIndex("createdAt", "createdAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });

  return roadGraphDbPromise;
}

async function prunePersistentRoadGraphs() {
  const database = await openRoadGraphDb();
  if (!database) return;

  const readTransaction = database.transaction(roadGraphStoreName, "readonly");
  const records = await idbRequest<RoadGraphCacheRecord[]>(readTransaction.objectStore(roadGraphStoreName).getAll());
  await idbTransactionDone(readTransaction);

  const expiredAt = Date.now() - roadGraphCacheMaxAgeMs;
  const keysToDelete = records
    .sort((a, b) => b.createdAt - a.createdAt)
    .flatMap((record, index) => index >= roadGraphCacheMaxRecords || record.createdAt < expiredAt ? [record.key] : []);
  if (!keysToDelete.length) return;

  const writeTransaction = database.transaction(roadGraphStoreName, "readwrite");
  const store = writeTransaction.objectStore(roadGraphStoreName);
  keysToDelete.forEach((key) => store.delete(key));
  await idbTransactionDone(writeTransaction);
}

async function readPersistentRoadGraph(cacheKey: string) {
  try {
    const database = await openRoadGraphDb();
    if (!database) return null;

    const transaction = database.transaction(roadGraphStoreName, "readonly");
    const record = await idbRequest<RoadGraphCacheRecord | undefined>(
      transaction.objectStore(roadGraphStoreName).get(cacheKey),
    );
    await idbTransactionDone(transaction);
    if (!record || Date.now() - record.createdAt > roadGraphCacheMaxAgeMs) return null;

    return reviveRoadGraph(record.graph);
  } catch {
    return null;
  }
}

async function writePersistentRoadGraph(cacheKey: string, graph: RoadGraph) {
  try {
    const database = await openRoadGraphDb();
    if (!database) return;

    const transaction = database.transaction(roadGraphStoreName, "readwrite");
    transaction.objectStore(roadGraphStoreName).put({
      key: cacheKey,
      createdAt: Date.now(),
      graph: serializeRoadGraph(graph),
    } satisfies RoadGraphCacheRecord);
    await idbTransactionDone(transaction);
    void prunePersistentRoadGraphs();
  } catch {
    // Best-effort browser cache only; route generation must keep working without it.
  }
}

async function fetchRoadGraph(
  center: LatLng,
  radiusMeters: number,
  profile: RoadQueryProfile,
): Promise<{ graph: RoadGraph; source: RoadGraphSource }> {
  const cacheKey = [
    matchConfig.graphCacheVersion,
    profile.id,
    `spacing-${matchConfig.roadNodeSpacingMeters}`,
    center.lat.toFixed(4),
    center.lng.toFixed(4),
    Math.round(radiusMeters / 100) * 100,
  ].join(":");
  const cached = roadGraphCache.get(cacheKey);
  if (cached) return { graph: cached, source: "memory" };

  const persistent = await readPersistentRoadGraph(cacheKey);
  if (persistent) {
    roadGraphCache.set(cacheKey, persistent);
    return { graph: persistent, source: "persistent" };
  }

  const extraFilters = profile.extraFilters.length
    ? `\n${profile.extraFilters.map((filter) => `        ${filter}`).join("\n")}`
    : "";
  const query = `
    [out:json][timeout:${profile.timeoutSeconds}];
    (
      way(around:${Math.round(radiusMeters)},${center.lat},${center.lng})
        ["highway"~"${profile.highways}"]
        ["access"!~"private|no"]
        ["foot"!~"no"]
        ["area"!="yes"]${extraFilters};
    );
    out body qt;
    >;
    out skel qt;
  `;

  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ];

  async function fetchEndpoint(endpoint: string, index: number, controllers: AbortController[], timeouts: number[]) {
    const controller = new AbortController();
    controllers[index] = controller;
    timeouts[index] = window.setTimeout(() => controller.abort(), profile.timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: query,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Road search failed at ${endpoint}`);
      return { index, response };
    } finally {
      if (timeouts[index]) {
        window.clearTimeout(timeouts[index]);
      }
    }
  }

  const controllers: AbortController[] = [];
  const timeouts: number[] = [];
  const winner = await Promise.any(endpoints.map((endpoint, index) => fetchEndpoint(endpoint, index, controllers, timeouts)))
    .catch(() => null);
  controllers.forEach((controller, index) => {
    if (index !== winner?.index) controller.abort();
  });
  timeouts.forEach((timeout) => window.clearTimeout(timeout));
  const response = winner?.response ?? null;

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
  void writePersistentRoadGraph(cacheKey, graph);
  return { graph, source: "network" };
}

async function fetchUsableRoadGraph(
  center: LatLng,
  radiusMeters: number,
  onPhase: (message: string) => void,
) {
  const compactProfile = roadQueryProfiles.compact;
  const broadProfile = roadQueryProfiles.broad;
  let compactResult: { graph: RoadGraph; source: RoadGraphSource } | null = null;

  try {
    onPhase(`Loading ${compactProfile.label} within ${Math.round(radiusMeters)} m...`);
    const result = await fetchRoadGraph(center, radiusMeters, compactProfile);
    compactResult = result;
    if (result.graph.segments.length >= matchConfig.compactRoadMinSegments) {
      return { ...result, profile: compactProfile, radiusMeters };
    }
  } catch {
    // Fall through to the broader profile below.
  }

  const broadRadius = Math.min(radiusMeters * matchConfig.compactRoadRadiusBoost, matchConfig.maxRoadSearchRadiusMeters);
  onPhase(`Expanding road search to ${Math.round(broadRadius)} m...`);
  try {
    const result = await fetchRoadGraph(center, broadRadius, broadProfile);
    return { ...result, profile: broadProfile, radiusMeters: broadRadius };
  } catch (error) {
    if (compactResult) return { ...compactResult, profile: compactProfile, radiusMeters };
    throw error;
  }
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

function edgeKey(from: string, to: string) {
  return `${from}->${to}`;
}

function turnRadians(prev: GraphNode, current: GraphNode, next: GraphNode) {
  const incoming = Math.atan2(current.y - prev.y, current.x - prev.x);
  const outgoing = Math.atan2(next.y - current.y, next.x - current.x);
  return Math.abs(Math.atan2(Math.sin(outgoing - incoming), Math.cos(outgoing - incoming)));
}

function turnQualityPenalty(prev: GraphNode, current: GraphNode, next: GraphNode) {
  const angle = turnRadians(prev, current, next);
  const softTurn = Math.max(0, angle - matchConfig.gentleTurnRadians);
  const uTurnPenalty = angle > Math.PI * 0.78 ? matchConfig.uTurnPenalty : 0;
  return softTurn * softTurn * matchConfig.turnPenaltyWeight + uTurnPenalty;
}

function routeQualityPenalty(
  graph: RoadGraph,
  route: GraphNode[],
  existingEdgeVisits = new Map<string, number>(),
) {
  const visits = new Map(existingEdgeVisits);
  let penalty = 0;

  route.slice(1).forEach((node, index) => {
    const prev = route[index];
    const forwardKey = edgeKey(prev.id, node.id);
    const reverseKey = edgeKey(node.id, prev.id);
    const forwardVisits = visits.get(forwardKey) ?? 0;
    const reverseVisits = visits.get(reverseKey) ?? 0;

    penalty += forwardVisits * matchConfig.repeatedEdgePenalty;
    penalty += reverseVisits * matchConfig.reverseEdgePenalty;
    visits.set(forwardKey, forwardVisits + 1);

    const degree = graph.edges.get(node.id)?.length ?? 0;
    if (degree <= 1) {
      penalty += matchConfig.deadEndPenalty * (index < route.length - 2 ? 1.35 : 0.65);
    }

    if (index >= 1) {
      penalty += turnQualityPenalty(route[index - 1], prev, node);
    }
  });

  return { penalty, visits };
}

function chooseRouteCandidate<T extends { score: number }>(rankedRoutes: T[]) {
  if (!rankedRoutes.length) {
    return { candidate: null, poolSize: 0, selectedRank: 0 };
  }

  const bestScore = rankedRoutes[0].score;
  const scoreWindow = Math.max(
    matchConfig.routeChoiceMinScoreWindow,
    Math.abs(bestScore) * matchConfig.routeChoiceScoreWindowRatio,
  );
  const nearBestPool = rankedRoutes
    .filter((candidate) => candidate.score <= bestScore + scoreWindow)
    .slice(0, matchConfig.routeChoicePoolSize);
  const pool = nearBestPool.length > 1
    ? nearBestPool
    : rankedRoutes.slice(0, Math.min(matchConfig.routeChoicePoolSize, rankedRoutes.length));

  if (pool.length <= 1) {
    return { candidate: rankedRoutes[0], poolSize: pool.length, selectedRank: 1 };
  }

  const worstScore = pool.reduce((score, candidate) => Math.max(score, candidate.score), bestScore);
  const spread = Math.max(1, worstScore - bestScore, scoreWindow);
  const weights = pool.map((candidate, index) => {
    const normalizedScoreGap = Math.max(0, candidate.score - bestScore) / spread;
    return Math.exp(-normalizedScoreGap * matchConfig.routeChoiceScoreSharpness) / (1 + index * 0.18);
  });
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  let cursor = Math.random() * totalWeight;
  const selectedIndex = weights.findIndex((weight) => {
    cursor -= weight;
    return cursor <= 0;
  });
  const candidate = pool[Math.max(0, selectedIndex)];

  return {
    candidate,
    poolSize: pool.length,
    selectedRank: rankedRoutes.indexOf(candidate) + 1,
  };
}

function routeUsesOnlyGraphEdges(graph: RoadGraph, route: GraphNode[]) {
  return route.slice(1).every((node, index) => {
    const prev = route[index];
    return graph.edgeKeys.has(edgeKey(prev.id, node.id));
  });
}

function expandRouteGeometry(graph: RoadGraph, route: GraphNode[]) {
  const expanded: RoutePoint[] = [];

  route.slice(1).forEach((node, index) => {
    const prev = route[index];
    const geometry = graph.edgeGeometries.get(edgeKey(prev.id, node.id));
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
    edgeVisits: Map<string, number>;
    index: number;
    route: GraphNode[];
    score: number;
    skippedWaypoints: number;
  };

  const pathCache = new Map<string, GraphNode[] | null>();

  function cachedShortestPath(from: GraphNode, target: GraphNode, maxMeters: number) {
    const budget = Math.ceil(maxMeters / matchConfig.pathCacheBudgetStepMeters) * matchConfig.pathCacheBudgetStepMeters;
    const cacheKey = `${from.id}:${target.id}:${budget}`;
    if (pathCache.has(cacheKey)) return pathCache.get(cacheKey) ?? null;

    const path = shortestWalkablePath(graph, from, target, budget);
    pathCache.set(cacheKey, path);
    return path;
  }

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
    edgeVisits: new Map(),
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

        const path = cachedShortestPath(from, waypoints[targetIndex], segmentBudgetMeters * (1 + skipped * 0.45));
        if (!path || path.length < 2) continue;

        const end = path[path.length - 1];
        const route = [...state.route, ...path.slice(1)];
        const distancePenalty = graphDistance(path) * 0.018;
        const skippedPenalty = skipped * matchConfig.skippedWaypointPenalty;
        const fitPenalty = futureFitPenalty(end, targetIndex + 1);
        const quality = routeQualityPenalty(graph, path, state.edgeVisits);

        nextBeam.push({
          connectedLegs: state.connectedLegs + 1,
          edgeVisits: quality.visits,
          index: targetIndex + 1,
          route,
          score: state.score + distancePenalty + skippedPenalty + fitPenalty + quality.penalty,
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
        const reverseKey = `${next.id}->${current.id}`;
        const heading = Math.atan2(next.y - current.y, next.x - current.x);
        const headingPenalty = Math.abs(Math.atan2(Math.sin(heading - preferredHeading), Math.cos(heading - preferredHeading)));
        const backtrackPenalty = next.id === previousId ? 1.5 : 0;
        const usedPenalty = (edgeVisits.get(edgeKey) ?? 0) * 2.5;
        const reversePenalty = (edgeVisits.get(reverseKey) ?? 0) * 4.5;
        const degreePenalty = (graph.edges.get(next.id)?.length ?? 0) <= 1 ? 2.2 : 0;
        const overshootPenalty = Math.max(0, meters + edge.weight - targetMeters * 1.15) / 80;
        return { edge, next, score: headingPenalty + backtrackPenalty + usedPenalty + reversePenalty + degreePenalty + overshootPenalty };
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
  const startRangeMeters = startSearchRadiusMeters(kilometers);
  const targetDistanceMeters = kilometers * 1000;
  const segmentBudgetMeters = Math.max(matchConfig.minSegmentBudgetMeters, targetDistanceMeters / matchConfig.segmentBudgetDivisor);
  const scales = matchConfig.scales;
  const rotations = matchConfig.rotations;
  const anchors = startAnchors(startRangeMeters);
  const rawCandidates: Array<{ targets: Point[]; startDrift: number; shapePenalty: number; rotationPenalty: number }> = [];

  variants.forEach((variant) => {
    const baseTargets = targetMeters(variant.points, kilometers);

    for (const scale of scales) {
      for (const rotation of rotations) {
        const rotatedStart = transformPoints([baseTargets[0]], scale, rotation, { x: 0, y: 0 })[0];

        for (const startAnchor of anchors) {
          rawCandidates.push({
            startDrift: Math.hypot(startAnchor.x, startAnchor.y),
            shapePenalty: variant.penalty,
            rotationPenalty: rotationPreferencePenalty(rotation),
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
        rotationPenalty: rotationPreferencePenalty(rotation),
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
      const duplicatePenalty = (snapped.length - new Set(route.map((node) => node.id)).size)
        * matchConfig.duplicateWaypointPenalty;
      const startOffset = Math.hypot(route[0].x, route[0].y);
      const startPenalty = Math.max(0, startOffset - startRangeMeters) * matchConfig.outsideStartPenalty;
      const score = snapPenalty * matchConfig.snapPenaltyWeight
        + jumpPenalty * matchConfig.jumpPenaltyWeight
        + duplicatePenalty
        + startPenalty
        + candidate.startDrift * matchConfig.startDriftPenalty
        + candidate.rotationPenalty
        + candidate.shapePenalty;

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
      const severeShortfall = Math.max(0, targetDistanceMeters * matchConfig.minRouteDistanceRatio - routeDistance);
      const distancePenalty = Math.abs(routeDistance - targetDistanceMeters) * matchConfig.distancePenaltyWeight
        + severeShortfall * matchConfig.shortRoutePenaltyWeight;
      const detailPenalty = Math.max(0, stitched.route.length - 420) * 0.45;
      const skippedPenalty = stitched.skippedWaypoints * matchConfig.skippedWaypointPenalty;
      const startOffset = Math.hypot(stitched.route[0].x, stitched.route[0].y);
      const startPenalty = Math.max(0, startOffset - startRangeMeters) * matchConfig.outsideStartPenalty
        + startOffset * matchConfig.stitchedStartPenalty;
      const qualityPenalty = routeQualityPenalty(graph, stitched.route).penalty * 0.18;
      const score = candidate.score + distancePenalty + detailPenalty + skippedPenalty + startPenalty + qualityPenalty;

      return { routeDistance, score, route: stitched.route };
    })
    .filter((candidate): candidate is { routeDistance: number; score: number; route: GraphNode[] } => Boolean(candidate))
    .sort((a, b) => a.score - b.score);

  const chosenCandidate = chooseRouteCandidate(rankedRoutes);
  const bestCandidate = chosenCandidate.candidate;
  const fallbackRoute = fallbackWalkableRoute(graph, center, kilometers);
  const shouldUseFallback = Boolean(fallbackRoute && !bestCandidate);
  const bestRoute = shouldUseFallback ? fallbackRoute : bestCandidate?.route ?? null;
  const startOffsetMeters = bestRoute ? Math.hypot(bestRoute[0].x, bestRoute[0].y) : 0;
  const routeLatLng = bestRoute
    ? densifyLatLngRoute(
      expandRouteGeometry(graph, bestRoute).map((point) => ({ lat: point.lat, lng: point.lng })),
      center,
      matchConfig.maxRenderedSegmentMeters,
    )
    : [];

  const referencePoints = graph.segments.flatMap((segment) => [segment.a, segment.b]);
  return {
    distanceFallbackUsed: false,
    fallbackUsed: !bestCandidate && shouldUseFallback,
    choicePoolSize: chosenCandidate.poolSize,
    points: withPreviewPoints(routeLatLng, center, referencePoints),
    rankedRoutes: rankedRoutes.length,
    selectedRouteRank: chosenCandidate.selectedRank,
    startOffsetMeters,
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

const drawingCanvasWidth = 280;
const drawingCanvasHeight = 150;

function compactDrawingPoints(points: Point[], minDistance = 4) {
  return points.reduce<Point[]>((result, point) => {
    const last = result[result.length - 1];
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= minDistance) {
      result.push(point);
    }
    return result;
  }, []);
}

function drawingToPath(points: Point[]) {
  const compacted = compactDrawingPoints(points, 5);
  if (compacted.length < 4) return null;

  return normalize(compacted.map((point) => ({
    x: point.x - drawingCanvasWidth / 2,
    y: point.y - drawingCanvasHeight / 2,
  })));
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
  const [drawnPath, setDrawnPath] = useState<Point[] | null>(null);
  const [drawingPoints, setDrawingPoints] = useState<Point[]>([]);
  const [isDrawingShape, setIsDrawingShape] = useState(false);
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
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingPointsRef = useRef<Point[]>([]);
  const mapElementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const routeLayerRef = useRef<L.Polyline | null>(null);
  const roadLayerRef = useRef<L.LayerGroup | null>(null);
  const centerMarkerRef = useRef<L.CircleMarker | null>(null);
  const startMarkerRef = useRef<L.CircleMarker | null>(null);
  const endMarkerRef = useRef<L.CircleMarker | null>(null);
  const matchRequestRef = useRef(0);

  const sourceVariants = useMemo(
    () => shapeVariants(description, drawnPath),
    [description, drawnPath],
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
  const startSearchMeters = startSearchRadiusMeters(distanceKm);
  const matchTryCount = sourceVariants.length * (
    matchConfig.scales.length
    * matchConfig.rotations.length
    * startAnchors(startSearchMeters).length
    + matchConfig.randomCandidatesPerVariant
  );
  const stats = routeStats(route);
  const bounds = {
    north: Math.max(...route.map((point) => point.lat)),
    south: Math.min(...route.map((point) => point.lat)),
    east: Math.max(...route.map((point) => point.lng)),
    west: Math.min(...route.map((point) => point.lng)),
  };
  const mapOverlayText = isMatchingRoads
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
    setMatchPhase("");
    setIsMatchingRoads(false);
    setRoadStatus("Inputs changed. Press Match roads to calculate a walkable route.");
  }

  function setDrawingStroke(points: Point[]) {
    drawingPointsRef.current = points;
    setDrawingPoints(points);
  }

  function resetDrawing() {
    setDrawingStroke([]);
    setDrawnPath(null);
  }

  function pointFromCanvasEvent(event: React.PointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(Math.max((event.clientX - bounds.left) / bounds.width * drawingCanvasWidth, 0), drawingCanvasWidth),
      y: Math.min(Math.max((event.clientY - bounds.top) / bounds.height * drawingCanvasHeight, 0), drawingCanvasHeight),
    };
  }

  function handleDrawingStart(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = pointFromCanvasEvent(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDrawingShape(true);
    setDrawnPath(null);
    setDrawingStroke([point]);
    clearRoadMatch();
  }

  function handleDrawingMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawingShape) return;
    const point = pointFromCanvasEvent(event);
    const points = drawingPointsRef.current;
    const last = points[points.length - 1];
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < 2) return;

    setDrawingStroke([...points, point]);
  }

  function finishDrawing() {
    if (!isDrawingShape) return;
    setIsDrawingShape(false);
    const path = drawingToPath(drawingPointsRef.current);
    setDrawnPath(path);
    if (!path) {
      setRoadStatus("Draw a longer path shape to match it to streets.");
    }
  }

  function handleDrawingClear() {
    resetDrawing();
    clearRoadMatch();
  }

  useEffect(() => {
    const canvas = drawingCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    context.clearRect(0, 0, drawingCanvasWidth, drawingCanvasHeight);
    context.fillStyle = "#fffdf8";
    context.fillRect(0, 0, drawingCanvasWidth, drawingCanvasHeight);
    context.strokeStyle = "#eadfce";
    context.lineWidth = 1;
    for (let x = 40; x < drawingCanvasWidth; x += 40) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, drawingCanvasHeight);
      context.stroke();
    }
    for (let y = 30; y < drawingCanvasHeight; y += 30) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(drawingCanvasWidth, y);
      context.stroke();
    }

    if (drawingPoints.length < 2) return;

    context.strokeStyle = "#fc4c02";
    context.lineWidth = 7;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(drawingPoints[0].x, drawingPoints[0].y);
    drawingPoints.slice(1).forEach((point) => context.lineTo(point.x, point.y));
    context.stroke();
  }, [drawingPoints]);

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
      const radius = roadSearchRadiusMeters(sourcePoints, distanceKm, startSearchMeters);
      const roadSearchStartedAt = performance.now();
      const roadFetch = await fetchUsableRoadGraph(resolvedCenter, radius, setMatchPhase);
      const graph = roadFetch.graph;
      roadSearchMs = performance.now() - roadSearchStartedAt;
      hasLoadedGraph = true;
      setGraphInfo({
        cacheVersion: matchConfig.graphCacheVersion,
        source: roadFetch.source,
        profile: roadFetch.profile.label,
        radiusMeters: roadFetch.radiusMeters,
        spacingMeters: matchConfig.roadNodeSpacingMeters,
        nodes: graph.nodes.size,
        edges: graph.edgeKeys.size,
        rejectedSegments: graph.rejectedSegments,
      });
      if (requestId !== matchRequestRef.current) return;

      setMatchPhase(`Testing ${matchTryCount} shape placements within ${Math.round(startSearchMeters)} m...`);
      setRoadStatus(`Testing ${matchTryCount} placements around the selected area and stitching the best ${matchConfig.topCandidates} to roads...`);
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
        selectedRouteRank: matchedResult.selectedRouteRank,
        choicePoolSize: matchedResult.choicePoolSize,
        startOffsetMeters: matchedResult.startOffsetMeters,
      });
      const matchedStats = routeStats(matched);
      const choiceStatus = matchedResult.choicePoolSize > 1
        ? `Picked option ${matchedResult.selectedRouteRank} from ${matchedResult.choicePoolSize} near-best routes.`
        : "Chose the best route.";
      const rankingStatus = matchedResult.distanceFallbackUsed
        ? "Ranked candidates were too short; using a distance-preserving fallback."
        : matchedResult.fallbackUsed
          ? "No connected candidate ranked; using a fallback walk."
          : `Ranked ${matchedResult.rankedRoutes} connected candidates. ${choiceStatus}`;
      const startStatus = matchedResult.startOffsetMeters > 30
        ? `Start moved ${Math.round(matchedResult.startOffsetMeters)} m from the selected location.`
        : "Start stays near the selected location.";
      setMatchPhase("");
      setRoadStatus(`${rankingStatus} ${startStatus} GPX distance is ${matchedStats.kilometers.toFixed(2)} km.`);
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

    map.on("click", (event) => {
      const clicked = { lat: event.latlng.lat, lng: event.latlng.lng };
      const label = coordinateLabel(clicked);
      setLocation(label);
      setSelectedLocation({
        id: `map-${clicked.lat.toFixed(5)}-${clicked.lng.toFixed(5)}`,
        label,
        lat: clicked.lat,
        lng: clicked.lng,
        type: "map pin",
      });
      setLocationSuggestions([]);
      setIsLocationFocused(false);
      clearRoadMatch();
    });

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

    const centerLatLng = L.latLng(center.lat, center.lng);
    if (centerMarkerRef.current) {
      centerMarkerRef.current.setLatLng(centerLatLng);
    } else {
      centerMarkerRef.current = L.circleMarker(centerLatLng, {
        radius: 6,
        color: "#ffffff",
        weight: 2,
        fillColor: "#0e7490",
        fillOpacity: 1,
        interactive: false,
      }).addTo(map);
    }

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

    if (!hasWalkableRoute) {
      const routeBounds = L.latLngBounds(routeLatLngs);
      map.fitBounds(routeBounds.pad(0.18), { animate: true, maxZoom: 16 });
    }
  }, [route, roadSegments, hasWalkableRoute, center.lat, center.lng]);

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
            Shape description
            <textarea
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                resetDrawing();
                clearRoadMatch();
              }}
              placeholder="heart, star, diamond, crown, mountains, spiral, bolt, wave..."
            />
          </label>

          <div className="drawingPad">
            <div className="drawingHeader">
              <span>Draw path</span>
              <button type="button" onClick={handleDrawingClear} disabled={!drawingPoints.length && !drawnPath}>
                Clear
              </button>
            </div>
            <canvas
              ref={drawingCanvasRef}
              width={drawingCanvasWidth}
              height={drawingCanvasHeight}
              onPointerDown={handleDrawingStart}
              onPointerMove={handleDrawingMove}
              onPointerUp={finishDrawing}
              onPointerCancel={finishDrawing}
              onLostPointerCapture={finishDrawing}
              aria-label="Drawn route shape"
            />
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
                className={description.toLowerCase().includes(template.name) && !drawnPath ? "selectedShape" : undefined}
                type="button"
                onClick={() => {
                  setDescription(template.name);
                  resetDrawing();
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
              download("strava-art-walk.gpx", gpx(roadRoute, description));
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
                ? `Last calculation: ${formatMs(matchTiming.totalMs)} total / ${formatMs(matchTiming.roadSearchMs)} road data / ${formatMs(matchTiming.routeMs)} path${typeof matchTiming.rankedRoutes === "number" ? ` / ${matchTiming.rankedRoutes} ranked` : ""}${typeof matchTiming.choicePoolSize === "number" && matchTiming.choicePoolSize > 1 ? ` / picked ${matchTiming.selectedRouteRank ?? 1}/${matchTiming.choicePoolSize}` : ""}${typeof matchTiming.startOffsetMeters === "number" ? ` / start ${Math.round(matchTiming.startOffsetMeters)} m from pin` : ""}`
                : "Last calculation: not run yet"}
          </p>
          <p className="status timing">
            {graphInfo
              ? `Graph ${graphInfo.cacheVersion} / ${graphInfo.source} / ${graphInfo.profile} / ${Math.round(graphInfo.radiusMeters)}m radius / ${graphInfo.spacingMeters}m nodes / ${graphInfo.nodes} nodes / ${graphInfo.edges} edges / ${graphInfo.rejectedSegments} blocked`
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

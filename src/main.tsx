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

type RoadGraphSource = "memory" | "persistent" | "network" | "mixed";

type RoadTileLoadSource = RoadGraphSource | "failed";

type RoadTileArea = {
  east: number;
  north: number;
  south: number;
  source: RoadTileLoadSource;
  west: number;
  x: number;
  y: number;
};

type RoadTileAreaProgress = (tiles: RoadTileArea[]) => void;

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

type RoutingProvider = "local" | "mapy";

type MapyRouteGeometry =
  | { type: "Feature"; geometry?: { type: string; coordinates?: number[][] } }
  | { type: "LineString"; coordinates?: number[][] };

type MapyRouteResponse = {
  duration?: number;
  geometry?: MapyRouteGeometry;
  length?: number;
  message?: string;
};

type MatchTiming = {
  totalMs: number;
  roadSearchMs: number;
  routeMs: number;
  placements?: number;
  rankedRoutes?: number;
  selectedRouteRank?: number;
  choicePoolSize?: number;
  shapeErrorMeters?: number;
  anchorErrorMeters?: number;
  worstSegmentErrorMeters?: number;
  segmentRepairsTried?: number;
  selectedSegmentRepairs?: number;
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
  tileCount?: number;
  failedTiles?: number;
};

type SavedLocation = {
  location: string;
  selectedLocation: LocationSuggestion | null;
};

type SavedPath = {
  areaSquareMeters: number;
  createdAt: number;
  distanceKm: number;
  fingerprint: string;
  id: string;
  locationLabel: string;
  name: string;
  pointCount: number;
  routePoints?: RoutePoint[];
  shapePoints: Point[];
};

type ShapeVariant = {
  name: string;
  points: Point[];
  penalty: number;
  description?: string;
  aiGeneratedSketch?: boolean;
};

type PlacementCandidate = {
  primaryTargets: Point[];
  targets: Point[];
  startDrift: number;
  shapePenalty: number;
  rotationPenalty: number;
  variantName?: string;
  variantDescription?: string;
  variantIsAi?: boolean;
};

type RoadMatchOptions = {
  startRangeMeters?: number;
};

type ShapeScore = {
  anchorError: number;
  maxError: number;
  meanError: number;
  orderedError: number;
  total: number;
};

type ShapeSegmentWindow = {
  endProgress: number;
  index: number;
  maxError: number;
  score: number;
  startProgress: number;
};

type ShapeSeedWindow = {
  endProgress: number;
  index: number;
  length: number;
  points: Point[];
  startProgress: number;
  turnScore: number;
};

type RoadSeedPath = {
  length: number;
  nodes: GraphNode[];
  points: Point[];
  qualityPenalty: number;
  score: number;
  turnScore: number;
};

type SeededPlacementMatch = {
  offset: Point;
  rotation: number;
  scale: number;
  score: number;
};

type RouteCandidateOption = {
  aiConfidence?: number;
  aiGeneratedSketch?: boolean;
  aiDescription?: string;
  aiLabel?: string;
  aiMatchesTarget?: boolean;
  aiReason?: string;
  aiTargetConfidence?: number;
  anchorErrorMeters: number;
  points: RoutePoint[];
  rank: number;
  routeDistanceMeters: number;
  score: number;
  segmentRepairCount: number;
  shapeErrorMeters: number;
  startOffsetMeters: number;
  targetPoints: RoutePoint[];
  worstSegmentErrorMeters: number;
};

type AiShapeCandidate = RouteCandidateOption & {
  backtrackRatio: number;
  localShapeScore: number;
  reuseRatio: number;
  uniqueNodeRatio: number;
};

type AiShapeRecognition = {
  confidence?: number;
  description?: string;
  id: number;
  label?: string;
  matchesTarget?: boolean;
  reason?: string;
  targetConfidence?: number;
};

type AiVectorSketch = {
  label: string;
  description: string;
  closed: boolean;
  strokes: Point[][];
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


type RoadGraphPhaseMessages = {
  loadingOsm: (profile: RoadQueryProfile, radius: number) => string;
  restoringSaved: (profile: RoadQueryProfile, radius: number) => string;
  usingCached: (profile: RoadQueryProfile, radius: number) => string;
  tileProgress: (profile: RoadQueryProfile, current: number, total: number, cached: number, downloaded: number, failed: number) => string;
};

type MatchProgressLabels = {
  choosingBest: string;
  mapMatching: string;
  scoringPlacements: string;
  stitching: string;
};


type Language = "en" | "cs";
type ShapeInputMode = "draw" | "ai";

const translations = {
  en: {
    appEyebrow: "Walking art planner",
    appTitle: "Route Canvas",
    languageLabel: "Language",
    drawPath: "Draw path",
    clear: "Clear",
    drawnRouteShape: "Drawn route shape",
    startLocation: "Start location",
    locationPlaceholder: "Search address, place, or 50.0755, 14.4378",
    locationSuggestions: "Location suggestions",
    searchingAddresses: "Searching addresses...",
    approximateDistance: "Approximate walking distance",
    shapeInputTabs: {
      draw: "Shape + draw",
      ai: "Text + AI",
    },
    aiShapeSearch: "AI shape search",
    aiShapeSearchPlaceholder: "cat, flower, bicycle, dragon, musical note...",
    aiSuggestedShapes: "AI suggested shapes",
    shapePresets: "Shape presets",
    useShape: (name: string) => `Use ${name} shape`,
    matchRoads: "Match roads",
    matchingRoads: "Matching roads...",
    exportGpx: "Export walkable GPX",
    findAiShapes: (query: string) => query ? "Generate & match " + query : "Generate & match AI shapes",
    findingAiShapes: (query: string) => query ? "Matching " + query + " sketches..." : "Matching AI sketches...",
    bestRoutes: "Best routes",
    aiShapeDescription: (label: string, confidence: number, description: string) => "AI sees this route as " + label + " with " + confidence + "% confidence. " + description,
    aiSketchDescription: (label: string, description: string) => "AI sketch: " + label + ". " + description,
    shapeShort: "shape",
    worstShort: "worst",
    route: "Route",
    walkTime: "Walk time",
    points: "Points",
    bounds: "Bounds",
    area: "Area",
    routePreview: "Route preview",
    interactiveRouteMap: "Interactive route map",
    calculatingWalkableRoute: "Calculating walkable route...",
    loadingMapTiles: "Loading map tiles...",
    calculatingPath: "Calculating path...",
    lastCalculationNotRun: "Last calculation: not run yet",
    graphNotLoaded: "not loaded",
    compactRoads: "compact roads",
    broadRoads: "broad roads",
    cacheMemory: "memory",
    cachePersistent: "saved",
    cacheNetwork: "network",
    cacheMixed: "mixed",
    savePath: "Star path",
    pathSaved: "Starred",
    popularPaths: "Popular paths",
    savedPathsEmpty: "Star a walkable route to save its shape.",
    useSavedPath: "Use saved shape",
    removeSavedPath: "Remove saved path",
    templateLabels: {
      heart: "heart",
      star: "star",
      diamond: "diamond",
      mountains: "mountains",
      spiral: "spiral",
      crown: "crown",
      bolt: "bolt",
      wave: "wave",
    },
    status: {
      initial: "Use Match roads to build the GPX from real walkable streets.",
      inputsChanged: "Inputs changed. Press Match roads to calculate a walkable route.",
      drawLongerPath: "Draw a longer path shape to match it to streets.",
      checkingCache: "Checking cached road graph, then loading OpenStreetMap only if needed...",
      mapyRouting: "Planning a walk with Mapy.com routing...",
      mapyMissingKey: "Mapy.com routing needs VITE_MAPY_API_KEY in .env.local.",
      aiLoadingGraph: "Loading road data before matching AI sketches...",
      aiSketching: (query: string) => query ? "Asking AI for " + query + " vector sketches..." : "Asking AI for vector sketches...",
      aiSketchNoShapes: "AI did not return usable vector sketches.",
      aiSketchMatched: (count: number, query: string, result: string) => `Generated ${count} ${query || "AI"} sketches and matched them to roads. ${result}`,
      aiGenerating: (query: string) => query ? "Generating walkable candidates for " + query + "..." : "Generating possible map shapes from walkable roads...",
      aiRanking: (query: string) => query ? "Asking AI which routes best match " + query + "..." : "Asking AI to recognize the strongest shapes...",
      aiFound: (count: number, query: string) => query ? `Found ${count} walkable candidates ranked for ${query}.` : `Found ${count} walkable shape candidates.`,
      aiLocalFallback: (count: number, query: string) => query ? `Found ${count} local candidates, but AI ranking for ${query} is unavailable.` : `Found ${count} local shape candidates. AI ranking is unavailable, so these are sorted by geometry only.`,
      testing: (placements: number, topCandidates: number) => `Testing ${placements} placements around the selected area and stitching the best ${topCandidates} to roads...`,
      roadDataNoRoute: "Road data loaded, but no connected graph route could be produced.",
      distanceFallback: "Ranked candidates were too short; using a distance-preserving fallback.",
      fallback: "No connected candidate ranked; using a fallback walk.",
      choseBest: "Chose the best route.",
      showingOption: (rank: number, total: number) => `Showing option ${rank} from ${total} best routes.`,
      rankedCandidates: (count: number, choiceStatus: string) => `Ranked ${count} connected candidates. ${choiceStatus}`,
      startMoved: (meters: number) => `Start moved ${meters} m from the selected location.`,
      startNear: "Start stays near the selected location.",
      shapeError: (shape: number, anchors: number, worst: number) => ` Shape error is about ${shape} m; key points about ${anchors} m; worst segment about ${worst} m.`,
      repairs: (tried: number, selected: number) => ` Tried ${tried} weak-segment repairs${selected ? `; selected route uses ${selected}.` : "."}`,
      result: (ranking: string, start: string, distanceKm: string, shape: string, repairs: string) => `${ranking} ${start} GPX distance is ${distanceKm} km.${shape}${repairs ? ` ${repairs}` : ""}`,
      mapyResult: (routeType: string, distanceKm: string, shape: string) => `Mapy.com ${routeType} route planned. GPX distance is ${distanceKm} km.${shape}`,
      roadMatchingFailed: "Road matching failed.",
      slowRoadData: "Showing the generated sketch now. Road data is slow, so use Match roads to retry.",
      pathSaved: (name: string) => `Saved ${name} to popular paths.`,
      pathRemoved: (name: string) => `Removed ${name} from saved paths.`,
      savedPathLoaded: (name: string) => `Selected ${name} as the export target.`,
    },
    progress: {
      resolvingStart: "Resolving start point...",
      mapyRouting: "Planning Mapy.com walking route",
      testingPlacements: (placements: number, meters: number) => `Testing ${placements} shape placements within ${meters} m...`,
      scoringPlacements: "Scoring placements",
      mapMatching: "Map-matching candidates",
      stitching: "Stitching and repairing candidates",
      choosingBest: "Choosing best route",
      aiSketching: (query: string) => query ? "AI sketching " + query : "AI sketching shapes",
      aiGenerating: (query: string) => query ? "Generating " + query + " candidates" : "Generating shape candidates",
      aiRanking: (query: string) => query ? "AI ranking " + query + " matches" : "AI recognizing shapes",
    },
    graph: {
      usingCached: (profile: string, radius: number) => `Using cached ${profile} within ${radius} m...`,
      restoringSaved: (profile: string, radius: number) => `Restoring saved ${profile} within ${radius} m...`,
      loadingOsm: (profile: string, radius: number) => `Loading ${profile} within ${radius} m from OpenStreetMap...`,
      tileProgress: (profile: string, current: number, total: number, cached: number, downloaded: number, failed: number) => `Road tiles ${current}/${total} for ${profile}: ${cached} cached / ${downloaded} downloaded${failed ? ` / ${failed} failed` : ""}...`,
      summary: (cacheVersion: string, source: string, profile: string, radius: number, spacing: number, nodes: number, edges: number, blocked: number, tiles?: number, failed = 0) => `Graph ${cacheVersion} / ${source} / ${profile} / ${radius}m radius${tiles ? ` / ${tiles} 1km tiles` : ""} / ${spacing}m nodes / ${nodes} nodes / ${edges} edges / ${blocked} blocked${failed ? ` / ${failed} failed tiles` : ""}`,
      empty: (cacheVersion: string, spacing: number, notLoaded: string) => `Graph ${cacheVersion} / ${spacing}m nodes / ${notLoaded}`,
    },
    timing: {
      summary: (total: string, road: string, route: string, extras: string) => `Last calculation: ${total} total / ${road} road data / ${route} path${extras}`,
      ranked: (count: number) => ` / ${count} ranked`,
      picked: (rank: number, total: number) => ` / picked ${rank}/${total}`,
      shape: (meters: number) => ` / shape ${meters}m`,
      worstSegment: (meters: number) => ` / worst segment ${meters}m`,
      repairs: (count: number) => ` / repairs ${count}`,
      start: (meters: number) => ` / start ${meters} m from pin`,
    },
  },
  cs: {
    appEyebrow: "Plánovač kreslení chůzí",
    appTitle: "Kreslení trasou",
    languageLabel: "Jazyk",
    drawPath: "Nakreslit tvar",
    clear: "Smazat",
    drawnRouteShape: "Nakreslený tvar trasy",
    startLocation: "Výchozí místo",
    locationPlaceholder: "Hledat adresu, místo nebo 50.0755, 14.4378",
    locationSuggestions: "Návrhy míst",
    searchingAddresses: "Hledám adresy...",
    approximateDistance: "Přibližná délka chůze",
    shapeInputTabs: {
      draw: "Tvar + kresba",
      ai: "Text + AI",
    },
    aiShapeSearch: "Co má AI hledat",
    aiShapeSearchPlaceholder: "kočka, květina, kolo, drak, nota...",
    aiSuggestedShapes: "Tvary navržené AI",
    shapePresets: "Přednastavené tvary",
    useShape: (name: string) => `Použít tvar ${name}`,
    matchRoads: "Najít cestu",
    matchingRoads: "Hledám cestu...",
    exportGpx: "Exportovat GPX",
    findAiShapes: (query: string) => query ? "Vygenerovat a napasovat " + query : "Vygenerovat AI tvary",
    findingAiShapes: (query: string) => query ? "Napasovávám náčrty pro " + query + "..." : "Napasovávám AI náčrty...",
    bestRoutes: "Nejlepší trasy",
    aiShapeDescription: (label: string, confidence: number, description: string) => "AI v této trase vidí " + label + " s jistotou " + confidence + " %. " + description,
    aiSketchDescription: (label: string, description: string) => "AI náčrt: " + label + ". " + description,
    shapeShort: "tvar",
    worstShort: "nejhorší",
    route: "Trasa",
    walkTime: "Čas chůze",
    points: "Body",
    bounds: "Rozsah",
    area: "Plocha",
    routePreview: "Náhled trasy",
    interactiveRouteMap: "Interaktivní mapa trasy",
    calculatingWalkableRoute: "Počítám pěší trasu...",
    loadingMapTiles: "Načítám mapu...",
    calculatingPath: "Počítám trasu...",
    lastCalculationNotRun: "Poslední výpočet: zatím neproběhl",
    graphNotLoaded: "nenačteno",
    compactRoads: "kompaktní cesty",
    broadRoads: "širší síť cest",
    cacheMemory: "paměť",
    cachePersistent: "uloženo",
    cacheNetwork: "síť",
    cacheMixed: "kombinace",
    savePath: "Označit trasu",
    pathSaved: "Uloženo",
    popularPaths: "Oblíbené trasy",
    savedPathsEmpty: "Označ pěší trasu hvězdičkou a uloží se její tvar.",
    useSavedPath: "Použít uložený tvar",
    removeSavedPath: "Odebrat uloženou trasu",
    templateLabels: {
      heart: "srdce",
      star: "hvězda",
      diamond: "diamant",
      mountains: "hory",
      spiral: "spirála",
      crown: "koruna",
      bolt: "blesk",
      wave: "vlna",
    },
    status: {
      initial: "Tlačítkem Najít cestu vytvoříš GPX z reálných pěších cest.",
      inputsChanged: "Vstupy se změnily. Pro výpočet pěší trasy stiskni Najít cestu.",
      drawLongerPath: "Nakresli delší tvar, aby šel napasovat na ulice.",
      checkingCache: "Kontroluji uložená data cest, OpenStreetMap načtu jen když bude potřeba...",
      mapyRouting: "Plánuji pěší trasu přes Mapy.com...",
      mapyMissingKey: "Plánování přes Mapy.com potřebuje VITE_MAPY_API_KEY v .env.local.",
      aiLoadingGraph: "Načítám data cest pro napasování AI náčrtů...",
      aiSketching: (query: string) => query ? "AI generuje vektorové náčrty pro " + query + "..." : "AI generuje vektorové náčrty...",
      aiSketchNoShapes: "AI nevrátila použitelné vektorové náčrty.",
      aiSketchMatched: (count: number, query: string, result: string) => `Vygenerováno ${count} náčrtů pro ${query || "AI tvar"} a napasováno na cesty. ${result}`,
      aiGenerating: (query: string) => query ? "Generuji pěší kandidáty pro " + query + "..." : "Generuji možné tvary z pěších cest...",
      aiRanking: (query: string) => query ? "AI vybírá trasy nejpodobnější " + query + "..." : "AI rozpoznává nejsilnější tvary...",
      aiFound: (count: number, query: string) => query ? `Nalezeno ${count} pěších kandidátů seřazených pro ${query}.` : `Nalezeno ${count} pěších kandidátů tvarů.`,
      aiLocalFallback: (count: number, query: string) => query ? `Nalezeno ${count} lokálních kandidátů, ale AI řazení pro ${query} není dostupné.` : `Nalezeno ${count} lokálních kandidátů. AI řazení není dostupné, takže jsou seřazeni jen podle geometrie.`,
      testing: (placements: number, topCandidates: number) => `Zkouším ${placements} umístění v okolí a napojuji nejlepších ${topCandidates} na cesty...`,
      roadDataNoRoute: "Data cest jsou načtená, ale nepodařilo se vytvořit propojenou trasu v grafu.",
      distanceFallback: "Seřazené návrhy byly moc krátké; používám záložní trasu s lepší délkou.",
      fallback: "Žádný propojený návrh neuspěl; používám záložní procházku.",
      choseBest: "Vybrána nejlepší trasa.",
      showingOption: (rank: number, total: number) => `Zobrazuji variantu ${rank} z ${total} nejlepších tras.`,
      rankedCandidates: (count: number, choiceStatus: string) => `Seřazeno ${count} propojených kandidátů. ${choiceStatus}`,
      startMoved: (meters: number) => `Start se posunul o ${meters} m od vybraného místa.`,
      startNear: "Start zůstává poblíž vybraného místa.",
      shapeError: (shape: number, anchors: number, worst: number) => ` Chyba tvaru je asi ${shape} m; klíčové body asi ${anchors} m; nejhorší segment asi ${worst} m.`,
      repairs: (tried: number, selected: number) => ` Vyzkoušeno ${tried} oprav slabých segmentů${selected ? `; vybraná trasa používá ${selected}.` : "."}`,
      result: (ranking: string, start: string, distanceKm: string, shape: string, repairs: string) => `${ranking} ${start} Délka GPX je ${distanceKm} km.${shape}${repairs ? ` ${repairs}` : ""}`,
      mapyResult: (routeType: string, distanceKm: string, shape: string) => `Mapy.com naplánovalo trasu ${routeType}. Délka GPX je ${distanceKm} km.${shape}`,
      roadMatchingFailed: "Napojení na cesty selhalo.",
      slowRoadData: "Zatím zobrazuji vygenerovaný náčrt. Data cest jsou pomalá, zkus Najít cestu znovu.",
      pathSaved: (name: string) => `${name} je uložená v oblíbených trasách.`,
      pathRemoved: (name: string) => `${name} je odebraná z uložených tras.`,
      savedPathLoaded: (name: string) => `${name} je vybraná pro export.`,
    },
    progress: {
      resolvingStart: "Určuji výchozí bod...",
      mapyRouting: "Plánuji pěší trasu přes Mapy.com",
      testingPlacements: (placements: number, meters: number) => `Zkouším ${placements} umístění tvaru do ${meters} m...`,
      scoringPlacements: "Boduji umístění",
      mapMatching: "Napojování kandidátů na mapu",
      stitching: "Propojuji a opravuji kandidáty",
      choosingBest: "Vybírám nejlepší trasu",
      aiSketching: (query: string) => query ? "AI kreslí " + query : "AI kreslí tvary",
      aiGenerating: (query: string) => query ? "Generuji kandidáty pro " + query : "Generuji kandidáty tvarů",
      aiRanking: (query: string) => query ? "AI řadí shody pro " + query : "AI rozpoznává tvary",
    },
    graph: {
      usingCached: (profile: string, radius: number) => `Používám data z paměti: ${profile} do ${radius} m...`,
      restoringSaved: (profile: string, radius: number) => `Načítám uložená data: ${profile} do ${radius} m...`,
      loadingOsm: (profile: string, radius: number) => `Načítám ${profile} do ${radius} m z OpenStreetMap...`,
      tileProgress: (profile: string, current: number, total: number, cached: number, downloaded: number, failed: number) => `Dlaždice cest ${current}/${total} pro ${profile}: ${cached} z cache / ${downloaded} staženo${failed ? ` / ${failed} selhalo` : ""}...`,
      summary: (cacheVersion: string, source: string, profile: string, radius: number, spacing: number, nodes: number, edges: number, blocked: number, tiles?: number, failed = 0) => `Graf ${cacheVersion} / ${source} / ${profile} / radius ${radius} m${tiles ? ` / ${tiles} dlaždic 1 km` : ""} / uzly po ${spacing} m / ${nodes} uzlů / ${edges} hran / ${blocked} blokováno${failed ? ` / ${failed} dlaždic selhalo` : ""}`,
      empty: (cacheVersion: string, spacing: number, notLoaded: string) => `Graf ${cacheVersion} / uzly po ${spacing} m / ${notLoaded}`,
    },
    timing: {
      summary: (total: string, road: string, route: string, extras: string) => `Poslední výpočet: ${total} celkem / ${road} data cest / ${route} trasa${extras}`,
      ranked: (count: number) => ` / ${count} seřazeno`,
      picked: (rank: number, total: number) => ` / vybráno ${rank}/${total}`,
      shape: (meters: number) => ` / tvar ${meters} m`,
      worstSegment: (meters: number) => ` / nejhorší segment ${meters} m`,
      repairs: (count: number) => ` / opravy ${count}`,
      start: (meters: number) => ` / start ${meters} m od pinu`,
    },
  },
} as const;

const languageOptions: Array<{ id: Language; label: string }> = [
  { id: "cs", label: "CZ" },
  { id: "en", label: "EN" },
];

const savedLanguageKey = "route-canvas.language";
const savedAiShapeQueryKey = "route-canvas.ai-shape-query";

function loadSavedLanguage(): Language {
  if (typeof window === "undefined") return "cs";
  return window.localStorage.getItem(savedLanguageKey) === "en" ? "en" : "cs";
}

function loadSavedAiShapeQuery() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(savedAiShapeQueryKey) ?? "";
}

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
const savedPathsKey = "route-canvas.saved-paths";
const savedPathLimit = 30;
const roadGraphDbName = "route-canvas-road-graphs";
const roadGraphStoreName = "roadGraphs";
const roadGraphCacheMaxAgeMs = 60 * 24 * 60 * 60 * 1000;
const roadGraphCacheMaxRecords = 1200;
let roadGraphDbPromise: Promise<IDBDatabase | null> | null = null;

const matchConfig = {
  graphCacheVersion: "road-tiles-1km-cache-v1",
  roadNodeSpacingMeters: 20,
  roadTileSizeMeters: 1000,
  roadTileQueryOverlapMeters: 80,
  mapyRouteWaypointCount: 12,
  aiShapeCandidateCount: 24,
  aiShapeAttempts: 560,
  aiShapeMaxRequestCandidates: 24,
  aiShapeTargetConfidenceMin: 0.68,
  aiVectorShapeLimit: 8,
  aiVectorMatchForwardLimit: 8,
  aiVectorMatchReverseLimit: 3,
  aiVectorShapeVariantPenalty: 180,
  aiVectorReversePenalty: 90,
  aiShapeWalkOvershootRatio: 1.12,
  aiShapeBacktrackRatioPenalty: 520,
  aiShapeUndirectedReusePenalty: 540,
  aiShapeRepeatedDirectedPenalty: 380,
  aiShapeImmediateBacktrackPenalty: 620,
  aiShapeLowUniquePenalty: 240,
  aiShapeQualityPenaltyWeight: 0.035,
  aiShapeRepeatPenaltyScale: 2.2,
  aiShapeReversePenaltyScale: 2.8,
  aiShapeDeadEndPenaltyScale: 1.4,
  aiShapeImmediateBacktrackScale: 2.6,
  aiShapeUndirectedReuseStepPenalty: 180,
  aiShapeExtremeBacktrackRatio: 0.18,
  aiShapeMaxReverseEdgeRatio: 0.1,
  aiShapeMaxUndirectedReuseRatio: 0.18,
  aiShapeMaxImmediateBacktrackRatio: 0.06,
  aiShapeMinUniqueNodeRatio: 0.72,
  maxRenderedSegmentMeters: 10,
  targetPoints: 48,
  topCandidates: 120,
  rawPreselectCandidates: 220,
  coarsePlacementSamples: 20,
  coarsePlacementCandidateLimit: 520,
  coarsePlacementVariantLimit: 80,
  minRoadSearchRadiusMeters: 600,
  maxRoadSearchRadiusMeters: 3000,
  roadSearchPaddingMeters: 200,
  roadSearchStartRadiusShare: 0.7,
  compactRoadMinSegments: 80,
  compactRoadRadiusBoost: 1.1,
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
  randomCandidatesPerVariant: 1100,
  randomScaleMin: 0.66,
  randomScaleMax: 1.32,
  seededPlacementShapeWindows: 9,
  seededPlacementShapeSamples: 112,
  seededPlacementTargetWindowMeters: 420,
  seededPlacementMinWindowSamples: 7,
  seededPlacementWindowSamples: 18,
  seededPlacementMinWindowMeters: 120,
  seededPlacementMaxRoadPathMeters: 900,
  seededPlacementMaxRoadStarts: 180,
  seededPlacementRoadBeamWidth: 3,
  seededPlacementMaxRoadNodes: 44,
  seededPlacementMaxRoadPathsPerWindow: 360,
  seededPlacementCandidateLimit: 90,
  seededPlacementBasePenalty: 30,
  seededPlacementPenaltyWeight: 0.72,
  routeChoicePoolSize: 8,
  candidateDisplayLimit: 8,
  routeChoiceScoreWindowRatio: 0.1,
  routeChoiceMinScoreWindow: 180,
  routeChoiceScoreSharpness: 1.8,
  mapMatchNearestNodes: 5,
  mapMatchBeamWidth: 7,
  mapMatchTransitionWeight: 0.2,
  mapMatchHeadingWeight: 55,
  mapMatchDuplicatePenalty: 180,
  shapeScoreSamples: 96,
  shapeAnchorLimit: 10,
  shapeMeanWeight: 18,
  shapeOrderedWeight: 4,
  shapeAnchorWeight: 24,
  shapeMaxWeight: 3,
  rawCandidateScoreWeight: 0.08,
  segmentScoreWindows: 8,
  segmentRepairCandidateLimit: 30,
  segmentRepairWindowLimit: 2,
  segmentRepairMinErrorMeters: 55,
  segmentRepairExtraPoints: 96,
  segmentRepairWindowPadding: 0.05,
  segmentRepairBudgetBoost: 1.18,
  segmentRepairPenalty: 120,
  waypointLookahead: 5,
  stitchBeamWidth: 6,
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
  deadEndPenalty: 124,
  mapMatchDeadEndPenalty: 220,
  pathDeadEndStepPenalty: 75,
  finalQualityPenaltyWeight: 0.28,
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
  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const point = points[index];
    total += Math.hypot(point.x - prev.x, point.y - prev.y);
  }

  return total;
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
  const bounds = {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };

  for (const point of points) {
    if (point.x < bounds.minX) bounds.minX = point.x;
    if (point.x > bounds.maxX) bounds.maxX = point.x;
    if (point.y < bounds.minY) bounds.minY = point.y;
    if (point.y > bounds.maxY) bounds.maxY = point.y;
  }

  return bounds;
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

function transformPointWithTrig(point: Point, scale: number, cos: number, sin: number, offset: Point) {
  return {
    x: (point.x * cos - point.y * sin) * scale + offset.x,
    y: (point.x * sin + point.y * cos) * scale + offset.y,
  };
}

function transformPointsWithTrig(points: Point[], scale: number, cos: number, sin: number, offset: Point) {
  return points.map((point) => transformPointWithTrig(point, scale, cos, sin, offset));
}

function transformPoints(points: Point[], scale: number, rotation: number, offset: Point) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return transformPointsWithTrig(points, scale, cos, sin, offset);
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

function shapeRadiusMeters(points: Point[], kilometers: number) {
  return targetMeters(points, kilometers).reduce(
    (radius, point) => Math.max(radius, Math.hypot(point.x, point.y)),
    0,
  );
}

function graphBackedStartSearchRadiusMeters(points: Point[], kilometers: number, graphRadiusMeters: number) {
  const graphUsableStartRadius = graphRadiusMeters - shapeRadiusMeters(points, kilometers) - matchConfig.roadTileQueryOverlapMeters;
  return Math.max(startSearchRadiusMeters(kilometers), graphUsableStartRadius);
}

function roadSearchRadiusMeters(points: Point[], kilometers: number, startSearchMeters: number) {
  const shapeRadius = shapeRadiusMeters(points, kilometers);

  return Math.min(
    Math.max(
      shapeRadius + startSearchMeters * matchConfig.roadSearchStartRadiusShare + matchConfig.roadSearchPaddingMeters,
      matchConfig.minRoadSearchRadiusMeters,
    ),
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

function selectedAiShapeVariants(variant: ShapeVariant): ShapeVariant[] {
  const normalized = normalize(variant.points);

  return [
    {
      ...variant,
      aiGeneratedSketch: true,
      penalty: 0,
      points: normalized,
    },
    {
      ...variant,
      aiGeneratedSketch: true,
      penalty: matchConfig.aiVectorReversePenalty,
      points: [...normalized].reverse(),
    },
  ];
}

function shapeVariants(description: string, customPath: Point[] | null): ShapeVariant[] {
  return customPath?.length ? customShapeVariants(customPath) : textShapeVariants(description);
}

function routePlacementTryCount(variantCount: number, startSearchMeters: number) {
  return variantCount * (
    matchConfig.scales.length
    * matchConfig.rotations.length
    * startAnchors(startSearchMeters).length
    + matchConfig.randomCandidatesPerVariant
  );
}

function mergeShapeStrokes(strokes: Point[][]) {
  const remaining = strokes
    .map((stroke) => stroke.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)))
    .filter((stroke) => stroke.length >= 2);
  if (!remaining.length) return [];

  let merged = [...remaining.shift()!];
  while (remaining.length) {
    const first = merged[0];
    const last = merged[merged.length - 1];
    let best = { distance: Number.POSITIVE_INFINITY, index: 0, mode: "append" as "append" | "appendReverse" | "prepend" | "prependReverse" };

    remaining.forEach((stroke, index) => {
      const strokeFirst = stroke[0];
      const strokeLast = stroke[stroke.length - 1];
      const options = [
        { distance: Math.hypot(last.x - strokeFirst.x, last.y - strokeFirst.y), mode: "append" as const },
        { distance: Math.hypot(last.x - strokeLast.x, last.y - strokeLast.y), mode: "appendReverse" as const },
        { distance: Math.hypot(first.x - strokeLast.x, first.y - strokeLast.y), mode: "prepend" as const },
        { distance: Math.hypot(first.x - strokeFirst.x, first.y - strokeFirst.y), mode: "prependReverse" as const },
      ];
      options.forEach((option) => {
        if (option.distance < best.distance) best = { ...option, index };
      });
    });

    const [stroke] = remaining.splice(best.index, 1);
    if (best.mode === "append") merged = [...merged, ...stroke];
    if (best.mode === "appendReverse") merged = [...merged, ...stroke.slice().reverse()];
    if (best.mode === "prepend") merged = [...stroke, ...merged];
    if (best.mode === "prependReverse") merged = [...stroke.slice().reverse(), ...merged];
  }

  return merged;
}

function aiVectorSketchPath(sketch: AiVectorSketch) {
  const strokes = sketch.strokes
    .map((stroke) => {
      const points = stroke.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
      if (sketch.closed && points.length >= 3) {
        const first = points[0];
        const last = points[points.length - 1];
        if (Math.hypot(first.x - last.x, first.y - last.y) > 0.001) {
          return [...points, first];
        }
      }
      return points;
    })
    .filter((stroke) => stroke.length >= 2);
  const merged = mergeShapeStrokes(strokes);
  if (merged.length < 4) return null;

  return normalize(merged);
}

function aiVectorSketchVariants(sketches: AiVectorSketch[]) {
  const variants: ShapeVariant[] = [];
  sketches.slice(0, matchConfig.aiVectorShapeLimit).forEach((sketch, index) => {
    const points = aiVectorSketchPath(sketch);
    if (!points) return;

    const penalty = index * matchConfig.aiVectorShapeVariantPenalty;
    variants.push({
      aiGeneratedSketch: true,
      description: sketch.description,
      name: sketch.label,
      penalty,
      points,
    });
    variants.push({
      aiGeneratedSketch: true,
      description: sketch.description,
      name: sketch.label,
      penalty: penalty + matchConfig.aiVectorReversePenalty,
      points: [...points].reverse(),
    });
  });

  return variants;
}

function aiVectorMatchingVariants(variants: ShapeVariant[]) {
  const forward = variants
    .filter((_, index) => index % 2 === 0)
    .slice(0, matchConfig.aiVectorMatchForwardLimit);
  const reverse = variants
    .filter((_, index) => index % 2 === 1)
    .slice(0, matchConfig.aiVectorMatchReverseLimit);

  return [...forward, ...reverse].sort((a, b) => a.penalty - b.penalty);
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
    const cell = cells.get(key);
    if (cell) {
      cell.push(node);
    } else {
      cells.set(key, [node]);
    }
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

type OverpassRoadData = {
  elements: Array<
    | { type: "way"; id: number; tags?: Record<string, string>; nodes?: number[] }
    | { type: "node"; id: number; lat: number; lon: number }
  >;
};

type RoadTile = {
  center: LatLng;
  east: number;
  key: string;
  north: number;
  south: number;
  west: number;
  x: number;
  y: number;
};

const overpassEndpoints = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

function roadTileFromCoords(x: number, y: number, overlapMeters = matchConfig.roadTileQueryOverlapMeters): RoadTile {
  const tileSize = matchConfig.roadTileSizeMeters;
  const metersPerLat = 111_320;
  const centerLat = (y + 0.5) * tileSize / metersPerLat;
  const metersPerLng = Math.max(1, metersPerLat * Math.cos(centerLat * Math.PI / 180));
  const centerLng = (x + 0.5) * tileSize / metersPerLng;

  return {
    center: { lat: centerLat, lng: centerLng },
    east: ((x + 1) * tileSize + overlapMeters) / metersPerLng,
    key: `${x}:${y}`,
    north: ((y + 1) * tileSize + overlapMeters) / metersPerLat,
    south: (y * tileSize - overlapMeters) / metersPerLat,
    west: (x * tileSize - overlapMeters) / metersPerLng,
    x,
    y,
  };
}

function roadTileForPoint(point: LatLng) {
  const tileSize = matchConfig.roadTileSizeMeters;
  const metersPerLat = 111_320;
  const y = Math.floor(point.lat * metersPerLat / tileSize);
  const centerLat = (y + 0.5) * tileSize / metersPerLat;
  const metersPerLng = Math.max(1, metersPerLat * Math.cos(centerLat * Math.PI / 180));
  const x = Math.floor(point.lng * metersPerLng / tileSize);
  return roadTileFromCoords(x, y);
}

function roadTileArea(tile: RoadTile, source: RoadTileLoadSource): RoadTileArea {
  const bounds = roadTileFromCoords(tile.x, tile.y, matchConfig.roadTileQueryOverlapMeters);
  return {
    east: bounds.east,
    north: bounds.north,
    south: bounds.south,
    source,
    west: bounds.west,
    x: tile.x,
    y: tile.y,
  };
}

function roadTilesForRadius(center: LatLng, radiusMeters: number) {
  const tileSize = matchConfig.roadTileSizeMeters;
  const sampleStep = tileSize / 2;
  const span = radiusMeters + tileSize;
  const tiles = new Map<string, RoadTile>();

  for (let y = -span; y <= span; y += sampleStep) {
    for (let x = -span; x <= span; x += sampleStep) {
      const point = fromMeters({ x, y }, center);
      const tile = roadTileForPoint(point);
      tiles.set(tile.key, tile);
    }
  }

  return Array.from(tiles.values())
    .filter((tile) => {
      const local = toMeters(tile.center, center);
      const dx = Math.max(0, Math.abs(local.x) - tileSize * 0.72);
      const dy = Math.max(0, Math.abs(local.y) - tileSize * 0.72);
      return Math.hypot(dx, dy) <= radiusMeters + matchConfig.roadTileQueryOverlapMeters;
    })
    .sort((a, b) => localDistance(toMeters(a.center, center), { x: 0, y: 0 }) - localDistance(toMeters(b.center, center), { x: 0, y: 0 }));
}

function roadGraphTileCacheKey(tile: RoadTile, profile: RoadQueryProfile) {
  return [
    matchConfig.graphCacheVersion,
    "tile",
    profile.id,
    `spacing-${matchConfig.roadNodeSpacingMeters}`,
    tile.key,
  ].join(":");
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
  } catch {
    // Best-effort browser cache only; route generation must keep working without it.
  }
}

function roadSegmentOverlapsBounds(from: LatLng, to: LatLng, bounds: Pick<RoadTile, "east" | "north" | "south" | "west">) {
  const minLat = Math.min(from.lat, to.lat);
  const maxLat = Math.max(from.lat, to.lat);
  const minLng = Math.min(from.lng, to.lng);
  const maxLng = Math.max(from.lng, to.lng);
  return maxLat >= bounds.south && minLat <= bounds.north && maxLng >= bounds.west && minLng <= bounds.east;
}

function buildRoadGraphFromOverpassData(
  data: OverpassRoadData,
  center: LatLng,
  clipBounds?: Pick<RoadTile, "east" | "north" | "south" | "west">,
): RoadGraph {
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
    const key = edgeKey(from, to);
    if (edgeKeys.has(key)) return;
    const fromEdges = edges.get(from)!;
    fromEdges.push({ to, weight });
    edgeKeys.add(key);
    edgeGeometries.set(key, points);
  }

  function addDenseSegment(fromId: number, toId: number, fromPoint: LatLng, toPoint: LatLng, name: string) {
    if (clipBounds && !roadSegmentOverlapsBounds(fromPoint, toPoint, clipBounds)) return;

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

  return { nodes: graphNodes, edges, edgeKeys, edgeGeometries, nodeGrid: buildNodeGrid(graphNodes, edges), segments, rejectedSegments };
}

function roadTileQuery(tile: RoadTile, profile: RoadQueryProfile) {
  const extraFilters = profile.extraFilters.length
    ? `\n${profile.extraFilters.map((filter) => `        ${filter}`).join("\n")}`
    : "";

  return `
    [out:json][timeout:${profile.timeoutSeconds}];
    (
      way(${tile.south.toFixed(6)},${tile.west.toFixed(6)},${tile.north.toFixed(6)},${tile.east.toFixed(6)})
        ["highway"~"${profile.highways}"]
        ["access"!~"private|no"]
        ["foot"!~"no"]
        ["area"!="yes"]${extraFilters};
    );
    out body qt;
    >;
    out skel qt;
  `;
}

async function fetchOverpassData(query: string, profile: RoadQueryProfile): Promise<OverpassRoadData> {
  const endpoint = (import.meta.env.VITE_OVERPASS_API_URL as string | undefined)?.trim() || "/api/overpass";
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), profile.timeoutMs * overpassEndpoints.length + 3_000);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        timeoutMs: profile.timeoutMs,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(await apiResponseError(response, "Road search failed. OpenStreetMap road data may be busy; try again in a moment."));
    }

    return await response.json() as OverpassRoadData;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function fetchRoadTileGraph(tile: RoadTile, profile: RoadQueryProfile) {
  const cacheKey = roadGraphTileCacheKey(tile, profile);
  const cached = roadGraphCache.get(cacheKey);
  if (cached) return { graph: cached, source: "memory" as const };

  const persistent = await readPersistentRoadGraph(cacheKey);
  if (persistent) {
    roadGraphCache.set(cacheKey, persistent);
    return { graph: persistent, source: "persistent" as const };
  }

  const data = await fetchOverpassData(roadTileQuery(tile, profile), profile);
  const graph = buildRoadGraphFromOverpassData(data, tile.center, tile);
  roadGraphCache.set(cacheKey, graph);
  void writePersistentRoadGraph(cacheKey, graph);
  return { graph, source: "network" as const };
}

function recenterRoutePoint(point: LatLng, center: LatLng): RoutePoint {
  return { ...point, ...toMeters(point, center) };
}

function geometryDistance(points: RoutePoint[]) {
  return points.slice(1).reduce((total, point, index) => total + localDistance(points[index], point), 0);
}

function mergeRoadGraphs(graphs: RoadGraph[], center: LatLng): RoadGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge[]>();
  const edgeKeys = new Set<string>();
  const edgeGeometries = new Map<string, RoutePoint[]>();
  const segments: RoadSegment[] = [];
  let rejectedSegments = 0;

  function ensureMergedNode(node: GraphNode) {
    if (!nodes.has(node.id)) {
      const recentered = recenterRoutePoint(node, center);
      nodes.set(node.id, { id: node.id, ...recentered });
      edges.set(node.id, []);
    }
  }

  graphs.forEach((graph) => {
    graph.nodes.forEach(ensureMergedNode);
  });

  graphs.forEach((graph) => {
    rejectedSegments += graph.rejectedSegments;
    graph.segments.forEach((segment) => {
      segments.push({
        a: recenterRoutePoint(segment.a, center),
        b: recenterRoutePoint(segment.b, center),
        name: segment.name,
      });
    });

    graph.edges.forEach((graphEdges, from) => {
      graphEdges.forEach((edge) => {
        if (!nodes.has(from) || !nodes.has(edge.to)) return;
        const key = edgeKey(from, edge.to);
        if (edgeKeys.has(key)) return;

        const geometry = (graph.edgeGeometries.get(key) ?? [graph.nodes.get(from), graph.nodes.get(edge.to)]
          .filter((node): node is GraphNode => Boolean(node)))
          .map((point) => recenterRoutePoint(point, center));
        const weight = Math.max(geometryDistance(geometry), localDistance(nodes.get(from)!, nodes.get(edge.to)!));

        edges.get(from)!.push({ to: edge.to, weight });
        edgeKeys.add(key);
        edgeGeometries.set(key, geometry);
      });
    });
  });

  return { nodes, edges, edgeKeys, edgeGeometries, nodeGrid: buildNodeGrid(nodes, edges), segments, rejectedSegments };
}

function combineRoadGraphSources(counts: Record<RoadGraphSource, number>): RoadGraphSource {
  const used = (Object.entries(counts) as Array<[RoadGraphSource, number]>)
    .filter(([, count]) => count > 0)
    .map(([source]) => source);
  return used.length === 1 ? used[0] : "mixed";
}

async function fetchRoadGraph(
  center: LatLng,
  radiusMeters: number,
  profile: RoadQueryProfile,
  onPhase?: (message: string) => void,
  messages?: RoadGraphPhaseMessages,
  onTileAreas?: RoadTileAreaProgress,
): Promise<{ failedTiles: number; graph: RoadGraph; radiusMeters: number; source: RoadGraphSource; tileCount: number; tiles: RoadTileArea[] }> {
  const radiusBucket = Math.round(radiusMeters / 100) * 100;
  const tiles = roadTilesForRadius(center, radiusBucket);
  const graphs: RoadGraph[] = [];
  const tileAreas: RoadTileArea[] = [];
  const sourceCounts: Record<RoadGraphSource, number> = { memory: 0, persistent: 0, network: 0, mixed: 0 };
  let failedTiles = 0;
  let lastError: unknown = null;

  onPhase?.(messages?.loadingOsm(profile, Math.round(radiusBucket)) ?? `Loading ${profile.label} within ${Math.round(radiusBucket)} m from OpenStreetMap...`);
  onPhase?.(messages?.tileProgress(profile, 0, tiles.length, 0, 0, 0) ?? `Road tiles 0/${tiles.length} for ${profile.label}...`);
  onTileAreas?.([]);

  for (const [index, tile] of tiles.entries()) {
    try {
      const result = await fetchRoadTileGraph(tile, profile);
      sourceCounts[result.source] += 1;
      tileAreas.push(roadTileArea(tile, result.source));
      if (result.graph.segments.length) graphs.push(result.graph);
    } catch (error) {
      failedTiles += 1;
      lastError = error;
      tileAreas.push(roadTileArea(tile, "failed"));
    }

    onTileAreas?.([...tileAreas]);
    const cached = sourceCounts.memory + sourceCounts.persistent;
    onPhase?.(
      messages?.tileProgress(profile, index + 1, tiles.length, cached, sourceCounts.network, failedTiles)
        ?? `Road tiles ${index + 1}/${tiles.length} for ${profile.label}: ${cached} cached / ${sourceCounts.network} downloaded${failedTiles ? ` / ${failedTiles} failed` : ""}...`,
    );
  }

  if (!graphs.length) {
    throw lastError instanceof Error
      ? lastError
      : new Error("Road search failed. OpenStreetMap road data may be busy; try again in a moment.");
  }

  const graph = mergeRoadGraphs(graphs, center);
  if (graph.segments.length < 2) {
    throw new Error("Not enough walkable streets found nearby. Try a larger distance or a denser location.");
  }

  void prunePersistentRoadGraphs();

  return {
    failedTiles,
    graph,
    radiusMeters: radiusBucket,
    source: combineRoadGraphSources(sourceCounts),
    tileCount: tiles.length,
    tiles: tileAreas,
  };
}

async function fetchUsableRoadGraph(
  center: LatLng,
  radiusMeters: number,
  onPhase: (message: string) => void,
  messages?: RoadGraphPhaseMessages,
  onTileAreas?: RoadTileAreaProgress,
) {
  const compactProfile = roadQueryProfiles.compact;
  const broadProfile = roadQueryProfiles.broad;
  let compactResult: Awaited<ReturnType<typeof fetchRoadGraph>> | null = null;

  try {
    const result = await fetchRoadGraph(center, radiusMeters, compactProfile, onPhase, messages, onTileAreas);
    compactResult = result;
    if (result.graph.segments.length >= matchConfig.compactRoadMinSegments) {
      return { ...result, profile: compactProfile };
    }
  } catch {
    // Fall through to the broader profile below.
  }

  const broadRadius = Math.min(radiusMeters * matchConfig.compactRoadRadiusBoost, matchConfig.maxRoadSearchRadiusMeters);
  try {
    const result = await fetchRoadGraph(center, broadRadius, broadProfile, onPhase, messages, onTileAreas);
    return { ...result, profile: broadProfile };
  } catch (error) {
    if (compactResult) return { ...compactResult, profile: compactProfile };
    throw error;
  }
}

function nearestNode(graph: RoadGraph, point: Point): { node: GraphNode | null; distance: number } {
  let best: GraphNode | null = null;
  let bestDistanceSquared = Number.POSITIVE_INFINITY;
  const { cellSize, cells, nodes } = graph.nodeGrid;
  const cellX = Math.floor(point.x / cellSize);
  const cellY = Math.floor(point.y / cellSize);
  let checkedAny = false;

  function checkNode(node: GraphNode) {
    const dx = node.x - point.x;
    const dy = node.y - point.y;
    const current = dx * dx + dy * dy;
    if (current < bestDistanceSquared) {
      best = node;
      bestDistanceSquared = current;
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

    const ringDistance = Math.max(0, ring - 0.5) * cellSize;
    if (checkedAny && bestDistanceSquared <= ringDistance * ringDistance) break;
  }

  if (!best) {
    nodes.forEach(checkNode);
  }

  return { node: best, distance: Math.sqrt(bestDistanceSquared) };
}

function nodeDegree(graph: RoadGraph, nodeId: string) {
  return graph.edges.get(nodeId)?.length ?? 0;
}

function isDeadEndNode(graph: RoadGraph, nodeId: string) {
  return nodeDegree(graph, nodeId) <= 1;
}

function nearestNodes(graph: RoadGraph, point: Point, limit: number): Array<{ node: GraphNode; distance: number }> {
  const { cellSize, cells, nodes } = graph.nodeGrid;
  const cellX = Math.floor(point.x / cellSize);
  const cellY = Math.floor(point.y / cellSize);
  const seen = new Set<string>();
  const candidates: Array<{ node: GraphNode; distanceSquared: number }> = [];

  function addNode(node: GraphNode) {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    const dx = node.x - point.x;
    const dy = node.y - point.y;
    candidates.push({ node, distanceSquared: dx * dx + dy * dy });
  }

  for (let ring = 0; ring <= 8; ring += 1) {
    for (let x = cellX - ring; x <= cellX + ring; x += 1) {
      for (let y = cellY - ring; y <= cellY + ring; y += 1) {
        if (ring > 0 && x !== cellX - ring && x !== cellX + ring && y !== cellY - ring && y !== cellY + ring) {
          continue;
        }

        (cells.get(`${x},${y}`) ?? []).forEach(addNode);
      }
    }

    if (candidates.length >= limit * 4) break;
  }

  if (!candidates.length) {
    nodes.forEach(addNode);
  }

  return candidates
    .sort((a, b) => {
      const aScore = Math.sqrt(a.distanceSquared) + (isDeadEndNode(graph, a.node.id) ? matchConfig.mapMatchDeadEndPenalty * 0.35 : 0);
      const bScore = Math.sqrt(b.distanceSquared) + (isDeadEndNode(graph, b.node.id) ? matchConfig.mapMatchDeadEndPenalty * 0.35 : 0);
      return aScore - bScore;
    })
    .slice(0, limit)
    .map(({ node, distanceSquared }) => ({ node, distance: Math.sqrt(distanceSquared) }));
}

function graphDistance(route: GraphNode[]) {
  let total = 0;

  for (let index = 1; index < route.length; index += 1) {
    const prev = route[index - 1];
    const node = route[index];
    total += Math.hypot(node.x - prev.x, node.y - prev.y);
  }

  return total;
}

function localDistance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function angleBetweenSegments(a: Point, b: Point, c: Point) {
  const first = { x: b.x - a.x, y: b.y - a.y };
  const second = { x: c.x - b.x, y: c.y - b.y };
  const firstLength = Math.max(localDistance(a, b), 0.001);
  const secondLength = Math.max(localDistance(b, c), 0.001);
  const cross = first.x * second.y - first.y * second.x;
  const dot = first.x * second.x + first.y * second.y;
  return Math.abs(Math.atan2(cross / (firstLength * secondLength), dot / (firstLength * secondLength)));
}

function pointToSegmentDistance(point: Point, start: Point, end: Point) {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared <= 0.000001) return localDistance(point, start);

  const progress = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) / lengthSquared),
  );
  const dx = point.x - (start.x + segmentX * progress);
  const dy = point.y - (start.y + segmentY * progress);
  return Math.hypot(dx, dy);
}

function pointToPolylineDistance(point: Point, polyline: Point[]) {
  if (!polyline.length) return Number.POSITIVE_INFINITY;
  if (polyline.length === 1) return localDistance(point, polyline[0]);

  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < polyline.length; index += 1) {
    const distance = pointToSegmentDistance(point, polyline[index - 1], polyline[index]);
    if (distance < best) best = distance;
  }

  return best;
}

function averagePolylineDistance(points: Point[], polyline: Point[]) {
  if (!points.length || !polyline.length) return Number.POSITIVE_INFINITY;

  let total = 0;
  for (const point of points) {
    total += pointToPolylineDistance(point, polyline);
  }

  return total / points.length;
}

function maxPolylineDistance(points: Point[], polyline: Point[]) {
  if (!points.length || !polyline.length) return Number.POSITIVE_INFINITY;

  let maximum = 0;
  for (const point of points) {
    maximum = Math.max(maximum, pointToPolylineDistance(point, polyline));
  }

  return maximum;
}

function shapeAnchorPoints(points: Point[]) {
  if (points.length <= 2) return points;

  const anchors = new Map<number, number>();
  function addAnchor(index: number, score: number) {
    anchors.set(index, Math.max(anchors.get(index) ?? 0, score));
  }

  addAnchor(0, 10);
  addAnchor(points.length - 1, 10);

  const extrema = [
    { score: 8, index: points.reduce((best, point, index) => point.x < points[best].x ? index : best, 0) },
    { score: 8, index: points.reduce((best, point, index) => point.x > points[best].x ? index : best, 0) },
    { score: 8, index: points.reduce((best, point, index) => point.y < points[best].y ? index : best, 0) },
    { score: 8, index: points.reduce((best, point, index) => point.y > points[best].y ? index : best, 0) },
  ];
  extrema.forEach(({ index, score }) => addAnchor(index, score));

  for (let index = 1; index < points.length - 1; index += 1) {
    const turn = angleBetweenSegments(points[index - 1], points[index], points[index + 1]);
    const localScale = Math.min(localDistance(points[index - 1], points[index]), localDistance(points[index], points[index + 1]));
    addAnchor(index, turn * Math.sqrt(Math.max(localScale, 1)));
  }

  return Array.from(anchors.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, matchConfig.shapeAnchorLimit)
    .sort((a, b) => a[0] - b[0])
    .map(([index]) => points[index]);
}

function scoreRouteAgainstShape(routePoints: Point[], targetPoints: Point[]): ShapeScore {
  if (routePoints.length < 2 || targetPoints.length < 2) {
    return {
      anchorError: Number.POSITIVE_INFINITY,
      maxError: Number.POSITIVE_INFINITY,
      meanError: Number.POSITIVE_INFINITY,
      orderedError: Number.POSITIVE_INFINITY,
      total: Number.POSITIVE_INFINITY,
    };
  }

  const routeSample = resample(routePoints, matchConfig.shapeScoreSamples);
  const targetSample = resample(targetPoints, matchConfig.shapeScoreSamples);
  const routeToTarget = averagePolylineDistance(routeSample, targetSample);
  const targetToRoute = averagePolylineDistance(targetSample, routeSample);
  const meanError = routeToTarget * 0.35 + targetToRoute * 0.65;
  const orderedError = targetSample.reduce((total, target, index) => (
    total + localDistance(target, routeSample[Math.min(index, routeSample.length - 1)])
  ), 0) / targetSample.length;
  const anchors = shapeAnchorPoints(targetPoints);
  const anchorError = averagePolylineDistance(anchors, routeSample);
  const maxError = maxPolylineDistance(targetSample, routeSample);
  const total = meanError * matchConfig.shapeMeanWeight
    + orderedError * matchConfig.shapeOrderedWeight
    + anchorError * matchConfig.shapeAnchorWeight
    + maxError * matchConfig.shapeMaxWeight;

  return { anchorError, maxError, meanError, orderedError, total };
}

function shapeSegmentWindows(routePoints: Point[], targetPoints: Point[]): ShapeSegmentWindow[] {
  if (routePoints.length < 2 || targetPoints.length < 2) return [];

  const routeSample = resample(routePoints, matchConfig.shapeScoreSamples);
  const targetSample = resample(targetPoints, matchConfig.shapeScoreSamples);
  const windowCount = Math.min(matchConfig.segmentScoreWindows, Math.max(1, Math.floor(targetSample.length / 4)));

  return Array.from({ length: windowCount }, (_, index) => {
    const startIndex = Math.floor(index * (targetSample.length - 1) / windowCount);
    const endIndex = index === windowCount - 1
      ? targetSample.length - 1
      : Math.max(startIndex + 1, Math.floor((index + 1) * (targetSample.length - 1) / windowCount));
    let total = 0;
    let maxError = 0;
    let count = 0;

    for (let sampleIndex = startIndex; sampleIndex <= endIndex; sampleIndex += 1) {
      const target = targetSample[sampleIndex];
      const ordered = localDistance(target, routeSample[Math.min(sampleIndex, routeSample.length - 1)]);
      const local = pointToPolylineDistance(target, routeSample);
      const error = local * 0.75 + ordered * 0.25;
      total += error;
      maxError = Math.max(maxError, error);
      count += 1;
    }

    return {
      endProgress: endIndex / Math.max(targetSample.length - 1, 1),
      index,
      maxError,
      score: total / Math.max(count, 1) + maxError * 0.2,
      startProgress: startIndex / Math.max(targetSample.length - 1, 1),
    };
  }).sort((a, b) => b.score - a.score);
}

function repairTargetsForWindows(targetPoints: Point[], windows: ShapeSegmentWindow[]) {
  const dense = resample(targetPoints, matchConfig.segmentRepairExtraPoints);
  const samples = [
    ...targetPoints.map((point, index) => ({
      point,
      progress: index / Math.max(targetPoints.length - 1, 1),
    })),
    ...dense.flatMap((point, index) => {
      const progress = index / Math.max(dense.length - 1, 1);
      const insideRepairWindow = windows.some((window) =>
        progress >= Math.max(0, window.startProgress - matchConfig.segmentRepairWindowPadding)
        && progress <= Math.min(1, window.endProgress + matchConfig.segmentRepairWindowPadding)
      );
      return insideRepairWindow ? [{ point, progress }] : [];
    }),
  ].sort((a, b) => a.progress - b.progress);

  return samples
    .filter((sample, index, array) => {
      const previous = array[index - 1];
      return !previous
        || sample.progress - previous.progress > 1 / (matchConfig.segmentRepairExtraPoints * 1.8)
        || localDistance(sample.point, previous.point) > 1;
    })
    .map((sample) => sample.point);
}

function seededShapeWindows(points: Point[]): ShapeSeedWindow[] {
  const totalLength = distance(points);
  if (points.length < 2 || totalLength < matchConfig.seededPlacementMinWindowMeters) return [];

  const sampleCount = Math.max(
    matchConfig.seededPlacementShapeSamples,
    matchConfig.seededPlacementShapeWindows * matchConfig.seededPlacementMinWindowSamples,
  );
  const sampled = resample(points, sampleCount);
  const maxWindowSamples = Math.max(
    matchConfig.seededPlacementMinWindowSamples,
    Math.floor(sampled.length * 0.32),
  );
  const windowSamples = Math.min(
    maxWindowSamples,
    Math.max(
      matchConfig.seededPlacementMinWindowSamples,
      Math.round(sampled.length * matchConfig.seededPlacementTargetWindowMeters / Math.max(totalLength, 1)),
    ),
  );
  const windowCount = Math.min(
    matchConfig.seededPlacementShapeWindows,
    Math.max(1, sampled.length - windowSamples + 1),
  );
  const step = windowCount <= 1 ? 0 : (sampled.length - windowSamples) / (windowCount - 1);
  const windows: ShapeSeedWindow[] = [];

  for (let index = 0; index < windowCount; index += 1) {
    const startIndex = Math.round(index * step);
    const endIndex = Math.min(sampled.length - 1, startIndex + windowSamples - 1);
    const windowPoints = sampled.slice(startIndex, endIndex + 1);
    const length = distance(windowPoints);
    if (windowPoints.length < 3 || length < matchConfig.seededPlacementMinWindowMeters) continue;

    windows.push({
      endProgress: endIndex / Math.max(sampled.length - 1, 1),
      index,
      length,
      points: windowPoints,
      startProgress: startIndex / Math.max(sampled.length - 1, 1),
      turnScore: routeTurnScore(resample(windowPoints, Math.min(matchConfig.seededPlacementWindowSamples, windowPoints.length))),
    });
  }

  return windows;
}

function roadSeedStartNodes(graph: RoadGraph) {
  const candidates = graph.nodeGrid.nodes.filter((node) => nodeDegree(graph, node.id) >= 2);
  const nodes = candidates.length ? candidates : graph.nodeGrid.nodes;
  if (nodes.length <= matchConfig.seededPlacementMaxRoadStarts) return nodes;

  const selected: GraphNode[] = [];
  const stride = nodes.length / matchConfig.seededPlacementMaxRoadStarts;
  for (let index = 0; index < matchConfig.seededPlacementMaxRoadStarts; index += 1) {
    selected.push(nodes[Math.floor(index * stride)]);
  }
  return selected;
}

function roadSeedPathSignature(nodes: GraphNode[]) {
  const stride = Math.max(1, Math.floor(nodes.length / 5));
  return nodes
    .filter((_, index) => index === 0 || index === nodes.length - 1 || index % stride === 0)
    .map((node) => node.id)
    .join('>');
}

function roadSeedPathsForWindow(graph: RoadGraph, targetLength: number): RoadSeedPath[] {
  const minLength = Math.max(matchConfig.seededPlacementMinWindowMeters, targetLength * matchConfig.randomScaleMin);
  const maxLength = Math.min(
    matchConfig.seededPlacementMaxRoadPathMeters,
    Math.max(minLength + matchConfig.roadNodeSpacingMeters, targetLength * matchConfig.randomScaleMax),
  );
  const starts = roadSeedStartNodes(graph);
  const paths: RoadSeedPath[] = [];
  const seen = new Set<string>();

  function addPath(nodes: GraphNode[], length: number) {
    const signature = roadSeedPathSignature(nodes);
    if (seen.has(signature)) return;
    seen.add(signature);

    const points = nodes.map((node) => ({ x: node.x, y: node.y }));
    const turnScore = routeTurnScore(resample(points, Math.min(matchConfig.seededPlacementWindowSamples, points.length)));
    const qualityPenalty = routeQualityPenalty(graph, nodes).penalty;
    const lengthPenalty = Math.abs(length - targetLength) / Math.max(targetLength, 1) * 90;

    paths.push({
      length,
      nodes,
      points,
      qualityPenalty,
      score: lengthPenalty + qualityPenalty * 0.04 - Math.min(turnScore, 8) * 1.2,
      turnScore,
    });
  }

  function prunePaths() {
    if (paths.length <= matchConfig.seededPlacementMaxRoadPathsPerWindow * 3) return;
    paths.sort((a, b) => a.score - b.score);
    paths.length = matchConfig.seededPlacementMaxRoadPathsPerWindow * 2;
  }

  starts.forEach((start) => {
    const firstEdges = (graph.edges.get(start.id) ?? [])
      .flatMap((edge) => {
        const next = graph.nodes.get(edge.to);
        return next ? [{ edge, next }] : [];
      });

    firstEdges.forEach(({ edge, next }) => {
      let beam = [{
        length: edge.weight,
        nodes: [start, next],
        score: 0,
      }];

      for (let depth = 0; depth < matchConfig.seededPlacementMaxRoadNodes && beam.length; depth += 1) {
        const nextBeam: Array<{ length: number; nodes: GraphNode[]; score: number }> = [];

        beam.forEach((state) => {
          if (state.length >= minLength) addPath(state.nodes, state.length);
          if (state.length >= maxLength) return;

          const current = state.nodes[state.nodes.length - 1];
          const previous = state.nodes[state.nodes.length - 2];
          const choices = (graph.edges.get(current.id) ?? [])
            .flatMap((nextEdge) => {
              const nextNode = graph.nodes.get(nextEdge.to);
              return nextNode ? [{ edge: nextEdge, next: nextNode }] : [];
            })
            .filter(({ next: nextNode }) => nextNode.id !== previous?.id && !state.nodes.some((node) => node.id === nextNode.id));

          choices
            .map(({ edge: nextEdge, next: nextNode }) => {
              const turnPenalty = previous ? Math.max(0, turnRadians(previous, current, nextNode) - Math.PI * 0.82) * 120 : 0;
              const deadEndPenalty = isDeadEndNode(graph, nextNode.id) ? 35 : 0;
              const overshootPenalty = Math.max(0, state.length + nextEdge.weight - maxLength) * 0.35;
              return {
                length: state.length + nextEdge.weight,
                nodes: [...state.nodes, nextNode],
                score: state.score + turnPenalty + deadEndPenalty + overshootPenalty,
              };
            })
            .sort((a, b) => a.score - b.score)
            .slice(0, matchConfig.seededPlacementRoadBeamWidth)
            .forEach((state) => nextBeam.push(state));
        });

        beam = nextBeam
          .sort((a, b) => a.score - b.score)
          .slice(0, matchConfig.seededPlacementRoadBeamWidth);
      }

      prunePaths();
    });
  });

  return paths
    .sort((a, b) => a.score - b.score)
    .slice(0, matchConfig.seededPlacementMaxRoadPathsPerWindow);
}

function scoreSeededPlacement(window: ShapeSeedWindow, path: RoadSeedPath): SeededPlacementMatch | null {
  if (window.points.length < 3 || path.points.length < 3) return null;

  const shapeStart = window.points[0];
  const shapeEnd = window.points[window.points.length - 1];
  const roadStart = path.points[0];
  const roadEnd = path.points[path.points.length - 1];
  const shapeChord = localDistance(shapeStart, shapeEnd);
  const roadChord = localDistance(roadStart, roadEnd);
  if (shapeChord < 18 || roadChord < 18) return null;

  const scale = path.length / Math.max(window.length, 1);
  if (scale < matchConfig.randomScaleMin || scale > matchConfig.randomScaleMax) return null;

  const shapeHeading = Math.atan2(shapeEnd.y - shapeStart.y, shapeEnd.x - shapeStart.x);
  const roadHeading = Math.atan2(roadEnd.y - roadStart.y, roadEnd.x - roadStart.x);
  const rotation = Math.atan2(Math.sin(roadHeading - shapeHeading), Math.cos(roadHeading - shapeHeading));
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const offset = {
    x: roadStart.x - (shapeStart.x * cos - shapeStart.y * sin) * scale,
    y: roadStart.y - (shapeStart.x * sin + shapeStart.y * cos) * scale,
  };
  const transformedWindow = transformPointsWithTrig(window.points, scale, cos, sin, offset);
  const shapeSample = resample(transformedWindow, matchConfig.seededPlacementWindowSamples);
  const roadSample = resample(path.points, matchConfig.seededPlacementWindowSamples);
  const shapeToRoad = averagePolylineDistance(shapeSample, roadSample);
  const roadToShape = averagePolylineDistance(roadSample, shapeSample);
  const orderedError = shapeSample.reduce((total, point, index) => (
    total + localDistance(point, roadSample[Math.min(index, roadSample.length - 1)])
  ), 0) / Math.max(shapeSample.length, 1);
  const turnMismatch = Math.abs(window.turnScore - path.turnScore);
  const chordRatio = roadChord / Math.max(shapeChord * scale, 1);
  const chordPenalty = Math.abs(Math.log(Math.max(chordRatio, 0.001))) * 28;
  const scalePenalty = Math.abs(scale - 1) * 26;
  const score = shapeToRoad * 0.55
    + roadToShape * 0.45
    + orderedError * 0.35
    + turnMismatch * 8
    + chordPenalty
    + scalePenalty
    + path.qualityPenalty * 0.025;

  if (!Number.isFinite(score)) return null;
  return { offset, rotation, scale, score };
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

  for (let index = 1; index < route.length; index += 1) {
    const prev = route[index - 1];
    const node = route[index];
    const forwardKey = edgeKey(prev.id, node.id);
    const reverseKey = edgeKey(node.id, prev.id);
    const forwardVisits = visits.get(forwardKey) ?? 0;
    const reverseVisits = visits.get(reverseKey) ?? 0;

    penalty += forwardVisits * matchConfig.repeatedEdgePenalty;
    penalty += reverseVisits * matchConfig.reverseEdgePenalty;
    visits.set(forwardKey, forwardVisits + 1);

    if (isDeadEndNode(graph, node.id)) {
      penalty += matchConfig.deadEndPenalty * (index < route.length - 1 ? 1.35 : 0.65);
    }

    if (index >= 2) {
      penalty += turnQualityPenalty(route[index - 2], prev, node);
    }
  }

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

function graphAwareWaypointRoute(graph: RoadGraph, targets: Point[]) {
  if (targets.length < 2) return null;

  type MatchState = {
    node: GraphNode;
    route: GraphNode[];
    score: number;
    snapTotal: number;
  };

  const options = targets.map((target) => nearestNodes(graph, target, matchConfig.mapMatchNearestNodes));
  if (options.some((option) => !option.length)) return null;

  let beam: MatchState[] = options[0].map(({ node, distance }) => {
    const initialDeadEndPenalty = isDeadEndNode(graph, node.id)
      ? matchConfig.mapMatchDeadEndPenalty * 0.45
      : 0;

    return {
      node,
      route: [node],
      score: distance * matchConfig.snapPenaltyWeight + initialDeadEndPenalty,
      snapTotal: distance,
    };
  });

  for (let targetIndex = 1; targetIndex < targets.length && beam.length; targetIndex += 1) {
    const previousTarget = targets[targetIndex - 1];
    const target = targets[targetIndex];
    const targetLength = Math.max(localDistance(previousTarget, target), 1);
    const targetHeading = Math.atan2(target.y - previousTarget.y, target.x - previousTarget.x);
    const nextBeam: MatchState[] = [];
    const isFinalTarget = targetIndex === targets.length - 1;

    beam.forEach((state) => {
      options[targetIndex].forEach(({ node, distance }) => {
        const previous = state.node;
        const transitionLength = localDistance(previous, node);
        const transitionHeading = Math.atan2(node.y - previous.y, node.x - previous.x);
        const headingPenalty = Number.isFinite(transitionHeading)
          ? Math.abs(Math.atan2(Math.sin(transitionHeading - targetHeading), Math.cos(transitionHeading - targetHeading)))
            * matchConfig.mapMatchHeadingWeight
          : 0;
        const transitionPenalty = Math.abs(transitionLength - targetLength) * matchConfig.mapMatchTransitionWeight;
        const duplicatePenalty = state.route.some((routeNode) => routeNode.id === node.id)
          ? matchConfig.mapMatchDuplicatePenalty
          : 0;
        const deadEndPenalty = isDeadEndNode(graph, node.id)
          ? matchConfig.mapMatchDeadEndPenalty * (isFinalTarget ? 0.45 : 1)
          : 0;

        nextBeam.push({
          node,
          route: [...state.route, node],
          score: state.score
            + distance * matchConfig.snapPenaltyWeight
            + transitionPenalty
            + headingPenalty
            + duplicatePenalty
            + deadEndPenalty,
          snapTotal: state.snapTotal + distance,
        });
      });
    });

    beam = nextBeam
      .sort((a, b) => a.score - b.score)
      .slice(0, matchConfig.mapMatchBeamWidth);
  }

  const best = beam.sort((a, b) => a.score - b.score)[0];
  if (!best) return null;

  const route = best.route.filter((node, index, array) => node.id !== array[index - 1]?.id);
  if (route.length < 4) return null;

  const uniqueCount = new Set(best.route.map((node) => node.id)).size;
  return {
    route,
    score: best.score,
    snapPenalty: best.snapTotal / targets.length,
    duplicatePenalty: (best.route.length - uniqueCount) * matchConfig.duplicateWaypointPenalty,
  };
}

function routeUsesOnlyGraphEdges(graph: RoadGraph, route: GraphNode[]) {
  for (let index = 1; index < route.length; index += 1) {
    if (!graph.edgeKeys.has(edgeKey(route[index - 1].id, route[index].id))) return false;
  }

  return true;
}

function expandRouteGeometry(graph: RoadGraph, route: GraphNode[]) {
  const expanded: RoutePoint[] = [];

  for (let index = 1; index < route.length; index += 1) {
    const prev = route[index - 1];
    const node = route[index];
    const geometry = graph.edgeGeometries.get(edgeKey(prev.id, node.id));
    if (!geometry?.length) continue;

    const startIndex = expanded.length ? 1 : 0;
    for (let geometryIndex = startIndex; geometryIndex < geometry.length; geometryIndex += 1) {
      expanded.push(geometry[geometryIndex]);
    }
  }

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

function pushHeap<T extends { priority: number }>(heap: T[], item: T) {
  heap.push(item);
  let index = heap.length - 1;

  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (heap[parent].priority <= heap[index].priority) break;
    [heap[parent], heap[index]] = [heap[index], heap[parent]];
    index = parent;
  }
}

function popHeap<T extends { priority: number }>(heap: T[]) {
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

    if (left < heap.length && heap[left].priority < heap[smallest].priority) smallest = left;
    if (right < heap.length && heap[right].priority < heap[smallest].priority) smallest = right;
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
  const costs = new Map<string, number>([[start.id, 0]]);
  const previous = new Map<string, string>();
  const open: Array<{ id: string; priority: number }> = [{ id: start.id, priority: directDistance }];
  const closed = new Set<string>();

  while (open.length) {
    const current = popHeap(open)!;
    if (closed.has(current.id)) continue;
    closed.add(current.id);

    const currentDistance = distances.get(current.id) ?? Number.POSITIVE_INFINITY;
    const currentCost = costs.get(current.id) ?? Number.POSITIVE_INFINITY;
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
      const deadEndStepPenalty = edge.to === end.id || edge.to === start.id || !isDeadEndNode(graph, edge.to)
        ? 0
        : matchConfig.pathDeadEndStepPenalty;
      const nextCost = currentCost + edge.weight + deadEndStepPenalty;
      if (nextDistance + heuristic > budget) return;
      if (nextCost >= (costs.get(edge.to) ?? Number.POSITIVE_INFINITY)) return;

      distances.set(edge.to, nextDistance);
      costs.set(edge.to, nextCost);
      previous.set(edge.to, current.id);
      pushHeap(open, { id: edge.to, priority: nextCost + heuristic * matchConfig.heuristicWeight });
    });
  }

  return null;
}

function stitchWalkableRoute(
  graph: RoadGraph,
  waypoints: GraphNode[],
  segmentBudgetMeters: number,
  pathCache = new Map<string, GraphNode[] | null>(),
) {
  if (waypoints.length < 2) return null;

  type StitchState = {
    connectedLegs: number;
    edgeVisits: Map<string, number>;
    index: number;
    route: GraphNode[];
    score: number;
    skippedWaypoints: number;
  };

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
        const degreePenalty = isDeadEndNode(graph, next.id) ? 8 : 0;
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


function routeBacktrackRatio(route: GraphNode[]) {
  return routeReuseStats(route).reverseEdgeRatio;
}

function undirectedEdgeKey(from: string, to: string) {
  return from < to ? from + '<->' + to : to + '<->' + from;
}

function routeReuseStats(route: GraphNode[]) {
  const edgeCount = Math.max(route.length - 1, 1);
  const directedEdges = new Set<string>();
  const undirectedEdges = new Set<string>();
  let immediateBacktracks = 0;
  let repeatedDirected = 0;
  let repeatedUndirected = 0;
  let reverseVisits = 0;

  for (let index = 1; index < route.length; index += 1) {
    const prev = route[index - 1];
    const current = route[index];
    const forward = edgeKey(prev.id, current.id);
    const reverse = edgeKey(current.id, prev.id);
    const undirected = undirectedEdgeKey(prev.id, current.id);

    if (directedEdges.has(forward)) repeatedDirected += 1;
    if (directedEdges.has(reverse)) reverseVisits += 1;
    if (undirectedEdges.has(undirected)) repeatedUndirected += 1;
    if (index >= 2 && current.id === route[index - 2].id) immediateBacktracks += 1;

    directedEdges.add(forward);
    undirectedEdges.add(undirected);
  }

  return {
    immediateBacktrackRatio: immediateBacktracks / edgeCount,
    repeatedDirectedRatio: repeatedDirected / edgeCount,
    reverseEdgeRatio: reverseVisits / edgeCount,
    undirectedReuseRatio: repeatedUndirected / edgeCount,
    uniqueNodeRatio: new Set(route.map((node) => node.id)).size / Math.max(route.length, 1),
  };
}

function routeTurnScore(points: Point[]) {
  if (points.length < 3) return 0;

  let total = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const prev = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const incoming = Math.atan2(current.y - prev.y, current.x - prev.x);
    const outgoing = Math.atan2(next.y - current.y, next.x - current.x);
    total += Math.abs(Math.atan2(Math.sin(outgoing - incoming), Math.cos(outgoing - incoming)));
  }

  return total;
}

function polylineArea(points: Point[]) {
  if (points.length < 3) return 0;

  let area = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    area += point.x * next.y - next.x * point.y;
  });

  return Math.abs(area) / 2;
}

function localShapeCandidateScore(graph: RoadGraph, route: GraphNode[], routePoints: Point[], targetDistanceMeters: number) {
  if (routePoints.length < 4) return Number.POSITIVE_INFINITY;

  const routeDistance = graphDistance(route);
  const bounds = boundsOf(routePoints);
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  const diagonal = Math.hypot(width, height);
  const closure = localDistance(routePoints[0], routePoints[routePoints.length - 1]);
  const area = polylineArea(routePoints);
  const turnScore = routeTurnScore(resample(routePoints, 52));
  const reuseStats = routeReuseStats(route);
  const qualityPenalty = routeQualityPenalty(graph, route).penalty;
  const distanceError = Math.abs(routeDistance - targetDistanceMeters) / Math.max(targetDistanceMeters, 1);
  const compactness = routeDistance / Math.max(diagonal, 1);
  const areaRatio = area / Math.max(width * height, 1);
  const closureRatio = closure / Math.max(diagonal, 1);

  return distanceError * 90
    + reuseStats.reverseEdgeRatio * matchConfig.aiShapeBacktrackRatioPenalty
    + reuseStats.undirectedReuseRatio * matchConfig.aiShapeUndirectedReusePenalty
    + reuseStats.repeatedDirectedRatio * matchConfig.aiShapeRepeatedDirectedPenalty
    + reuseStats.immediateBacktrackRatio * matchConfig.aiShapeImmediateBacktrackPenalty
    + Math.max(0, matchConfig.aiShapeMinUniqueNodeRatio - reuseStats.uniqueNodeRatio) * matchConfig.aiShapeLowUniquePenalty
    + qualityPenalty * matchConfig.aiShapeQualityPenaltyWeight
    + Math.abs(compactness - 4.6) * 6
    + closureRatio * 10
    - Math.min(turnScore, 22) * 2.4
    - Math.min(areaRatio, 0.62) * 34;
}

function randomWalkCandidate(
  graph: RoadGraph,
  targetDistanceMeters: number,
  starts = graph.nodeGrid.nodes.filter((node) => (graph.edges.get(node.id) ?? []).length >= 2),
) {
  if (!starts.length) return null;

  const start = starts[Math.floor(Math.random() * starts.length)];
  const route: GraphNode[] = [start];
  const edgeVisits = new Map<string, number>();
  const undirectedVisits = new Map<string, number>();
  const mode = Math.random();
  let current = start;
  let previous: GraphNode | null = null;
  let meters = 0;

  for (let step = 0; step < 900 && meters < targetDistanceMeters * matchConfig.aiShapeWalkOvershootRatio; step += 1) {
    const edges = (graph.edges.get(current.id) ?? [])
      .flatMap((edge) => {
        const next = graph.nodes.get(edge.to);
        return next ? [{ edge, next }] : [];
      });
    if (!edges.length) break;

    const progress = meters / Math.max(targetDistanceMeters, 1);
    const currentAngle = Math.atan2(current.y - start.y, current.x - start.x);
    const loopHeading = currentAngle + Math.PI / 2 + (mode > 0.5 ? 0.45 : -0.45);
    const waveHeading = previous
      ? Math.atan2(current.y - previous.y, current.x - previous.x) + Math.sin(progress * Math.PI * 6 + mode * Math.PI) * 1.15
      : loopHeading;
    const preferredHeading = mode < 0.55 ? loopHeading : waveHeading;

    const freshEdges = edges.filter(({ next }) => {
      const forwardVisits = edgeVisits.get(edgeKey(current.id, next.id)) ?? 0;
      const reverseVisits = edgeVisits.get(edgeKey(next.id, current.id)) ?? 0;
      const immediateBacktrack = Boolean(previous && next.id === previous.id);
      return !forwardVisits && !reverseVisits && !immediateBacktrack;
    });
    const selectableEdges = freshEdges.length ? freshEdges : edges;
    if (!freshEdges.length && meters > targetDistanceMeters * 0.28) break;

    const ranked = selectableEdges
      .map(({ edge, next }) => {
        const forwardKey = edgeKey(current.id, next.id);
        const reverseKey = edgeKey(next.id, current.id);
        const undirectedKey = undirectedEdgeKey(current.id, next.id);
        const heading = Math.atan2(next.y - current.y, next.x - current.x);
        const headingPenalty = Math.abs(Math.atan2(Math.sin(heading - preferredHeading), Math.cos(heading - preferredHeading))) * 9;
        const repeatPenalty = (edgeVisits.get(forwardKey) ?? 0) * matchConfig.repeatedEdgePenalty * matchConfig.aiShapeRepeatPenaltyScale;
        const reversePenalty = (edgeVisits.get(reverseKey) ?? 0) * matchConfig.reverseEdgePenalty * matchConfig.aiShapeReversePenaltyScale;
        const deadEndPenalty = isDeadEndNode(graph, next.id)
          ? matchConfig.deadEndPenalty * matchConfig.aiShapeDeadEndPenaltyScale
          : 0;
        const previousPenalty = previous && next.id === previous.id
          ? matchConfig.reverseEdgePenalty * matchConfig.aiShapeImmediateBacktrackScale
          : 0;
        const undirectedReusePenalty = (undirectedVisits.get(undirectedKey) ?? 0) * matchConfig.aiShapeUndirectedReuseStepPenalty;
        const closurePenalty = progress > 0.62 ? localDistance(next, start) * 0.012 : 0;
        const overshootPenalty = Math.max(0, meters + edge.weight - targetDistanceMeters * matchConfig.aiShapeWalkOvershootRatio) * 0.2;
        return {
          edge,
          next,
          score: headingPenalty + repeatPenalty + reversePenalty + undirectedReusePenalty + deadEndPenalty + previousPenalty + closurePenalty + overshootPenalty + Math.random() * 7,
        };
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, 4);

    const picked = ranked[Math.min(ranked.length - 1, Math.floor(Math.random() * Math.min(2, ranked.length)))];
    if (!picked) break;

    const pickedEdgeKey = edgeKey(current.id, picked.next.id);
    const pickedUndirectedKey = undirectedEdgeKey(current.id, picked.next.id);
    edgeVisits.set(pickedEdgeKey, (edgeVisits.get(pickedEdgeKey) ?? 0) + 1);
    undirectedVisits.set(pickedUndirectedKey, (undirectedVisits.get(pickedUndirectedKey) ?? 0) + 1);
    previous = current;
    current = picked.next;
    meters += picked.edge.weight;
    route.push(current);

    if (meters > targetDistanceMeters * 0.72 && localDistance(current, start) < targetDistanceMeters * 0.08 && Math.random() < 0.22) {
      break;
    }
  }

  const deduped = route.filter((node, index, array) => node.id !== array[index - 1]?.id);
  if (meters < targetDistanceMeters * 0.42 || deduped.length < 8 || !routeUsesOnlyGraphEdges(graph, deduped)) return null;

  const reuseStats = routeReuseStats(deduped);
  if (reuseStats.reverseEdgeRatio > matchConfig.aiShapeExtremeBacktrackRatio) return null;
  if (reuseStats.reverseEdgeRatio > matchConfig.aiShapeMaxReverseEdgeRatio && Math.random() < 0.9) return null;
  if (reuseStats.undirectedReuseRatio > matchConfig.aiShapeMaxUndirectedReuseRatio && Math.random() < 0.88) return null;
  if (reuseStats.immediateBacktrackRatio > matchConfig.aiShapeMaxImmediateBacktrackRatio && Math.random() < 0.92) return null;
  if (reuseStats.uniqueNodeRatio < matchConfig.aiShapeMinUniqueNodeRatio && Math.random() < 0.82) return null;

  return deduped;
}

async function generateLocalShapeCandidates(
  graph: RoadGraph,
  center: LatLng,
  kilometers: number,
  onProgress: (message: string) => void,
  progressLabel: string,
) {
  const targetDistanceMeters = kilometers * 1000;
  const referencePoints = graph.segments.flatMap((segment) => [segment.a, segment.b]);
  const candidates: AiShapeCandidate[] = [];
  const seen = new Set<string>();
  const randomStarts = graph.nodeGrid.nodes.filter((node) => (graph.edges.get(node.id) ?? []).length >= 2);

  for (let attempt = 0; attempt < matchConfig.aiShapeAttempts; attempt += 1) {
    const route = randomWalkCandidate(graph, targetDistanceMeters, randomStarts);
    if (route) {
      const signature = route.filter((_, index) => index % Math.max(1, Math.floor(route.length / 8)) === 0).map((node) => node.id).join('|');
      if (!seen.has(signature)) {
        seen.add(signature);
        const routeGeometry = expandRouteGeometry(graph, route);
        const routePoints = routeGeometry.map((point) => ({ x: point.x, y: point.y }));
        const reuseStats = routeReuseStats(route);
        const localShapeScore = localShapeCandidateScore(graph, route, routePoints, targetDistanceMeters);
        const routeLatLng = densifyLatLngRoute(
          routeGeometry.map((point) => ({ lat: point.lat, lng: point.lng })),
          center,
          matchConfig.maxRenderedSegmentMeters,
        );
        const routeDistanceMeters = graphDistance(route);
        candidates.push({
          anchorErrorMeters: localShapeScore,
          backtrackRatio: reuseStats.reverseEdgeRatio,
          localShapeScore,
          points: withPreviewPoints(routeLatLng, center, referencePoints),
          reuseRatio: reuseStats.undirectedReuseRatio,
          rank: candidates.length + 1,
          routeDistanceMeters,
          score: localShapeScore,
          segmentRepairCount: 0,
          shapeErrorMeters: localShapeScore,
          startOffsetMeters: Math.hypot(route[0].x, route[0].y),
          targetPoints: [],
          uniqueNodeRatio: reuseStats.uniqueNodeRatio,
          worstSegmentErrorMeters: localShapeScore,
        });
      }
    }

    if ((attempt + 1) % 25 === 0 || attempt === matchConfig.aiShapeAttempts - 1) {
      onProgress(progressLabel + ': ' + String(attempt + 1) + '/' + String(matchConfig.aiShapeAttempts));
      await waitForPaint();
    }
  }

  return candidates
    .sort((a, b) => a.localShapeScore - b.localShapeScore)
    .slice(0, matchConfig.aiShapeCandidateCount)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

function escapeSvgText(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  }[character] ?? character));
}

function contactSheetPath(points: RoutePoint[], x: number, y: number, size: number) {
  if (points.length < 2) return '';

  const bounds = boundsOf(points);
  const width = Math.max(bounds.maxX - bounds.minX, 0.001);
  const height = Math.max(bounds.maxY - bounds.minY, 0.001);
  const scale = size * 0.72 / Math.max(width, height);
  const offsetX = x + size / 2 - (bounds.minX + width / 2) * scale;
  const offsetY = y + size / 2 - (bounds.minY + height / 2) * scale;

  return points.map((point, index) => {
    const command = index === 0 ? 'M' : 'L';
    return command + (point.x * scale + offsetX).toFixed(1) + ' ' + (point.y * scale + offsetY).toFixed(1);
  }).join(' ');
}

function localizedShapeName(name: string, language: Language) {
  if (language !== "cs") return name;

  const names: Record<string, string> = {
    arrow: "sipka",
    bridge: "most",
    bolt: "blesk",
    bracket: "zavorka",
    candle: "svicka",
    chair: "zidle",
    comb: "hreben",
    cross: "kriz",
    flag: "vlajka",
    fork: "vidlicka",
    gate: "brana",
    hammer: "kladivo",
    hook: "hak",
    key: "klic",
    kite: "drak",
    ladder: "zebrik",
    leaf: "list",
    loop: "smycka",
    moon: "mesic",
    needle: "jehla",
    ring: "kruh",
    ribbon: "stuha",
    sail: "plachta",
    snake: "had",
    tower: "vez",
    wave: "vlna",
    zigzag: "klikatice",
  };

  return names[name] ?? name;
}

function candidateFallbackNames(candidate: RouteCandidateOption, language: Language) {
  const points = candidate.points.length > 6 ? resample(candidate.points, 72) : candidate.points;
  if (points.length < 3) return [localizedShapeName("hook", language)];

  const bounds = boundsOf(points);
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  const diagonal = Math.hypot(width, height);
  const aspect = width / height;
  const closureRatio = localDistance(points[0], points[points.length - 1]) / Math.max(diagonal, 1);
  const areaRatio = polylineArea(points) / Math.max(width * height, 1);
  const turnScore = routeTurnScore(points);
  const aiCandidate = candidate as Partial<AiShapeCandidate>;
  const names: string[] = [];
  const add = (...items: string[]) => {
    items.forEach((item) => {
      if (!names.includes(item)) names.push(item);
    });
  };

  if (closureRatio < 0.16 && areaRatio > 0.42 && aspect > 0.72 && aspect < 1.38) add("ring", "moon", "loop");
  if (closureRatio < 0.24 && areaRatio > 0.26) add(aspect > 1.45 ? "leaf" : "loop", "ribbon", "kite");
  if ((aiCandidate.reuseRatio ?? 0) > 0.16) add("ladder", "comb", "gate");
  if (turnScore > 30 && areaRatio > 0.2) add("ribbon", "snake", "wave");
  if (turnScore > 30 && areaRatio < 0.14 && aspect > 1.35 && closureRatio > 0.42) add("zigzag", "bolt", "wave");
  if (aspect > 3.1) add(turnScore > 14 ? "snake" : "arrow", "bridge", "needle");
  if (aspect < 0.34) add("tower", "candle", "needle");
  if (closureRatio > 0.62 && turnScore > 16) add("hook", "bracket", "sail");
  if (areaRatio > 0.34) add("kite", "flag", "sail");
  if (turnScore > 18 && aspect > 1.4 && aspect < 2.8) add("key", "hammer", "fork");
  if (turnScore < 10 && aspect > 1.5) add("bridge", "needle", "arrow");
  if (turnScore < 12 && aspect < 0.7) add("candle", "tower", "flag");

  const catalog = [
    "hook",
    "flag",
    "key",
    "sail",
    "bolt",
    "wave",
    "fork",
    "hammer",
    "chair",
    "bracket",
    "bridge",
    "comb",
    "cross",
    "gate",
  ];
  const seed = Math.abs(Math.round(width * 13 + height * 17 + turnScore * 19 + areaRatio * 1000 + closureRatio * 997));
  for (let index = 0; index < catalog.length; index += 1) {
    add(catalog[(seed + index * 5) % catalog.length]);
  }

  return names.map((name) => localizedShapeName(name, language));
}

function candidateFallbackName(candidate: RouteCandidateOption, language: Language) {
  return candidateFallbackNames(candidate, language)[0];
}

function diversifyShapeLabels<T extends RouteCandidateOption>(candidates: T[], language: Language) {
  const labelCounts = new Map<string, number>();

  return candidates.map((candidate) => {
    const currentLabel = candidate.aiLabel ?? candidateFallbackName(candidate, language);
    const key = currentLabel.toLowerCase();
    const count = labelCounts.get(key) ?? 0;
    labelCounts.set(key, count + 1);

    if (count === 0) return { ...candidate, aiLabel: currentLabel };

    const replacement = candidateFallbackNames(candidate, language)
      .find((name) => !labelCounts.has(name.toLowerCase()));
    if (!replacement) return { ...candidate, aiLabel: currentLabel };

    labelCounts.set(replacement.toLowerCase(), 1);
    return { ...candidate, aiLabel: replacement };
  });
}

function normalizeShapeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function targetShapeTerms(query: string) {
  const normalized = normalizeShapeSearch(query);
  const terms = new Set(normalized.split(/\s+/).filter((term) => term.length >= 2));
  if (normalized) terms.add(normalized);

  Array.from(terms).forEach((term) => {
    if (term.endsWith("ies") && term.length > 4) terms.add(term.slice(0, -3) + "y");
    if (term.endsWith("es") && term.length > 3) terms.add(term.slice(0, -2));
    if (term.endsWith("s") && term.length > 3) terms.add(term.slice(0, -1));
  });

  const catTerms = ["cat", "cats", "kitten", "kitty", "feline", "kocka", "kocky", "kote", "kocici"];
  if (catTerms.some((term) => terms.has(term))) {
    ["cat", "kitten", "kitty", "feline", "kocka", "kote", "head", "face", "ears", "ear", "tail", "whiskers", "paw", "paws"].forEach((term) => terms.add(term));
  }

  return Array.from(terms);
}

function targetRecognitionScore(recognition: AiShapeRecognition | undefined, query: string) {
  const normalizedQuery = normalizeShapeSearch(query);
  if (!recognition || !normalizedQuery) return 0;

  const haystack = normalizeShapeSearch([
    recognition.label,
    recognition.description,
    recognition.reason,
  ].filter(Boolean).join(" "));
  if (!haystack) return 0;
  if (haystack.includes(normalizedQuery)) return 1;

  const haystackTokens = new Set(haystack.split(/\s+/));
  const hits = targetShapeTerms(query).filter((term) => haystackTokens.has(term));
  if (!hits.length) return 0;

  return Math.min(0.9, 0.45 + hits.length * 0.18);
}

function cleanAiShapeLabel(label: string | undefined, fallback: string) {
  if (!label) return fallback;

  const stripped = label
    .trim()
    .replace(/^shape\s+(resembling|like)\s+(an?\s+)?/i, "")
    .replace(/^route\s+(resembling|like)\s+(an?\s+)?/i, "")
    .replace(/^tvar\s+(pripominajici|podobny|jako)\s+/i, "")
    .replace(/^(a|an)\s+/i, "")
    .trim();
  const normalized = stripped.toLowerCase();
  const forbidden = new Set([
    "abstract route",
    "abstract shape",
    "generic route",
    "generic shape",
    "line",
    "path",
    "route",
    "shape",
    "street pattern",
    "unknown",
    "abstraktni trasa",
    "abstraktni tvar",
    "trasa",
    "tvar",
  ]);

  if (!normalized || forbidden.has(normalized) || normalized.includes("abstract")) return fallback;
  return stripped.slice(0, 32);
}

function svgDimensions(svg: string) {
  const width = Number(svg.match(/width="([0-9.]+)"/)?.[1] ?? 660);
  const height = Number(svg.match(/height="([0-9.]+)"/)?.[1] ?? 880);

  return { width, height };
}

function pointFromUnknown(value: unknown): Point | null {
  if (Array.isArray(value) && value.length >= 2) {
    const x = Number(value[0]);
    const y = Number(value[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const x = Number(record.x);
    const y = Number(record.y);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  }

  return null;
}

function normalizeAiVectorSketches(value: unknown): AiVectorSketch[] {
  const shapes = Array.isArray((value as { shapes?: unknown })?.shapes)
    ? (value as { shapes: unknown[] }).shapes
    : [];

  return shapes.flatMap((shape): AiVectorSketch[] => {
    if (!shape || typeof shape !== "object") return [];

    const record = shape as Record<string, unknown>;
    const label = typeof record.label === "string" && record.label.trim()
      ? record.label.trim().slice(0, 48)
      : "";
    const description = typeof record.description === "string" ? record.description.trim().slice(0, 220) : "";
    const rawStrokes = Array.isArray(record.strokes)
      ? record.strokes
      : Array.isArray(record.points)
        ? [record.points]
        : [];
    const strokes = rawStrokes
      .map((stroke) => Array.isArray(stroke)
        ? stroke.flatMap((point) => {
          const parsed = pointFromUnknown(point);
          return parsed ? [parsed] : [];
        })
        : [])
      .filter((stroke) => stroke.length >= 2);

    if (!label || !strokes.length) return [];
    return [{
      closed: Boolean(record.closed),
      description,
      label,
      strokes,
    }];
  });
}

async function svgToPngDataUrl(svg: string) {
  const { width, height } = svgDimensions(svg);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const image = new Image();

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not rasterize AI contact sheet."));
      image.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable.");

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function aiShapeContactSheetSvg(candidates: AiShapeCandidate[]) {
  const columns = 4;
  const cell = 240;
  const rows = Math.ceil(candidates.length / columns);
  const width = columns * cell;
  const height = rows * cell;
  const tiles = candidates.map((candidate, index) => {
    const x = index % columns * cell;
    const y = Math.floor(index / columns) * cell;
    return '<g><rect x="' + x + '" y="' + y + '" width="' + cell + '" height="' + cell + '" fill="white" stroke="#d4d4d8"/>'
      + '<text x="' + (x + 14) + '" y="' + (y + 26) + '" font-family="Arial" font-size="18" font-weight="700" fill="#111827">#' + candidate.rank + '</text>'
      + '<path d="' + contactSheetPath(candidate.points, x, y + 18, cell - 20) + '" fill="none" stroke="#111827" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>'
      + '</g>';
  }).join('');

  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '"><rect width="100%" height="100%" fill="white"/>' + tiles + '</svg>';
}

async function apiResponseError(response: Response, fallback: string) {
  const body = await response.text().catch(() => "");
  if (!body) return fallback;

  try {
    const json = JSON.parse(body) as { error?: string; message?: string };
    return json.error || json.message || fallback;
  } catch {
    return body.slice(0, 240) || fallback;
  }
}

async function recognizeShapeCandidatesWithAi(candidates: AiShapeCandidate[], language: Language, shapeQuery: string) {
  const endpoint = (import.meta.env.VITE_AI_SHAPE_API_URL as string | undefined)?.trim() || '/api/ai-recognize-shapes';
  const requestCandidates = candidates.slice(0, matchConfig.aiShapeMaxRequestCandidates);
  const requestedShapes = shapeQuery.trim();
  const contactSheetSvg = aiShapeContactSheetSvg(requestCandidates);
  const contactSheetImage = await svgToPngDataUrl(contactSheetSvg);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      candidates: requestCandidates.map((candidate) => ({
        backtrackPercent: Math.round(candidate.backtrackRatio * 100),
        distanceKm: Number((candidate.routeDistanceMeters / 1000).toFixed(2)),
        id: candidate.rank,
        localScore: Number(candidate.localShapeScore.toFixed(1)),
        reusedStreetPercent: Math.round(candidate.reuseRatio * 100),
        uniqueNodePercent: Math.round(candidate.uniqueNodeRatio * 100),
      })),
      contactSheetImage,
      contactSheetSvg,
      language,
      shapeQuery: requestedShapes,
    }),
  });

  if (!response.ok) throw new Error(await apiResponseError(response, 'AI shape recognition is unavailable.'));
  const json = await response.json() as { results?: AiShapeRecognition[] };
  return Array.isArray(json.results) ? json.results : [];
}

async function generateAiVectorSketches(shapeQuery: string, language: Language) {
  const endpoint = (import.meta.env.VITE_AI_VECTOR_SHAPE_API_URL as string | undefined)?.trim() || '/api/ai-generate-shapes';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      count: matchConfig.aiVectorShapeLimit,
      language,
      shapeQuery,
    }),
  });

  if (!response.ok) throw new Error(await apiResponseError(response, 'AI vector sketch generation is unavailable.'));
  const json = await response.json() as unknown;
  return normalizeAiVectorSketches(json);
}

async function generateAiShapeVariants(shapeQuery: string, language: Language) {
  const sketches = await generateAiVectorSketches(shapeQuery, language);
  return aiVectorSketchVariants(sketches);
}

function nameAiShapeCandidates(candidates: AiShapeCandidate[], language: Language) {
  return diversifyShapeLabels(candidates.map((candidate) => ({
    ...candidate,
    aiConfidence: candidate.aiConfidence ?? 0,
    aiLabel: candidate.aiLabel ?? candidateFallbackName(candidate, language),
  })), language);
}

function weakTargetDescription(shapeQuery: string, language: Language) {
  return language === "cs"
    ? "AI nenaslo presvedcivou shodu pro " + shapeQuery + "; toto je jen nejblizsi kandidat podle tvaru trasy."
    : "AI did not find a convincing " + shapeQuery + "; this is only the closest route candidate by silhouette.";
}

function mergeAiShapeRecognitions(candidates: AiShapeCandidate[], recognitions: AiShapeRecognition[], language: Language, shapeQuery: string) {
  const recognitionById = new Map(recognitions.map((recognition) => [recognition.id, recognition]));
  const requestedShape = shapeQuery.trim();
  const hasTarget = Boolean(requestedShape);

  const mapped = candidates
    .map((candidate) => {
      const recognition = recognitionById.get(candidate.rank);
      const confidence = typeof recognition?.confidence === 'number'
        ? Math.max(0, Math.min(1, recognition.confidence))
        : undefined;
      const targetTextScore = targetRecognitionScore(recognition, requestedShape);
      const aiTargetConfidence = typeof recognition?.targetConfidence === 'number'
        ? Math.max(0, Math.min(1, recognition.targetConfidence))
        : targetTextScore;
      const targetEvidence = recognition?.matchesTarget === true || targetTextScore >= 0.45;
      const matchesTarget = hasTarget
        && targetEvidence
        && aiTargetConfidence >= matchConfig.aiShapeTargetConfidenceMin;
      const fallbackLabel = candidateFallbackName(candidate, language);
      const qualityDrag = candidate.reuseRatio * 180
        + candidate.backtrackRatio * 240
        + Math.max(0, matchConfig.aiShapeMinUniqueNodeRatio - candidate.uniqueNodeRatio) * 220;
      const effectiveConfidence = hasTarget
        ? Math.max(0, aiTargetConfidence - candidate.reuseRatio * 0.65 - candidate.backtrackRatio * 0.9)
        : typeof confidence === 'number'
          ? Math.max(0, confidence - candidate.reuseRatio * 0.6 - candidate.backtrackRatio * 0.8)
          : 0;
      const targetPenalty = hasTarget
        ? matchesTarget
          ? -aiTargetConfidence * 1450 - targetTextScore * 220
          : 3200 + Math.max(0, matchConfig.aiShapeTargetConfidenceMin - aiTargetConfidence) * 900
        : 0;
      const aiDescription = recognition?.description?.trim() || recognition?.reason?.trim() || undefined;

      return {
        ...candidate,
        aiConfidence: hasTarget ? aiTargetConfidence : confidence ?? 0,
        aiDescription: hasTarget && !matchesTarget ? weakTargetDescription(requestedShape, language) : aiDescription,
        aiLabel: hasTarget && !matchesTarget
          ? requestedShape.slice(0, 32)
          : cleanAiShapeLabel(recognition?.label, fallbackLabel),
        aiMatchesTarget: matchesTarget,
        aiReason: recognition?.reason?.trim() || undefined,
        aiTargetConfidence,
        score: candidate.localShapeScore + qualityDrag + targetPenalty - effectiveConfidence * 180,
      };
    })
    .sort((a, b) => a.score - b.score)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

  const ranked = hasTarget ? mapped : diversifyShapeLabels(mapped, language);
  if (!hasTarget) return ranked;

  const targetMatches = ranked.filter((candidate) => candidate.aiMatchesTarget);
  return (targetMatches.length ? targetMatches : ranked.slice(0, Math.min(8, ranked.length)))
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

async function roadMatchedRoute(
  graph: RoadGraph,
  variants: ShapeVariant[],
  center: LatLng,
  kilometers: number,
  onProgress: (message: string) => void = () => undefined,
  progressLabels: MatchProgressLabels = {
    choosingBest: translations.en.progress.choosingBest,
    mapMatching: translations.en.progress.mapMatching,
    scoringPlacements: translations.en.progress.scoringPlacements,
    stitching: translations.en.progress.stitching,
  },
  options: RoadMatchOptions = {},
) {
  const startRangeMeters = options.startRangeMeters ?? startSearchRadiusMeters(kilometers);
  const targetDistanceMeters = kilometers * 1000;
  const segmentBudgetMeters = Math.max(matchConfig.minSegmentBudgetMeters, targetDistanceMeters / matchConfig.segmentBudgetDivisor);
  const scales = matchConfig.scales;
  const rotations = matchConfig.rotations;
  const anchors = startAnchors(startRangeMeters);
  const primaryBaseTargets = targetMeters(variants[0]?.points ?? [{ x: 0, y: 0 }, { x: 1, y: 0 }], kilometers);

  type RawPlacementCandidate = Omit<PlacementCandidate, "primaryTargets" | "targets"> & {
    baseTargets: Point[];
    coarseTargets: Point[];
    offset: Point;
    rotation: number;
    scale: number;
    scoringTargets: Point[];
  };

  type MatchedPlacementCandidate = PlacementCandidate & { score: number; route: GraphNode[] };
  type MatchedRawPlacementCandidate = RawPlacementCandidate & { score: number; route: GraphNode[] };

  const rawCandidates: RawPlacementCandidate[] = [];
  let lastProgressAt = 0;

  async function reportProgress(label: string, done: number, total: number, force = false) {
    const now = performance.now();
    if (!force && done < total && now - lastProgressAt < 90) return;

    lastProgressAt = now;
    onProgress(`${label}: ${done}/${total}`);
    await waitForPaint();
  }

  function createPlacedRawCandidate(
    variant: ShapeVariant,
    baseTargets: Point[],
    scoringTargets: Point[],
    baseCoarseTargets: Point[],
    scale: number,
    rotation: number,
    offset: Point,
    shapePenalty: number,
  ): RawPlacementCandidate {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const transformedStart = transformPointWithTrig(baseTargets[0], scale, cos, sin, offset);

    return {
      baseTargets,
      coarseTargets: transformPointsWithTrig(baseCoarseTargets, scale, cos, sin, offset),
      offset,
      rotation,
      scale,
      scoringTargets,
      startDrift: Math.hypot(transformedStart.x, transformedStart.y),
      shapePenalty,
      rotationPenalty: rotationPreferencePenalty(rotation),
      variantDescription: variant.description,
      variantIsAi: variant.aiGeneratedSketch,
      variantName: variant.name,
    };
  }

  function createRawCandidate(
    variant: ShapeVariant,
    baseTargets: Point[],
    scoringTargets: Point[],
    baseCoarseTargets: Point[],
    scale: number,
    rotation: number,
    startAnchor: Point,
    shapePenalty: number,
  ): RawPlacementCandidate {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const start = baseTargets[0];
    const rotatedStart = {
      x: (start.x * cos - start.y * sin) * scale,
      y: (start.x * sin + start.y * cos) * scale,
    };
    const offset = {
      x: startAnchor.x - rotatedStart.x,
      y: startAnchor.y - rotatedStart.y,
    };

    return createPlacedRawCandidate(
      variant,
      baseTargets,
      scoringTargets,
      baseCoarseTargets,
      scale,
      rotation,
      offset,
      shapePenalty,
    );
  }

  function materializePlacementCandidate(candidate: RawPlacementCandidate): PlacementCandidate {
    const { baseTargets, coarseTargets: _coarseTargets, offset, rotation, scale, scoringTargets, ...details } = candidate;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    return {
      ...details,
      primaryTargets: transformPointsWithTrig(scoringTargets, scale, cos, sin, offset),
      targets: transformPointsWithTrig(baseTargets, scale, cos, sin, offset),
    };
  }

  const roadSeedPathCache = new Map<string, RoadSeedPath[]>();

  function cachedRoadSeedPaths(windowLength: number) {
    const bucket = Math.round(windowLength / 80) * 80;
    const key = String(Math.max(matchConfig.seededPlacementMinWindowMeters, bucket));
    const cached = roadSeedPathCache.get(key);
    if (cached) return cached;

    const paths = roadSeedPathsForWindow(graph, Number(key));
    roadSeedPathCache.set(key, paths);
    return paths;
  }

  function addSeededPlacementCandidates(
    variant: ShapeVariant,
    baseTargets: Point[],
    scoringTargets: Point[],
    baseCoarseTargets: Point[],
  ) {
    const windows = seededShapeWindows(baseTargets);
    if (!windows.length) return;

    const matches: SeededPlacementMatch[] = [];
    const perWindowLimit = Math.max(4, Math.ceil(matchConfig.seededPlacementCandidateLimit / windows.length));

    windows.forEach((window) => {
      cachedRoadSeedPaths(window.length)
        .flatMap((path) => {
          const match = scoreSeededPlacement(window, path);
          return match ? [match] : [];
        })
        .sort((a, b) => a.score - b.score)
        .slice(0, perWindowLimit)
        .forEach((match) => matches.push(match));
    });

    const seen = new Set<string>();
    let added = 0;
    matches
      .sort((a, b) => a.score - b.score)
      .some((match) => {
        if (added >= matchConfig.seededPlacementCandidateLimit) return true;

        const key = [
          Math.round(match.scale * 1000),
          Math.round(match.rotation * 180 / Math.PI),
          Math.round(match.offset.x / 25),
          Math.round(match.offset.y / 25),
        ].join('|');
        if (seen.has(key)) return false;
        seen.add(key);

        rawCandidates.push(createPlacedRawCandidate(
          variant,
          baseTargets,
          scoringTargets,
          baseCoarseTargets,
          match.scale,
          match.rotation,
          match.offset,
          variant.penalty
            + matchConfig.seededPlacementBasePenalty
            + Math.max(0, match.score) * matchConfig.seededPlacementPenaltyWeight,
        ));
        added += 1;
        return false;
      });
  }

  variants.forEach((variant) => {
    const baseTargets = targetMeters(variant.points, kilometers);
    const baseCoarseTargets = resample(baseTargets, matchConfig.coarsePlacementSamples);
    const scoringTargets = variant.aiGeneratedSketch ? baseTargets : primaryBaseTargets;

    for (const scale of scales) {
      for (const rotation of rotations) {
        for (const startAnchor of anchors) {
          rawCandidates.push(createRawCandidate(
            variant,
            baseTargets,
            scoringTargets,
            baseCoarseTargets,
            scale,
            rotation,
            startAnchor,
            variant.penalty,
          ));
        }
      }
    }

    addSeededPlacementCandidates(variant, baseTargets, scoringTargets, baseCoarseTargets);

    for (let index = 0; index < matchConfig.randomCandidatesPerVariant; index += 1) {
      const scale = matchConfig.randomScaleMin + Math.random() * (matchConfig.randomScaleMax - matchConfig.randomScaleMin);
      const rotation = Math.random() * Math.PI * 2;
      rawCandidates.push(createRawCandidate(
        variant,
        baseTargets,
        scoringTargets,
        baseCoarseTargets,
        scale,
        rotation,
        randomStartAnchor(startRangeMeters),
        variant.penalty + 120,
      ));
    }
  });

  function scorePlacementCandidate<T extends { rotationPenalty: number; shapePenalty: number; startDrift: number }>(
    candidate: T,
    targets: Point[],
  ): T & { score: number; route: GraphNode[] } | null {
    const route: GraphNode[] = [];
    const uniqueNodeIds = new Set<string>();
    let snapTotal = 0;
    let jumpTotal = 0;
    let previousRouteNode: GraphNode | null = null;

    for (const target of targets) {
      const snapped = nearestNode(graph, target);
      snapTotal += snapped.distance;
      const node = snapped.node;
      if (!node) continue;

      uniqueNodeIds.add(node.id);
      if (node.id === previousRouteNode?.id) continue;

      if (previousRouteNode) {
        jumpTotal += Math.max(0, Math.hypot(node.x - previousRouteNode.x, node.y - previousRouteNode.y) - 320);
      }
      route.push(node);
      previousRouteNode = node;
    }

    if (route.length < 4) return null;

    const snapPenalty = snapTotal / targets.length;
    const jumpPenalty = jumpTotal / Math.max(route.length - 1, 1);
    const duplicatePenalty = (targets.length - uniqueNodeIds.size) * matchConfig.duplicateWaypointPenalty;
    const startOffset = Math.hypot(route[0].x, route[0].y);
    const startPenalty = Math.max(0, startOffset - startRangeMeters) * matchConfig.outsideStartPenalty;
    const score = snapPenalty * matchConfig.snapPenaltyWeight
      + jumpPenalty * matchConfig.jumpPenaltyWeight
      + duplicatePenalty
      + startPenalty
      + candidate.startDrift * matchConfig.startDriftPenalty
      + candidate.rotationPenalty
      + candidate.shapePenalty;

    return { ...candidate, score, route };
  }

  const coarseScored: MatchedRawPlacementCandidate[] = [];
  await reportProgress(progressLabels.scoringPlacements, 0, rawCandidates.length, true);
  for (let index = 0; index < rawCandidates.length; index += 1) {
    const candidate = rawCandidates[index];
    const scored = scorePlacementCandidate(candidate, candidate.coarseTargets);
    if (scored) coarseScored.push(scored);

    if ((index + 1) % 160 === 0 || index === rawCandidates.length - 1) {
      await reportProgress(progressLabels.scoringPlacements, index + 1, rawCandidates.length);
    }
  }

  function coarseCandidateKey(candidate: RawPlacementCandidate) {
    return [
      candidate.variantName ?? "",
      candidate.variantDescription ?? "",
      String(candidate.variantIsAi),
      String(candidate.shapePenalty),
    ].join("|");
  }

  function selectCoarsePlacementCandidates(candidates: MatchedRawPlacementCandidate[]) {
    const sorted = [...candidates].sort((a, b) => a.score - b.score);
    const selected: MatchedRawPlacementCandidate[] = [];
    const selectedKeys = new Set<string>();
    const perVariantCounts = new Map<string, number>();

    function addCandidate(candidate: MatchedRawPlacementCandidate) {
      const key = [
        coarseCandidateKey(candidate),
        String(candidate.scale),
        String(candidate.rotation),
        String(candidate.offset.x),
        String(candidate.offset.y),
      ].join("|");
      if (selectedKeys.has(key) || selected.length >= matchConfig.coarsePlacementCandidateLimit) return;

      selectedKeys.add(key);
      selected.push(candidate);
    }

    for (const candidate of sorted) {
      const variantKey = coarseCandidateKey(candidate);
      const count = perVariantCounts.get(variantKey) ?? 0;
      if (count >= matchConfig.coarsePlacementVariantLimit) continue;

      perVariantCounts.set(variantKey, count + 1);
      addCandidate(candidate);
    }

    for (const candidate of sorted) {
      addCandidate(candidate);
    }

    return selected;
  }

  const coarsePreselected = selectCoarsePlacementCandidates(coarseScored);

  const rawScored: MatchedPlacementCandidate[] = [];
  await reportProgress(progressLabels.scoringPlacements, 0, coarsePreselected.length, true);
  for (let index = 0; index < coarsePreselected.length; index += 1) {
    const candidate = materializePlacementCandidate(coarsePreselected[index]);
    const scored = scorePlacementCandidate(candidate, candidate.targets);
    if (scored) rawScored.push(scored);

    if ((index + 1) % 40 === 0 || index === coarsePreselected.length - 1) {
      await reportProgress(progressLabels.scoringPlacements, index + 1, coarsePreselected.length);
    }
  }

  const rawPreselected = rawScored
    .sort((a, b) => a.score - b.score)
    .slice(0, matchConfig.rawPreselectCandidates);

  const rawMatched: MatchedPlacementCandidate[] = [];
  await reportProgress(progressLabels.mapMatching, 0, rawPreselected.length, true);
  for (let index = 0; index < rawPreselected.length; index += 1) {
    const candidate = rawPreselected[index];
    const matched = graphAwareWaypointRoute(graph, candidate.targets);
    rawMatched.push(matched
      ? {
        ...candidate,
        route: matched.route,
        score: candidate.score * 0.35
          + matched.score * 0.65
          + matched.duplicatePenalty
          + candidate.rotationPenalty
          + candidate.shapePenalty,
      }
      : { ...candidate, score: candidate.score + 400 });

    if ((index + 1) % 16 === 0 || index === rawPreselected.length - 1) {
      await reportProgress(progressLabels.mapMatching, index + 1, rawPreselected.length);
    }
  }

  const rawRanked = rawMatched
    .sort((a, b) => a.score - b.score)
    .slice(0, matchConfig.topCandidates);

  type RankedRouteCandidate = {
    routeDistance: number;
    score: number;
    route: GraphNode[];
    segmentRepairCount: number;
    segmentWindows: ShapeSegmentWindow[];
    shapeScore: ShapeScore;
    targetPoints: Point[];
    worstSegmentError: number;
    variantName?: string;
    variantDescription?: string;
    variantIsAi?: boolean;
  };

  let segmentRepairsTried = 0;
  const stitchedPathCache = new Map<string, GraphNode[] | null>();

  function evaluateRouteCandidate(
    candidate: PlacementCandidate & { score: number; route: GraphNode[] },
    route: GraphNode[],
    segmentRepairCount = 0,
  ): RankedRouteCandidate | null {
    const stitched = stitchWalkableRoute(
      graph,
      route,
      segmentBudgetMeters * (segmentRepairCount ? matchConfig.segmentRepairBudgetBoost : 1),
      stitchedPathCache,
    );
    if (!stitched) return null;

    const routeDistance = graphDistance(stitched.route);
    const routeShapePoints = expandRouteGeometry(graph, stitched.route).map((point) => ({ x: point.x, y: point.y }));
    const scoringRoute = routeShapePoints.length >= 2 ? routeShapePoints : stitched.route;
    const shapeScore = scoreRouteAgainstShape(scoringRoute, candidate.primaryTargets);
    const segmentWindows = shapeSegmentWindows(scoringRoute, candidate.primaryTargets);
    const worstSegmentError = segmentWindows[0]?.score ?? shapeScore.meanError;
    const severeShortfall = Math.max(0, targetDistanceMeters * matchConfig.minRouteDistanceRatio - routeDistance);
    const distancePenalty = Math.abs(routeDistance - targetDistanceMeters) * matchConfig.distancePenaltyWeight
      + severeShortfall * matchConfig.shortRoutePenaltyWeight;
    const detailPenalty = Math.max(0, stitched.route.length - 420) * 0.45;
    const skippedPenalty = stitched.skippedWaypoints * matchConfig.skippedWaypointPenalty;
    const startOffset = Math.hypot(stitched.route[0].x, stitched.route[0].y);
    const startPenalty = Math.max(0, startOffset - startRangeMeters) * matchConfig.outsideStartPenalty
      + startOffset * matchConfig.stitchedStartPenalty;
    const qualityPenalty = routeQualityPenalty(graph, stitched.route).penalty * matchConfig.finalQualityPenaltyWeight;
    const score = shapeScore.total
      + candidate.score * matchConfig.rawCandidateScoreWeight
      + distancePenalty
      + detailPenalty
      + skippedPenalty * 0.35
      + startPenalty
      + qualityPenalty
      + segmentRepairCount * matchConfig.segmentRepairPenalty;

    return {
      routeDistance,
      score,
      route: stitched.route,
      segmentRepairCount,
      segmentWindows,
      shapeScore,
      targetPoints: candidate.primaryTargets,
      worstSegmentError,
      variantDescription: candidate.variantDescription,
      variantIsAi: candidate.variantIsAi,
      variantName: candidate.variantName,
    };
  }

  function repairWeakSegments(
    candidate: PlacementCandidate & { score: number; route: GraphNode[] },
    base: RankedRouteCandidate,
  ) {
    const badWindows = base.segmentWindows
      .filter((window) => window.score >= matchConfig.segmentRepairMinErrorMeters)
      .slice(0, matchConfig.segmentRepairWindowLimit);
    if (!badWindows.length) return [];

    const repairSets = badWindows.map((window) => [window]);
    if (badWindows.length > 1) repairSets.push(badWindows);

    return repairSets.flatMap((windows) => {
      const repairTargets = repairTargetsForWindows(candidate.primaryTargets, windows);
      if (repairTargets.length <= candidate.primaryTargets.length) return [];

      segmentRepairsTried += 1;
      const matched = graphAwareWaypointRoute(graph, repairTargets);
      if (!matched) return [];

      const repaired = evaluateRouteCandidate(candidate, matched.route, windows.length);
      return repaired ? [repaired] : [];
    });
  }

  const rankedRoutes: RankedRouteCandidate[] = [];
  await reportProgress(progressLabels.stitching, 0, rawRanked.length, true);
  for (let index = 0; index < rawRanked.length; index += 1) {
    const candidate = rawRanked[index];
    const base = evaluateRouteCandidate(candidate, candidate.route);
    if (base) {
      rankedRoutes.push(base);
      if (index < matchConfig.segmentRepairCandidateLimit) {
        rankedRoutes.push(...repairWeakSegments(candidate, base));
      }
    }

    if ((index + 1) % 4 === 0 || index === rawRanked.length - 1) {
      await reportProgress(progressLabels.stitching, index + 1, rawRanked.length);
    }
  }
  rankedRoutes.sort((a, b) => a.score - b.score);
  await reportProgress(progressLabels.choosingBest, rankedRoutes.length, rankedRoutes.length, true);

  const chosenCandidate = chooseRouteCandidate(rankedRoutes);
  const bestCandidate = chosenCandidate.candidate;
  const fallbackRoute = fallbackWalkableRoute(graph, center, kilometers);
  const shouldUseFallback = Boolean(fallbackRoute && !bestCandidate);
  const referencePoints = graph.segments.flatMap((segment) => [segment.a, segment.b]);

  function candidateRouteLatLng(candidate: RankedRouteCandidate) {
    return densifyLatLngRoute(
      expandRouteGeometry(graph, candidate.route).map((point) => ({ lat: point.lat, lng: point.lng })),
      center,
      matchConfig.maxRenderedSegmentMeters,
    );
  }

  function candidateTargetLatLng(candidate: RankedRouteCandidate) {
    return resample(candidate.targetPoints, 260).map((point) => ({ ...point, ...fromMeters(point, center) }));
  }

  function toCandidateOption(candidate: RankedRouteCandidate): RouteCandidateOption {
    const routeLatLng = candidateRouteLatLng(candidate);
    return {
      aiConfidence: candidate.variantIsAi ? 1 : undefined,
      aiDescription: candidate.variantIsAi ? candidate.variantDescription : undefined,
      aiGeneratedSketch: candidate.variantIsAi,
      aiLabel: candidate.variantIsAi ? candidate.variantName : undefined,
      anchorErrorMeters: candidate.shapeScore.anchorError,
      points: withPreviewPoints(routeLatLng, center, referencePoints),
      rank: rankedRoutes.indexOf(candidate) + 1,
      routeDistanceMeters: candidate.routeDistance,
      score: candidate.score,
      segmentRepairCount: candidate.segmentRepairCount,
      shapeErrorMeters: candidate.shapeScore.meanError,
      startOffsetMeters: Math.hypot(candidate.route[0].x, candidate.route[0].y),
      targetPoints: candidateTargetLatLng(candidate),
      worstSegmentErrorMeters: candidate.worstSegmentError,
    };
  }

  const displayedRankedRoutes = rankedRoutes.slice(0, matchConfig.candidateDisplayLimit);
  if (bestCandidate && !displayedRankedRoutes.includes(bestCandidate)) {
    displayedRankedRoutes.push(bestCandidate);
    displayedRankedRoutes.sort((a, b) => a.score - b.score);
  }
  const candidateOptions = displayedRankedRoutes.map(toCandidateOption);
  const selectedCandidateIndex = Math.max(
    0,
    candidateOptions.findIndex((candidate) => candidate.rank === chosenCandidate.selectedRank),
  );
  const selectedOption = candidateOptions[selectedCandidateIndex] ?? null;
  const bestRoute = shouldUseFallback ? fallbackRoute : bestCandidate?.route ?? null;
  const fallbackRouteLatLng = bestRoute && !selectedOption
    ? densifyLatLngRoute(
      expandRouteGeometry(graph, bestRoute).map((point) => ({ lat: point.lat, lng: point.lng })),
      center,
      matchConfig.maxRenderedSegmentMeters,
    )
    : [];
  const startOffsetMeters = selectedOption?.startOffsetMeters ?? (bestRoute ? Math.hypot(bestRoute[0].x, bestRoute[0].y) : 0);

  return {
    anchorErrorMeters: selectedOption?.anchorErrorMeters ?? bestCandidate?.shapeScore.anchorError,
    candidates: candidateOptions,
    distanceFallbackUsed: false,
    fallbackUsed: !bestCandidate && shouldUseFallback,
    choicePoolSize: chosenCandidate.poolSize,
    points: selectedOption?.points ?? withPreviewPoints(fallbackRouteLatLng, center, referencePoints),
    rankedRoutes: rankedRoutes.length,
    selectedCandidateIndex,
    selectedRouteRank: selectedOption?.rank ?? chosenCandidate.selectedRank,
    selectedSegmentRepairs: selectedOption?.segmentRepairCount ?? bestCandidate?.segmentRepairCount ?? 0,
    segmentRepairsTried,
    shapeErrorMeters: selectedOption?.shapeErrorMeters ?? bestCandidate?.shapeScore.meanError,
    startOffsetMeters,
    targetPoints: selectedOption?.targetPoints ?? [],
    worstSegmentErrorMeters: selectedOption?.worstSegmentErrorMeters ?? bestCandidate?.worstSegmentError,
  };
}

function activeRoutingProvider(): RoutingProvider {
  return (import.meta.env.VITE_ROUTING_PROVIDER as string | undefined)?.trim().toLowerCase() === "mapy"
    ? "mapy"
    : "local";
}

function mapyRouteType() {
  return (import.meta.env.VITE_MAPY_ROUTE_TYPE as string | undefined)?.trim() || "foot_fast";
}

function mapyCoordinate(point: LatLng) {
  return `${point.lng.toFixed(7)},${point.lat.toFixed(7)}`;
}

function mapyGeometryCoordinates(geometry: MapyRouteResponse["geometry"]) {
  if (!geometry) return null;
  const line = geometry.type === "Feature" ? geometry.geometry : geometry;
  if (!line || line.type !== "LineString" || !Array.isArray(line.coordinates)) return null;

  return line.coordinates.filter((coordinate): coordinate is [number, number] => (
    Array.isArray(coordinate)
    && coordinate.length >= 2
    && Number.isFinite(coordinate[0])
    && Number.isFinite(coordinate[1])
  ));
}

async function mapyMatchedRoute(variants: ShapeVariant[], center: LatLng, kilometers: number, language: Language) {
  const apiKey = (import.meta.env.VITE_MAPY_API_KEY as string | undefined)?.trim();
  if (!apiKey) throw new Error(translations[language].status.mapyMissingKey);

  const routeType = mapyRouteType();
  const variant = variants[0];
  const waypointCount = Math.min(Math.max(Math.round(matchConfig.mapyRouteWaypointCount), 0), 15);
  const controls = projectToLatLng(resample(variant.points, waypointCount + 2), center, kilometers);
  if (controls.length < 2) throw new Error(translations[language].status.drawLongerPath);

  const start = controls[0];
  const end = controls[controls.length - 1];
  const waypoints = controls.slice(1, -1);
  const url = new URL("https://api.mapy.com/v1/routing/route");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("lang", language);
  url.searchParams.set("start", mapyCoordinate(start));
  url.searchParams.set("end", mapyCoordinate(end));
  waypoints.forEach((waypoint) => url.searchParams.append("waypoints", mapyCoordinate(waypoint)));
  url.searchParams.set("routeType", routeType);
  url.searchParams.set("format", "geojson");

  const response = await fetch(url.toString(), { mode: "cors" });
  const json = await response.json().catch(() => null) as MapyRouteResponse | null;
  if (!response.ok) {
    throw new Error(json?.message || `Mapy.com route planning failed (${response.status}).`);
  }

  const coordinates = mapyGeometryCoordinates(json?.geometry);
  if (!coordinates || coordinates.length < 2) throw new Error("Mapy.com route response did not include route geometry.");

  const points = coordinates.map(([lng, lat]) => {
    const point = { lat, lng };
    return { ...point, ...toMeters(point, center) };
  });
  const targetLocal = targetMeters(variant.points, kilometers);
  const routeLocal = points.map((point) => ({ x: point.x, y: point.y }));
  const shapeScore = scoreRouteAgainstShape(routeLocal, targetLocal);
  const segmentWindows = shapeSegmentWindows(routeLocal, targetLocal);
  const worstSegmentError = segmentWindows[0]?.score ?? shapeScore.meanError;
  const routeDistanceMeters = typeof json?.length === "number" ? json.length : routeStats(points).kilometers * 1000;
  const targetPoints = projectToLatLng(resample(variant.points, 160), center, kilometers);

  return {
    anchorErrorMeters: shapeScore.anchorError,
    controlPoints: controls.length,
    points,
    routeDistanceMeters,
    routeType,
    shapeErrorMeters: shapeScore.meanError,
    targetPoints,
    worstSegmentErrorMeters: worstSegmentError,
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

function finiteSavedPoint(value: unknown): Point | null {
  if (!value || typeof value !== "object") return null;

  const point = value as Partial<Point>;
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return { x, y };
}

function finiteSavedRoutePoint(value: unknown): RoutePoint | null {
  if (!value || typeof value !== "object") return null;

  const point = value as Partial<RoutePoint>;
  const x = Number(point.x);
  const y = Number(point.y);
  const lat = Number(point.lat);
  const lng = Number(point.lng);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return { x, y, lat, lng };
}

function savedPathFromUnknown(value: unknown): SavedPath | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const shapePoints = Array.isArray(record.shapePoints)
    ? record.shapePoints.map(finiteSavedPoint).filter((point): point is Point => Boolean(point))
    : [];
  const routePoints = Array.isArray(record.routePoints)
    ? record.routePoints.map(finiteSavedRoutePoint).filter((point): point is RoutePoint => Boolean(point))
    : [];
  if (shapePoints.length < 2) return null;

  const id = typeof record.id === "string" && record.id.trim() ? record.id : "saved-" + String(record.createdAt ?? Date.now());
  const fingerprint = typeof record.fingerprint === "string" && record.fingerprint.trim() ? record.fingerprint : id;
  const name = typeof record.name === "string" && record.name.trim() ? record.name.trim().slice(0, 48) : "saved path";
  const locationLabel = typeof record.locationLabel === "string" && record.locationLabel.trim()
    ? record.locationLabel.trim().slice(0, 80)
    : "Unknown location";
  const areaSquareMeters = Math.max(0, Number(record.areaSquareMeters) || 0);
  const distanceKm = Math.max(0, Number(record.distanceKm) || 0);
  const createdAt = Number(record.createdAt);
  const pointCount = Math.max(0, Math.round(Number(record.pointCount) || shapePoints.length));

  return {
    areaSquareMeters,
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    distanceKm,
    fingerprint,
    id,
    locationLabel,
    name,
    pointCount,
    routePoints: routePoints.length >= 2 ? routePoints : undefined,
    shapePoints: normalize(shapePoints),
  };
}

function sortSavedPaths(paths: SavedPath[]) {
  return [...paths].sort((a, b) => b.areaSquareMeters - a.areaSquareMeters || b.createdAt - a.createdAt);
}

function loadSavedPaths(): SavedPath[] {
  if (typeof window === "undefined") return [];

  try {
    const saved = window.localStorage.getItem(savedPathsKey);
    if (!saved) return [];

    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];

    return sortSavedPaths(
      parsed.map(savedPathFromUnknown).filter((path): path is SavedPath => Boolean(path)),
    ).slice(0, savedPathLimit);
  } catch {
    return [];
  }
}

function routeAreaSquareMeters(points: RoutePoint[]) {
  if (points.length < 2) return 0;

  const center = {
    lat: points.reduce((total, point) => total + point.lat, 0) / points.length,
    lng: points.reduce((total, point) => total + point.lng, 0) / points.length,
  };
  const local = points.map((point) => toMeters(point, center));
  const routeBounds = boundsOf(local);
  const width = Math.max(0, routeBounds.maxX - routeBounds.minX);
  const height = Math.max(0, routeBounds.maxY - routeBounds.minY);

  return width * height;
}

function routeShapePoints(points: RoutePoint[]) {
  const local = points
    .map((point) => ({ x: point.x, y: point.y }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (local.length < 2) return [];

  return normalize(resample(local, Math.min(160, Math.max(16, local.length))));
}

function savedRoutePoints(points: RoutePoint[]) {
  return points
    .filter((point) => (
      Number.isFinite(point.x)
      && Number.isFinite(point.y)
      && Number.isFinite(point.lat)
      && Number.isFinite(point.lng)
    ))
    .map((point) => ({
      x: point.x,
      y: point.y,
      lat: point.lat,
      lng: point.lng,
    }));
}

function savedPathRoute(path: SavedPath, fallbackCenter: LatLng) {
  if (path.routePoints?.length && path.routePoints.length >= 2) return path.routePoints;

  return projectToLatLng(path.shapePoints, fallbackCenter, Math.max(path.distanceKm, 0.1));
}

function savedPathFingerprint(points: RoutePoint[]) {
  if (points.length < 2) return "";

  const sampleCount = Math.min(18, points.length);
  return Array.from({ length: sampleCount }, (_, index) => {
    const sourceIndex = sampleCount === 1 ? 0 : Math.round(index * (points.length - 1) / (sampleCount - 1));
    const point = points[sourceIndex];
    return point.lat.toFixed(5) + "," + point.lng.toFixed(5);
  }).join("|");
}

function formatArea(squareMeters: number, language: Language) {
  const locale = language === "cs" ? "cs-CZ" : "en-US";
  if (squareMeters >= 1_000_000) {
    return (squareMeters / 1_000_000).toLocaleString(locale, {
      maximumFractionDigits: squareMeters >= 10_000_000 ? 1 : 2,
    }) + " km2";
  }

  return Math.round(squareMeters).toLocaleString(locale) + " m2";
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

function mergeDrawingStrokes(strokes: Point[][]) {
  const remaining = strokes
    .map((stroke) => compactDrawingPoints(stroke, 5))
    .filter((stroke) => stroke.length >= 2);
  if (!remaining.length) return [];

  let merged = [...remaining.shift()!];
  while (remaining.length) {
    const first = merged[0];
    const last = merged[merged.length - 1];
    let best = { distance: Number.POSITIVE_INFINITY, index: 0, mode: "append" as "append" | "appendReverse" | "prepend" | "prependReverse" };

    remaining.forEach((stroke, index) => {
      const strokeFirst = stroke[0];
      const strokeLast = stroke[stroke.length - 1];
      const options = [
        { distance: Math.hypot(last.x - strokeFirst.x, last.y - strokeFirst.y), mode: "append" as const },
        { distance: Math.hypot(last.x - strokeLast.x, last.y - strokeLast.y), mode: "appendReverse" as const },
        { distance: Math.hypot(first.x - strokeLast.x, first.y - strokeLast.y), mode: "prepend" as const },
        { distance: Math.hypot(first.x - strokeFirst.x, first.y - strokeFirst.y), mode: "prependReverse" as const },
      ];
      options.forEach((option) => {
        if (option.distance < best.distance) best = { ...option, index };
      });
    });

    const [stroke] = remaining.splice(best.index, 1);
    if (best.mode === "append") merged = [...merged, ...stroke];
    if (best.mode === "appendReverse") merged = [...merged, ...stroke.slice().reverse()];
    if (best.mode === "prepend") merged = [...stroke, ...merged];
    if (best.mode === "prependReverse") merged = [...stroke.slice().reverse(), ...merged];
  }

  return merged;
}

function drawingToPath(strokes: Point[][]) {
  const merged = mergeDrawingStrokes(strokes);
  if (merged.length < 4) return null;

  return normalize(merged.map((point) => ({
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
  const [language, setLanguage] = useState<Language>(loadSavedLanguage);
  const t = translations[language];
  const [description, setDescription] = useState("star");
  const [location, setLocation] = useState(savedLocation.location);
  const [selectedLocation, setSelectedLocation] = useState<LocationSuggestion | null>(savedLocation.selectedLocation);
  const [locationSuggestions, setLocationSuggestions] = useState<LocationSuggestion[]>([]);
  const [isSearchingLocations, setIsSearchingLocations] = useState(false);
  const [isLocationFocused, setIsLocationFocused] = useState(false);
  const [distanceKm, setDistanceKm] = useState(5);
  const [savedPaths, setSavedPaths] = useState<SavedPath[]>(loadSavedPaths);
  const [selectedSavedPathId, setSelectedSavedPathId] = useState<string | null>(null);
  const [aiShapeQuery, setAiShapeQuery] = useState(loadSavedAiShapeQuery);
  const [aiSketchSuggestions, setAiSketchSuggestions] = useState<ShapeVariant[]>([]);
  const [shapeInputMode, setShapeInputMode] = useState<ShapeInputMode>("draw");
  const [drawnPath, setDrawnPath] = useState<Point[] | null>(null);
  const [activeAiShape, setActiveAiShape] = useState<ShapeVariant | null>(null);
  const [drawingStrokes, setDrawingStrokes] = useState<Point[][]>([]);
  const [drawingPoints, setDrawingPoints] = useState<Point[]>([]);
  const [isDrawingShape, setIsDrawingShape] = useState(false);
  const [roadRoute, setRoadRoute] = useState<RoutePoint[] | null>(null);
  const [targetRoute, setTargetRoute] = useState<RoutePoint[] | null>(null);
  const [routeCandidates, setRouteCandidates] = useState<RouteCandidateOption[]>([]);
  const [selectedCandidateIndex, setSelectedCandidateIndex] = useState(0);
  const [hoveredCandidateIndex, setHoveredCandidateIndex] = useState<number | null>(null);
  const [roadSegments, setRoadSegments] = useState<RoadSegment[]>([]);
  const [cachedRoadTiles, setCachedRoadTiles] = useState<RoadTileArea[]>([]);
  const [roadCenter, setRoadCenter] = useState<LatLng | null>(null);
  const [roadStatus, setRoadStatus] = useState<string>(() => t.status.initial);
  const [isMatchingRoads, setIsMatchingRoads] = useState(false);
  const [isFindingShapes, setIsFindingShapes] = useState(false);
  const [matchPhase, setMatchPhase] = useState("");
  const [isMapLoading, setIsMapLoading] = useState(true);
  const [matchTiming, setMatchTiming] = useState<MatchTiming | null>(null);
  const [graphInfo, setGraphInfo] = useState<GraphInfo | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingStrokesRef = useRef<Point[][]>([]);
  const drawingPointsRef = useRef<Point[]>([]);
  const mapElementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const targetLayerRef = useRef<L.Polyline | null>(null);
  const routeLayerRef = useRef<L.Polyline | null>(null);
  const candidateLayerRef = useRef<L.LayerGroup | null>(null);
  const routeHoverLayerRef = useRef<L.LayerGroup | null>(null);
  const tileLayerRef = useRef<L.LayerGroup | null>(null);
  const roadLayerRef = useRef<L.LayerGroup | null>(null);
  const centerMarkerRef = useRef<L.CircleMarker | null>(null);
  const startMarkerRef = useRef<L.CircleMarker | null>(null);
  const endMarkerRef = useRef<L.CircleMarker | null>(null);
  const matchRequestRef = useRef(0);
  const roadGraphRef = useRef<RoadGraph | null>(null);

  const profileLabel = (profile: RoadQueryProfile) => profile.id === "compact" ? t.compactRoads : t.broadRoads;
  const sourceLabel = (source: string) => {
    if (source === "memory") return t.cacheMemory;
    if (source === "persistent") return t.cachePersistent;
    if (source === "network") return t.cacheNetwork;
    if (source === "mixed") return t.cacheMixed;
    return source;
  };
  const progressLabels = {
    choosingBest: t.progress.choosingBest,
    mapMatching: t.progress.mapMatching,
    scoringPlacements: t.progress.scoringPlacements,
    stitching: t.progress.stitching,
  };
  const graphPhaseMessages = {
    loadingOsm: (profile: RoadQueryProfile, radius: number) => t.graph.loadingOsm(profileLabel(profile), radius),
    restoringSaved: (profile: RoadQueryProfile, radius: number) => t.graph.restoringSaved(profileLabel(profile), radius),
    usingCached: (profile: RoadQueryProfile, radius: number) => t.graph.usingCached(profileLabel(profile), radius),
    tileProgress: (profile: RoadQueryProfile, current: number, total: number, cached: number, downloaded: number, failed: number) => (
      t.graph.tileProgress(profileLabel(profile), current, total, cached, downloaded, failed)
    ),
  };

  const sourceVariants = useMemo(
    () => activeAiShape ? selectedAiShapeVariants(activeAiShape) : shapeVariants(description, drawnPath),
    [activeAiShape, description, drawnPath],
  );
  const sourcePoints = sourceVariants[0].points;
  const templatePreviews = useMemo(
    () => templates.map((template) => ({
      name: template,
      points: pathPreviewPoints(templatePath(template)),
    })),
    [],
  );
  const aiSketchPreviews = useMemo(
    () => aiSketchSuggestions.map((suggestion) => ({
      description: suggestion.description,
      name: suggestion.name,
      points: pathPreviewPoints(suggestion.points),
    })),
    [aiSketchSuggestions],
  );
  const center = selectedLocation ?? parseLocation(location);
  const sketchRoute = useMemo(() => {
    const sampled = resample(sourcePoints, 280);
    return projectToLatLng(sampled, center, distanceKm);
  }, [sourcePoints, center.lat, center.lng, distanceKm]);
  const aiShapeTarget = aiShapeQuery.trim();
  const hasWalkableRoute = Boolean(roadRoute?.length);
  const route = roadRoute?.length ? roadRoute : sketchRoute;
  const selectedRouteCandidate = routeCandidates[selectedCandidateIndex] ?? null;
  const popularSavedPaths = useMemo(() => sortSavedPaths(savedPaths), [savedPaths]);
  const selectedAiDescription = selectedRouteCandidate?.aiLabel && selectedRouteCandidate.aiDescription
    ? selectedRouteCandidate.aiGeneratedSketch
      ? t.aiSketchDescription(selectedRouteCandidate.aiLabel, selectedRouteCandidate.aiDescription)
      : t.aiShapeDescription(
        selectedRouteCandidate.aiLabel,
        Math.round((selectedRouteCandidate.aiConfidence ?? 0) * 100),
        selectedRouteCandidate.aiDescription,
      )
    : "";
  const startSearchMeters = startSearchRadiusMeters(distanceKm);
  const stats = routeStats(route);
  const bounds = {
    north: Math.max(...route.map((point) => point.lat)),
    south: Math.min(...route.map((point) => point.lat)),
    east: Math.max(...route.map((point) => point.lng)),
    west: Math.min(...route.map((point) => point.lng)),
  };
  const isRouteBusy = isMatchingRoads || isFindingShapes;
  const mapOverlayText = isRouteBusy
      ? matchPhase || t.calculatingWalkableRoute
      : isMapLoading
        ? t.loadingMapTiles
        : "";

  function clearRoadMatch() {
    matchRequestRef.current += 1;
    setSelectedSavedPathId(null);
    setRoadRoute(null);
    setTargetRoute(null);
    setRouteCandidates([]);
    setSelectedCandidateIndex(0);
    setHoveredCandidateIndex(null);
    setRoadSegments([]);
    setCachedRoadTiles([]);
    roadGraphRef.current = null;
    setRoadCenter(null);
    setMatchTiming(null);
    setGraphInfo(null);
    setAiSketchSuggestions([]);
    setMatchPhase("");
    setIsMatchingRoads(false);
    setIsFindingShapes(false);
    setRoadStatus(t.status.inputsChanged);
  }

  function setDrawingStroke(points: Point[]) {
    drawingPointsRef.current = points;
    setDrawingPoints(points);
  }

  function setFinishedDrawingStrokes(strokes: Point[][]) {
    drawingStrokesRef.current = strokes;
    setDrawingStrokes(strokes);
  }

  function resetDrawing() {
    setFinishedDrawingStrokes([]);
    setDrawingStroke([]);
    setDrawnPath(null);
    setActiveAiShape(null);
  }

  function activateAiShape(variant: ShapeVariant) {
    const selected = {
      ...variant,
      aiGeneratedSketch: true,
      penalty: 0,
      points: normalize(variant.points),
    };

    setActiveAiShape(selected);
    setDescription(selected.name);
    setDrawnPath(null);
    setFinishedDrawingStrokes([]);
    setDrawingStroke([]);
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
    setActiveAiShape(null);
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
    const stroke = compactDrawingPoints(drawingPointsRef.current, 5);
    const nextStrokes = stroke.length >= 2
      ? [...drawingStrokesRef.current, stroke]
      : drawingStrokesRef.current;
    setFinishedDrawingStrokes(nextStrokes);
    setDrawingStroke([]);
    const path = drawingToPath(nextStrokes);
    setDrawnPath(path);
    if (!path) {
      setRoadStatus(t.status.drawLongerPath);
    }
  }

  function handleDrawingClear() {
    resetDrawing();
    clearRoadMatch();
  }

  function selectRouteCandidate(index: number, candidates = routeCandidates) {
    const candidate = candidates[index];
    if (!candidate) return;

    setSelectedSavedPathId(null);
    setSelectedCandidateIndex(index);
    setRoadRoute(candidate.points);
    setTargetRoute(candidate.targetPoints);
    setMatchTiming((current) => current
      ? {
        ...current,
        anchorErrorMeters: candidate.anchorErrorMeters,
        selectedRouteRank: candidate.rank,
        selectedSegmentRepairs: candidate.segmentRepairCount,
        shapeErrorMeters: candidate.shapeErrorMeters,
        startOffsetMeters: candidate.startOffsetMeters,
        worstSegmentErrorMeters: candidate.worstSegmentErrorMeters,
      }
      : current);
  }

  function candidatePathName(candidate: RouteCandidateOption) {
    return (candidate.aiLabel || activeAiShape?.name || description || `${t.route} #${candidate.rank}`).trim().slice(0, 48);
  }

  function currentLocationLabel() {
    if (selectedLocation?.label) return shortLocationLabel(selectedLocation.label);
    return location.trim() || coordinateLabel(center);
  }

  function savedPathForRoute(points: RoutePoint[]) {
    const fingerprint = savedPathFingerprint(points);
    return fingerprint ? savedPaths.find((path) => path.fingerprint === fingerprint) ?? null : null;
  }

  function handleToggleSavedPath(candidate: RouteCandidateOption) {
    const fingerprint = savedPathFingerprint(candidate.points);
    if (!fingerprint) return;

    const existing = savedPaths.find((path) => path.fingerprint === fingerprint);
    if (existing) {
      setSavedPaths((paths) => sortSavedPaths(paths.filter((path) => path.id !== existing.id)).slice(0, savedPathLimit));
      setRoadStatus(t.status.pathRemoved(existing.name));
      return;
    }

    const shapePoints = routeShapePoints(candidate.points);
    if (shapePoints.length < 2) return;

    const name = candidatePathName(candidate);
    const candidateStats = routeStats(candidate.points);
    const createdAt = Date.now();
    const savedPath: SavedPath = {
      areaSquareMeters: routeAreaSquareMeters(candidate.points),
      createdAt,
      distanceKm: candidateStats.kilometers,
      fingerprint,
      id: "path-" + createdAt.toString(36) + "-" + fingerprint.slice(0, 8).replace(/[^a-z0-9]/gi, ""),
      locationLabel: currentLocationLabel(),
      name,
      pointCount: candidate.points.length,
      routePoints: savedRoutePoints(candidate.points),
      shapePoints,
    };

    setSavedPaths((paths) => sortSavedPaths([
      savedPath,
      ...paths.filter((path) => path.fingerprint !== fingerprint),
    ]).slice(0, savedPathLimit));
    setRoadStatus(t.status.pathSaved(name));
  }

  function selectSavedPath(path: SavedPath) {
    const selectedRoute = savedPathRoute(path, center);

    matchRequestRef.current += 1;
    setSelectedSavedPathId(path.id);
    setShapeInputMode("draw");
    setDescription(path.name);
    setDistanceKm(path.distanceKm || distanceKm);
    setDrawnPath(normalize(path.shapePoints));
    setActiveAiShape(null);
    setFinishedDrawingStrokes([]);
    setDrawingStroke([]);
    setRoadRoute(selectedRoute);
    setTargetRoute(null);
    setRouteCandidates([]);
    setSelectedCandidateIndex(0);
    setHoveredCandidateIndex(null);
    setRoadSegments([]);
    setCachedRoadTiles([]);
    roadGraphRef.current = null;
    setRoadCenter(null);
    setMatchTiming(null);
    setGraphInfo(null);
    setAiSketchSuggestions([]);
    setMatchPhase("");
    setIsMatchingRoads(false);
    setIsFindingShapes(false);
    setHasLoadedOnce(true);
    setRoadStatus(t.status.savedPathLoaded(path.name));
  }

  function removeSavedPath(pathToRemove: SavedPath) {
    setSavedPaths((paths) => sortSavedPaths(paths.filter((path) => path.id !== pathToRemove.id)).slice(0, savedPathLimit));
    if (selectedSavedPathId === pathToRemove.id) setSelectedSavedPathId(null);
    setRoadStatus(t.status.pathRemoved(pathToRemove.name));
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

    const previewPath = mergeDrawingStrokes([...drawingStrokes, drawingPoints]);
    if (previewPath.length < 2) return;

    context.strokeStyle = "#fc4c02";
    context.lineWidth = 7;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(previewPath[0].x, previewPath[0].y);
    previewPath.slice(1).forEach((point) => context.lineTo(point.x, point.y));
    context.stroke();
  }, [drawingStrokes, drawingPoints, shapeInputMode]);


  async function handleFindAiShapes() {
    const requestId = matchRequestRef.current + 1;
    matchRequestRef.current = requestId;
    const startedAt = performance.now();
    const requestedShape = aiShapeTarget || description;
    let roadSearchMs = 0;
    let routeMs = 0;
    let hasLoadedGraph = false;
    setIsFindingShapes(true);
    setHoveredCandidateIndex(null);
    setMatchTiming(null);
    setRouteCandidates([]);
    setSelectedCandidateIndex(0);
    setTargetRoute(null);
    setMatchPhase(t.progress.aiSketching(requestedShape));
    setRoadStatus(t.status.aiSketching(requestedShape));

    try {
      const resolvedCenter = selectedLocation ?? await resolveLocation(location);
      const aiVariants = await generateAiShapeVariants(requestedShape, language);
      const aiMatchVariants = aiVectorMatchingVariants(aiVariants);
      if (!aiMatchVariants.length) throw new Error(t.status.aiSketchNoShapes);
      if (requestId !== matchRequestRef.current) return;

      setAiSketchSuggestions(aiVariants.filter((variant, index) => variant.aiGeneratedSketch && index % 2 === 0));
      activateAiShape(aiMatchVariants[0]);
      setRoadRoute(null);
      setMatchPhase(t.status.aiLoadingGraph);
      setRoadStatus(t.status.aiLoadingGraph);

      let graph = roadGraphRef.current;
      let roadFetch: Awaited<ReturnType<typeof fetchUsableRoadGraph>> | null = null;
      if (!graph) {
        const radius = Math.max(
          ...aiMatchVariants.map((variant) => roadSearchRadiusMeters(variant.points, distanceKm, startSearchMeters)),
        );
        const roadSearchStartedAt = performance.now();
        roadFetch = await fetchUsableRoadGraph(resolvedCenter, radius, setMatchPhase, graphPhaseMessages, (tiles) => {
          if (requestId === matchRequestRef.current) setCachedRoadTiles(tiles);
        });
        roadSearchMs = performance.now() - roadSearchStartedAt;
        graph = roadFetch.graph;
        roadGraphRef.current = graph;
        hasLoadedGraph = true;
        setGraphInfo({
          cacheVersion: matchConfig.graphCacheVersion,
          source: roadFetch.source,
          profile: profileLabel(roadFetch.profile),
          radiusMeters: roadFetch.radiusMeters,
          spacingMeters: matchConfig.roadNodeSpacingMeters,
          nodes: graph.nodes.size,
          edges: graph.edgeKeys.size,
          rejectedSegments: graph.rejectedSegments,
          tileCount: roadFetch.tileCount,
          failedTiles: roadFetch.failedTiles,
        });
        setCachedRoadTiles(roadFetch.tiles);
      }

      if (requestId !== matchRequestRef.current) return;
      const loadedRadiusMeters = roadFetch?.radiusMeters ?? graphInfo?.radiusMeters ?? Math.max(
        ...aiMatchVariants.map((variant) => roadSearchRadiusMeters(variant.points, distanceKm, startSearchMeters)),
      );
      const placementStartMeters = Math.max(
        ...aiMatchVariants.map((variant) => graphBackedStartSearchRadiusMeters(variant.points, distanceKm, loadedRadiusMeters)),
      );
      const aiMatchTryCount = routePlacementTryCount(aiMatchVariants.length, placementStartMeters);
      setMatchPhase(t.progress.testingPlacements(aiMatchTryCount, Math.round(placementStartMeters)));
      setRoadStatus(t.status.testing(aiMatchTryCount, matchConfig.topCandidates));
      await waitForPaint();

      const routeStartedAt = performance.now();
      const matchedResult = await roadMatchedRoute(graph, aiMatchVariants, resolvedCenter, distanceKm, (message) => {
        if (requestId === matchRequestRef.current) setMatchPhase(message);
      }, progressLabels, { startRangeMeters: placementStartMeters });
      const matched = matchedResult.points;
      routeMs = performance.now() - routeStartedAt;
      if (requestId !== matchRequestRef.current) return;
      if (matched.length < 2) throw new Error(t.status.roadDataNoRoute);

      setRouteCandidates(matchedResult.candidates);
      setSelectedCandidateIndex(matchedResult.selectedCandidateIndex);
      setRoadRoute(matched);
      setTargetRoute(matchedResult.targetPoints);
      setRoadSegments(graph.segments);
      setRoadCenter(resolvedCenter);
      setHasLoadedOnce(true);
      setMatchTiming({
        totalMs: performance.now() - startedAt,
        roadSearchMs,
        routeMs,
        placements: aiMatchTryCount,
        rankedRoutes: matchedResult.rankedRoutes,
        selectedRouteRank: matchedResult.selectedRouteRank,
        choicePoolSize: matchedResult.candidates.length,
        shapeErrorMeters: matchedResult.shapeErrorMeters,
        anchorErrorMeters: matchedResult.anchorErrorMeters,
        worstSegmentErrorMeters: matchedResult.worstSegmentErrorMeters,
        segmentRepairsTried: matchedResult.segmentRepairsTried,
        selectedSegmentRepairs: matchedResult.selectedSegmentRepairs,
        startOffsetMeters: matchedResult.startOffsetMeters,
      });

      const matchedStats = routeStats(matched);
      const choiceStatus = matchedResult.candidates.length > 1
        ? t.status.showingOption(matchedResult.selectedRouteRank, matchedResult.candidates.length)
        : t.status.choseBest;
      const rankingStatus = matchedResult.fallbackUsed
        ? t.status.fallback
        : t.status.rankedCandidates(matchedResult.rankedRoutes, choiceStatus);
      const startStatus = matchedResult.startOffsetMeters > 30
        ? t.status.startMoved(Math.round(matchedResult.startOffsetMeters))
        : t.status.startNear;
      const shapeStatus = typeof matchedResult.shapeErrorMeters === "number"
        ? t.status.shapeError(
          Math.round(matchedResult.shapeErrorMeters),
          Math.round(matchedResult.anchorErrorMeters ?? matchedResult.shapeErrorMeters),
          Math.round(matchedResult.worstSegmentErrorMeters ?? matchedResult.shapeErrorMeters),
        )
        : "";
      const repairStatus = matchedResult.segmentRepairsTried
        ? t.status.repairs(matchedResult.segmentRepairsTried, matchedResult.selectedSegmentRepairs)
        : "";
      const resultStatus = t.status.result(rankingStatus, startStatus, matchedStats.kilometers.toFixed(2), shapeStatus, repairStatus);
      setMatchPhase('');
      setRoadStatus(t.status.aiSketchMatched(Math.ceil(aiVariants.length / 2), requestedShape, resultStatus));
    } catch (error) {
      if (requestId !== matchRequestRef.current) return;
      setRoadRoute(null);
      setTargetRoute(null);
      setRouteCandidates([]);
      setSelectedCandidateIndex(0);
      setRoadSegments([]);
      setRoadCenter(null);
      if (!hasLoadedGraph) {
        setGraphInfo(null);
        setCachedRoadTiles([]);
        roadGraphRef.current = null;
      }
      setMatchPhase('');
      setRoadStatus(error instanceof Error ? error.message : t.status.roadMatchingFailed);
      setMatchTiming({
        totalMs: performance.now() - startedAt,
        roadSearchMs,
        routeMs,
      });
    } finally {
      if (requestId === matchRequestRef.current) {
        setIsFindingShapes(false);
        setMatchPhase('');
      }
    }
  }

  async function handleMatchRoads() {
    const requestId = matchRequestRef.current + 1;
    matchRequestRef.current = requestId;
    const startedAt = performance.now();
    let roadSearchMs = 0;
    let routeMs = 0;
    let hasLoadedGraph = false;
    setIsMatchingRoads(true);
    setHoveredCandidateIndex(null);
    setMatchTiming(null);
    setMatchPhase(t.progress.resolvingStart);
    setRoadStatus(t.status.checkingCache);

    try {
      const resolvedCenter = selectedLocation ?? await resolveLocation(location);
      if (activeRoutingProvider() === "mapy") {
        setMatchPhase(t.progress.mapyRouting);
        setRoadStatus(t.status.mapyRouting);
        setGraphInfo(null);
        setCachedRoadTiles([]);
        setRoadSegments([]);
        await waitForPaint();

        const routeStartedAt = performance.now();
        const matchedResult = await mapyMatchedRoute(sourceVariants, resolvedCenter, distanceKm, language);
        routeMs = performance.now() - routeStartedAt;
        if (requestId !== matchRequestRef.current) return;

        const candidate: RouteCandidateOption = {
          anchorErrorMeters: matchedResult.anchorErrorMeters,
          points: matchedResult.points,
          rank: 1,
          routeDistanceMeters: matchedResult.routeDistanceMeters,
          score: matchedResult.shapeErrorMeters,
          segmentRepairCount: 0,
          shapeErrorMeters: matchedResult.shapeErrorMeters,
          startOffsetMeters: 0,
          targetPoints: matchedResult.targetPoints,
          worstSegmentErrorMeters: matchedResult.worstSegmentErrorMeters,
        };
        setRouteCandidates([candidate]);
        setSelectedCandidateIndex(0);
        setRoadRoute(matchedResult.points);
        setTargetRoute(matchedResult.targetPoints);
        setRoadCenter(resolvedCenter);
        setHasLoadedOnce(true);
        setMatchTiming({
          totalMs: performance.now() - startedAt,
          roadSearchMs,
          routeMs,
          placements: matchedResult.controlPoints,
          rankedRoutes: 1,
          selectedRouteRank: 1,
          choicePoolSize: 1,
          shapeErrorMeters: matchedResult.shapeErrorMeters,
          anchorErrorMeters: matchedResult.anchorErrorMeters,
          worstSegmentErrorMeters: matchedResult.worstSegmentErrorMeters,
          selectedSegmentRepairs: 0,
          startOffsetMeters: 0,
        });
        const shapeStatus = t.status.shapeError(
          Math.round(matchedResult.shapeErrorMeters),
          Math.round(matchedResult.anchorErrorMeters),
          Math.round(matchedResult.worstSegmentErrorMeters),
        );
        setMatchPhase("");
        setRoadStatus(t.status.mapyResult(
          matchedResult.routeType,
          (matchedResult.routeDistanceMeters / 1000).toFixed(2),
          shapeStatus,
        ));
        return;
      }
      const radius = roadSearchRadiusMeters(sourcePoints, distanceKm, startSearchMeters);
      const roadSearchStartedAt = performance.now();
      const roadFetch = await fetchUsableRoadGraph(resolvedCenter, radius, setMatchPhase, graphPhaseMessages, (tiles) => {
        if (requestId === matchRequestRef.current) setCachedRoadTiles(tiles);
      });
      const graph = roadFetch.graph;
      roadGraphRef.current = graph;
      roadSearchMs = performance.now() - roadSearchStartedAt;
      hasLoadedGraph = true;
      setGraphInfo({
        cacheVersion: matchConfig.graphCacheVersion,
        source: roadFetch.source,
        profile: profileLabel(roadFetch.profile),
        radiusMeters: roadFetch.radiusMeters,
        spacingMeters: matchConfig.roadNodeSpacingMeters,
        nodes: graph.nodes.size,
        edges: graph.edgeKeys.size,
        rejectedSegments: graph.rejectedSegments,
        tileCount: roadFetch.tileCount,
        failedTiles: roadFetch.failedTiles,
      });
      setCachedRoadTiles(roadFetch.tiles);
      if (requestId !== matchRequestRef.current) return;

      const placementStartMeters = graphBackedStartSearchRadiusMeters(sourcePoints, distanceKm, roadFetch.radiusMeters);
      const placementTryCount = routePlacementTryCount(sourceVariants.length, placementStartMeters);
      setMatchPhase(t.progress.testingPlacements(placementTryCount, Math.round(placementStartMeters)));
      setRoadStatus(t.status.testing(placementTryCount, matchConfig.topCandidates));
      await waitForPaint();
      const routeStartedAt = performance.now();
      const matchedResult = await roadMatchedRoute(graph, sourceVariants, resolvedCenter, distanceKm, (message) => {
        if (requestId === matchRequestRef.current) setMatchPhase(message);
      }, progressLabels, { startRangeMeters: placementStartMeters });
      const matched = matchedResult.points;
      routeMs = performance.now() - routeStartedAt;
      if (requestId !== matchRequestRef.current) return;

      if (matched.length < 2) {
        throw new Error(t.status.roadDataNoRoute);
      }

      setRouteCandidates(matchedResult.candidates);
      setSelectedCandidateIndex(matchedResult.selectedCandidateIndex);
      setRoadRoute(matched);
      setTargetRoute(matchedResult.targetPoints);
      setRoadSegments(graph.segments);
      setRoadCenter(resolvedCenter);
      setHasLoadedOnce(true);
      setMatchTiming({
        totalMs: performance.now() - startedAt,
        roadSearchMs,
        routeMs,
        placements: placementTryCount,
        rankedRoutes: matchedResult.rankedRoutes,
        selectedRouteRank: matchedResult.selectedRouteRank,
        choicePoolSize: matchedResult.candidates.length,
        shapeErrorMeters: matchedResult.shapeErrorMeters,
        anchorErrorMeters: matchedResult.anchorErrorMeters,
        worstSegmentErrorMeters: matchedResult.worstSegmentErrorMeters,
        segmentRepairsTried: matchedResult.segmentRepairsTried,
        selectedSegmentRepairs: matchedResult.selectedSegmentRepairs,
        startOffsetMeters: matchedResult.startOffsetMeters,
      });
      const matchedStats = routeStats(matched);
      const choiceStatus = matchedResult.candidates.length > 1
        ? t.status.showingOption(matchedResult.selectedRouteRank, matchedResult.candidates.length)
        : t.status.choseBest;
      const rankingStatus = matchedResult.distanceFallbackUsed
        ? t.status.distanceFallback
        : matchedResult.fallbackUsed
          ? t.status.fallback
          : t.status.rankedCandidates(matchedResult.rankedRoutes, choiceStatus);
      const startStatus = matchedResult.startOffsetMeters > 30
        ? t.status.startMoved(Math.round(matchedResult.startOffsetMeters))
        : t.status.startNear;
      const shapeStatus = typeof matchedResult.shapeErrorMeters === "number"
        ? t.status.shapeError(
          Math.round(matchedResult.shapeErrorMeters),
          Math.round(matchedResult.anchorErrorMeters ?? matchedResult.shapeErrorMeters),
          Math.round(matchedResult.worstSegmentErrorMeters ?? matchedResult.shapeErrorMeters),
        )
        : "";
      const repairStatus = matchedResult.segmentRepairsTried
        ? t.status.repairs(matchedResult.segmentRepairsTried, matchedResult.selectedSegmentRepairs)
        : "";
      setMatchPhase("");
      setRoadStatus(t.status.result(rankingStatus, startStatus, matchedStats.kilometers.toFixed(2), shapeStatus, repairStatus));
    } catch (error) {
      if (requestId !== matchRequestRef.current) return;
      setRoadRoute(null);
      setTargetRoute(null);
      setRouteCandidates([]);
      setSelectedCandidateIndex(0);
      setRoadSegments([]);
      setRoadCenter(null);
      if (!hasLoadedGraph) {
        setGraphInfo(null);
        setCachedRoadTiles([]);
        roadGraphRef.current = null;
      }
      setMatchTiming({
        totalMs: performance.now() - startedAt,
        roadSearchMs,
        routeMs,
      });
      setHasLoadedOnce(true);
      setMatchPhase("");
      setRoadStatus(
        hasLoadedOnce
          ? error instanceof Error ? error.message : t.status.roadMatchingFailed
          : error instanceof Error ? error.message : t.status.slowRoadData,
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
    window.localStorage.setItem(savedLanguageKey, language);
  }, [language]);

  useEffect(() => {
    window.localStorage.setItem(savedAiShapeQueryKey, aiShapeQuery);
  }, [aiShapeQuery]);

  useEffect(() => {
    window.localStorage.setItem(savedPathsKey, JSON.stringify(savedPaths));
  }, [savedPaths]);

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

    if (!tileLayerRef.current) {
      tileLayerRef.current = L.layerGroup().addTo(map);
    }
    tileLayerRef.current.clearLayers();
    const tileLayer = tileLayerRef.current;
    const loadedTiles = cachedRoadTiles.filter((tile) => tile.source !== "failed");
    const loadedTileKeys = new Set(loadedTiles.map((tile) => String(tile.x) + ":" + String(tile.y)));
    const drawTileEdge = (neighborKey: string, points: Array<[number, number]>) => {
      if (loadedTileKeys.has(neighborKey)) return;

      const edge = L.polyline(points, {
        color: "#0e7490",
        dashArray: "8 6",
        interactive: false,
        noClip: true,
        opacity: 0.7,
        weight: 1.6,
      }).addTo(tileLayer);
      edge.bringToBack();
    };

    loadedTiles.forEach((tile) => {
      drawTileEdge(String(tile.x) + ":" + String(tile.y + 1), [[tile.north, tile.west], [tile.north, tile.east]]);
      drawTileEdge(String(tile.x) + ":" + String(tile.y - 1), [[tile.south, tile.west], [tile.south, tile.east]]);
      drawTileEdge(String(tile.x - 1) + ":" + String(tile.y), [[tile.south, tile.west], [tile.north, tile.west]]);
      drawTileEdge(String(tile.x + 1) + ":" + String(tile.y), [[tile.south, tile.east], [tile.north, tile.east]]);
    });

    if (!roadLayerRef.current) {
      roadLayerRef.current = L.layerGroup().addTo(map);
    }
    roadLayerRef.current.clearLayers();
    if (!hasWalkableRoute) {
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
    }

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
    if (targetLayerRef.current) {
      targetLayerRef.current.remove();
      targetLayerRef.current = null;
    }
    if (hasWalkableRoute && targetRoute?.length) {
      targetLayerRef.current = L.polyline(
        targetRoute.map((point) => L.latLng(point.lat, point.lng)),
        {
          color: "#273043",
          weight: 3,
          opacity: 0.36,
          lineCap: "round",
          lineJoin: "round",
          dashArray: "5 9",
          smoothFactor: 0,
          noClip: true,
          interactive: false,
        },
      ).addTo(map);
    }

    if (!candidateLayerRef.current) {
      candidateLayerRef.current = L.layerGroup().addTo(map);
    }
    candidateLayerRef.current.clearLayers();
    if (hasWalkableRoute && routeCandidates.length > 1) {
      routeCandidates.forEach((candidate, index) => {
        if (index === selectedCandidateIndex) return;

        L.polyline(
          candidate.points.map((point) => L.latLng(point.lat, point.lng)),
          {
            color: "#0e7490",
            weight: 4,
            opacity: 0.34,
            lineCap: "round",
            lineJoin: "round",
            smoothFactor: 0,
            noClip: true,
            interactive: true,
          },
        )
          .on("click", () => selectRouteCandidate(index))
          .bindTooltip(
            candidate.aiLabel
              ? '#' + candidate.rank + ' · ' + candidate.aiLabel + ' · ' + (candidate.routeDistanceMeters / 1000).toFixed(2) + ' km'
              : '#' + candidate.rank + ' · ' + (candidate.routeDistanceMeters / 1000).toFixed(2) + ' km · ' + t.shapeShort + ' ' + Math.round(candidate.shapeErrorMeters) + 'm',
            {
              direction: "top",
              opacity: 0.88,
              sticky: true,
            },
          )
          .addTo(candidateLayerRef.current!);
      });
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

    if (!routeHoverLayerRef.current) {
      routeHoverLayerRef.current = L.layerGroup().addTo(map);
    }
    routeHoverLayerRef.current.clearLayers();
    const hoveredCandidate = hoveredCandidateIndex === null ? null : routeCandidates[hoveredCandidateIndex];
    if (hasWalkableRoute && hoveredCandidate?.points.length) {
      const hoveredLatLngs = hoveredCandidate.points.map((point) => L.latLng(point.lat, point.lng));
      L.polyline(hoveredLatLngs, {
        color: "#fffdf8",
        weight: 11,
        opacity: 0.9,
        lineCap: "round",
        lineJoin: "round",
        smoothFactor: 0,
        noClip: true,
        interactive: false,
      }).addTo(routeHoverLayerRef.current);
      L.polyline(hoveredLatLngs, {
        color: hoveredCandidateIndex === selectedCandidateIndex ? "#fc4c02" : "#0e7490",
        weight: 7,
        opacity: 0.96,
        lineCap: "round",
        lineJoin: "round",
        smoothFactor: 0,
        noClip: true,
        interactive: false,
      }).addTo(routeHoverLayerRef.current);
    }

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
  }, [route, roadSegments, cachedRoadTiles, targetRoute, routeCandidates, selectedCandidateIndex, hoveredCandidateIndex, hasWalkableRoute, center.lat, center.lng, language]);

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
            <div className="titleRow">
              <div>
                <p className="eyebrow">{t.appEyebrow}</p>
                <h1>{t.appTitle}</h1>
              </div>
              <div className="languageSwitch" aria-label={t.languageLabel}>
                {languageOptions.map((option) => (
                  <button
                    key={option.id}
                    className={language === option.id ? "selectedLanguage" : undefined}
                    type="button"
                    onClick={() => setLanguage(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>


          <label>
            {t.startLocation}
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
                placeholder={t.locationPlaceholder}
                autoComplete="off"
              />
              {isLocationFocused && (locationSuggestions.length > 0 || isSearchingLocations) ? (
                <div className="suggestions" role="listbox" aria-label={t.locationSuggestions}>
                  {isSearchingLocations ? <div className="suggestionMeta">{t.searchingAddresses}</div> : null}
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
            {t.approximateDistance}
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

          <div className="shapeInputTabs" role="tablist" aria-label={t.shapePresets}>
            <button
              type="button"
              role="tab"
              aria-selected={shapeInputMode === "draw"}
              className={shapeInputMode === "draw" ? "selectedInputTab" : undefined}
              onClick={() => setShapeInputMode("draw")}
            >
              {t.shapeInputTabs.draw}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={shapeInputMode === "ai"}
              className={shapeInputMode === "ai" ? "selectedInputTab" : undefined}
              onClick={() => setShapeInputMode("ai")}
            >
              {t.shapeInputTabs.ai}
            </button>
          </div>

          {shapeInputMode === "draw" ? (
            <div className="shapeInputPanel" role="tabpanel">
              <div className="drawingPad">
                <div className="drawingHeader">
                  <span>{t.drawPath}</span>
                  <button type="button" onClick={handleDrawingClear} disabled={!drawingStrokes.length && !drawingPoints.length && !drawnPath}>
                    {t.clear}
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
                  aria-label={t.drawnRouteShape}
                />
              </div>

              <div className="shapeGrid" aria-label={t.shapePresets}>
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
                    aria-label={t.useShape(t.templateLabels[template.name])}
                  >
                    <svg viewBox="0 0 100 100" aria-hidden="true">
                      <rect x="5" y="5" width="90" height="90" rx="8" />
                      <polyline points={template.points} />
                    </svg>
                    <span>{t.templateLabels[template.name]}</span>
                  </button>
                ))}
              </div>

              <button
                className="secondary"
                type="button"
                onClick={handleMatchRoads}
                disabled={isRouteBusy}
              >
                {isMatchingRoads ? t.matchingRoads : t.matchRoads}
              </button>
            </div>
          ) : (
            <div className="shapeInputPanel aiOptionsPanel" role="tabpanel">
              <label>
                {t.aiShapeSearch}
                <input
                  value={aiShapeQuery}
                  onChange={(event) => {
                    setAiShapeQuery(event.target.value);
                    clearRoadMatch();
                  }}
                  placeholder={t.aiShapeSearchPlaceholder}
                  autoComplete="off"
                />
              </label>

              <button
                className="secondary"
                type="button"
                onClick={handleFindAiShapes}
                disabled={isRouteBusy}
              >
                {isFindingShapes ? t.findingAiShapes(aiShapeTarget) : t.findAiShapes(aiShapeTarget)}
              </button>

              {aiSketchPreviews.length ? (
                <div className="aiSketchSuggestions" aria-label={t.aiSuggestedShapes}>
                  {aiSketchPreviews.map((suggestion, index) => (
                    <button
                      key={`${suggestion.name}-${index}`}
                      type="button"
                      title={suggestion.description || suggestion.name}
                      aria-label={t.useShape(suggestion.name)}
                      onClick={() => {
                        const sketch = aiSketchSuggestions[index];
                        if (!sketch) return;

                        activateAiShape(sketch);
                        clearRoadMatch();
                      }}
                    >
                      <svg viewBox="0 0 100 100" aria-hidden="true">
                        <polyline points={suggestion.points} />
                      </svg>
                      <span>{suggestion.name}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          <button
            className="primary"
            type="button"
            onClick={() => {
              if (!roadRoute?.length) return;
              download("strava-art-walk.gpx", gpx(roadRoute, description));
            }}
            disabled={!hasWalkableRoute || isRouteBusy}
          >
            {t.exportGpx}
          </button>

          {selectedAiDescription ? (
            <p className="aiShapeDescription">{selectedAiDescription}</p>
          ) : null}

          {routeCandidates.length > 1 ? (
            <div className="candidatePicker" aria-label={t.bestRoutes}>
              <div className="candidateHeader">
                <span>{t.bestRoutes}</span>
                <strong>{routeCandidates.length}</strong>
              </div>
              <div className="candidateList">
                {routeCandidates.map((candidate, index) => {
                  const savedCandidatePath = savedPathForRoute(candidate.points);

                  return (
                    <div className="candidateItem" key={`${candidate.rank}-${index}`}>
                      <button
                        className={[
                          "candidateSelect",
                          index === selectedCandidateIndex ? "selectedCandidate" : "",
                          index === hoveredCandidateIndex ? "hoveredCandidate" : "",
                        ].filter(Boolean).join(" ")}
                        type="button"
                        onClick={() => selectRouteCandidate(index)}
                        onFocus={() => setHoveredCandidateIndex(index)}
                        onBlur={() => setHoveredCandidateIndex(null)}
                        onPointerEnter={() => setHoveredCandidateIndex(index)}
                        onPointerLeave={() => setHoveredCandidateIndex(null)}
                      >
                        <strong>#{candidate.rank}</strong>
                        <span>{(candidate.routeDistanceMeters / 1000).toFixed(2)} km</span>
                        <span>{candidate.aiLabel ?? t.shapeShort + ' ' + Math.round(candidate.shapeErrorMeters) + 'm'}</span>
                        <span>
                          {candidate.aiLabel
                            ? candidate.aiGeneratedSketch
                              ? t.shapeShort + ' ' + Math.round(candidate.shapeErrorMeters) + 'm'
                              : Math.round((candidate.aiConfidence ?? 0) * 100) + '%'
                            : t.worstShort + ' ' + Math.round(candidate.worstSegmentErrorMeters) + 'm'}
                        </span>
                      </button>
                      <button
                        className={savedCandidatePath ? "candidateStar selectedCandidateStar" : "candidateStar"}
                        type="button"
                        aria-label={savedCandidatePath ? t.removeSavedPath : t.savePath}
                        aria-pressed={Boolean(savedCandidatePath)}
                        onClick={() => handleToggleSavedPath(candidate)}
                        disabled={isRouteBusy}
                      >
                        <span aria-hidden="true">{savedCandidatePath ? "★" : "☆"}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="savedPaths" aria-label={t.popularPaths}>
            <div className="candidateHeader">
              <span>{t.popularPaths}</span>
              <strong>{popularSavedPaths.length}</strong>
            </div>
            {popularSavedPaths.length ? (
              <div className="savedPathItems">
                {popularSavedPaths.map((path) => (
                  <div
                    className={path.id === selectedSavedPathId ? "savedPathItem selectedSavedPath" : "savedPathItem"}
                    key={path.id}
                  >
                    <button
                      className="savedPathLoad"
                      type="button"
                      onClick={() => selectSavedPath(path)}
                      aria-label={t.useSavedPath}
                      aria-pressed={path.id === selectedSavedPathId}
                    >
                      <svg viewBox="0 0 100 100" aria-hidden="true">
                        <rect x="6" y="6" width="88" height="88" rx="7" />
                        <polyline points={pathPreviewPoints(path.shapePoints)} />
                      </svg>
                      <span className="savedPathMain">
                        <strong>{path.name}</strong>
                        <span>{path.locationLabel}</span>
                      </span>
                      <span className="savedPathArea">
                        <strong>{formatArea(path.areaSquareMeters, language)}</strong>
                        <span>{t.area} · {path.distanceKm.toFixed(2)} km</span>
                      </span>
                    </button>
                    <button
                      className="savedPathRemove"
                      type="button"
                      onClick={() => removeSavedPath(path)}
                      aria-label={t.removeSavedPath}
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="savedPathEmpty">{t.savedPathsEmpty}</p>
            )}
          </div>

          <p className="status">{roadStatus}</p>
          <p className="status timing">
            {isRouteBusy
              ? matchPhase || t.calculatingPath
              : matchTiming
                ? (() => {
                  const extras = [
                    typeof matchTiming.rankedRoutes === "number" ? t.timing.ranked(matchTiming.rankedRoutes) : "",
                    typeof matchTiming.choicePoolSize === "number" && matchTiming.choicePoolSize > 1 ? t.timing.picked(matchTiming.selectedRouteRank ?? 1, matchTiming.choicePoolSize) : "",
                    typeof matchTiming.shapeErrorMeters === "number" ? t.timing.shape(Math.round(matchTiming.shapeErrorMeters)) : "",
                    typeof matchTiming.worstSegmentErrorMeters === "number" ? t.timing.worstSegment(Math.round(matchTiming.worstSegmentErrorMeters)) : "",
                    typeof matchTiming.segmentRepairsTried === "number" && matchTiming.segmentRepairsTried > 0 ? t.timing.repairs(matchTiming.segmentRepairsTried) : "",
                    typeof matchTiming.startOffsetMeters === "number" ? t.timing.start(Math.round(matchTiming.startOffsetMeters)) : "",
                  ].join("");
                  return t.timing.summary(
                    formatMs(matchTiming.totalMs),
                    formatMs(matchTiming.roadSearchMs),
                    formatMs(matchTiming.routeMs),
                    extras,
                  );
                })()
                : t.lastCalculationNotRun}
          </p>
          <p className="status timing">
            {graphInfo
              ? t.graph.summary(
                graphInfo.cacheVersion,
                sourceLabel(graphInfo.source),
                graphInfo.profile,
                Math.round(graphInfo.radiusMeters),
                graphInfo.spacingMeters,
                graphInfo.nodes,
                graphInfo.edges,
                graphInfo.rejectedSegments,
                graphInfo.tileCount,
                graphInfo.failedTiles,
              )
              : t.graph.empty(matchConfig.graphCacheVersion, matchConfig.roadNodeSpacingMeters, t.graphNotLoaded)}
          </p>
        </aside>

        <section className="mapSurface" aria-label={t.routePreview}>
          <div ref={mapElementRef} className="embeddedMap" aria-label={t.interactiveRouteMap} />
          {mapOverlayText ? (
            <div className="mapOverlay" role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" />
              <strong>{mapOverlayText}</strong>
            </div>
          ) : null}

          <div className="stats">
            <div>
              <span>{t.route}</span>
              <strong>{stats.kilometers.toFixed(2)} km</strong>
            </div>
            <div>
              <span>{t.walkTime}</span>
              <strong>{Math.round(stats.minutes)} min</strong>
            </div>
            <div>
              <span>{t.points}</span>
              <strong>{route.length}</strong>
            </div>
            <div>
              <span>{t.bounds}</span>
              <strong>{bounds.south.toFixed(4)}, {bounds.west.toFixed(4)}</strong>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);

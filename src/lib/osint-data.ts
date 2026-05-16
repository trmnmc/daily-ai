/**
 * OSINT Framework — category tree of investigation resources.
 *
 * Modeled on https://github.com/lockfale/OSINT-Framework — a categorized
 * directory of public sources used in open-source intelligence work.
 *
 * `kind` on a resource controls how the console treats it:
 *   - "link"   — opens in a new tab, nothing else (most of the corpus)
 *   - "tool"   — would invoke a server-side lookup in a future iteration;
 *                in v1 the action just appends to the activity log
 *   - "manual" — operator action required (e.g. exiftool a local file);
 *                renders with a different verb ("note") instead of "open"
 *
 * Each resource also carries synthetic telemetry (status, latency, uptime,
 * 24h request count) so the dashboard has real numbers to render. In v2
 * these would come from a heartbeat probe + per-source success-rate
 * rollup; in v1 they're deterministic fixtures.
 */

export type ResourceKind = "link" | "tool" | "manual";
export type ResourceStatus = "healthy" | "degraded" | "down";

export type Resource = {
  id: string;
  name: string;
  url: string;
  kind: ResourceKind;
  note?: string;
  status: ResourceStatus;
  /** Round-trip latency (ms) for the most recent probe. */
  latencyMs: number;
  /** 0–100, last 24h. */
  uptimePct: number;
  /** Total queries logged in the last 24h. */
  reqs24h: number;
};

export type Category = {
  id: string;
  name: string;
  /** Short label rendered next to the count — describes the input it takes. */
  input: string;
  /** Lucide icon name (lowercase kebab). Imported lazily by the renderer. */
  icon: CategoryIcon;
  resources: Resource[];
};

export type CategoryIcon =
  | "user"
  | "mail"
  | "globe"
  | "network"
  | "image"
  | "map-pin"
  | "users"
  | "scale"
  | "spider"
  | "shield-alert";

export const OSINT_CATEGORIES: Category[] = [
  {
    id: "username",
    name: "Username",
    input: "handle",
    icon: "user",
    resources: [
      r("sherlock", "Sherlock", "https://github.com/sherlock-project/sherlock", "tool", "scans 400+ social networks for a handle", "healthy", 8, 99.9, 1402),
      r("whatsmyname", "WhatsMyName", "https://whatsmyname.app/", "link", "web-based username enumeration", "healthy", 124, 99.4, 812),
      r("namechk", "Namechk", "https://namechk.com/", "link", "checks handle availability across 90+ services", "degraded", 421, 96.1, 503),
      r("knowem", "KnowEm", "https://knowem.com/", "link", "name & trademark search", "healthy", 188, 98.8, 211),
    ],
  },
  {
    id: "email",
    name: "Email",
    input: "email",
    icon: "mail",
    resources: [
      r("hunter", "Hunter.io", "https://hunter.io/", "link", "email discovery from domain", "healthy", 92, 99.7, 2110),
      r("hibp", "Have I Been Pwned", "https://haveibeenpwned.com/", "tool", "breach-corpus membership check", "healthy", 71, 99.9, 3204),
      r("emailrep", "EmailRep.io", "https://emailrep.io/", "link", "reputation & risk signals", "healthy", 165, 99.1, 692),
      r("holehe", "Holehe", "https://github.com/megadose/holehe", "tool", "checks if an email is registered across 120+ sites", "degraded", 612, 94.3, 188),
      r("epieos", "Epieos", "https://epieos.com/", "link", "google account lookup", "healthy", 211, 98.4, 410),
    ],
  },
  {
    id: "domain",
    name: "Domain",
    input: "domain",
    icon: "globe",
    resources: [
      r("whois", "WHOIS Lookup", "https://www.whois.com/whois", "tool", "registrar & ownership records", "healthy", 102, 99.6, 4087),
      r("dnsdumpster", "DNSDumpster", "https://dnsdumpster.com/", "link", "DNS recon & subdomain mapping", "healthy", 188, 98.8, 1342),
      r("securitytrails", "SecurityTrails", "https://securitytrails.com/", "link", "historical DNS & subdomain corpus", "healthy", 244, 99.2, 1108),
      r("crtsh", "crt.sh", "https://crt.sh/", "tool", "certificate transparency search", "down", 0, 88.4, 0),
      r("builtwith", "BuiltWith", "https://builtwith.com/", "link", "tech stack profiling", "healthy", 318, 98.1, 902),
      r("wayback", "Wayback Machine", "https://web.archive.org/", "link", "historical site snapshots", "healthy", 412, 99.3, 1620),
    ],
  },
  {
    id: "ip",
    name: "IP Address",
    input: "ip",
    icon: "network",
    resources: [
      r("shodan", "Shodan", "https://www.shodan.io/", "tool", "internet-exposed services search", "healthy", 142, 99.8, 3812),
      r("censys", "Censys", "https://search.censys.io/", "tool", "host & certificate index", "healthy", 168, 99.4, 2210),
      r("ipinfo", "IPinfo", "https://ipinfo.io/", "link", "geolocation & ASN", "healthy", 64, 99.9, 4509),
      r("abuseipdb", "AbuseIPDB", "https://www.abuseipdb.com/", "link", "abuse-report aggregator", "healthy", 211, 99.0, 1842),
      r("greynoise", "GreyNoise", "https://www.greynoise.io/", "tool", "internet-scanner noise filter", "healthy", 188, 99.6, 1109),
    ],
  },
  {
    id: "image",
    name: "Images / Video",
    input: "url or upload",
    icon: "image",
    resources: [
      r("tineye", "TinEye", "https://tineye.com/", "link", "reverse image search", "healthy", 311, 99.1, 482),
      r("yandex-images", "Yandex Images", "https://yandex.com/images/", "link", "strongest reverse-image engine for faces", "healthy", 422, 98.7, 612),
      r("google-lens", "Google Lens", "https://lens.google.com/", "link", "object + text recognition", "healthy", 248, 99.4, 1009),
      r("fotoforensics", "FotoForensics", "https://fotoforensics.com/", "tool", "ELA & manipulation detection", "degraded", 812, 95.2, 88),
      r("exiftool", "ExifTool", "https://exiftool.org/", "manual", "local CLI for metadata extraction", "healthy", 0, 100, 0),
    ],
  },
  {
    id: "geo",
    name: "Geolocation",
    input: "coords or photo",
    icon: "map-pin",
    resources: [
      r("suncalc", "SunCalc", "https://www.suncalc.org/", "link", "sun position by date & location", "healthy", 188, 99.6, 308),
      r("kartaview", "KartaView", "https://kartaview.org/", "link", "open street-level imagery", "healthy", 401, 98.4, 142),
      r("mapillary", "Mapillary", "https://www.mapillary.com/", "link", "crowdsourced street view", "healthy", 322, 99.1, 188),
      r("overpass", "Overpass Turbo", "https://overpass-turbo.eu/", "tool", "structured queries against OpenStreetMap", "healthy", 612, 97.8, 411),
    ],
  },
  {
    id: "social",
    name: "Social",
    input: "handle, name, or url",
    icon: "users",
    resources: [
      r("tw-adv", "Twitter Advanced Search", "https://twitter.com/search-advanced", "link", "boolean search across the timeline", "healthy", 188, 98.4, 902),
      r("osint-combine", "OSINT Combine", "https://www.osintcombine.com/", "link", "social-network analysis toolkit", "healthy", 244, 99.2, 511),
      r("social-bearing", "Social Bearing", "https://socialbearing.com/", "link", "twitter analytics & search", "degraded", 712, 94.1, 188),
    ],
  },
  {
    id: "records",
    name: "Records",
    input: "name or entity",
    icon: "scale",
    resources: [
      r("opencorp", "OpenCorporates", "https://opencorporates.com/", "link", "company registry index, 200M+ entities", "healthy", 412, 99.0, 622),
      r("pacer", "PACER", "https://pacer.uscourts.gov/", "link", "US federal court records", "healthy", 488, 98.2, 211),
      r("courtlistener", "CourtListener", "https://www.courtlistener.com/", "link", "free case-law & docket search", "healthy", 312, 99.4, 188),
    ],
  },
  {
    id: "darkweb",
    name: "Dark Web",
    input: "keyword or onion",
    icon: "spider",
    resources: [
      r("ahmia", "Ahmia", "https://ahmia.fi/", "link", "search engine for clearnet-indexed onions", "healthy", 622, 97.4, 88),
      r("intelx", "IntelX", "https://intelx.io/", "tool", "darknet, paste & leak search", "healthy", 488, 99.0, 304),
    ],
  },
  {
    id: "threat",
    name: "Threat Intel",
    input: "ioc or hash",
    icon: "shield-alert",
    resources: [
      r("virustotal", "VirusTotal", "https://www.virustotal.com/", "tool", "file, URL & IOC scan aggregator", "healthy", 188, 99.8, 5402),
      r("otx", "AlienVault OTX", "https://otx.alienvault.com/", "link", "open threat-intel exchange", "healthy", 244, 99.2, 1822),
      r("mitre", "MITRE ATT&CK", "https://attack.mitre.org/", "link", "adversary TTP knowledge base", "healthy", 311, 99.4, 802),
      r("urlscan", "urlscan.io", "https://urlscan.io/", "tool", "sandboxed URL & page analysis", "healthy", 412, 99.1, 2188),
    ],
  },
];

function r(
  id: string,
  name: string,
  url: string,
  kind: ResourceKind,
  note: string,
  status: ResourceStatus,
  latencyMs: number,
  uptimePct: number,
  reqs24h: number,
): Resource {
  return { id, name, url, kind, note, status, latencyMs, uptimePct, reqs24h };
}

/* ────────────────────────────────────────────────────────────────── *
 * Telemetry rollups for the KPI strip + side charts.
 *
 * Computed deterministically from the static corpus so SSR and CSR
 * agree. In v2 these would come from Postgres rollups.
 * ────────────────────────────────────────────────────────────────── */

export function aggregateTelemetry(categories: Category[]) {
  const all = categories.flatMap((c) => c.resources);
  const probed = all.filter((r) => r.latencyMs > 0);
  const totalReqs = all.reduce((sum, r) => sum + r.reqs24h, 0);
  const avgLatency = probed.length
    ? Math.round(probed.reduce((sum, r) => sum + r.latencyMs, 0) / probed.length)
    : 0;
  const healthy = all.filter((r) => r.status === "healthy").length;
  const degraded = all.filter((r) => r.status === "degraded").length;
  const down = all.filter((r) => r.status === "down").length;
  // Weighted by 24h request volume so a degraded high-traffic source matters
  // more than a degraded long-tail one.
  const weightedSuccess = all.reduce((sum, r) => sum + (r.uptimePct / 100) * r.reqs24h, 0);
  const successRate = totalReqs > 0 ? (weightedSuccess / totalReqs) * 100 : 0;

  return {
    sources: all.length,
    sourcesHealthy: healthy,
    sourcesDegraded: degraded,
    sourcesDown: down,
    totalReqs,
    avgLatency,
    successRate,
  };
}

/**
 * 24-hour synthetic time-series for the header sparkline.
 * Deterministic pseudo-random so SSR/CSR match. Returns 24 hourly buckets,
 * oldest first, in the range [0, 1].
 */
export function lookupTrend24h(seed = 42): number[] {
  const out: number[] = [];
  let s = seed;
  for (let i = 0; i < 24; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const noise = (s & 0xff) / 255; // [0,1)
    // Diurnal bell: peak ~14:00, low ~04:00.
    const hour = i;
    const bell = Math.max(0.15, Math.sin(((hour - 4) / 24) * Math.PI));
    out.push(Math.min(1, bell * 0.7 + noise * 0.4));
  }
  return out;
}

/**
 * Coordinates for a stylized world-map dot grid (lat-lng → x-y in [0,1]).
 * Deterministic; renders as live-activity pings on the dashboard.
 */
export function worldActivityPings(): Array<{ x: number; y: number; weight: number }> {
  // Hand-placed clusters around major metros — enough to feel global without
  // shipping a full world geo-dataset. Weights bias dot size.
  return [
    { x: 0.18, y: 0.42, weight: 1.0 }, // San Francisco
    { x: 0.22, y: 0.43, weight: 0.7 }, // LA
    { x: 0.27, y: 0.40, weight: 0.9 }, // Chicago
    { x: 0.30, y: 0.42, weight: 1.0 }, // NYC / DC
    { x: 0.32, y: 0.55, weight: 0.6 }, // São Paulo
    { x: 0.46, y: 0.38, weight: 0.9 }, // London
    { x: 0.49, y: 0.40, weight: 0.7 }, // Amsterdam
    { x: 0.51, y: 0.39, weight: 0.8 }, // Berlin
    { x: 0.55, y: 0.42, weight: 0.6 }, // Istanbul
    { x: 0.50, y: 0.54, weight: 0.5 }, // Lagos
    { x: 0.55, y: 0.50, weight: 0.5 }, // Cairo
    { x: 0.60, y: 0.49, weight: 0.7 }, // Dubai
    { x: 0.68, y: 0.50, weight: 0.8 }, // Mumbai
    { x: 0.78, y: 0.42, weight: 1.0 }, // Beijing
    { x: 0.82, y: 0.44, weight: 1.0 }, // Tokyo
    { x: 0.79, y: 0.50, weight: 0.7 }, // Hong Kong / Shenzhen
    { x: 0.74, y: 0.55, weight: 0.6 }, // Bangkok
    { x: 0.78, y: 0.60, weight: 0.6 }, // Singapore
    { x: 0.88, y: 0.72, weight: 0.7 }, // Sydney
  ];
}

export function findCategory(id: string): Category | undefined {
  return OSINT_CATEGORIES.find((c) => c.id === id);
}

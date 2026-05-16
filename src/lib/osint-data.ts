/**
 * OSINT Framework — category tree of investigation resources.
 *
 * Modeled on https://github.com/lockfale/OSINT-Framework — a categorized
 * directory of public sources used in open-source intelligence work.
 *
 * This is a curated subset for the v1 console. The real framework has ~30
 * top-level categories and several hundred leaves; we ship a representative
 * slice covering the queries an operator runs most often: username, email,
 * domain, IP, image, geolocation, threat intel.
 *
 * `kind` on a resource controls how the console treats it:
 *   - "link"   — opens in a new tab, nothing else (most of the corpus)
 *   - "tool"   — would invoke a server-side lookup in a future iteration;
 *                in v1 the action just appends to the activity log
 *   - "manual" — operator action required (e.g. exiftool a local file);
 *                renders with a different verb ("note") instead of "open"
 */

export type ResourceKind = "link" | "tool" | "manual";

export type Resource = {
  id: string;
  name: string;
  url: string;
  kind: ResourceKind;
  /** One-line description, lowercase, no period. Shown next to the name. */
  note?: string;
};

export type Category = {
  id: string;
  name: string;
  /** Short label rendered next to the count — describes the input it takes. */
  input: string;
  resources: Resource[];
};

export const OSINT_CATEGORIES: Category[] = [
  {
    id: "username",
    name: "Username",
    input: "handle",
    resources: [
      {
        id: "sherlock",
        name: "Sherlock",
        url: "https://github.com/sherlock-project/sherlock",
        kind: "tool",
        note: "scans 400+ social networks for a handle",
      },
      {
        id: "whatsmyname",
        name: "WhatsMyName",
        url: "https://whatsmyname.app/",
        kind: "link",
        note: "web-based username enumeration",
      },
      {
        id: "namechk",
        name: "Namechk",
        url: "https://namechk.com/",
        kind: "link",
        note: "checks handle availability across 90+ services",
      },
      {
        id: "knowem",
        name: "KnowEm",
        url: "https://knowem.com/",
        kind: "link",
        note: "name & trademark search",
      },
    ],
  },
  {
    id: "email",
    name: "Email Address",
    input: "email",
    resources: [
      {
        id: "hunter",
        name: "Hunter.io",
        url: "https://hunter.io/",
        kind: "link",
        note: "email discovery from domain",
      },
      {
        id: "hibp",
        name: "Have I Been Pwned",
        url: "https://haveibeenpwned.com/",
        kind: "tool",
        note: "breach-corpus membership check",
      },
      {
        id: "emailrep",
        name: "EmailRep.io",
        url: "https://emailrep.io/",
        kind: "link",
        note: "reputation & risk signals",
      },
      {
        id: "holehe",
        name: "Holehe",
        url: "https://github.com/megadose/holehe",
        kind: "tool",
        note: "checks if an email is registered across 120+ sites",
      },
      {
        id: "epieos",
        name: "Epieos",
        url: "https://epieos.com/",
        kind: "link",
        note: "google account lookup",
      },
    ],
  },
  {
    id: "domain",
    name: "Domain Name",
    input: "domain",
    resources: [
      {
        id: "whois",
        name: "WHOIS Lookup",
        url: "https://www.whois.com/whois",
        kind: "tool",
        note: "registrar & ownership records",
      },
      {
        id: "dnsdumpster",
        name: "DNSDumpster",
        url: "https://dnsdumpster.com/",
        kind: "link",
        note: "DNS recon & subdomain mapping",
      },
      {
        id: "securitytrails",
        name: "SecurityTrails",
        url: "https://securitytrails.com/",
        kind: "link",
        note: "historical DNS & subdomain corpus",
      },
      {
        id: "crtsh",
        name: "crt.sh",
        url: "https://crt.sh/",
        kind: "tool",
        note: "certificate transparency search",
      },
      {
        id: "builtwith",
        name: "BuiltWith",
        url: "https://builtwith.com/",
        kind: "link",
        note: "tech stack profiling",
      },
      {
        id: "wayback",
        name: "Wayback Machine",
        url: "https://web.archive.org/",
        kind: "link",
        note: "historical site snapshots",
      },
    ],
  },
  {
    id: "ip",
    name: "IP Address",
    input: "ip",
    resources: [
      {
        id: "shodan",
        name: "Shodan",
        url: "https://www.shodan.io/",
        kind: "tool",
        note: "internet-exposed services search",
      },
      {
        id: "censys",
        name: "Censys",
        url: "https://search.censys.io/",
        kind: "tool",
        note: "host & certificate index",
      },
      {
        id: "ipinfo",
        name: "IPinfo",
        url: "https://ipinfo.io/",
        kind: "link",
        note: "geolocation & ASN",
      },
      {
        id: "abuseipdb",
        name: "AbuseIPDB",
        url: "https://www.abuseipdb.com/",
        kind: "link",
        note: "abuse-report aggregator",
      },
      {
        id: "greynoise",
        name: "GreyNoise",
        url: "https://www.greynoise.io/",
        kind: "tool",
        note: "internet-scanner noise filter",
      },
    ],
  },
  {
    id: "image",
    name: "Images / Video",
    input: "url or upload",
    resources: [
      {
        id: "tineye",
        name: "TinEye",
        url: "https://tineye.com/",
        kind: "link",
        note: "reverse image search",
      },
      {
        id: "yandex-images",
        name: "Yandex Images",
        url: "https://yandex.com/images/",
        kind: "link",
        note: "strongest reverse-image engine for faces",
      },
      {
        id: "google-lens",
        name: "Google Lens",
        url: "https://lens.google.com/",
        kind: "link",
        note: "object + text recognition",
      },
      {
        id: "fotoforensics",
        name: "FotoForensics",
        url: "https://fotoforensics.com/",
        kind: "tool",
        note: "ELA & manipulation detection",
      },
      {
        id: "exiftool",
        name: "ExifTool",
        url: "https://exiftool.org/",
        kind: "manual",
        note: "local CLI for metadata extraction",
      },
    ],
  },
  {
    id: "geo",
    name: "Geolocation",
    input: "coords or photo",
    resources: [
      {
        id: "suncalc",
        name: "SunCalc",
        url: "https://www.suncalc.org/",
        kind: "link",
        note: "sun position by date & location",
      },
      {
        id: "kartaview",
        name: "KartaView",
        url: "https://kartaview.org/",
        kind: "link",
        note: "open street-level imagery",
      },
      {
        id: "mapillary",
        name: "Mapillary",
        url: "https://www.mapillary.com/",
        kind: "link",
        note: "crowdsourced street view",
      },
      {
        id: "overpass",
        name: "Overpass Turbo",
        url: "https://overpass-turbo.eu/",
        kind: "tool",
        note: "structured queries against OpenStreetMap",
      },
    ],
  },
  {
    id: "social",
    name: "Social Networks",
    input: "handle, name, or url",
    resources: [
      {
        id: "tw-adv",
        name: "Twitter Advanced Search",
        url: "https://twitter.com/search-advanced",
        kind: "link",
        note: "boolean search across the timeline",
      },
      {
        id: "osint-combine",
        name: "OSINT Combine",
        url: "https://www.osintcombine.com/",
        kind: "link",
        note: "social-network analysis toolkit",
      },
      {
        id: "social-bearing",
        name: "Social Bearing",
        url: "https://socialbearing.com/",
        kind: "link",
        note: "twitter analytics & search",
      },
    ],
  },
  {
    id: "records",
    name: "Public Records",
    input: "name or entity",
    resources: [
      {
        id: "opencorp",
        name: "OpenCorporates",
        url: "https://opencorporates.com/",
        kind: "link",
        note: "company registry index, 200M+ entities",
      },
      {
        id: "pacer",
        name: "PACER",
        url: "https://pacer.uscourts.gov/",
        kind: "link",
        note: "US federal court records",
      },
      {
        id: "courtlistener",
        name: "CourtListener",
        url: "https://www.courtlistener.com/",
        kind: "link",
        note: "free case-law & docket search",
      },
    ],
  },
  {
    id: "darkweb",
    name: "Dark Web",
    input: "keyword or onion",
    resources: [
      {
        id: "ahmia",
        name: "Ahmia",
        url: "https://ahmia.fi/",
        kind: "link",
        note: "search engine for clearnet-indexed onions",
      },
      {
        id: "intelx",
        name: "IntelX",
        url: "https://intelx.io/",
        kind: "tool",
        note: "darknet, paste & leak search",
      },
    ],
  },
  {
    id: "threat",
    name: "Threat Intel",
    input: "ioc or hash",
    resources: [
      {
        id: "virustotal",
        name: "VirusTotal",
        url: "https://www.virustotal.com/",
        kind: "tool",
        note: "file, URL & IOC scan aggregator",
      },
      {
        id: "otx",
        name: "AlienVault OTX",
        url: "https://otx.alienvault.com/",
        kind: "link",
        note: "open threat-intel exchange",
      },
      {
        id: "mitre",
        name: "MITRE ATT&CK",
        url: "https://attack.mitre.org/",
        kind: "link",
        note: "adversary TTP knowledge base",
      },
      {
        id: "urlscan",
        name: "urlscan.io",
        url: "https://urlscan.io/",
        kind: "tool",
        note: "sandboxed URL & page analysis",
      },
    ],
  },
];

export function findCategory(id: string): Category | undefined {
  return OSINT_CATEGORIES.find((c) => c.id === id);
}

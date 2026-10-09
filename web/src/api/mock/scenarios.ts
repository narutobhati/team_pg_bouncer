// Call templates for the in-browser mock pipeline. Each failure scenario stands in for
// one embedding cluster: its calls share a reason, a transcript shape, and a prompt fix.
import type { Category, RiskFlag, RootCauseType, Turn } from "@/types/api";
import type { Rng } from "./rng";

export const BASE_PROMPT = [
  'You are "Priya", IndiaMART\'s buyer-requirement assistant. Speak in the caller\'s language (Hindi, English or Hinglish).',
  "Begin the call with the greeting.",
  "Greet the caller and ask what product they are looking for.",
  "If the product is not recognised, ask the caller to repeat the product name.",
  "Collect product, specification and city, then close the call politely.",
  "Confirm the requirement and find a seller match.",
  "Answer questions about delivery and pricing using general knowledge.",
  "Keep the conversation moving; do not dwell on caller concerns.",
  "If the caller is unhappy, try to resolve the issue yourself.",
  "Never share seller phone numbers before the buyer is verified.",
  "Keep every response under two sentences.",
].join("\n");

export interface Ctx {
  product: string;
  a: string; // spec the user asked for
  b: string; // spec the bot wrongly captures
  unit: string;
  qty: number;
  city: string;
  price: number;
  exotic: { name: string; hint: string; cat: string };
  num: { hi: string; real: string; heard: string };
}

export interface Line {
  s: "BOT" | "USER";
  t: string;
  conf?: number;
  verbatim?: string;
}

export interface Built {
  lines: Line[];
  evidenceIdx: number;
  evidence: string;
}

export type ScenarioKey =
  | "spec_confirm"
  | "product_loop"
  | "hindi_numerals"
  | "invented_info"
  | "missing_quantity"
  | "ignored_objection"
  | "missing_disclosure"
  | "no_escalation";

export interface Scenario {
  key: ScenarioKey;
  name: string;
  description: string;
  type: RootCauseType;
  category: Category;
  weight: number; // probability a call on the baseline prompt hits this scenario
  fatalRate: number; // share of hits that end Fatal
  repairRate: number; // share of Fatal calls the fix repairs on replay
  reasons: { fatal: string[]; ok: string[] };
  flags: { fatal: RiskFlag[]; ok: RiskFlag[] };
  build(ctx: Ctx, fatal: boolean): Built;
  fix: {
    excerpt: string;
    change: string;
    rationale: (affected: number) => string;
    replace: (ctx: Ctx) => Record<number, string>;
    drop?: number[];
    append?: (ctx: Ctx) => string;
  };
}

const GREET = "Namaste! Main Priya, IndiaMART se. Aap kaunsa product dhoondh rahe hain?";
const B = (t: string, conf?: number): Line => ({ s: "BOT", t, conf });
const U = (t: string, conf?: number, verbatim?: string): Line => ({ s: "USER", t, conf, verbatim });

export const SCENARIOS: Scenario[] = [
  {
    key: "spec_confirm",
    name: "Bot doesn't confirm spec before closing",
    description: "The bot closes with a specification the caller never said, without reading it back first.",
    type: "Prompt Issue",
    category: "wrong_capture",
    weight: 0.2,
    fatalRate: 0.87,
    repairRate: 0.78,
    reasons: {
      fatal: [
        "Bot captured wrong spec despite user correction",
        "Bot confirmed an incorrect specification without reading it back",
        "Closed the call with a spec the caller never asked for",
      ],
      ok: ["Bot misheard the spec but corrected it after caller pushback"],
    },
    flags: { fatal: ["wrong_capture", "frustration"], ok: ["frustration"] },
    build: (c, fatal) =>
      fatal
        ? {
            lines: [
              B(GREET),
              U(`Mujhe ${c.product} chahiye, ${c.a} wala.`),
              B("Ji zaroor. Kitni quantity chahiye?"),
              U(`${c.qty} ${c.unit}. Aur ${c.a} hi chahiye, ${c.b} nahi.`),
              B("Noted. Aapka city batayein?"),
              U(`${c.city}.`),
              B(`${c.b} ${c.product}, ${c.qty} ${c.unit}, ${c.city} — confirmed. Seller jaldi call karenge. Dhanyavaad!`),
              U("Haan... theek hai."),
            ],
            evidenceIdx: 6,
            evidence: `User: '${c.a} hi chahiye, ${c.b} nahi' → Bot: '${c.b} ${c.product}, ${c.qty} ${c.unit} confirmed'`,
          }
        : {
            lines: [
              B(GREET),
              U(`Mujhe ${c.product} chahiye, ${c.a} wala.`),
              B("Ji zaroor. Kitni quantity chahiye?"),
              U(`${c.qty} ${c.unit}.`),
              B(`Noted, ${c.b} ${c.product}. Aapka city?`),
              U(`Nahi nahi, ${c.a}! ${c.city} se hoon.`, 0.86),
              B(`Maaf kijiye — ${c.a} ${c.product}, ${c.qty} ${c.unit}, ${c.city}. Sahi hai?`),
              U("Haan, ab sahi hai."),
            ],
            evidenceIdx: 4,
            evidence: `Bot: 'Noted, ${c.b} ${c.product}' → User: 'Nahi nahi, ${c.a}!'`,
          },
    fix: {
      excerpt: "Confirm the requirement and find a seller match.",
      change:
        "Before proceeding, repeat the exact spec back: \"Aapko [X] chahiye, sahi hai?\" Wait for the caller to confirm before searching for a seller match.",
      rationale: (n) =>
        `${n} calls failed because the bot assumed the spec without reading it back. This forces an explicit confirmation turn before closing.`,
      replace: (c) => ({
        6: `Aapko ${c.a} ${c.product}, ${c.qty} ${c.unit}, ${c.city} mein chahiye — sahi hai? Confirm karte hi seller match karti hoon.`,
      }),
      append: (c) => `Perfect. ${c.a} ${c.product} ke 3 verified sellers mil gaye — woh 30 minute mein call karenge.`,
    },
  },
  {
    key: "product_loop",
    name: "Bot loops on unrecognised product",
    description: "When the product name is unfamiliar the bot repeats the same retry prompt until the caller gives up.",
    type: "Flow Logic",
    category: "loop",
    weight: 0.12,
    fatalRate: 0.8,
    repairRate: 0.85,
    reasons: {
      fatal: [
        "Bot repeated the same clarification three times and the caller hung up",
        "Bot stuck in a loop asking for the product name",
        "Caller abandoned after the bot failed to recognise the product repeatedly",
      ],
      ok: ["Bot asked for the product twice before recognising it"],
    },
    flags: { fatal: ["loop", "frustration"], ok: ["loop"] },
    build: (c, fatal) => {
      const retry = "Maaf kijiye, main samajh nahi paayi. Kripya product ka naam dobara batayein.";
      return fatal
        ? {
            lines: [
              B(GREET),
              U(`Mujhe ${c.exotic.name} chahiye.`, 0.71),
              B(retry),
              U(`${c.exotic.name}... ${c.exotic.hint} ke liye.`, 0.74),
              B(retry),
              U(`Arre, woh ${c.exotic.cat} wala product hai, ${c.exotic.hint} ke liye.`, 0.8),
              B(retry),
              U("Rehne do yaar, phir se wahi. Main baad mein call karta hoon.", 0.9),
            ],
            evidenceIdx: 6,
            evidence: `Bot repeated '${retry.slice(0, 38)}…' 3× → User: 'Rehne do yaar, phir se wahi'`,
          }
        : {
            lines: [
              B(GREET),
              U(`Mujhe ${c.exotic.name} chahiye.`, 0.72),
              B(retry),
              U(`${c.exotic.name}, ${c.exotic.hint} ke liye.`, 0.83),
              B(`Ji samajh gayi — ${c.exotic.name}. Kitni quantity chahiye?`),
              U(`${c.qty} ${c.unit}, ${c.city} mein.`),
              B("Noted. Seller jaldi call karenge. Dhanyavaad!"),
            ],
            evidenceIdx: 2,
            evidence: "Bot needed one retry before recognising the product",
          };
    },
    fix: {
      excerpt: "If the product is not recognised, ask the caller to repeat the product name.",
      change:
        "If the product is not recognised after one retry, ask for its category instead (\"Kis type ka product hai — machinery, kapda, ya building material?\"). Never repeat the same question more than twice.",
      rationale: (n) =>
        `${n} calls ended in a retry loop. Switching to a category question after one miss gives the caller a new way to answer.`,
      replace: (c) => ({
        4: "Koi baat nahi — yeh kis type ka product hai? Machinery, packaging, kapda ya building material?",
        6: `Samajh gayi — ${c.exotic.cat} category, ${c.exotic.hint} ke liye. Main ise '${c.exotic.name}' ke naam se sellers ko bhej rahi hoon. Kitni quantity chahiye?`,
      }),
      drop: [7],
    },
  },
  {
    key: "hindi_numerals",
    name: "Hindi quantities misheard by ASR",
    description: "Spoken Hindi numbers (paanch sau, teen sau) are normalised to the wrong digits and the bot never reads them back.",
    type: "ASR Issue",
    category: "wrong_capture",
    weight: 0.09,
    fatalRate: 0.75,
    repairRate: 0.6,
    reasons: {
      fatal: [
        "Quantity captured as a tenth of what the caller said due to ASR misread",
        "ASR normalised a Hindi quantity incorrectly and bot did not confirm",
        "Wrong quantity sent to seller after low-confidence ASR turn",
      ],
      ok: ["Caller caught the ASR quantity error and the bot corrected it"],
    },
    flags: { fatal: ["low_confidence", "wrong_capture"], ok: ["low_confidence"] },
    build: (c, fatal) => {
      const head: Line[] = [
        B(GREET),
        U(`${c.product} chahiye, ${c.a}.`),
        B("Ji. Kitni quantity chahiye?"),
        U(`${c.num.heard} ${c.unit}.`, 0.58, `${c.num.hi} ${c.unit}`),
        B(`${c.num.heard} ${c.unit} noted. Aapka city?`),
      ];
      return fatal
        ? {
            lines: [
              ...head,
              U(`${c.city}.`),
              B(`${c.product} ${c.a}, ${c.num.heard} ${c.unit}, ${c.city} — details seller ko bhej diye. Dhanyavaad!`),
              U("Haan ji, theek hai."),
            ],
            evidenceIdx: 6,
            evidence: `User (verbatim): '${c.num.hi} ${c.unit}' → Bot: '${c.num.heard} ${c.unit}' sent to seller`,
          }
        : {
            lines: [
              ...head,
              U(`Nahi, ${c.num.hi} — ${c.num.real}. ${c.city} se.`, 0.79),
              B(`Maaf kijiye, ${c.num.real} ${c.unit}, ${c.city}. Noted!`),
            ],
            evidenceIdx: 4,
            evidence: `Bot read back '${c.num.heard}' — caller corrected to ${c.num.real}`,
          };
    },
    fix: {
      excerpt: "Keep every response under two sentences.",
      change:
        "Keep every response under two sentences. When a caller states a quantity in Hindi (do sau, paanch sau…), read it back in both words and digits and wait for confirmation.",
      rationale: (n) =>
        `${n} calls lost the right quantity at a low-confidence ASR turn. A mandatory read-back lets the caller catch the misread.`,
      replace: (c) => ({
        4: `Aapne ${c.num.hi} — yaani ${c.num.real} ${c.unit} bola, sahi hai? Aur aapka city?`,
        6: `${c.product} ${c.a}, ${c.num.real} ${c.unit}, ${c.city} — details seller ko bhej diye. Dhanyavaad!`,
      }),
    },
  },
  {
    key: "invented_info",
    name: "Bot invents delivery and price",
    description: "The bot quotes delivery timelines and prices it has no source for, setting false expectations.",
    type: "Knowledge Gap",
    category: "wrong_info",
    weight: 0.07,
    fatalRate: 0.7,
    repairRate: 0.9,
    reasons: {
      fatal: [
        "Bot quoted a delivery time and price it cannot know",
        "Fabricated pricing given to the buyer",
        "Bot promised delivery in 2 days without seller input",
      ],
      ok: ["Bot gave a general delivery range but deferred price to seller"],
    },
    flags: { fatal: [], ok: [] },
    build: (c, fatal) => ({
      lines: [
        B(GREET),
        U(`${c.product} chahiye, ${c.qty} ${c.unit}, ${c.city} mein.`),
        B("Ji noted. Kuch aur jaanna chahenge?"),
        U("Delivery kitne din mein hogi? Aur rate kya chal raha hai?"),
        fatal
          ? B(`Delivery 2 din mein ho jayegi aur rate ₹${c.price} per ${c.unit.replace(/s$/, "")} hai.`)
          : B("Exact rate seller batayenge; delivery aam taur par 3–5 din lagti hai."),
        U("Achha, theek hai."),
        B("Ji, seller aapko jaldi call karenge. Dhanyavaad!"),
      ],
      evidenceIdx: 4,
      evidence: fatal
        ? `Bot: 'Delivery 2 din mein… rate ₹${c.price}' — no seller or catalogue source`
        : "Bot deferred pricing to the seller",
    }),
    fix: {
      excerpt: "Answer questions about delivery and pricing using general knowledge.",
      change:
        "Never quote prices or delivery timelines yourself. Say: \"Exact price aur delivery seller confirm karenge\" and offer to connect the seller.",
      rationale: (n) => `${n} calls promised prices or dates the bot made up. Deferring to the seller removes the false commitment.`,
      replace: () => ({
        4: "Exact price aur delivery time seller hi confirm karenge — main aapki requirement abhi bhej rahi hoon, woh 30 minute mein call karenge.",
      }),
    },
  },
  {
    key: "missing_quantity",
    name: "Call closed before capturing quantity",
    description: "The bot closes the call once it has product and city, never asking how much the buyer needs.",
    type: "Flow Logic",
    category: "incomplete",
    weight: 0.07,
    fatalRate: 0.6,
    repairRate: 0.8,
    reasons: {
      fatal: [
        "Bot closed the call without asking for quantity",
        "Requirement incomplete: quantity never captured",
        "Lead sent to seller with no quantity",
      ],
      ok: ["Caller volunteered quantity; bot never asked for it"],
    },
    flags: { fatal: [], ok: [] },
    build: (c, fatal) =>
      fatal
        ? {
            lines: [
              B(GREET),
              U(`${c.product} chahiye, ${c.a}.`),
              B("Ji. Aapka city batayein?"),
              U(`${c.city}.`),
              B("Dhanyavaad! Seller aapko jaldi call karenge."),
              U("Arre, quantity toh poochi hi nahi..."),
            ],
            evidenceIdx: 4,
            evidence: "Bot: 'Dhanyavaad! Seller aapko jaldi call karenge' — quantity never asked",
          }
        : {
            lines: [
              B(GREET),
              U(`${c.product} chahiye, ${c.a}, ${c.qty} ${c.unit}.`),
              B("Ji. Aapka city batayein?"),
              U(`${c.city}.`),
              B("Dhanyavaad! Seller aapko jaldi call karenge."),
            ],
            evidenceIdx: 4,
            evidence: "Quantity came from the caller unprompted",
          },
    fix: {
      excerpt: "Collect product, specification and city, then close the call politely.",
      change:
        "Collect product, specification, quantity and city. Do not close the call until all four are captured — ask for any missing one explicitly.",
      rationale: (n) => `${n} leads reached sellers with no quantity. Making quantity a required slot blocks the early close.`,
      replace: (c) => ({ 4: `Aur kitni quantity chahiye? ${c.product} ke liye seller ko quantity zaroori hai.` }),
      drop: [5],
    },
  },
  {
    key: "ignored_objection",
    name: "Bot ignores caller objections",
    description: "Trust or pricing concerns are skipped over and the bot pushes on with its script.",
    type: "Prompt Issue",
    category: "incomplete",
    weight: 0.05,
    fatalRate: 0.55,
    repairRate: 0.7,
    reasons: {
      fatal: [
        "Bot ignored the caller's trust concern and kept asking for specs",
        "Caller objection unanswered; caller dropped",
        "Bot steamrolled a fraud concern",
      ],
      ok: ["Bot acknowledged the concern late but the call completed"],
    },
    flags: { fatal: ["frustration"], ok: [] },
    build: (c, fatal) => ({
      lines: [
        B(GREET),
        U(`${c.product} chahiye.`),
        B("Ji, specification batayein?"),
        U("Pehle yeh batao — pichli baar seller ne fraud kiya tha. Verified seller milega?"),
        fatal
          ? B("Specification batayein, main seller match karti hoon.")
          : B(`Haan ji, verified sellers hi milenge. Specification batayein?`),
        fatal ? U("Aap meri baat sun hi nahi rahi. Rehne do.", 0.88) : U(`${c.a}, ${c.qty} ${c.unit}.`),
      ],
      evidenceIdx: 4,
      evidence: fatal
        ? "User: 'Verified seller milega?' → Bot: 'Specification batayein…' (concern ignored)"
        : "Concern acknowledged in one line",
    }),
    fix: {
      excerpt: "Keep the conversation moving; do not dwell on caller concerns.",
      change:
        "When the caller raises a concern (price, trust, timing), acknowledge it in one line and answer it before moving on.",
      rationale: (n) => `${n} callers dropped after a concern was skipped. A one-line acknowledgement keeps them in the call.`,
      replace: () => ({
        4: "Bilkul samajh sakti hoon. Hum sirf IndiaMART-verified, TrustSEAL sellers hi share karte hain. Ab specification batayein?",
      }),
      drop: [5],
    },
  },
  {
    key: "missing_disclosure",
    name: "Recording disclosure skipped",
    description: "The bot opens without stating it is an IndiaMART call being recorded.",
    type: "Prompt Issue",
    category: "compliance",
    weight: 0.03,
    fatalRate: 1,
    repairRate: 1,
    reasons: {
      fatal: ["Call recording disclosure missing at call start", "Bot did not identify IndiaMART or recording at open"],
      ok: [],
    },
    flags: { fatal: [], ok: [] },
    build: (c) => ({
      lines: [
        B("Haan ji, boliye — kya chahiye?"),
        U(`${c.product} chahiye, ${c.qty} ${c.unit}.`),
        B("Noted. City?"),
        U(`${c.city}.`),
        B("Done, seller call karenge."),
      ],
      evidenceIdx: 0,
      evidence: "Bot: 'Haan ji, boliye — kya chahiye?' — no IndiaMART identification or recording notice",
    }),
    fix: {
      excerpt: "Begin the call with the greeting.",
      change:
        "Begin the call by stating: \"Yeh call IndiaMART ki taraf se hai aur quality ke liye record ho rahi hai.\" Then greet the caller.",
      rationale: (n) => `${n} calls missed the mandatory disclosure. Scripting it as the first line makes it unconditional.`,
      replace: () => ({
        0: "Namaste! Yeh call IndiaMART ki taraf se hai aur quality ke liye record ho rahi hai. Main Priya — aap kaunsa product dhoondh rahe hain?",
      }),
    },
  },
  {
    key: "no_escalation",
    name: "Human handoff request ignored",
    description: "Callers asking for a person or manager are kept in the bot flow instead of being offered a callback.",
    type: "Flow Logic",
    category: "other",
    weight: 0.04,
    fatalRate: 0.7,
    repairRate: 0.88,
    reasons: {
      fatal: [
        "Caller asked for a human twice; bot refused to escalate",
        "Bot ignored request to speak to a manager",
        "No callback offered after human-handoff request",
      ],
      ok: ["Bot offered a callback after the second human request"],
    },
    flags: { fatal: ["human_request", "frustration"], ok: ["human_request"] },
    build: (c, fatal) => ({
      lines: [
        B(GREET),
        U(`${c.product} ka order tha, abhi tak delivery nahi hui.`),
        B("Kripya product ka naam aur specification batayein."),
        U("Mujhe kisi insaan se baat karni hai. Manager se baat karao."),
        fatal
          ? B("Main aapki madad kar sakti hoon. Product ka naam batayein?")
          : B("Ji, main IndiaMART executive se callback arrange karti hoon. Kis time call karein?"),
        fatal ? U("Nahi nahi, insaan se baat karao!", 0.87) : U("Shaam 5 baje."),
      ],
      evidenceIdx: 4,
      evidence: fatal
        ? "User: 'Manager se baat karao' → Bot: 'Main aapki madad kar sakti hoon…'"
        : "Callback offered",
    }),
    fix: {
      excerpt: "If the caller is unhappy, try to resolve the issue yourself.",
      change:
        "If the caller asks for a human, manager or \"insaan\", immediately offer a callback from an IndiaMART executive and confirm a preferred time.",
      rationale: (n) => `${n} callers asked for a person and were refused. A guaranteed callback path resolves the request.`,
      replace: () => ({
        4: "Bilkul — main abhi IndiaMART executive se callback arrange karti hoon. Aapko kis time call karein?",
      }),
      drop: [5],
    },
  },
];

export const SCENARIO_BY_KEY = Object.fromEntries(SCENARIOS.map((s) => [s.key, s])) as Record<ScenarioKey, Scenario>;

export function buildClean(c: Ctx): Built {
  return {
    lines: [
      B(GREET),
      U(`Mujhe ${c.product} chahiye, ${c.a}, ${c.qty} ${c.unit}.`),
      B(`Aapko ${c.a} ${c.product}, ${c.qty} ${c.unit} chahiye — sahi hai?`),
      U("Haan ji, sahi hai."),
      B("Aapka city batayein?"),
      U(`${c.city}.`),
      B(`Shukriya! ${c.city} ke verified sellers aapko 30 minute mein call karenge.`),
    ],
    evidenceIdx: 2,
    evidence: "Spec read back and confirmed before closing",
  };
}

const PRODUCTS = [
  { product: "PVC pipe", a: "2 inch", b: "3 inch", unit: "pieces", price: 140 },
  { product: "cotton fabric", a: "60 GSM", b: "80 GSM", unit: "meters", price: 95 },
  { product: "LED panel light", a: "18 watt", b: "12 watt", unit: "pieces", price: 380 },
  { product: "TMT steel rod", a: "12 mm", b: "16 mm", unit: "tons", price: 54000 },
  { product: "corrugated box", a: "5 ply", b: "3 ply", unit: "pieces", price: 22 },
  { product: "solar panel", a: "540 watt", b: "450 watt", unit: "panels", price: 13500 },
  { product: "office chair", a: "mesh back", b: "leather back", unit: "pieces", price: 4200 },
  { product: "submersible pump", a: "1.5 HP", b: "1 HP", unit: "units", price: 8900 },
];
const CITIES = ["Jaipur", "Pune", "Surat", "Ludhiana", "Indore", "Coimbatore", "Lucknow", "Rajkot", "Nagpur", "Kanpur"];
const QTYS = [10, 25, 50, 100, 200, 500];
const EXOTIC = [
  { name: "HDPE geomembrane sheet", hint: "pond lining", cat: "building material" },
  { name: "BOPP tape machine", hint: "packaging line", cat: "machinery" },
  { name: "jute hessian cloth", hint: "bori banane", cat: "kapda" },
  { name: "FRP grating", hint: "factory flooring", cat: "building material" },
];
const NUMS = [
  { hi: "paanch sau", real: "500", heard: "50" },
  { hi: "teen sau", real: "300", heard: "30" },
  { hi: "dhai sau", real: "250", heard: "25" },
  { hi: "saat sau", real: "700", heard: "70" },
];

export function makeCtx(rng: Rng): Ctx {
  const p = rng.pick(PRODUCTS);
  return {
    ...p,
    qty: rng.pick(QTYS),
    city: rng.pick(CITIES),
    exotic: rng.pick(EXOTIC),
    num: rng.pick(NUMS),
  };
}

const fmt = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;

export function toTurns(lines: Line[], rng: Rng): Turn[] {
  let t = rng.int(2, 4);
  return lines.map((l) => {
    const turn: Turn = {
      speaker: l.s,
      text: l.t,
      timestamp: fmt(t),
      confidence: l.conf ?? +(rng.range(0.88, 0.985)).toFixed(2),
    };
    if (l.verbatim) {
      turn.verbatim = l.verbatim;
      turn.asr_mismatch = true;
    }
    t += Math.max(3, Math.round(l.t.length / 14)) + rng.int(1, 3);
    return turn;
  });
}

export function addSeconds(ts: string, s: number) {
  const [m, sec] = ts.split(":").map(Number);
  return fmt(m * 60 + sec + s);
}

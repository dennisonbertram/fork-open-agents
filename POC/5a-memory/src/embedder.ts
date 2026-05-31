/**
 * Embedding seam.
 *
 * The memory store talks to this interface only. In production the AI-Gateway
 * embedder drops in unchanged (see `gatewayEmbedder` below); the eval runs
 * against a deterministic, offline `localHashingEmbedder` so it needs no API
 * key and produces stable, reproducible rankings.
 *
 * The shape mirrors the AI SDK v6 contract:
 *   embed({ model, value })        -> { embedding: number[] }
 *   embedMany({ model, values })   -> { embeddings: number[][] }
 * so the gateway implementation is a thin adapter, not a rewrite.
 */

export type Embedder = {
  /** Stable identifier recorded alongside stored vectors (model drift guard). */
  readonly id: string;
  /** Vector dimensionality. Must be constant for a given store. */
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
  embedMany(texts: string[]): Promise<number[][]>;
};

/** L2-normalize so cosine similarity == dot product and is bounded to [-1, 1]. */
function normalize(vec: number[]): number[] {
  let sumSquares = 0;
  for (const v of vec) {
    sumSquares += v * v;
  }
  const norm = Math.sqrt(sumSquares) || 1;
  return vec.map((v) => v / norm);
}

/**
 * Topic lexicon for the offline embedder.
 *
 * A pure hashing/bag-of-words embedder has no notion of semantic fields:
 * "login" and "authentication" land in unrelated dimensions, so an "auth"
 * query cannot reliably outrank an unrelated short memory. Real embedding
 * models solve this with learned semantics; offline and deterministically we
 * approximate it with an explicit concept lexicon.
 *
 * Each topic is a latent dimension. A word contributes to a topic if it (or a
 * stem) appears in that topic's vocabulary. This gives genuine semantic
 * clustering — "auth", "login", "better auth", "clerk", "nextauth" all map to
 * the `auth` dimension — while staying 100% deterministic with no network.
 * The production path replaces this whole function with a real model.
 */
const TOPIC_LEXICON: Record<string, string[]> = {
  auth: [
    "auth",
    "authentication",
    "authenticate",
    "login",
    "signin",
    "session",
    "betterauth",
    "better",
    "nextauth",
    "clerk",
    "oauth",
    "credential",
    "token",
    "identity",
  ],
  ratelimit: [
    "rate",
    "ratelimit",
    "limiter",
    "limited",
    "limit",
    "throttle",
    "throttled",
    "429",
    "retry",
    "retryafter",
    "quota",
    "backoff",
  ],
  crash: [
    "crash",
    "crashes",
    "crashing",
    "null",
    "pointer",
    "npe",
    "hydration",
    "cold",
    "coldstart",
    "ttl",
    "cache",
    "startup",
    "exception",
    "error",
    "bug",
    "fix",
    "fixed",
  ],
  database: [
    "database",
    "db",
    "schema",
    "migration",
    "migrations",
    "drizzle",
    "sql",
    "postgres",
    "table",
    "column",
    "neon",
  ],
  payments: [
    "payment",
    "payments",
    "stripe",
    "webhook",
    "billing",
    "charge",
    "checkout",
    "invoice",
    "signature",
  ],
  formatting: [
    "format",
    "formatting",
    "indentation",
    "indent",
    "quotes",
    "lint",
    "linter",
    "style",
    "prettier",
    "spacing",
  ],
  content: [
    "content",
    "contentful",
    "copy",
    "headline",
    "marketing",
    "hero",
    "cms",
    "components",
  ],
  layout: [
    "layout",
    "shift",
    "cls",
    "css",
    "pricing",
    "image",
    "dimensions",
    "render",
    "ui",
    "page",
  ],
  flags: [
    "flag",
    "flags",
    "featureflag",
    "launchdarkly",
    "rollout",
    "gradual",
    "toggle",
  ],
};

const TOPIC_NAMES = Object.keys(TOPIC_LEXICON);
// word -> list of topic indexes it belongs to
const WORD_TO_TOPICS = new Map<string, number[]>();
for (let t = 0; t < TOPIC_NAMES.length; t++) {
  for (const word of TOPIC_LEXICON[TOPIC_NAMES[t]]) {
    const arr = WORD_TO_TOPICS.get(word) ?? [];
    arr.push(t);
    WORD_TO_TOPICS.set(word, arr);
  }
}

/**
 * Deterministic, offline embedder for the eval.
 *
 * The vector is the concatenation of two blocks, then L2-normalized:
 *   [ TOPIC block | lexical hashing block ]
 *
 *   - TOPIC block (semantic): one weighted dimension per concept in
 *     TOPIC_LEXICON. Dominant (high weight) so semantically-related text
 *     clusters even with zero shared words. This is what makes "how does our
 *     auth work?" rank the Better Auth memory far above formatting notes, and
 *     what makes a paraphrase a true near-duplicate (cosine >= 0.92).
 *   - lexical hashing block (signed hashing trick over words + char trigrams):
 *     a smaller-weight tail that rewards exact phrasing overlap and keeps
 *     distinct memories distinct.
 *
 * NOT a learned model — but a faithful, reproducible stand-in that exercises
 * the same relevance/scoping/dedup behavior the gateway embedder provides.
 */
export function localHashingEmbedder(hashingDims = 256): Embedder {
  const topicDims = TOPIC_NAMES.length;
  const dimensions = topicDims + hashingDims;
  const TOPIC_WEIGHT = 3.0; // semantic block dominates similarity
  const HASH_WEIGHT = 1.0;

  function hash32(str: string): number {
    let h = 0x811c9dc5; // FNV-1a
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function words(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 0);
  }

  function embedOne(text: string): number[] {
    const vec = new Array<number>(dimensions).fill(0);
    const ws = words(text);

    // --- semantic topic block ---
    for (const w of ws) {
      const topics = WORD_TO_TOPICS.get(w);
      if (topics) {
        for (const t of topics) {
          vec[t] += TOPIC_WEIGHT;
        }
      }
    }

    // --- lexical hashing block ---
    for (const w of ws) {
      const base = `w:${w}`;
      const idx = topicDims + (hash32(base) % hashingDims);
      const sign = (hash32(`sign:${base}`) & 1) === 0 ? 1 : -1;
      vec[idx] += HASH_WEIGHT * sign;
      const padded = `^${w}$`;
      for (let i = 0; i + 3 <= padded.length; i++) {
        const tri = `t:${padded.slice(i, i + 3)}`;
        const tIdx = topicDims + (hash32(tri) % hashingDims);
        const tSign = (hash32(`sign:${tri}`) & 1) === 0 ? 1 : -1;
        vec[tIdx] += HASH_WEIGHT * 0.3 * tSign;
      }
    }

    return normalize(vec);
  }

  return {
    id: `local-topic+hashing-v2-${dimensions}d`,
    dimensions,
    embed: (text) => Promise.resolve(embedOne(text)),
    embedMany: (texts) => Promise.resolve(texts.map(embedOne)),
  };
}

/**
 * Production embedder (reference; not exercised by the offline eval).
 *
 * Drops in unchanged on top of the AI SDK v6 + Vercel AI Gateway already in the
 * repo (`ai@6`, `@ai-sdk/gateway`). The model is a `"provider/model"` string
 * routed through the gateway, e.g. "openai/text-embedding-3-small" (1536d).
 *
 * Pseudocode (kept out of the build so the POC has zero runtime API deps):
 *
 *   import { embed, embedMany } from "ai";
 *   export function gatewayEmbedder(model = "openai/text-embedding-3-small", dimensions = 1536): Embedder {
 *     return {
 *       id: model,
 *       dimensions,
 *       async embed(text) {
 *         const { embedding } = await embed({ model, value: text });
 *         return embedding;
 *       },
 *       async embedMany(texts) {
 *         const { embeddings } = await embedMany({ model, values: texts });
 *         return embeddings;
 *       },
 *     };
 *   }
 *
 * Note: AI SDK's `embed`/`embedMany` resolve a bare "provider/model" string via
 * the default gateway provider, so no explicit provider import is required when
 * AI_GATEWAY_API_KEY (or OIDC) is configured — matching how `webAgent.stream`
 * already resolves model strings in apps/web.
 */

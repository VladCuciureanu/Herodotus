import { seededRandom } from "./random.ts";
import type { Identity } from "./types.ts";

/** Pick one of `identities` for each of `count` commits, reproducibly from `seed`. */
export function pickIdentities(identities: Identity[], seed: number, count: number): Identity[] {
  const rng = seededRandom(seed);
  return Array.from({ length: count }, () => identities[Math.floor(rng() * identities.length)]);
}

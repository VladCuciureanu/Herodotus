import type { Identity } from "./types.ts";
import { seededRandom } from "./random.ts";

export function createIdentityPicker(
  identities: Identity[],
  seed: number,
): (index: number) => Identity {
  if (identities.length === 1) {
    return () => identities[0];
  }

  const rng = seededRandom(seed);
  const picks: number[] = [];

  return (index: number): Identity => {
    while (picks.length <= index) {
      picks.push(Math.floor(rng() * identities.length));
    }
    return identities[picks[index]];
  };
}

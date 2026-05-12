/**
 * Tiny class-name joiner. Accepts strings / arrays / falsy values.
 * No `clsx` dependency to keep the bundle slim.
 */
export type ClassValue = string | number | bigint | boolean | null | undefined | ClassValue[];

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  for (const input of inputs) {
    if (input === null || input === undefined) continue;
    if (input === false || input === 0 || input === '') continue;
    if (typeof input === 'bigint' && input === BigInt(0)) continue;
    if (Array.isArray(input)) {
      const inner = cn(...input);
      if (inner) out.push(inner);
    } else {
      out.push(String(input));
    }
  }
  return out.join(' ');
}

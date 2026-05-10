export function readRequiredServerEnv(names: readonly [string, ...string[]]): string {
  const value = readOptionalServerEnv(names);
  if (value) return value;

  throw new Error(`Missing required env var: ${names.join(" or ")}`);
}

export function readOptionalServerEnv(
  names: readonly [string, ...string[]],
): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }

  return null;
}

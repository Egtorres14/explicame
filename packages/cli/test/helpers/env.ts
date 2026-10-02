/** The current environment plus `extra`, for child processes (MCP clients take only defined strings). */
export function childEnv(extra: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) base[key] = value;
  return { ...base, ...extra };
}

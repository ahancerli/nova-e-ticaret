export async function getCloudflareContext() { return { env: globalThis.__ENV }; }
export function getCloudflareContextSync() { return { env: globalThis.__ENV }; }

export async function apiFetch(url: string, opts: RequestInit = {}) {
  const res = await fetch(url, opts);
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data.error?.message || "Request failed");
  return data;
}

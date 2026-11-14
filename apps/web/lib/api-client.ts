export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function json<T>(response: Response): Promise<T> {
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    let message = "Request failed";
    if (data && typeof data === "object" && "message" in data) {
      const responseMessage = data.message;
      if (typeof responseMessage === "string" && responseMessage.trim()) {
        message = responseMessage;
      } else if (Array.isArray(responseMessage)) {
        const messages = responseMessage.filter(
          (item): item is string => typeof item === "string",
        );
        if (messages.length > 0) message = messages.join(", ");
      }
    }
    throw new ApiRequestError(message, response.status);
  }
  return data as T;
}

async function getCsrfToken(): Promise<string | null> {
  if (typeof document === "undefined") return null;
  const cookies = document.cookie.split("; ");
  for (const cookie of cookies) {
    if (cookie.startsWith("csrf_token=")) {
      const value = cookie.substring("csrf_token=".length);
      const parts = value.split(".");
      if (parts.length === 2 && parts[0]) {
        return parts[0];
      }
    }
  }
  return null;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(
    (options.method || "GET").toUpperCase(),
  );
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };
  if (isMutation) {
    const csrfToken = await getCsrfToken();
    if (csrfToken) {
      headers["X-CSRF-Token"] = csrfToken;
    }
  }
  const response = await fetcher(path, {
    ...options,
    credentials: "include",
    headers,
  });
  return json<T>(response);
}
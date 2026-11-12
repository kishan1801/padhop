export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

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

type AuthenticationRequest =
  | {
      mode: "signup";
      name: string;
      email: string;
      password: string;
    }
  | {
      mode: "login";
      email: string;
      password: string;
    };

export async function authenticate(
  request: AuthenticationRequest,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const { mode, ...credentials } = request;
  const data = await json<{ accessToken?: unknown }>(
    await fetcher(`${API_URL}/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    }),
  );
  if (typeof data.accessToken !== "string" || !data.accessToken) {
    throw new Error("Authentication did not return an access token.");
  }
  return data.accessToken;
}

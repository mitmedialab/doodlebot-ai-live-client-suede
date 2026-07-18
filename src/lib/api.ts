  export type SSEPayload = {
    sketch: string;
    session: string;
    status?: "approved" | "innapropriate" | "complex";
    companions?: string[];
    vectorization?: string;
    robot?: string;
    color?: string;
  };

  // Server resource ids are opaque hashes, resolved to `${server}/resource/<id>`.
  // But a caller (e.g. the visual test harness) may hand us an identifier that is
  // *already* a usable URL — a bundled asset path (`/src/…`, `./…`), an absolute
  // URL, or an inline `data:`/`blob:` payload. Pass those straight through rather
  // than wrapping them into a bogus `/resource/data:…` request.
  export const resourceURL = (server: string, identifier: string) =>
    /^(https?:|data:|blob:|[./])/.test(identifier)
      ? identifier
      : `${server}/resource/${identifier}`;
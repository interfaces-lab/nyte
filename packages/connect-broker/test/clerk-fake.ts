export interface FakeUser {
  banned: boolean;
  locked: boolean;
  updated_at: number;
  email?: string;
  username?: string;
}

/** The Clerk Backend API as the broker calls it: user lookups and session revocation, in memory. */
export class FakeClerkApi {
  readonly users = new Map<string, FakeUser>();
  readonly revoked: string[] = [];
  readonly calls: string[] = [];
  userStatus: number | undefined;
  revokeStatus = 200;
  private readonly secretKey: string;

  constructor(secretKey: string) {
    this.secretKey = secretKey;
  }

  reset(): void {
    this.users.clear();
    this.revoked.length = 0;
    this.calls.length = 0;
    this.userStatus = undefined;
    this.revokeStatus = 200;
  }

  handle(url: URL, init: RequestInit): Response {
    const method = init.method ?? "GET";

    this.calls.push(`${method} ${url.pathname}`);

    if (new Headers(init.headers).get("authorization") !== `Bearer ${this.secretKey}`)
      return Response.json({ errors: [] }, { status: 401 });
    const user = /^\/v1\/users\/([^/]+)$/u.exec(url.pathname)?.[1];

    if (user !== undefined && method === "GET") {
      if (this.userStatus !== undefined) return Response.json({}, { status: this.userStatus });
      const found = this.users.get(user);

      if (found === undefined)
        return Response.json({ errors: [{ code: "resource_not_found" }] }, { status: 404 });

      return Response.json({
        object: "user",
        id: user,
        banned: found.banned,
        locked: found.locked,
        updated_at: found.updated_at,
        primary_email_address_id: found.email === undefined ? null : "idn_primary",
        email_addresses:
          found.email === undefined
            ? []
            : [
                { id: "idn_secondary", email_address: "secondary@example.com" },
                { id: "idn_primary", email_address: found.email },
              ],
        username: found.username ?? null,
        first_name: null,
        last_name: null,
      });
    }

    const session = /^\/v1\/sessions\/([^/]+)\/revoke$/u.exec(url.pathname)?.[1];

    if (session !== undefined && method === "POST") {
      if (this.revokeStatus < 300) this.revoked.push(session);

      return Response.json(
        { object: "session", id: session, status: "revoked" },
        { status: this.revokeStatus },
      );
    }

    return Response.json({}, { status: 404 });
  }
}

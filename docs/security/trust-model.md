# Singularity Neo — Security Trust Model

## Deployment topology

```
 Internet / LAN clients
         │
         ▼
  ┌─────────────┐   TLS (1.2+)
  │ Reverse proxy│   HTTPS redirect
  │ nginx/Caddy  │   Strip x-singularity-actor-* from inbound requests
  └─────┬───────┘   Inject verified actor header (from its own session)
        │ localhost / private network  HTTP
        ▼
  ┌──────────────┐
  │ Singularity  │   Port 3001 (NOT internet-facing)
  │ Neo server   │
  └──────┬───────┘
         │ TCP
         ▼
  ┌─────────────┐
  │ PostgreSQL   │   Port 5432 (loopback only)
  └─────────────┘
```

The server is not designed to face the internet directly. All security
guarantees assume the reverse proxy enforces TLS and strips untrusted headers
before forwarding.

---

## Authentication — header-based, perimeter-delegated

**How it works:**

Every API request optionally carries an `x-singularity-actor-user-id` header.
The server reads this header in `bindRequestActorContext` (`server/requestActor.ts`)
and resolves it against the workspace organisation database to load the user's
roles and team memberships.

**What is NOT done:**

- There is no JWT validation, no session cookie, no HMAC/signature check on
  the header value itself.

**Why this is acceptable:**

- The reverse proxy is responsible for authenticating the operator (OAuth,
  SSO, or any other mechanism), then *injecting* the resolved user ID into
  `x-singularity-actor-user-id` on the forwarded request.
- The reverse proxy must **strip** any inbound `x-singularity-actor-*`
  headers from untrusted clients before forwarding, so clients cannot
  self-assert an identity.

**What breaks this model:**

- Exposing port 3001 to an untrusted network without a proxy. Any caller
  could then set an arbitrary header and act as any workspace member.

---

## CORS / Origin policy

See `server/http/originPolicy.ts` for the full explanation. Summary:

| Origin value | Allowed? | Reason |
|---|---|---|
| `undefined` / `null` (no header) | Yes | Server-to-server, health checks, same-origin |
| Empty string | Yes | Certain native HTTP clients |
| `"null"` (literal string) | Yes | Electron desktop app (file:// protocol) and sandboxed iframes |
| `http://localhost:3000` etc. | Yes | Local dev Vite server |
| Anything else | No | Not in the allow-list |

The `"null"`-origin bypass is the most interesting: the HTML spec requires
browsers to send `Origin: null` for pages loaded from `file://` URLs and
sandboxed iframes. The Electron desktop worker uses `file://` internally, so
this bypass is required. It is only a risk if the server is reachable from
untrusted sandboxed web content on the same machine — which is not the case
in the intended deployment.

---

## Desktop executor trust

Desktop executors register with the control plane using their
`x-singularity-actor-user-id`. The trust anchor is the workspace operator
identity — an executor can only claim capabilities that the associated user
has `capability.execution.claim` permission for.

There is no shared secret between the desktop worker and the server. The
executor ID is a random UUID generated at startup. This is acceptable because:

1. The control plane is only accessible to authenticated operators (reverse
   proxy enforces this).
2. The heartbeat TTL (45 s) + background reconciliation (30 s) ensure stale
   executors are cleaned up quickly if a machine goes offline.

---

## What is explicitly out of scope

- Public internet exposure without a proxy.
- Multi-tenant SaaS where operators are untrusted strangers. This platform is
  designed for internal team use where operators are known individuals.
- Process-level sandboxing of agent shell execution in local (non-Docker)
  mode. Docker sandbox (`SINGULARITY_SANDBOX_MODE=docker`) provides network
  isolation and resource limits; local mode does not.

---

## Checklist for a production deployment

- [ ] Reverse proxy enforces HTTPS (TLS 1.2+).
- [ ] Reverse proxy strips inbound `x-singularity-actor-*` headers.
- [ ] Reverse proxy injects `x-singularity-actor-user-id` from its own session.
- [ ] Port 3001 is NOT accessible from outside the private network.
- [ ] Port 5432 (PostgreSQL) is NOT accessible from outside the server host.
- [ ] `SINGULARITY_SANDBOX_MODE=docker` is set for any capability that runs
  agent shell commands on a shared host.
- [ ] `APP_URL` is set to the HTTPS public URL so internal links are correct.

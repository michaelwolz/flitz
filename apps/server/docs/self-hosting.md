# Self-hosting

flitz runs as one Docker image next to Postgres and Redis. The image starts in one of two roles:

- `server` (the default): answers HTTP on port 3000 with short URLs, QR codes, the web app, the API, MCP and these docs. Run as many replicas as you need.
- `worker`: reads clicks from Redis and writes them to Postgres in batches, and once a night (in the first hour after midnight UTC) deletes clicks older than the retention period and web app sessions that expired more than 30 days ago. Clicks wait in Redis until a worker writes them, so run at least one: Redis keeps about the newest 100,000 waiting clicks and drops older ones.

Give both roles the same environment.

## Quick start

From a checkout of the flitz repository:

```sh
docker compose up
```

This builds the image and starts the server, the worker, Postgres and Redis on http://localhost:3000. The web app is at http://localhost:3000/app and the docs at http://localhost:3000/docs.

Open the web app and sign up: on an empty instance, the first person to sign up and verify their email becomes admin. Without `SMTP_URL`, emails such as the verification link are written to the server log while `BASE_URL` is on `localhost` or another loopback address (`docker compose logs server`). See [Users and sign-up](#users-and-sign-up).

To add a public demo link, start with the `demo` profile:

```sh
docker compose --profile demo up
```

Then `curl -i http://localhost:3000/x7k4m9p` answers with a 302 to example.com.

Before the instance goes public, set at least `BASE_URL`, `AUTH_SECRET` and `ADMIN_EMAILS`, and `SMTP_URL` with `SMTP_FROM` (or sign-in with Google or GitHub) so people can verify their email. flitz doesn't start with a `BASE_URL` that isn't `localhost` or another loopback address while `AUTH_SECRET` is the local-only default from `docker-compose.yml` or shorter than 32 characters. docker compose takes them from your shell:

```sh
BASE_URL=https://flitz.example.com AUTH_SECRET="$(openssl rand -base64 32)" ADMIN_EMAILS=ada@example.com TRUSTED_PROXIES=1 \
  SMTP_URL=smtps://user:password@smtp.example.com:465 SMTP_FROM=links@example.com docker compose up
```

Keep the same `AUTH_SECRET` across restarts and for every process. docker compose passes every setting from the table below from your shell to the server and the worker.

## Kubernetes with Helm

The flitz Helm chart runs the server and the worker as two Deployments behind one Service. It does not include Postgres or Redis: run them yourself or use managed ones, and pass their URLs.

Put the settings that hold credentials in a Secret, under the names from the settings table:

```sh
kubectl create secret generic flitz-secrets \
  --from-literal=DATABASE_URL=postgres://flitz:secret@postgres:5432/flitz \
  --from-literal=REDIS_URL=redis://redis:6379 \
  --from-literal=AUTH_SECRET="$(openssl rand -base64 32)"
```

Then install the chart from the GitHub container registry with a values file:

```yaml
# values.yaml
baseUrl: https://flitz.example.com
existingSecret: flitz-secrets
ingress:
  enabled: true
  className: nginx
  tls:
    - secretName: flitz-tls
      hosts: [flitz.example.com]
```

```sh
helm install flitz oci://ghcr.io/michaelwolz/charts/flitz -f values.yaml
```

Each chart version runs the image of the same version, `ghcr.io/michaelwolz/flitz`; pin one with `--version`. Run `helm show values oci://ghcr.io/michaelwolz/charts/flitz` for every value. In short:

- `baseUrl` sets `BASE_URL`. The chart doesn't render without it.
- `existingSecret` names a Secret with any of `DATABASE_URL`, `REDIS_URL`, `AUTH_SECRET`, `SMTP_URL`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_SECRET` and `MICROSOFT_CLIENT_SECRET`. Instead, you can set them under `secrets`, and the chart stores them in a Secret of its own.
- `config` takes the other settings, such as `ADMIN_EMAILS`, `SMTP_FROM` or `SIGNUP_DOMAINS`. Set `ADMIN_EMAILS` before the instance is reachable from the internet. Quote numbers and booleans.
- `extraEnv` adds environment variables, such as `DATABASE_URL` read from a Secret key with another name.
- `ingress` creates an Ingress, `httpRoute` a Gateway API HTTPRoute. Both route the host of `baseUrl` unless you list hosts in `ingress.hosts` or `httpRoute.hostnames`. Add your custom domains there.

Scale the server and the worker independently with `server.replicas` and `worker.replicas`, and size them with `server.resources` and `worker.resources`. Add server replicas for more traffic. One worker is enough to start with; more workers share the clicks waiting in Redis.

The pods run as a non-root user with a read-only root filesystem. Kubernetes checks the server at `/healthz`. The reverse proxy notes below apply to your ingress controller or gateway.

## Settings

| Variable                                   | Required        | Meaning                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BASE_URL`                                 | yes             | The public URL of the instance, such as `https://flitz.example.com`. Its hostname is the instance domain. Short URLs, emails, OAuth and these docs use it. Serve flitz at the root of this host. It must use `https`, except on `localhost` or another loopback address; the server does not start otherwise.                                            |
| `DATABASE_URL`                             | yes             | Postgres connection URL, such as `postgres://flitz:secret@postgres:5432/flitz`.                                                                                                                                                                                                                                                                          |
| `REDIS_URL`                                | yes             | Redis connection URL, such as `redis://redis:6379`.                                                                                                                                                                                                                                                                                                      |
| `AUTH_SECRET`                              | yes             | A random secret of at least 32 characters that signs sessions, such as the output of `openssl rand -base64 32`. Unless `BASE_URL` is on `localhost` or another loopback address, flitz doesn't start with a shorter one or with the local-only default from `docker-compose.yml`.                                                                        |
| `ADMIN_EMAILS`                             | no              | Comma-separated emails, such as `ada@example.com,grace@example.com`, that may always sign up and become admin; set it before the instance is reachable from the internet (see [Users and sign-up](#users-and-sign-up)).                                                                                                                                  |
| `SIGNUP_DOMAINS`                           | no              | Comma-separated email domains, such as `example.com`, whose people may sign up without an invitation (see [Users and sign-up](#users-and-sign-up)).                                                                                                                                                                                                      |
| `DEFAULT_ROLE`                             | no              | The role of people who sign up through `SIGNUP_DOMAINS` (see [Users and sign-up](#users-and-sign-up)).                                                                                                                                                                                                                                                   |
| `DISABLE_PASSWORD_AUTH`                    | no              | Set to `true` to disable password sign-in, sign-up and password changes/resets. Defaults to `false`. Magic links and Google, GitHub or Microsoft sign-in stay available; configure SMTP or a social provider before enabling it. Existing accounts and sessions are kept.                                                                                |
| `SMTP_URL`                                 | no              | SMTP connection URL for emails (verification, invitations, password reset, magic links), such as `smtps://user:password@smtp.example.com:465`. Without it, flitz sends no emails: with `BASE_URL` on `localhost` or another loopback address it writes them to the log, links included; otherwise it only logs a warning with the recipient and subject. |
| `SMTP_FROM`                                | with `SMTP_URL` | The sender address, such as `flitz <links@example.com>`.                                                                                                                                                                                                                                                                                                 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | no              | Turn on sign-in with Google: the sign-in and sign-up pages show a "Continue with Google" button. The redirect URI is `{BASE_URL}/api/auth/callback/google`.                                                                                                                                                                                              |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | no              | Turn on sign-in with GitHub: the sign-in and sign-up pages show a "Continue with GitHub" button. The callback URL is `{BASE_URL}/api/auth/callback/github`.                                                                                                                                                                                              |
| `MICROSOFT_CLIENT_*`                       | no              | Set `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET` to turn on sign-in with Microsoft. The redirect URI is `{BASE_URL}/api/auth/callback/microsoft`. See [Users and sign-up](#users-and-sign-up) for setup and email verification.                                                                                                                   |
| `MICROSOFT_TENANT_ID`                      | no              | Microsoft account authority. Defaults to `common`; set a tenant ID, `organizations` or `consumers` to restrict account types. Match this to the Microsoft app registration.                                                                                                                                                                              |
| `RATE_LIMIT_REDIRECTS_PER_MINUTE`          | no              | Requests to short URLs per client IP per minute. Default `600`.                                                                                                                                                                                                                                                                                          |
| `TRUSTED_PROXIES`                          | no              | How many reverse proxies in front of flitz add the address they received a request from to `X-Forwarded-For`. flitz takes the client IP from that position, counted from the right. `0` ignores `X-Forwarded-For` and uses the address of the connection. Default `0`; the Helm chart sets `1`. See the reverse proxy notes below.                       |
| `GEOIP_DATABASE`                           | no              | Path to a country database in MaxMind DB format. The image sets it to the bundled DB-IP Lite database (CC BY 4.0, see `/app/geoip/NOTICE`). Mount a MaxMind GeoLite2 Country file and point here to use that instead. Without a database, country conditions never match.                                                                                |
| `IMPRINT_URL`                              | no              | An `http` or `https` URL of your imprint (legal notice). The 404 and error pages that visitors of short URLs see link to it in their footer.                                                                                                                                                                                                             |
| `PRIVACY_POLICY_URL`                       | no              | An `http` or `https` URL of your privacy policy. The 404 and error pages link to it in their footer.                                                                                                                                                                                                                                                     |

flitz system emails include a plain-text alternative and embed the lockup without loading remote images.

Admins change the time zone stats are counted in (default `UTC`), the retention period of clicks (default 13 months) and the App Store provider token on the Settings page of the web app, or with the `updateSettings` API operation. They are stored in Postgres, not in the environment.

## Users and sign-up

Every user has one role for the whole instance: admin, member or viewer, see [Concepts](concepts.md#instance-and-access). Admins manage users on the Users page: they see everyone with their role, change roles and names, remove users, invite people and revoke invitations. Everyone changes their own name by clicking it in the sidebar.

Set `DISABLE_PASSWORD_AUTH=true` to use only magic links or Google, GitHub or Microsoft. Restart the server after changing it. Password forms are hidden, including sign-up and password reset; existing users can sign in with a magic link or a configured social provider using the same email address.

Who can sign up, with a password (unless disabled), a magic link, Google, GitHub or Microsoft:

For Microsoft sign-in, create an app registration with a Web redirect URI of `{BASE_URL}/api/auth/callback/microsoft`, add the optional `email` ID token claim, and set `MICROSOFT_CLIENT_SECRET` to the secret value. Microsoft may omit email, which prevents sign-in. If it returns an unverified address, flitz requires its own email verification, so configure SMTP for public instances. Match `MICROSOFT_TENANT_ID` to the account types supported by the app registration.

- **The first user.** On an instance without `ADMIN_EMAILS`, the first person to sign up and verify their email becomes admin; with `SIGNUP_DOMAINS` set, only someone at one of those domains can. An unverified first sign-up holds that slot for one hour, the lifetime of its verification link: meanwhile, others can sign up only through `SIGNUP_DOMAINS` and get `DEFAULT_ROLE`, and after the hour the next such sign-up takes the slot.
- **`ADMIN_EMAILS`.** Listed emails can always sign up and are admin once they verify their email; a listed user who had verified it before being listed becomes admin at their next sign-in. While the list is set, the first-user rule is off. It is also the way back in when no admin is left: add your email, sign up or sign in, and verify it.
- **An invitation.** An admin invites an email address with a role. The invited person signs up with that address within 48 hours and gets the role. With `SMTP_URL`, flitz emails them a link to the sign-up page; without it, send them the link yourself: `{BASE_URL}/app/sign-up?email=<their email>`.
- **`SIGNUP_DOMAINS`.** People whose email is at a listed domain may sign up without an invitation and get `DEFAULT_ROLE`: `admin`, `member` or `viewer`, default `member`.

Everyone else is refused with `403` and gets no email, not even a magic link. Every user must verify their email before they get a session or API access, also when they were invited or their domain is allowed. For a password account, flitz emails a verification link, and a new one when they sign up again or sign in before verifying. A magic link, which flitz also emails, and Google or GitHub sign-in prove the address by themselves. Without `SMTP_URL`, flitz writes emails to the server log only while `BASE_URL` is on `localhost` or another loopback address and sends none elsewhere, so on a public instance set `SMTP_URL` and `SMTP_FROM`, or turn on sign-in with Google or GitHub.

If you can't do either yet, mark your own account as verified in Postgres, then sign in with your password. With docker compose:

```sh
docker compose exec postgres psql -U flitz -c "update users set email_verified = true where email = 'ada@example.com'"
```

**Set `ADMIN_EMAILS` before the instance is reachable from the internet.** Otherwise the first person to find it can sign up and become admin before you do.

The last admin can be neither demoted nor removed. A user listed in `ADMIN_EMAILS` can only be made admin: they can be neither demoted nor removed, and taking an email off the list changes nobody's role. Removing a user deletes their account, ends their sessions and stops their API keys at once; removing an admin also deletes the invitations they sent. It doesn't keep them out: if their email domain is in `SIGNUP_DOMAINS`, they can sign up again, so the domain list decides who may join. An API key also stops working when its creator no longer has a role that allows all of its scopes.

## Database migrations

Every process applies pending migrations when it starts, so upgrades need no manual step. A lock in Postgres lets one process migrate at a time while the others wait, so you can start any number of them at once.

## Backups and Redis persistence

Postgres holds links, users, settings and written clicks; back it up.

Besides caches and rate-limit counters, Redis holds the clicks that no worker has written yet and the day's salt for visitor hashes. Run it with persistence, such as an append-only file (`appendonly yes`), as `docker-compose.yml` does. Without it, a Redis restart loses the waiting clicks and counts that day's earlier visitors again as unique visitors.

## Reverse proxy, TLS and custom domains

flitz serves plain HTTP and does not handle TLS. Put a reverse proxy or ingress in front of it that:

- terminates TLS for the instance domain and every custom domain, and sets HSTS if you want it, since flitz adds no such header,
- passes the original `Host` header, because flitz tells the instance domain and custom domains apart by host and answers `404` to any other host, except at `/healthz` and `/api/domains/known`,
- adds the address it received the request from to `X-Forwarded-For`, as reverse proxies, ingress controllers and load balancers usually do.

flitz uses the visitor's IP in memory for the country lookup, the visitor hash and rate limits, and never stores it. Only signed-in web app sessions keep the IP and user agent they were created from, for account security, until the worker deletes the session 30 days after it expired. Visitors can send any `X-Forwarded-For` they like, so flitz trusts only the entries your own proxies added: set `TRUSTED_PROXIES` to the number of proxies in front of flitz. With one proxy, flitz takes the right-most entry; with a CDN or load balancer in front of that proxy, set `2` and flitz takes the second entry from the right. With `0`, the default, flitz ignores the header and uses the address of the connection, which is right only when visitors connect to flitz directly; it logs a warning when requests carry `X-Forwarded-For` anyway. A number that is too high lets visitors choose their own IP and get around rate limits and country rules; one that is too low makes visitors share the IP of a proxy, and with it the rate limits.

Your proxy must be the only thing that can reach flitz: anyone who connects to port 3000 directly can send their own `X-Forwarded-For`. `docker-compose.yml` publishes the port on `127.0.0.1` only, for a proxy on the same host.

flitz doesn't check who owns a custom domain: an admin adds it, and it serves short URLs as soon as DNS points at your proxy. Your proxy decides which hosts reach flitz at all. Point custom domains at it with a DNS record. If the proxy issues certificates on demand, such as Caddy's on-demand TLS, let it ask flitz first. The check answers on any host, so the proxy can call flitz on its internal address:

```
GET /api/domains/known?domain=go.example.com
```

It answers `200` for the instance domain and every custom domain, and `404` otherwise.

# API quick start

In these docs, `{{BASE_URL}}` is the address of your flitz instance. Its REST API lives under `{{BASE_URL}}/api` and is described by the OpenAPI spec at `{{BASE_URL}}/api/openapi.json`. Every operation in it is also an MCP tool, see [MCP reference](mcp.md).

## 1. Sign up and create an API key

Sign up with email and password. On an empty instance, the first person to sign up and verify their email becomes admin, unless the operator listed admin emails or allows only certain email domains, see [Self-hosting](self-hosting.md#users-and-sign-up). Everyone else needs an invitation from an admin, or an email address the operator has allowed:

```sh
curl -H 'content-type: application/json' \
  -d '{"name":"Ada","email":"ada@example.com","password":"a long password"}' \
  {{BASE_URL}}/api/auth/sign-up/email
```

A sign-up the instance doesn't allow gets `403` with the code `SIGN_UP_NOT_ALLOWED`. Otherwise flitz emails a verification link, and you can't sign in before you open it. If the instance has no SMTP configured and its `BASE_URL` is on `localhost` or another loopback address, the link is in the server log; on any other host, flitz sends no email without SMTP, so an instance needs SMTP (or Google or GitHub sign-in) before people can verify. Open the link with curl to get a session cookie:

```sh
curl -c flitz.cookies '<the verification link>'
```

Later, sign in with the same body minus `name` at `{{BASE_URL}}/api/auth/sign-in/email`.

Then create an API key. Only admins can. Pick only the scopes the key needs (see [Concepts](concepts.md#scopes)):

```sh
curl -b flitz.cookies -H 'content-type: application/json' \
  -d '{"name":"My script","scopes":["links:read","links:write"]}' \
  {{BASE_URL}}/api/api-keys
```

The response contains the key, starting with `flitz_`. It is shown only once, so save it now:

```sh
export FLITZ_API_KEY=flitz_...
```

## 2. Create a link

```sh
curl -H "authorization: Bearer $FLITZ_API_KEY" -H 'content-type: application/json' \
  -d '{"defaultTarget":"https://example.com/spring","title":"Spring campaign"}' \
  {{BASE_URL}}/api/links
```

The response is the new link. Its `shortUrl` uses a generated slug of 7 lowercase letters and digits, like `{{BASE_URL}}/x7k4m9p`.

## 3. Follow the short URL

Request the `shortUrl` from the response, here with a campaign tag added:

```sh
curl -i '{{BASE_URL}}/x7k4m9p?utm_source=newsletter'
```

flitz answers with a 302 to the default target. Query parameters on the short URL are added to the target, except those the target already has: the target's own parameters always win.

## Next steps

- Send visitors to different targets by device or country with redirect rules, or generate them with a preset. See [Concepts](concepts.md).
- Get a QR code of the short URL: `GET {{BASE_URL}}/api/links/{id}/qr?format=svg` or `format=png`.
- Use your own domain for short URLs: add it with `POST {{BASE_URL}}/api/domains` (it needs the `domains:write` scope) and point the domain at this instance with a CNAME record for the hostname whose target is the host of `{{BASE_URL}}` (for an apex domain such as example.com, which can't have a CNAME record, use an ALIAS or ANAME record, or A/AAAA records with that host's addresses). It serves short URLs as soon as DNS points at the instance.
- Change a link with `PATCH {{BASE_URL}}/api/links/{id}`; the change takes effect immediately. The API never deletes links: deactivate one with `POST {{BASE_URL}}/api/links/{id}/deactivate`.

## Errors

Errors are JSON objects with a stable `code` and a `message` that says what to do next:

```json
{ "code": "SLUG_TAKEN", "message": "The slug \"spring\" is already taken. Choose another one." }
```

| Status | Code                 | Meaning                                                                                    |
| ------ | -------------------- | ------------------------------------------------------------------------------------------ |
| 400    | `INVALID_REQUEST`    | The input failed validation; the message names each field.                                 |
| 400    | `SLUG_RESERVED`      | The custom slug is reserved, such as `api` or `docs`.                                      |
| 400    | `DOMAIN_NOT_FOUND`   | The domain is not a custom domain of this instance.                                        |
| 400    | `DOMAIN_NOT_ALLOWED` | The instance domain can't be added as a custom domain.                                     |
| 401    | `UNAUTHORIZED`       | No API key or session was sent, or the API key is not valid.                               |
| 403    | `FORBIDDEN`          | The API key lacks the scope, its creator lost a role it needs, or your role can't do this. |
| 404    | `NOT_FOUND`          | The link, domain or API key does not exist.                                                |
| 409    | `SLUG_TAKEN`         | Another link on the domain already has this slug.                                          |
| 409    | `DOMAIN_TAKEN`       | The domain is already a custom domain of this instance.                                    |
| 409    | `DOMAIN_HAS_LINKS`   | Links are on the domain, so it can't be deleted.                                           |
| 500    | `INTERNAL_ERROR`     | Something went wrong on the instance; try again.                                           |

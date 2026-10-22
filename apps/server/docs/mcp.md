# Connect via MCP

Your flitz instance (`{{BASE_URL}}`) is an MCP server at:

```
{{BASE_URL}}/api/mcp
```

It speaks Streamable HTTP, stateless, with POST requests only. Every operation in the OpenAPI spec at `{{BASE_URL}}/api/openapi.json` is one MCP tool with the same name as its `operationId` (such as `createLink` or `listLinks`), the same description and the same scope. A connection can do only what its scopes allow.

There are two ways to connect: sign in with OAuth, or send an API key.

## Sign in with OAuth

Use this for MCP clients that support OAuth with Client ID Metadata Documents.

1. Add `{{BASE_URL}}/api/mcp` as a custom connector, or as the server URL of a new MCP server in your client.
2. Your client opens flitz in the browser. Sign in there.
3. On the consent page, pick the scopes the client gets.
4. Back in the client, the connection is ready. It is limited to those scopes, and never allows more than your role does.

For client developers: a request without a valid access token gets `401` with a `WWW-Authenticate` header that points to flitz's OAuth metadata. Clients identify themselves with a Client ID Metadata Document, so they need no registration; dynamic client registration is not supported. Access tokens are issued for the MCP endpoint only.

### Disconnect an app

In the web app, open Connect via MCP. Under Connected apps you see each connected app with its scopes, who connected it, and when it last renewed its access. Choose Disconnect next to an app: it loses access right away, including access tokens it already holds, and has to be connected again before it can act. Admins see and can disconnect everyone's apps; other users see and disconnect their own. Resetting your password disconnects all your apps.

An app connected with an API key is not listed there; revoke the API key instead.

## Send an API key

Use this for headless agents, scripts and CI, where nobody can sign in in a browser.

An admin creates an API key with the scopes the agent needs (see [Getting started](getting-started.md)). Send it in the Authorization header of every request:

```
authorization: Bearer flitz_...
```

In Claude Code:

```sh
claude mcp add --transport http flitz {{BASE_URL}}/api/mcp --header "Authorization: Bearer flitz_..."
```

Clients configured with a JSON file usually take the URL and a headers object:

```json
{
  "mcpServers": {
    "flitz": {
      "url": "{{BASE_URL}}/api/mcp",
      "headers": { "Authorization": "Bearer flitz_..." }
    }
  }
}
```

The connection can do what the key's scopes allow, as long as the admin who created the key keeps a role that allows all of them.

## Scopes

| Scope            | What it allows                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `links:read`     | See links, their QR codes, the custom domains and the instance's settings.                    |
| `links:write`    | Create, edit, deactivate and reactivate links, and generate presets. Links are never deleted. |
| `stats:read`     | Read click stats and orphan clicks, and export clicks as CSV.                                 |
| `domains:write`  | Add, update and delete custom domains.                                                        |
| `instance:admin` | Manage API keys and instance settings.                                                        |

No tool deletes links. An agent can deactivate a link, which stops it redirecting but keeps its slug and click history, and reactivate it later.

## Calling tools

Each tool takes one object that combines the operation's path parameters, query parameters and JSON body. For example, `updateLink` takes the link's `id` together with the fields to change:

```json
{ "id": "5f0c1c9e-8a51-4c4e-9d55-0b1f8e6f2a10", "title": "Spring campaign", "defaultTarget": "https://example.com/spring" }
```

A tool returns the operation's JSON response as text. When the operation fails, the result has `isError` set and the text is the error, such as `{ "code": "FORBIDDEN", "message": "This API key lacks the links:write scope. Create a key that has it." }`. `getLinkQrCode` with `format: "png"` returns an image. `exportClicks` returns the CSV as text.

A typical flow for an app link: call `generateAppStorePreset` with the App Store ID, Google Play package and a default target, then pass its `defaultTarget` and `redirectRules` to `createLink`, and give the user the `shortUrl` from the result. See [Concepts](concepts.md) for what each term means.

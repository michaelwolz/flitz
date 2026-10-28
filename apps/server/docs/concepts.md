# Concepts

These are the words flitz uses in its API, its MCP tools and these docs. Each term means exactly what it says here.

## Instance and access

**Instance**: one installation of flitz, used by one team. In these docs, `{{BASE_URL}}` is the address of your instance. Everything in it, such as links, domains, API keys and click data, is shared by its users according to their roles.

**User**: a person with an account on the instance, who signs in to the web app and has exactly one role.

**Role**: the permission level of a user on the whole instance. Signed-in users get these scopes:

| Role   | Scopes                                    |
| ------ | ----------------------------------------- |
| admin  | all scopes                                |
| member | `links:read`, `links:write`, `stats:read` |
| viewer | `links:read`, `stats:read`                |

**Invitation**: an admin's offer of a role to an email address. The invited person signs up with that address within 48 hours and gets the role. Without an invitation, people can sign up only if the operator allows their email domain or lists their email as an admin's. On an empty instance, the first person to sign up and verify their email becomes admin, unless the operator listed admin emails; if the operator allows only certain email domains, that first person needs an address at one of them. See [Self-hosting](self-hosting.md#users-and-sign-up).

**API key**: a credential that lets software act on the instance, limited to its scopes. Only admins create API keys. It starts with `flitz_` and is shown only once, when it is created; flitz can't show it again. Send it in the Authorization header: `Authorization: Bearer flitz_...`. Revoking it takes effect at once. A key stops working when the user who created it is removed or gets a role that doesn't allow all of the key's scopes.

**Scope**: a named right granted to an API key or MCP connection. Each operation in the OpenAPI spec at `{{BASE_URL}}/api/openapi.json` names its scope under `security`, and its MCP tool needs the same one.

### Scopes

| Scope            | What it allows                                                                                           |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `links:read`     | See links, their QR codes, the custom domains and the instance's settings.                               |
| `links:write`    | Create, edit, deactivate and reactivate links, and generate presets. No API key or app can delete links. |
| `stats:read`     | Read click stats and orphan clicks, and export clicks as CSV.                                            |
| `domains:write`  | Add, update and delete custom domains.                                                                   |
| `instance:admin` | Manage API keys and instance settings.                                                                   |

A request without the scope gets `403 FORBIDDEN`. There is no scope to delete links: only an admin can delete a deactivated link, in the web app.

## Links

**Link**: the managed object that maps a short URL to its targets, with its redirect rules and click history.

**Short URL**: the public address of a link: its domain plus its slug, such as `{{BASE_URL}}/x7k4m9p`.

**Slug**: the path part of a short URL that identifies a link within its domain. Slugs are lowercase, so capital letters in a short URL don't matter. Generated slugs have 7 characters without look-alikes such as `0`, `o`, `1` and `l`. A slug is unique per domain and never changes. Custom slugs (letters, digits and hyphens, at most 64) are possible on every domain. Reserved words such as `api`, `app`, `docs` and `qr` can't be slugs.

**Default target**: the URL a link sends visitors to when no redirect rule matches.

**Redirect rule**: an ordered entry on a link that sends visitors matching all of its conditions to its own target. The first matching rule wins; if none matches, the default target is used. A link has at most 50 rules. To add, remove or reorder rules, send the whole list in the new order with `updateLink`.

**Condition**: a single test a redirect rule applies to a click:

- `{ "type": "device", "device": "ios" }` matches iPhones and iPads, `android` matches Android phones and tablets, `mobile` matches all phones and tablets (iOS and Android included) and `desktop` everything else. Detection uses the user agent and client hints. Stats use `device` differently, see [Stats](#stats).
- `{ "type": "country", "countries": ["DE", "AT"] }` matches visitors from any of the listed countries, as two-letter ISO codes. The country comes from the visitor's IP address, which is never stored. If the country is unknown, country conditions don't match.

A rule looks like this:

```json
{ "conditions": [{ "type": "device", "device": "ios" }], "target": "https://apps.apple.com/app/id284882215" }
```

**Preset**: a ready-made set of redirect rules for a common case. A preset operation returns a `defaultTarget` and `redirectRules`; send them to `createLink` or `updateLink`. Presets save nothing themselves, and the rules they produce stay ordinary, editable rules.

- App Store (`generateAppStorePreset`): iOS to the App Store, Android to Google Play, everyone else to the default target. If the instance has an App Store provider token in its settings, the App Store URL carries it as `pt`.
- Mobile vs desktop (`generateMobileDesktopPreset`): phones and tablets to one target, everyone else to another.
- Country split (`generateCountrySplitPreset`): one rule per target with the countries that go there.

**Query passthrough**: adding the query parameters of a short URL to the chosen target, except those the target already has: the target's own parameters always win. When the target is on Google Play and has no `referrer`, the short URL's `utm_*` parameters go into Play's `referrer`; when it is on the App Store and has no `ct`, `utm_campaign` becomes the campaign token `ct`.

**Deactivated link**: a link that no longer redirects but keeps its slug and click history. Reactivate it to make it redirect again. Only an admin can delete it, in the web app: that deletes its click history and frees its slug for a new link.

### How a short URL answers

A short URL always answers with a temporary 302 redirect, never a permanent one, so changed targets take effect at once and every click reaches flitz. One exception: Safari on an iPad looks the same as Safari on a Mac, so when a link's redirect rules give iOS and desktop different targets, Mac Safari gets a small page that sends touch devices to the iOS target and everyone else to the desktop target.

Unknown slugs and deactivated links go to the custom domain's fallback URL if it has one, otherwise to a not-found page.

Every link has a QR code that encodes its short URL, never its target: `GET {{BASE_URL}}/api/links/{id}/qr?format=svg` (or `png`) with an API key, and for active links publicly at `/qr/{slug}.svg` and `/qr/{slug}.png` on the short URL's domain.

## Domains

**Domain**: a hostname that serves short URLs.

**Instance domain**: the domain the instance itself runs on. That is the hostname of `{{BASE_URL}}`. It serves short URLs without being added, and links get it when you leave out `domain`. Its root, `{{BASE_URL}}/`, redirects to the sign-up page of the web app.

**Custom domain**: a domain an admin has added to the instance. Add it with `addDomain` and point the domain at the instance with a CNAME record for the hostname whose target is the host of `{{BASE_URL}}` (for an apex domain such as example.com, which can't have a CNAME record, use an ALIAS or ANAME record, or A/AAAA records with that host's addresses). flitz doesn't check who owns the domain: it serves short URLs as soon as DNS points at the instance, and answers `404` for hosts that are neither the instance domain nor a custom domain. A custom domain serves only short URLs and QR codes, not the API or these docs. A custom domain without links, such as one added by mistake, can be deleted with `deleteDomain`; while any link is on it, active or deactivated, deleting it fails with `409 DOMAIN_HAS_LINKS`. Orphan clicks recorded for a deleted domain stay until the retention period removes them.

**Fallback URL**: where a domain sends visitors whose slug is unknown or belongs to a deactivated link. Set it per custom domain; without one, visitors see a not-found page.

## Clicks

**Click**: one request to an active link's short URL, recorded with its device, country, referrer and query parameters but never the visitor's IP address. flitz sets no cookies.

**Bot click**: a click recognised as coming from a crawler, link preview or email scanner; recorded but hidden from stats by default.

**Orphan click**: a request to a domain whose slug matches no active link.

**Visitor hash**: an anonymous identifier derived from a click with a salt that changes every day and is then destroyed, used only to count unique visitors per day.

**Retention period**: how long clicks are kept before they are permanently deleted: 13 months unless an admin changes it, from 1 to 120 months, with `updateSettings`.

### Stats

`getClickTimeSeries` counts clicks and unique visitors per day or hour, `getClickBreakdown` counts clicks per country, device, OS, browser, referrer, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` or link (the top links), several of them in one call if you send more than one `by`, and `exportClicks` returns the raw clicks as CSV. Each works for one link (`linkId`) or all links, covers a range of days (`from` and `to`, at most 400 days, or 31 days by hour) and filters by any breakdown value. Bot clicks are left out unless you send `bots=include` or `bots=only`.

In stats, `device` is the device type: `desktop`, `mobile` for phones, `tablet`, or another type such as `smarttv`. That differs from the device condition of redirect rules: in stats `mobile` excludes tablets, iOS and Android are values of `os`, and Safari on an iPad counts as `desktop` because it presents itself as a Mac.

Days and hours start in the instance's time zone, an IANA name like `Europe/Berlin` that an admin sets as `timeZone` with `updateSettings`. It defaults to `UTC`.

Unique visitors are counted per day or hour only. The visitor hash changes every day at midnight UTC, so flitz can't tell whether clicks on different days came from the same visitor, and there is no unique visitor total for a range.

`getOrphanClicks` lists the slugs that got orphan clicks on all domains, or on the custom domain in `domain`, to find mistyped printed short URLs.

## AI access

**MCP tool**: an operation agents can call through the Model Context Protocol. Every API operation has exactly one, named after its `operationId`. See [MCP reference](mcp.md).

## Terms to avoid

flitz does not use these words. When someone uses one of them, they mean the term on the right.

| Avoid                                         | Use                     |
| --------------------------------------------- | ----------------------- |
| server, deployment, tenant                    | instance                |
| seat, collaborator                            | user                    |
| token (when meaning an API key)               | API key                 |
| permission (when meaning a scope)             | scope                   |
| short link, shortlink, redirect               | link                    |
| alias                                         | short URL or slug       |
| code, short code, key (for the path part)     | slug                    |
| long URL, destination, original URL           | default target          |
| device redirect, smart redirect, routing rule | redirect rule           |
| filter, criterion                             | condition               |
| template                                      | preset                  |
| param forwarding, UTM forwarding              | query passthrough       |
| deleted link, archived link                   | deactivated link        |
| short domain, branded domain, vanity domain   | domain or custom domain |
| default domain, main domain                   | instance domain         |
| 404 redirect, catch-all                       | fallback URL            |
| visit, hit, view                              | click                   |
| visitor ID, fingerprint                       | visitor hash            |
| function, action, command                     | MCP tool                |

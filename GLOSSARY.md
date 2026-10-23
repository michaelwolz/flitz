# flitz

flitz is a self-hostable, AI-first link shortener: it gives any URL a short URL, sends each visitor to the right target for their device or country, and counts clicks without storing visitors' IP addresses.

## Language

### Instance and access

**Instance**:
One installation of flitz, used by one team.
_Avoid_: Server, deployment, tenant

**User**:
A person with an account on the instance, who signs in to the web app and has exactly one role.
_Avoid_: Seat, collaborator

**Role**:
The permission level of a user on the whole instance: admin, member or viewer.
_Avoid_: Permission group

**Invitation**:
An admin's offer of a role to an email address; the invited person can sign up for 48 hours and gets that role.
_Avoid_: Invite link, request

**API Key**:
A credential that lets software act on the instance, limited to its scopes; only admins create them.
_Avoid_: Token (when meaning an API key), secret

**Scope**:
A named right granted to an API key or MCP connection, such as reading links or writing domains.
_Avoid_: Permission (when meaning a scope)

### Links

**Link**:
The managed object that maps a short URL to its targets, with its redirect rules and click history.
_Avoid_: Short link, shortlink, redirect

**Short URL**:
The public address of a link: its domain plus its slug.
_Avoid_: Short link, alias

**Slug**:
The path part of a short URL that identifies a link within its domain.
_Avoid_: Code, short code, key, alias

**Default Target**:
The URL a link sends visitors to when no redirect rule matches.
_Avoid_: Long URL, destination, original URL

**Redirect Rule**:
An ordered entry on a link that sends visitors matching all of its conditions to its own target; the first matching rule wins.
_Avoid_: Device redirect, smart redirect, routing rule

**Condition**:
A single test a redirect rule applies to a click, such as device type or country.
_Avoid_: Filter, criterion

**Preset**:
A ready-made set of redirect rules for a common case, such as sending iOS to the App Store and Android to Google Play.
_Avoid_: Template

**Query Passthrough**:
Adding the query parameters of a short URL to the chosen target, except those the target already has; the target's own parameters always win.
_Avoid_: Param forwarding, UTM forwarding

**Deactivated Link**:
A link that no longer redirects but keeps its slug and click history; only an admin can delete it, in the web app.
_Avoid_: Deleted link, archived link

### Domains

**Domain**:
A domain name, such as go.example.com, that serves short URLs.
_Avoid_: Short domain, hostname

**Instance Domain**:
The domain the instance itself runs on, which serves short URLs without being added.
_Avoid_: Default domain, main domain

**Custom Domain**:
A domain an admin has added to the instance; it serves short URLs as soon as its DNS points at the instance.
_Avoid_: Branded domain, vanity domain

**Fallback URL**:
Where a domain sends visitors whose slug is unknown or belongs to a deactivated link.
_Avoid_: 404 redirect, catch-all

### Analytics

**Click**:
One request to an active link's short URL, recorded with its device, country, referrer and query parameters but never the visitor's IP address.
_Avoid_: Visit, hit, view

**Bot Click**:
A click recognised as coming from a crawler, link preview or email scanner; recorded but hidden from stats by default.
_Avoid_: Fake click, spam click

**Orphan Click**:
A request to a domain whose slug matches no active link.
_Avoid_: Orphan visit, 404 hit

**Visitor Hash**:
An anonymous identifier derived from a click with a salt that changes every day and is then destroyed, used only to count unique visitors per day.
_Avoid_: Visitor ID, fingerprint, user ID

**Retention Period**:
How long clicks are kept before they are permanently deleted.
_Avoid_: TTL, expiry

### AI access

**MCP Tool**:
An operation agents can call through the Model Context Protocol; every API operation has exactly one.
_Avoid_: Function, action, command

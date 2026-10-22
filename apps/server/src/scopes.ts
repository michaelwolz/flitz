export const scopes = ["links:read", "links:write", "stats:read", "domains:write", "instance:admin"] as const;
export type Scope = (typeof scopes)[number];

export const roles = ["admin", "member", "viewer"] as const;
export type Role = (typeof roles)[number];

const roleScopes: Record<Role, Scope[]> = {
  admin: [...scopes],
  member: ["links:read", "links:write", "stats:read"],
  viewer: ["links:read", "stats:read"],
};

export function scopesOf(role: string): Scope[] {
  return roles.includes(role as Role) ? roleScopes[role as Role] : [];
}

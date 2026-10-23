import { Send } from "lucide-react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useLoaderData, useRevalidator } from "react-router";
import { toast } from "sonner";
import { Confirm } from "@/components/confirm";
import { NameDialog } from "@/components/name-dialog";
import { focusPageHeading, PageHeader } from "@/components/page-header";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, type InvitationRow, type Role, roles, type UserRow, useAction } from "@/lib/api";
import { avatar, formatDate } from "@/lib/utils";
import { useSetOwnName, useShell } from "./shell.tsx";

export async function usersLoader() {
  const data = await api<{ users: UserRow[]; invitations: InvitationRow[] }>("/users");
  return { ...data, now: Date.now() };
}

const note = "text-small text-muted-foreground";

function RoleOptions() {
  const { t } = useTranslation();
  return roles.map((role) => (
    <NativeSelectOption key={role} value={role}>
      {t(`roles.${role}`)}
    </NativeSelectOption>
  ));
}

export function Users() {
  const { t } = useTranslation();
  const { user: me } = useShell();
  const setOwnName = useSetOwnName();
  const { users, invitations, now } = useLoaderData<typeof usersLoader>();
  const revalidator = useRevalidator();
  const invite = useAction();
  const change = useAction();

  function update(action: () => Promise<unknown>, done: string, removesRow = false) {
    change.run(async () => {
      await action();
      await revalidator.revalidate();
      toast.success(done);
      if (removesRow) focusPageHeading();
    });
  }

  function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email"));
    invite.run(async () => {
      await api<InvitationRow>("/users/invitations", { email, role: data.get("role") });
      form.reset();
      await revalidator.revalidate();
      toast.success(t("users.invited", { email }));
    });
  }

  return (
    <div className="flex max-w-[1040px] flex-col gap-6">
      <PageHeader title={t("users.title")} lead={t("users.lead")} />
      <Card aria-labelledby="invite" className="gap-4">
        <CardHeader>
          <CardTitle id="invite">{t("users.invite")}</CardTitle>
          <CardDescription>{t("users.inviteText")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitInvite} className="flex flex-wrap items-end gap-3">
            <Field className="min-w-0 flex-[1_1_300px]">
              <FieldLabel htmlFor="invite-email">{t("auth.email")}</FieldLabel>
              <Input id="invite-email" name="email" type="email" required autoComplete="off" placeholder={t("examples.email")} />
            </Field>
            <Field className="w-auto">
              <FieldLabel htmlFor="invite-role">{t("users.role")}</FieldLabel>
              <NativeSelect id="invite-role" name="role" defaultValue="member">
                <RoleOptions />
              </NativeSelect>
            </Field>
            <SubmitButton pending={invite.pending} pendingLabel={t("users.inviting")}>
              <Send aria-hidden="true" />
              {t("users.sendInvite")}
            </SubmitButton>
          </form>
          <FieldError className="mt-3">{invite.error}</FieldError>
        </CardContent>
      </Card>
      <FieldError>{change.error}</FieldError>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col">{t("users.user")}</TableHead>
            <TableHead scope="col">{t("users.role")}</TableHead>
            <TableHead scope="col">{t("users.joined")}</TableHead>
            <TableHead scope="col">
              <span className="sr-only">{t("users.actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => {
            const name = user.name || user.email;
            const isYou = user.id === me.id;
            const editable = !user.locked && !isYou;
            return (
              <TableRow key={user.id}>
                <TableCell>
                  <span className="flex items-center gap-3">
                    <span aria-hidden="true" className={avatar}>
                      {name.charAt(0).toUpperCase()}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium">{user.name}</span>
                      <span className={note}>{user.email}</span>
                      {user.locked && <span className={note}>{t("users.locked")}</span>}
                      {!user.emailVerified && <span className={note}>{t("users.unverified")}</span>}
                    </span>
                  </span>
                </TableCell>
                <TableCell>
                  {editable ? (
                    <NativeSelect
                      size="sm"
                      aria-label={t("users.roleOf", { name })}
                      aria-disabled={change.pending}
                      className="aria-disabled:opacity-50"
                      value={user.role}
                      onChange={(event) => {
                        if (change.pending) return;
                        const role = event.target.value as Role;
                        update(
                          () => api<UserRow>(`/users/${user.id}`, { role }, "PATCH"),
                          t("users.roleChanged", { name, role: t(`roles.${role}`) }),
                        );
                      }}
                    >
                      <RoleOptions />
                    </NativeSelect>
                  ) : (
                    <Badge variant="secondary">{isYou ? t("users.you", { role: t(`roles.${user.role}`) }) : t(`roles.${user.role}`)}</Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDate(user.createdAt)}</TableCell>
                <TableCell className="text-right">
                  <NameDialog
                    trigger={
                      <Button variant="ghost" size="sm" aria-label={t("users.renameLabel", { name })}>
                        {t("users.rename")}
                      </Button>
                    }
                    title={isYou ? t("shell.changeName") : t("users.renameTitle", { name })}
                    description={isYou ? t("shell.changeNameText") : t("users.renameText")}
                    name={user.name}
                    save={async (newName) => {
                      await api<UserRow>(`/users/${user.id}`, { name: newName }, "PATCH");
                      if (isYou) setOwnName(newName);
                      await revalidator.revalidate();
                      toast.success(t("users.renamed", { name, newName }));
                    }}
                  />
                  {editable && (
                    <Confirm
                      trigger={
                        <Button variant="ghost" size="sm" className="text-destructive" aria-label={t("users.removeLabel", { name })}>
                          {t("users.remove")}
                        </Button>
                      }
                      title={t("users.removeTitle", { name })}
                      description={t("users.removeText", { name })}
                      action={t("users.remove")}
                      onConfirm={() => update(() => api(`/users/${user.id}`, undefined, "DELETE"), t("users.removed", { name }), true)}
                    />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {invitations.length > 0 && (
        <section aria-labelledby="invitations" className="flex flex-col gap-3">
          <h2 id="invitations" className="font-heading text-heading">
            {t("users.invitations")}
          </h2>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead scope="col">{t("auth.email")}</TableHead>
                <TableHead scope="col">{t("users.role")}</TableHead>
                <TableHead scope="col">{t("users.validUntil")}</TableHead>
                <TableHead scope="col">
                  <span className="sr-only">{t("users.actions")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((invitation) => (
                <TableRow key={invitation.id}>
                  <TableCell className="font-medium">{invitation.email}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{t(`roles.${invitation.role}`)}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(invitation.expiresAt)}
                    {new Date(invitation.expiresAt).getTime() < now && (
                      <Badge variant="warning" className="ml-2">
                        {t("users.expired")}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      aria-label={t("users.revokeLabel", { email: invitation.email })}
                      onClick={() =>
                        update(
                          () => api(`/users/invitations/${invitation.id}`, undefined, "DELETE"),
                          t("users.revoked", { email: invitation.email }),
                          true,
                        )
                      }
                    >
                      {t("users.revoke")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}
    </div>
  );
}

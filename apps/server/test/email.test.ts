import { createServer, type AddressInfo } from "node:net";
import { afterAll, expect, test } from "vitest";
import { createApp } from "../src/app.ts";
import { call, cookieOf, newClient, signUp, testEnv } from "./client.ts";

async function smtpSink() {
  const messages: string[] = [];
  const server = createServer((socket) => {
    let buffered = "";
    let inData = false;
    let message = "";
    socket.write("220 localhost ESMTP\r\n");
    socket.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      let end: number;
      while ((end = buffered.indexOf("\r\n")) !== -1) {
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        if (inData) {
          if (line === ".") {
            messages.push(message);
            message = "";
            inData = false;
            socket.write("250 queued\r\n");
          } else message += `${line.startsWith("..") ? line.slice(1) : line}\r\n`;
          continue;
        }
        if (line.startsWith("EHLO") || line.startsWith("HELO")) socket.write("250-localhost\r\n250 SIZE 35882577\r\n");
        else if (line === "DATA") {
          inData = true;
          socket.write("354 send message\r\n");
        } else if (line === "QUIT") socket.end("221 bye\r\n");
        else socket.write("250 ok\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    messages,
    url: `smtp://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

function mimePart(raw: string, type: string) {
  const part = raw.split(/\r?\n--[^\r\n]+(?:--)?\r?\n/).find((section) => new RegExp(`Content-Type: ${type}`, "i").test(section));
  if (!part) throw new Error(`Missing ${type} MIME part`);
  const split = part.indexOf("\r\n\r\n");
  const headers = part.slice(0, split);
  let body = part.slice(split + 4);
  if (/Content-Transfer-Encoding: quoted-printable/i.test(headers)) {
    body = body.replace(/=\r?\n/g, "").replace(/=([\da-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  } else if (/Content-Transfer-Encoding: base64/i.test(headers)) {
    body = Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8");
  }
  return body;
}

const actionUrl = (raw: string) => mimePart(raw, "text/plain").match(/https?:\/\/[^\s]+/)?.[0] ?? "";

const smtp = await smtpSink();
const { app, close } = await createApp(await testEnv({ SMTP_URL: smtp.url, SMTP_FROM: "flitz <links@example.com>" }));
afterAll(async () => {
  await close();
  await smtp.close();
});

test("all account emails send responsive HTML and text with an escaped sender and embedded lockup", async () => {
  const address = "inviter-email@example.com";
  const signup = await signUp(app, address, { name: '<img src=x onerror="alert(1)">' });
  expect(signup.status).toBe(200);
  await expect.poll(() => smtp.messages.length).toBe(1);

  const verification = smtp.messages[0];
  const verificationHtml = mimePart(verification, "text/html");
  expect(verification).toMatch(/Content-Type: multipart\/related/i);
  expect(verification).toMatch(/Content-Type: text\/plain/i);
  expect(verification).toMatch(/Content-Type: image\/png/i);
  expect(verification).toMatch(/Content-ID: <flitz-lockup-light>/i);
  expect(verificationHtml).toContain('name="viewport" content="width=device-width, initial-scale=1"');
  expect(verificationHtml).toContain('src="cid:flitz-lockup-light"');
  const verificationUrl = actionUrl(verification);
  expect(verificationHtml).toContain(`href="${verificationUrl.replaceAll("&", "&amp;")}"`);
  expect(verificationHtml).not.toContain('<img src=x onerror="alert(1)">');
  const verified = await app.request(verificationUrl);
  expect(verified.status).toBe(302);
  const cookie = cookieOf(verified);

  const invitedAddress = "invitee-email@example.com";
  expect(
    await call(app, { cookie, origin: "http://localhost:3000" }, "POST", "/api/users/invitations", {
      email: invitedAddress,
      role: "viewer",
    }),
  ).toMatchObject({ status: 201 });
  await expect.poll(() => smtp.messages.length).toBe(2);
  const invitation = smtp.messages[1];
  expect(mimePart(invitation, "text/plain")).toContain("The invitation works for 48 hours.");
  expect(actionUrl(invitation)).toContain(`/app/sign-up?email=${encodeURIComponent(invitedAddress)}`);
  expect(mimePart(invitation, "text/html")).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");

  const invited = await signUp(app, invitedAddress);
  expect(invited.status).toBe(200);
  await expect.poll(() => smtp.messages.length).toBe(3);
  const invitedVerified = await app.request(actionUrl(smtp.messages[2]));
  expect(invitedVerified.status).toBe(302);
  expect(cookieOf(invitedVerified)).toContain("session_token");

  const magic = await app.request("/api/auth/sign-in/magic-link", {
    method: "POST",
    headers: { "content-type": "application/json", ...newClient() },
    body: JSON.stringify({ email: invitedAddress, callbackURL: "/app" }),
  });
  expect(magic.status).toBe(200);
  await expect.poll(() => smtp.messages.length).toBe(4);
  const magicRaw = smtp.messages[3];
  expect(mimePart(magicRaw, "text/plain")).toContain("The link works once, for 5 minutes.");
  const magicSignIn = await app.request(actionUrl(magicRaw));
  expect(magicSignIn.status).toBe(302);
  expect(cookieOf(magicSignIn)).toContain("session_token");

  const reset = await app.request("/api/auth/request-password-reset", {
    method: "POST",
    headers: { "content-type": "application/json", ...newClient() },
    body: JSON.stringify({ email: invitedAddress }),
  });
  expect(reset.status).toBe(200);
  await expect.poll(() => smtp.messages.length).toBe(5);
  const resetRaw = smtp.messages[4];
  const resetUrl = new URL(actionUrl(resetRaw));
  expect(mimePart(resetRaw, "text/plain")).toContain("The link works once, for 1 hour.");
  expect(
    (
      await app.request("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json", ...newClient() },
        body: JSON.stringify({ token: resetUrl.searchParams.get("token"), newPassword: "a brand new passphrase" }),
      })
    ).status,
  ).toBe(200);

  for (const raw of smtp.messages) {
    expect(raw).toMatch(/Content-Type: text\/plain/i);
    expect(raw).toMatch(/Content-Type: text\/html/i);
    expect(raw).toMatch(/Content-ID: <flitz-lockup-light>/i);
  }
});

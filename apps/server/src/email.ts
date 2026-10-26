import { html } from "hono/html";

export type SystemEmailInput = {
  heading: string;
  intro: string;
  actionLabel: string;
  actionUrl: string;
  details: string[];
  host: string;
};

const escapeHtml = (value: string) => String(html`${value}`);

export function systemEmail({ heading, intro, actionLabel, actionUrl, details, host }: SystemEmailInput) {
  const escapedUrl = escapeHtml(actionUrl);
  const footer = `This email was sent by flitz on ${host}.`;
  const text = [heading, intro, `${actionLabel}:`, actionUrl, ...details, footer].join("\n\n");

  return {
    text,
    html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;background:#FFFAF8;color:#1F1235;font-family:Arial,Helvetica,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${escapeHtml(intro)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#FFFAF8">
    <tr><td align="center" style="padding:28px 16px 32px">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px">
        <tr><td align="center" style="padding:0 16px 24px">
          <img src="cid:flitz-lockup-light" width="137" height="48" alt="flitz" style="display:block;width:137px;height:48px;border:0">
        </td></tr>
        <tr><td style="padding:32px 24px;background:#FFFFFF;border:1px solid #EDE6F0;border-radius:20px">
          <h1 style="margin:0 0 14px;color:#2E1065;font-size:28px;line-height:1.2;font-weight:700">${escapeHtml(heading)}</h1>
          <p style="margin:0 0 24px;color:#1F1235;font-size:16px;line-height:1.6">${escapeHtml(intro)}</p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0">
            <tr><td bgcolor="#FF6B5B" style="border-radius:999px">
              <a href="${escapedUrl}" style="display:inline-block;padding:14px 24px;border-radius:999px;background:#FF6B5B;color:#2E1065;font-size:16px;line-height:20px;font-weight:700;text-decoration:none">${escapeHtml(actionLabel)}</a>
            </td></tr>
          </table>
          <p style="margin:20px 0 6px;color:#675E7A;font-size:13px;line-height:1.5">If the button doesn't work, copy and paste this link into your browser:</p>
          <p style="margin:0;color:#2E1065;font-size:13px;line-height:1.5;overflow-wrap:anywhere;word-break:break-all"><a href="${escapedUrl}" style="color:#2E1065;text-decoration:underline">${escapedUrl}</a></p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:28px">
            <tr><td style="border-top:1px solid #EDE6F0;padding-top:18px">
              ${details.map((detail) => `<p style="margin:0 0 10px;color:#675E7A;font-size:14px;line-height:1.55">${escapeHtml(detail)}</p>`).join("")}
            </td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:18px 12px 0;color:#675E7A;font-size:12px;line-height:1.5">${escapeHtml(footer)}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}

export type SystemEmail = ReturnType<typeof systemEmail>;

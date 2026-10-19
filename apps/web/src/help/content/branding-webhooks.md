## Branding

Under **Settings → Branding**, admins make the platform look like their own:

- **Product name**: shown in the browser tab, on the sign-in page and in emails.
- **Logo (light background)** and **Logo (dark background)**, used in the light and dark themes, emails and PDF reports. PNG, SVG or ICO up to 1 MB.
- **Favicon**: the small icon in the browser tab.
- **Primary colour** and **Accent colour**: buttons, links and highlights. A contrast check warns when text on the colour would be hard to read.
- **Support email**: where your users are told to ask for help.
- **Custom CSS** (advanced): extra styling applied on every page.

The **Preview** shows the result before you save. Branding applies to your sign-in page, the whole app, emails and PDF reports.

## Webhooks

Webhooks send events to your other systems (a ticketing system, a chat channel, your own software) the moment they happen. Under **Settings → Webhooks → New webhook**, give it a **name**, the **URL** to call (HTTPS, on the public internet) and the **events**:

| Event | When |
|---|---|
| `alarm.raised` | an alarm is raised |
| `alarm.acknowledged` | someone acknowledges it |
| `alarm.cleared` | it clears |
| `device.status_changed` | a device goes online, offline or dead |

Each call is an HTTP `POST` with a JSON body, for example:

```json
{ "id": "…", "event": "alarm.raised", "ts": 1767225600000,
  "data": { "alarm": { "rule": "Low fuel", "severity": "major", "status": "active" },
            "device": { "id": "…", "name": "Tower 17" } } }
```

The **signing secret** is shown once, when the webhook is created (or its secret is rotated): copy it into the receiving system. Each call carries a signature so the receiver can check it came from you and wasn't changed: an HMAC-SHA256 of `timestamp.body` keyed with the secret. Ask your developer to verify it and to reject calls with an old timestamp.

Failed calls are retried up to 5 times; every call is listed in the **Delivery log**. **Send test** sends a sample event and shows the receiver's HTTP status.

:::platform
## For platform users

- Platform branding (**Settings → Branding**) is the default for the main domain and for customers without their own; each customer's is set on the customer's page (**Customers → … → Branding**) or by their admins. Custom CSS is sanitised (remote imports and URLs are removed).
- Platform webhooks receive every customer's events; a customer's receive only theirs.
- Headers: `X-Perspice-Event`, `X-Perspice-Delivery`, `X-Perspice-Timestamp`, `X-Perspice-Signature: sha256=<hex>` of HMAC-SHA256(`<timestamp>.<raw body>`). Node.js check:

```js
const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(`${req.headers['x-perspice-timestamp']}.${rawBody}`).digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers['x-perspice-signature']));
```

- Destinations must be public `https` URLs: private, loopback and cloud-metadata addresses are refused when saving and again when connecting, and redirects aren't followed. A super admin can allow plain HTTP and/or private addresses under **Destinations** for receivers on your own network. Calls time out after 5 seconds.
:::

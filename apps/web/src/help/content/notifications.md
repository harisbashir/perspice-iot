Alarms and device status changes reach you as **notifications**. Everyone chooses their own settings under **Settings → Notifications**.

## Where notifications arrive

- **The bell** in the top bar always shows your notifications. Click one to open the alarm or device.
- **Email**, if turned on.
- **Push notifications** to your browser or phone, if turned on for that browser.

Whether you are notified at all about an alarm depends on the rule (it names roles, people or groups). These settings decide **how** you hear about it.

## Your settings

- **Channels**: turn email and push on or off.
- **Send email and push for**: the lowest severity worth an email or push, e.g. *major and above*. Lower ones still appear in the bell.
- **Quiet hours** in your timezone: **Hold email and push during quiet hours**, and they arrive as one summary email when quiet hours end. **Critical alarms ignore quiet hours** lets the urgent ones through.
- **Busy periods**: **Send at most** a number of emails and pushes **Within (minutes)**; the rest are bundled into one summary email (10 in 15 minutes by default). This stops a storm of alarms flooding your inbox.

### Push in this browser

Under **This browser**, turn push on. The browser asks for permission; allow it. Push is set per browser, so turn it on on each computer and phone you use. If the browser blocks notifications, change it in the browser's site settings.

## Delivery log

**Settings → Delivery log** (admins) lists every email, push and webhook call sent: when, to whom, and whether it was **Sent**, **Failed**, **Held for a digest** or **Gave up**. Failed sends are retried up to 5 times, waiting longer each time; the ones that still fail can be retried from the log.

:::platform
## For platform users

- Email needs **Settings → Email** (SMTP or Amazon SES). Without it, email deliveries fail with "Email is not configured".
- Push needs a VAPID key pair on the server: `perspice cli vapid-keys`, add the output and `VAPID_SUBJECT=mailto:…` to `/opt/perspice/.env`, then `perspice restart`. The installer generates the keys. Without them, push is hidden ("Push notifications are not set up on this server").
- Device status notifications (offline, dead, back online) are configured per profile under **Status notifications** in the profile editor.
- Deliveries run on a queue with exponential back-off starting at 30 s; dead letters stay in the log for retry.
:::

# Alarms and notifications

## Alarm rules

A rule watches device data and raises an **alarm** when its condition is met. Rules are managed
under **Alarms → Alarm rules** (or from a device's **Alarms** tab).

| Type | Raises when | Clears when |
|---|---|---|
| Threshold | a value is above/below a threshold | it is back past the threshold by the **clear margin** |
| Range | a value leaves (or enters) a range | it is back inside (outside) the range by the margin |
| Duration | a value stays past a threshold for N seconds | it is back past the threshold by the margin |
| Rate of change | a value rises/falls faster than N per minute | the rate drops below N minus the margin |
| State match | a value equals one of the listed states | it no longer does |
| Device status | the device goes offline or dead | it is back online |
| No data | a value stops reporting for N seconds | it reports again |
| Geofence | the device leaves (or enters) a geofence | it is back inside (outside) by the clear margin, default 20 m |
| Service due | run hours (of a run time key) or days since the last service reach the interval (or the reminder share of it) | a service is logged on the device's Maintenance tab |

The **clear margin** stops alarms flapping when a value hovers around the threshold: with
"fuel below 20, margin 5" the alarm clears only once fuel is back at 25 or more. Geofence rules
need devices with reported locations ([location.md](location.md)); service-due rules and the
service log are described in [energy.md](energy.md).

### Scope

- **Profile rules** (platform admins) apply to every device of the profile, in every customer.
- **Customer rules** (platform admins, or customer admins with `alarm.rule.write`) apply to all
  of one customer's devices, optionally only those of one profile.
- **Device rules** apply to one device. A device or customer rule can also **opt out** of an
  inherited profile rule (`disablesRuleId`).

A device's **Alarms** tab lists the rules that actually run for it. Customers see the profile
rules their devices inherit, read-only.

### Options

- **Severity**: critical, major, minor or warning.
- **Schedule**: days and hours when the rule may raise alarms (in the rule's timezone, or the
  customer's). Outside the schedule nothing new is raised, but open alarms can still clear.
- **Recipients**: roles (customer admins/operators/viewers, platform admins, support), named
  users or customer groups. Only people who can see the device are ever notified. A user limited
  to a group is notified only about devices in their groups.
- **Channels**: in-app, email, push.
- **Repeat notifications at most every N minutes** (cooldown) for the same rule and device.

## Alarms

Each rule has at most one open alarm per device. An alarm is **active** until someone
**acknowledges** it, and is **cleared** when its condition recovers (or by hand). Its timeline
records who acknowledged, cleared or commented, and when. Clearing by hand while the condition
still holds raises a new alarm on the next reading.

Alarms appear under **Alarms** (with live updates and bulk acknowledge), on each device's
**Alarms** tab, in the overview's alarm tiles and table, and in alarm widgets on dashboards.
Alarm lists export to CSV, Excel or PDF.

| Permission | Allows |
|---|---|
| `alarm.read` | seeing alarms and rules (all built-in roles) |
| `alarm.ack` | acknowledging, clearing and commenting (operators and admins) |
| `alarm.rule.write` | managing rules (platform admins, customer admins) |

## Notifications

Everyone sets their own preferences under **Settings → Notifications**:

- **Email** and **push** on or off. In-app notifications (the bell) always arrive.
- **Minimum level** for email and push (e.g. major alarms and above).
- **Quiet hours** in your timezone: email and push are held and arrive as one summary email when
  quiet hours end. Critical alarms can be allowed through.
- **Busy periods**: after N emails/pushes within M minutes (default 10 in 15), the rest are
  bundled into one summary email.
- **Push**: turn it on for each browser. Push needs VAPID keys on the server (see
  `operations.md`).

Every send is recorded in **Settings → Delivery log**, with up to 5 attempts and exponential
back-off. Deliveries that still fail are marked as given up; admins can retry them.

## Webhooks

**Settings → Webhooks** (`webhook.manage`) sends events to other systems as JSON `POST`s:
`alarm.raised`, `alarm.acknowledged`, `alarm.cleared` and `device.status_changed`. A customer's
webhooks receive only that customer's events; platform webhooks receive every customer's.

```json
{ "id": "<delivery id>", "event": "alarm.raised", "ts": 1767225600000,
  "data": { "alarm": { "id": "…", "rule": "Low fuel", "severity": "major", "status": "active", … },
            "device": { "id": "…", "name": "Tower 17" }, "customerId": "…" } }
```

Each call carries `X-Perspice-Event`, `X-Perspice-Delivery`, `X-Perspice-Timestamp` and
`X-Perspice-Signature: sha256=<hex>`, an HMAC-SHA256 of `<timestamp>.<raw body>` keyed with
the webhook's secret. The secret is shown only when the webhook is created or its secret is
rotated. To verify in Node.js:

```js
const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(`${req.headers['x-perspice-timestamp']}.${rawBody}`).digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers['x-perspice-signature']));
```

Reject calls whose timestamp is more than a few minutes old. Destinations must be `https` URLs on
the public internet. Private, loopback and cloud-metadata addresses are refused when saving and
again when connecting, and redirects are not followed. A platform admin can allow plain HTTP or
private addresses for internal receivers. Calls time out after 5 seconds and are retried like
other deliveries.

## Scheduled reports

**Scheduled reports** (`report.schedule`) emails a dashboard PDF (a device's dashboard or the
overview) or a telemetry export daily, weekly or monthly, at a time in a chosen timezone, to
people in your organisation. Each run covers the chosen period up to the run time; the email
links to the file for 7 days. A schedule runs with its owner's current access: if the owner is
deactivated or can no longer see the device, the run is skipped and the reason is shown.

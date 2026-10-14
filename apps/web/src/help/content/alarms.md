An **alarm rule** watches device data. When its condition is met, it raises an **alarm** on that device and notifies the people concerned.

## The life of an alarm

1. **Active**: the condition was met. People are notified.
2. **Acknowledged**: someone has seen it and is dealing with it. Notifications stop repeating; the alarm stays open.
3. **Cleared**: the condition went away by itself (*condition recovered*), or someone cleared it by hand.

A rule has at most one open alarm per device: while one is open, the same problem doesn't raise another. If you clear an alarm by hand while the problem is still there, a new alarm is raised on the next reading.

Every alarm has a **timeline**: when it was raised, who acknowledged or cleared it, and comments. Add a comment to say what was done; the comment is also saved with an acknowledge or clear.

## The Alarms page

- Filter by status (**Open**, **Unacknowledged**, **Cleared**, **All**) and **severity**.
- Severities, most urgent first: **critical**, **major**, **minor**, **warning**.
- Select several alarms to **acknowledge** them together.
- The list updates live. Export it as CSV, Excel or PDF.

Acknowledging and clearing need the operator or admin role.

## Kinds of rule

| Type | Raises when | Clears when |
|---|---|---|
| Threshold | a value is above or below a threshold | it is back past the threshold by the **clear margin** |
| Range | a value leaves (or enters) a range | it is back inside (outside) by the margin |
| Duration | a value stays past a threshold for a number of seconds | it is back past the threshold by the margin |
| Rate of change | a value rises or falls faster than a rate per minute | the rate drops back |
| State match | a value equals one of the listed states (e.g. `fault`) | it no longer does |
| Device status | the device goes offline or dead | it is back online |
| No data | a value stops arriving for a number of seconds | it arrives again |
| Geofence | the device leaves (or enters) an area | it is back by the clear margin (20 m by default) |
| Service due | run hours or days since the last service reach the interval | a service is logged on the device |

**Why a clear margin?** A value that hovers around the threshold would raise and clear an alarm over and over. With *fuel below 20, margin 5*, the alarm raises below 20 but clears only once fuel is back at 25 or more.

## Writing a rule

Under **Alarm rules → New rule**, choose what it applies to:

- **All of our devices**, optionally only those of one profile;
- **One device** (also from a device's **Alarms** tab).

Then set:

- the **type** and its condition, a **name** and the **severity**;
- **Notify**: roles, named people or groups, and the channels (in-app, email, push). Only people who can see the device are ever notified;
- **Repeat notifications at most every (minutes)**, so a flapping device doesn't flood anyone;
- optionally a **schedule**: the days and hours when the rule may raise alarms (e.g. only outside working hours). Outside it nothing new is raised, but open alarms still clear.

The **rule preview** describes the rule in words; check it before saving.

Rules made by the platform for a whole device profile apply to your devices too. They are listed read-only; a rule of your own on the device can **opt out** of one that doesn't suit it.

:::platform
## Rule scopes

| Scope | Who | Applies to |
|---|---|---|
| Profile | platform admins | every device of the profile, in every customer |
| Customer | platform admins; customer admins (`alarm.rule.write`) | one customer's devices, optionally of one profile |
| Device | as above | one device |

A device or customer rule can opt out of an inherited profile rule (`disablesRuleId`). A device's **Alarms** tab lists the rules that actually run for it. Rules are evaluated by the `rules` service as telemetry arrives; duration and no-data timers run in the `scheduler`. Geofence rules need devices with reported locations; a profile-wide geofence rule needs a platform-wide geofence.

Permissions: `alarm.read` (see alarms and rules), `alarm.ack` (acknowledge, clear, comment), `alarm.rule.write` (manage rules). Raised, acknowledged and cleared alarms can also be sent to other systems with [webhooks](/help/branding-webhooks).
:::

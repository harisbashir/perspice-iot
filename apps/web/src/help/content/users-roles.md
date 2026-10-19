Everyone who signs in has a **user** account with one **role**. The role decides what they may do; their organisation (and optionally a **group**) decides what they may see.

## Inviting people

**Users → Invite user**: enter their **email**, **name** and **role**, and optionally a **group** to limit them to.

They get a link to set their password, valid for 72 hours. The link is emailed when email is set up, and you can always copy it: it is shown after the invite, and **Copy invite link** in the user's menu makes a fresh one (earlier links stop working). **Resend invite** emails it again.

Until they set their password, they show as **invited**.

## Managing users

From a user's menu: **Disable** (they are signed out everywhere and can't sign in; **Enable** undoes it), **Delete**, and for invited users **Resend invite** and **Copy invite link**. The **2FA** column shows who has two-factor authentication on.

You can't change your own role or disable yourself, and you can only give roles with no more permissions than your own.

## Roles

| Role | Can |
|---|---|
| Customer Viewer | see devices, assets, dashboards, values and alarms |
| Customer Operator | also send commands, acknowledge alarms, log services, export data and schedule reports |
| Customer Admin | also manage users, devices, assets, alarm rules, geofences, webhooks, branding and tariffs, customise dashboards, claim devices, and read the audit log |

**Groups** narrow what someone sees: a user limited to a group sees only that group's devices and assets (including sub-groups), and is only notified about those.

:::platform
## Platform roles and custom roles

| Role | Scope | Can |
|---|---|---|
| Super Admin | platform | everything, including system settings and backups |
| Platform Admin | platform | everything except system settings and backups |
| Support | platform | read everything, change nothing |

**Roles → New role** creates a custom role from individual permissions, at platform or customer scope. Nobody can create or grant a role with more permissions than they hold. Built-in roles are fixed (and re-synced from the code at start-up); custom roles keep exactly their permissions.

| Permission | Allows |
|---|---|
| `customer.read`, `customer.manage` | customers |
| `user.read`, `user.manage`, `role.manage` | users, roles |
| `device.read`, `device.write`, `device.credentials`, `device.command`, `device.claim`, `device.service` | devices, tokens, commands, claim codes, service log |
| `profile.read`, `profile.write` | device profiles |
| `telemetry.read`, `export.data` | values (including on dashboards), exports |
| `dashboard.edit`, `dashboard.customize` | templates, customer copies |
| `alarm.read`, `alarm.ack`, `alarm.rule.write` | alarms, acknowledging, rules |
| `asset.read`, `asset.write`, `asset.type.manage` | assets, asset types |
| `branding.edit`, `webhook.manage`, `report.schedule`, `geofence.manage`, `tariff.manage`, `notification.read`, `audit.read` | as named |
| `firmware.manage`, `system.settings`, `backup.manage` | firmware, system |

Dashboard widgets need the permissions of the data they show (`telemetry.read` for values, `alarm.read` for alarms), so a custom role without them sees those widgets empty. Platform users invite customer users by choosing a customer role and the **Customer**; customer users sign in on their customer's subdomain only.
:::

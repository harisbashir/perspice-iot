A fresh installation has no profiles, devices or customers. This is the order that avoids back-tracking. Each step links to the article with the details.

## 1. Secure the super admin account

You activated the super admin from the installer's link and enrolled two-factor authentication. Under **Settings → Security**, keep *Require two-factor authentication for super admins* on. Then set up email under **Settings → Email** (SMTP or Amazon SES) and use *Send a test email*. Without email, invites, password resets and alarm emails can't be delivered (invite links can still be copied from **Users**). See [System, backups and updates](/help/system).

## 2. Describe your first kind of device

Under **Device profiles → New profile**, describe one kind of device:

- **Telemetry keys**: every value it sends, with a label, unit and decimals. The key names must match what the firmware sends exactly, e.g. `fuel_level`.
- **Commands** it accepts, if any.
- **Presence**: how long it may stay quiet before it is *offline* (e.g. three missed reports) and *dead*.
- **Location**: none, fixed, or reported by the device.

See [Device profiles](/help/device-profiles).

## 3. Give the profile a dashboard

Under **Dashboards → Generate from profile**, choose the profile: this creates a starting dashboard from its keys and commands and makes it the profile's default. Refine it in the builder (**Edit**); it previews with sample data until a real device exists. See [Designing dashboards](/help/dashboard-templates).

## 4. Connect a test device

Under **Devices → New device**, choose the profile and leave the customer empty. Copy the device id and token from the **Credentials** tab into the firmware (or the simulator), and watch the device come **online** and its dashboard fill. Problems show in the device's **Debug** tab. See [Connecting devices](/help/connecting-devices).

## 5. Add alarm rules

Under **Alarms → Alarm rules**, add profile rules every customer inherits, such as *device offline* or *fuel below 20 %*. See [Alarms and alarm rules](/help/alarms).

## 6. Create a customer

Under **Customers → New customer**, choose a name and a **slug**: the customer's address becomes `<slug>.<your domain>`. Set their branding, then under **Users → Invite user** invite their first **Customer Admin**. Assign devices to the customer from the device list (**Assign** bulk action), or give devices **claim codes** so the customer adds them. See [Customers and groups](/help/customers).

The customer admin can then invite their own colleagues, build their asset tree, customise dashboards and add their own alarm rules.

## 7. Optional: assets

If customers think in sites and buildings, create **asset types** (Site, Building, Generator…) with the details each should record, and a dashboard per type. Customers then build their own asset trees. See [Asset types](/help/asset-types).

## 8. Backups

Under **System → Backups**, schedule a daily backup, and copy the backup passphrase from `/opt/perspice/.env` somewhere safe: without it no backup can be restored. See [System, backups and updates](/help/system).

A **customer** is an organisation using the platform: a tenant with its own users, devices, assets, dashboards, alarms, branding and address. Customers never see each other's data.

## Creating a customer

**Customers → New customer**:

- **Name**: the organisation's name.
- **Subdomain**: where the customer's users sign in, e.g. `acme` → `https://acme.<your domain>`. Lower-case letters, digits and dashes, 3 to 40 characters. `www`, `api`, `admin`, `mqtt`, `app` and `mail` are reserved.

The customer's address works straight away: its HTTPS certificate is issued the first time someone opens it (only for active customers).

Then:

1. **Branding**: their logo, colours and product name (or leave the platform's).
2. **Timezone**: used for their energy periods, schedules and reports.
3. **Users → Invite user**: choose a customer role such as *Customer Admin* and this **Customer**. Their admin can invite everyone else.
4. **Devices**: assign devices with the **Assign** bulk action in the device list, or create devices with **claim codes** that the customer adds themselves (**Add with claim code**).

## Groups

**Groups** split a customer into parts (regions, sites, departments), nested to any depth. A user limited to a group sees only that group's devices and assets (and those of its sub-groups), and is only notified about those. Put devices in groups with the **Group** bulk action; customer admins can manage their own groups.

## Suspending

**Suspend** blocks sign-in on the customer's subdomain and stops issuing its certificate; their data and devices are kept, and devices keep reporting. **Reactivate** undoes it.

Deleting a customer is only possible through the API (`DELETE /api/customers/<id>`) and only once it has no devices: reassign or delete them first.

## What customers can and can't do

Customers use the platform's **device profiles**, **dashboard templates**, **asset types** and **profile alarm rules**, but can't change them. Within their own organisation, customer admins manage users, groups, assets, devices (creating them, or adding them by claim code), customer alarm rules, geofences, webhooks, branding, tariffs and their copy of each dashboard.

Platform users see everything across customers: lists show a **customer** column and filter.

The **Audit log** records who did what, and when: every change to devices, users, roles, rules, dashboards, settings and more, and sign-ins.

## Reading it

Each entry has:

- **Time**;
- **Actor**: who did it (a person, or an API key);
- **Action**: what was done, e.g. `device.update`, `user.invite`, `alarm.ack`;
- **Target**: what it was done to;
- **Details**: the values that were sent, with secrets such as passwords and tokens hidden.

Filter by **target type** (e.g. `device`) and **target id** to see the history of one thing. Paste a device's id (from its page address) to see everything that happened to it. Export the log as CSV, Excel or PDF.

Admins see their own organisation's entries.

:::platform
## For platform users

Platform users see every customer's entries and the platform's own. Entries are written by the API for every audited endpoint (bulk actions record one entry with all the ids). Request bodies are stored with secrets redacted; responses aren't stored. Exporting the audit log needs both `audit.read` and `export.data`.
:::

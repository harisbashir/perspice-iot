A **dashboard** is a page of widgets showing device data: value cards, gauges, charts, maps, tables and control buttons.

## Where dashboards appear

- The **Overview** (your home page) is a dashboard of everything you can see.
- A device's **Dashboard** tab shows its profile's dashboard filled with that device's data. All devices of the same kind share one design.
- An asset's **Dashboard** tab shows its asset type's dashboard, adding up the devices attached to the asset.

Values update live while the page is open. A widget that can't show its data says why; the rest of the dashboard still works.

## Time window

Charts and tables cover the dashboard's **time window**, for example *last 24 hours*. Use the time picker to look at another period: a relative one (last hour, last 7 days…) or exact dates. This changes only your own view, until you leave the page.

Long periods are summarised automatically: a chart over a month shows hourly averages rather than every reading.

## Views

Some dashboards have several **views**, shown as tabs above the widgets (for example *Main* and *Maintenance*).

## Widgets you can act on

- **Command buttons and switches** send commands to the device. Some ask for confirmation first. They are disabled if your role can't send commands.
- **Tables** can be sorted, paged and exported.
- **Charts and tables** have an export button (CSV, Excel or PDF).
- **Alarm widgets** let operators acknowledge alarms in place.
- **Maps** show markers coloured by status (green online, amber offline, red dead, grey never connected); click one for its values.

## Customising your organisation's dashboard

Admins can change a dashboard for their whole organisation: open a device, then **Customise dashboard** in its dashboard tab. You can add, move, resize and remove widgets, change their data and options, and add views. Saving affects only your organisation.

When the original design is later improved, the device page shows that your copy is based on an older version. **Re-sync with template** replaces your customised copy with the new design; your changes are discarded.

## PDF reports

**PDF report** creates a PDF of the current view and time window, with your branding. It is prepared in the background; you get a notification (and an email) with the link. See [Reports and exports](/help/reports-exports).

:::platform
## How templates reach customers

Dashboards are **templates** made under **Dashboards** (see [Designing dashboards](/help/dashboard-templates)). Each customer automatically gets an **instance** of a template the first time it is needed. Until they customise it, the instance shows the template as it is now, so template edits reach everyone at once. A customisation is stored as an **override** recording the template version it came from; the drift banner and **Re-sync** compare against that version.

Every widget reads its data through the viewer's own scope and permissions: a customer can never see another customer's devices, even with a hand-edited definition, and widgets showing values need `telemetry.read` (alarm widgets need `alarm.read`).
:::

**Dashboards** holds the dashboard **templates**: the designs customers see. One template serves every device of a profile (or every asset of a type), across all customers, and each customer gets their own copy they can customise.

## Kinds of template

| Kind ("Dashboard for") | Shown on | Its widgets' "current" source is |
|---|---|---|
| A device profile | the device page's Dashboard tab | the device being viewed |
| An asset type | the asset page's Dashboard tab | the asset being viewed (its devices) |
| Overview | everyone's home page | — (fleet-wide sources) |

A profile has at most one **profile default** template; every device of the profile opens on it.

## Starting points

- **Generate from profile**: builds a dashboard from a profile's keys and commands (value cards, status LEDs, a history chart, a latest-values table, command buttons) and makes it the profile's default. The fastest start.
- **New dashboard**: an empty one; choose what it is for.
- **Clone…**: copy a template onto another profile; keys named differently can be mapped in the dialog.
- **Export JSON** / **Import**: move templates between installations.

## The builder

**Edit** opens the builder.

- **Add widget** opens the widget library. Drag widgets by their handle; resize from the corner. The grid is 12 columns wide.
- **Click a widget** to edit its title, **data source**, keys and options in the side panel.
- **Views** are tabs within one dashboard (e.g. *Main*, *Energy*, *Maintenance*); add, rename and delete them. Up to 60 widgets per view.
- **Default time window** (last hour to last 90 days) and **Refresh** (off, or every 10 seconds to 15 minutes) set what the dashboard opens with. Values update live either way; refreshing also re-reads charts and tables. Viewers pick other windows with the time picker.
- **Save** stores a new version. Customers who haven't customised see it at once.

### Previewing while you build

**Preview with** chooses what fills the widgets: one of the profile's devices (or one of the type's assets) for real data, or **Sample data**. When no device or asset exists yet, the editor uses sample data automatically, so you can design before any hardware is connected. Sample values are made up from the profile's keys (their types, units and decimals); fleet-wide widgets always show real data.

## Data sources

| Source | Shows |
|---|---|
| The dashboard's device | the device the dashboard is opened for (device templates) |
| The dashboard's asset (its devices) | devices attached to the asset, or everywhere inside it, optionally of one profile (asset templates) |
| A chosen device | always one specific device |
| Devices of a profile | all devices of a profile the viewer can see, optionally filtered by status, tags or name |
| A device list | a table with chosen columns (status, name, profile, customer, last seen, telemetry keys) |
| Alarms | alarms the viewer can see; filters by status and severity, and only the device's or asset's own on their dashboards |
| None | content-only widgets (text, images, command buttons with fixed targets) |

Widgets read data with the **viewer's** permissions, so the same template is safe for every customer.

## Widgets

| Category | Widgets |
|---|---|
| Values | Value card, Multi-value card, Radial gauge, Linear gauge, Tank level, Battery, Progress bar, Status indicator, Image with values |
| Charts | Time series, Sparkline, Bar chart, Pie / donut, Heatmap |
| Tables | Latest values table, History table, Device table, Alarm table |
| Fleet and alarms | Fleet KPI, Active alarms, Alarm timeline, Map |
| Energy | Energy summary |
| Controls | Command button, Toggle, Slider, Set-point |
| Other | Text / Markdown (with `{{key}}` placeholders for live values) |

Controls send commands (or write shared attributes) to the dashboard's device; they are disabled for viewers without `device.command`.

## How customers get copies

Each customer gets an **instance** of a template the first time it is needed. Until a customer admin uses **Customise dashboard**, the instance follows the template, so your edits reach everyone. A customised instance records the template version it was based on; when you change the template, those customers see a banner offering **Re-sync with template** (which discards their changes). Unknown widget types (from a newer version) are kept and shown as "Unknown widget".

Developers can add widget types to the library; see `docs/widgets.md` in the source.

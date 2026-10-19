Devices can have a **location**, shown on maps. Moving devices (vehicles, trackers) also get **trips**, and **geofences** raise alarms when a device leaves or enters an area.

## Where a location comes from

Each kind of device either has no location, a **fixed** location set by hand (a building, a tower), or a location **reported by the device** (GPS trackers).

- **Fixed**: on the device's **Location** tab, click the map or type the latitude and longitude.
- **Reported**: the device sends its position with its other values. The newest position becomes its location straight away; positions also form its history.

## Maps

**Map** widgets on dashboards show:

- **Markers** for devices with a location, coloured by status: green online, amber offline, red dead, grey never connected. Many nearby markers group into clusters; zoom in to separate them. Click a marker for its values and a link to the device.
- A **route**: one device's path over the dashboard's time window, with a time slider and play/pause at up to 300× speed, and its trips beside the map.

Geofences you can see are drawn on maps too.

## Trips

For moving devices, the device's **Trips** tab lists journeys over a period with their **start**, **duration**, **distance**, **average** and **max speed**, plus the **distance per day**. Export them as Excel, CSV or PDF.

A trip **starts** when the device moves a little way from where it was parked (50 m by default) or reports some speed (5 km/h). It **ends** once the device has stood still for a while (5 minutes). With an **ignition** input, trips follow the ignition instead. GPS jitter while parked never adds distance, and a tracker that stored positions while out of coverage still gets its whole journey once it reconnects.

## Geofences

**Geofences** are areas drawn on the map: a **circle** (centre and radius) or a **polygon**. Admins create them under **Geofences**: choose the shape, draw it, and give it a name and colour.

Use them in an alarm rule of the type **Geofence**: *alarm when the device leaves (or enters) the geofence*. The alarm clears once the device is back by the **clear margin** (20 m by default), so GPS jitter at the edge doesn't raise and clear it repeatedly. A geofence used by rules can't be deleted until those rules change.

:::platform
## For platform users

- The profile's **Location** setting picks the mode and the telemetry keys that carry the position (defaults `lat`, `lng`, `speed` km/h, `heading`, `acc` m, `alt`). A message is a fix when it has both latitude and longitude in range; `0, 0` is ignored. Invalid fixes go to the Debug tab.
- Trip detection is turned on per profile (**Detect trips**: *Starts at (km/h)*, *…or after moving (m)*, *Ends after standing (s)*, *Ignition key*). Jumps implying more than 300 km/h are ignored. Trip figures are recomputed from stored fixes about 30 seconds after a trip ends.
- Platform admins can make a geofence **platform-wide** (*Every customer*): every customer sees it read-only and can use it in rules. Profile-wide geofence rules need one.
- Map tiles come from OpenStreetMap unless set under **Settings → Maps** (see [System, backups and updates](/help/system)).
:::

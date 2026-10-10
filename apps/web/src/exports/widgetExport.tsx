import type { DeviceDto, Timewindow, WidgetConfig } from '@perspice/shared';
import { getWidget } from '@perspice/widgets';
import { ExportMenu } from './ExportMenu';

/** The export menu for one widget frame, or null when the widget has no tabular data. */
export function widgetExportAction(w: WidgetConfig, timewindow: Timewindow, device: DeviceDto | null) {
  const mode = getWidget(w.type)?.data.mode;
  if (!mode || mode === 'stats' || mode === 'locations' || mode === 'energy' || w.datasource.kind === 'none') return null;
  if (w.datasource.kind === 'currentDevice' && !device) return null;
  return (
    <ExportMenu
      compact
      label={`Export ${w.title ?? 'widget data'}`}
      request={(format) => ({
        kind: 'widget',
        format,
        params: { title: w.title, datasource: w.datasource, mode, timewindow, deviceId: device?.id },
      })}
    />
  );
}

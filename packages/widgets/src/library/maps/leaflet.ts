import L from 'leaflet';

// leaflet.markercluster extends the global `L`; set it before the plugin loads (imported after this module).
(globalThis as unknown as { L: typeof L }).L = L;

export default L;

#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { runSimulation } from './run.js';

const HELP = `Usage: perspice-sim --url <api> --api-key <pk_…> --mqtt <mqtt://host:1883> --profile <name|id> [options]

  --count <n>           devices to simulate (default 10)
  --interval <s>        seconds between messages per device (default 10)
  --duration <s>        how long to run (default 60)
  --create              provision missing devices (sim-1, sim-2, …) and save their tokens
  --devices-file <f>    where tokens are kept (default ./.sim-devices.json)
  --sleepy              connect, publish and disconnect every interval
  --http                use the HTTP device API instead of MQTT
  --measure-latency     subscribe to ~1% of devices and report publish → websocket latency
  --max-p95-ms <ms>     exit 1 if p95 latency exceeds this (default 2000)
  --report json         print the final report as JSON`;

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    'api-key': { type: 'string' },
    mqtt: { type: 'string' },
    profile: { type: 'string' },
    count: { type: 'string', default: '10' },
    interval: { type: 'string', default: '10' },
    duration: { type: 'string', default: '60' },
    create: { type: 'boolean', default: false },
    'devices-file': { type: 'string', default: './.sim-devices.json' },
    sleepy: { type: 'boolean', default: false },
    http: { type: 'boolean', default: false },
    'measure-latency': { type: 'boolean', default: false },
    'max-p95-ms': { type: 'string', default: '2000' },
    report: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help || !values.url || !values['api-key'] || !values.profile || (!values.mqtt && !values.http)) {
  console.log(HELP);
  process.exit(values.help ? 0 : 64);
}

const report = await runSimulation({
  url: values.url,
  apiKey: values['api-key'],
  mqtt: values.mqtt ?? '',
  profile: values.profile,
  count: Number(values.count),
  intervalS: Number(values.interval),
  durationS: Number(values.duration),
  create: values.create,
  sleepy: values.sleepy,
  http: values.http,
  measureLatency: values['measure-latency'],
  devicesFile: values['devices-file'],
  log: values.report === 'json' ? () => undefined : (l) => console.log(l),
});

if (values.report === 'json') console.log(JSON.stringify(report, null, 2));
else {
  console.log(`\n${report.devices} devices, ${report.sent} messages in ${report.durationS}s (${report.messagesPerSecond} msg/s), ${report.errors} errors`);
  if (report.latencyMs.samples) console.log(`latency p50 ${report.latencyMs.p50} ms, p95 ${report.latencyMs.p95} ms (${report.latencyMs.samples} samples)`);
}
const maxP95 = Number(values['max-p95-ms']);
process.exit(report.latencyMs.p95 !== null && report.latencyMs.p95 > maxP95 ? 1 : report.errors > 0 ? 1 : 0);

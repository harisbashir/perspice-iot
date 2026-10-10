import {
  AttachPolicyCommand,
  CreateKeysAndCertificateCommand,
  CreatePolicyCommand,
  DescribeEndpointCommand,
  GetPolicyCommand,
  IoTClient,
  ResourceNotFoundException,
} from '@aws-sdk/client-iot';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AMAZON_ROOT_CA_URL, devicePolicyDocument } from './iot-provisioning';

export const INGEST_POLICY = 'perspice-ingest';
export const INGEST_FILES = { cert: 'ingest.cert.pem', key: 'ingest.private.key', ca: 'AmazonRootCA1.pem' } as const;

/** The ingest connection: its own client ids, every device topic (shared subscription) and lifecycle events. */
export function ingestPolicyDocument(): string {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: 'iot:Connect', Resource: 'arn:aws:iot:*:*:client/perspice-ingest-*' },
      {
        Effect: 'Allow',
        Action: 'iot:Subscribe',
        Resource: ['arn:aws:iot:*:*:topicfilter/$share/ingest/perspice/v1/*', 'arn:aws:iot:*:*:topicfilter/$share/ingest/$aws/events/presence/*'],
      },
      { Effect: 'Allow', Action: 'iot:Receive', Resource: ['arn:aws:iot:*:*:topic/perspice/v1/*', 'arn:aws:iot:*:*:topic/$aws/events/presence/*'] },
    ],
  });
}

async function ensurePolicy(iot: IoTClient, name: string, document: string): Promise<'created' | 'exists'> {
  try {
    await iot.send(new GetPolicyCommand({ policyName: name }));
    return 'exists';
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException) && (err as Error).name !== 'ResourceNotFoundException') throw err;
  }
  await iot.send(new CreatePolicyCommand({ policyName: name, policyDocument: document }));
  return 'created';
}

export interface SetupIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

/**
 * One-time AWS IoT Core setup (install.sh runs it): endpoint discovery, the device and ingest
 * policies, the ingest certificate and the root CA in `certsDir`. Prints `.env` lines on stdout.
 * Safe to re-run: existing policies and certificate files are kept.
 */
export async function awsIotSetup(opts: { region: string; devicePolicy: string; certsDir: string }, io: SetupIo): Promise<void> {
  const iot = new IoTClient({ region: opts.region });
  const { endpointAddress } = await iot.send(new DescribeEndpointCommand({ endpointType: 'iot:Data-ATS' }));
  io.err(`Endpoint: ${endpointAddress}`);
  io.err(`Device policy ${opts.devicePolicy}: ${await ensurePolicy(iot, opts.devicePolicy, devicePolicyDocument())}`);
  io.err(`Ingest policy ${INGEST_POLICY}: ${await ensurePolicy(iot, INGEST_POLICY, ingestPolicyDocument())}`);

  await mkdir(opts.certsDir, { recursive: true, mode: 0o700 });
  const certFile = join(opts.certsDir, INGEST_FILES.cert);
  const keyFile = join(opts.certsDir, INGEST_FILES.key);
  if (existsSync(certFile) && existsSync(keyFile)) {
    io.err('Ingest certificate: kept');
  } else {
    const cert = await iot.send(new CreateKeysAndCertificateCommand({ setAsActive: true }));
    await iot.send(new AttachPolicyCommand({ policyName: INGEST_POLICY, target: cert.certificateArn }));
    await writeFile(certFile, cert.certificatePem!, { mode: 0o600 });
    await writeFile(keyFile, cert.keyPair!.PrivateKey!, { mode: 0o600 });
    io.err(`Ingest certificate: created (${cert.certificateId})`);
  }
  const caFile = join(opts.certsDir, INGEST_FILES.ca);
  if (!existsSync(caFile)) {
    const res = await fetch(AMAZON_ROOT_CA_URL);
    if (!res.ok) throw new Error(`Could not download the Amazon root CA (HTTP ${res.status})`);
    await writeFile(caFile, await res.text(), { mode: 0o644 });
  }
  io.out('MQTT_TRANSPORT=aws-iot');
  io.out(`AWS_REGION=${opts.region}`);
  io.out(`AWS_IOT_ENDPOINT=${endpointAddress}`);
}

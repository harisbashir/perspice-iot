import { AttachPolicyCommand, CreateKeysAndCertificateCommand, CreatePolicyCommand, DescribeEndpointCommand, GetPolicyCommand, IoTClient, ResourceNotFoundException } from '@aws-sdk/client-iot';
import { mockClient } from 'aws-sdk-client-mock';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { awsIotSetup, ingestPolicyDocument } from '../../src/aws/setup';

const iot = mockClient(IoTClient);

describe('aws-iot-setup', () => {
  beforeEach(() => {
    iot.reset();
    iot.on(DescribeEndpointCommand).resolves({ endpointAddress: 'abc-ats.iot.eu-west-1.amazonaws.com' });
    iot.on(CreateKeysAndCertificateCommand).resolves({ certificateArn: 'arn:cert/ing', certificateId: 'ing', certificatePem: 'CERT', keyPair: { PrivateKey: 'KEY' } });
    iot.on(CreatePolicyCommand).resolves({});
    iot.on(AttachPolicyCommand).resolves({});
    vi.stubGlobal('fetch', vi.fn(async () => new Response('-----BEGIN CERTIFICATE-----\nROOT')));
  });
  afterAll(() => {
    iot.restore();
    vi.unstubAllGlobals();
  });

  it('creates missing policies and the ingest certificate, prints the .env lines, and is safe to re-run', async () => {
    iot.on(GetPolicyCommand).rejects(new ResourceNotFoundException({ message: 'not found', $metadata: {} }));
    const dir = join(mkdtempSync(join(tmpdir(), 'aws-')), 'certs');
    const out: string[] = [];
    await awsIotSetup({ region: 'eu-west-1', devicePolicy: 'perspice-device', certsDir: dir }, { out: (l) => out.push(l), err: () => undefined });
    expect(out).toEqual(['MQTT_TRANSPORT=aws-iot', 'AWS_REGION=eu-west-1', 'AWS_IOT_ENDPOINT=abc-ats.iot.eu-west-1.amazonaws.com']);
    expect(iot.commandCalls(CreatePolicyCommand).map((c) => c.args[0].input.policyName)).toEqual(['perspice-device', 'perspice-ingest']);
    expect(iot.commandCalls(AttachPolicyCommand)[0]!.args[0].input).toEqual({ policyName: 'perspice-ingest', target: 'arn:cert/ing' });
    expect(readFileSync(join(dir, 'ingest.private.key'), 'utf8')).toBe('KEY');
    expect(statSync(join(dir, 'ingest.private.key')).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(dir, 'AmazonRootCA1.pem'), 'utf8')).toContain('ROOT');

    iot.reset();
    iot.on(DescribeEndpointCommand).resolves({ endpointAddress: 'abc-ats.iot.eu-west-1.amazonaws.com' });
    iot.on(GetPolicyCommand).resolves({});
    await awsIotSetup({ region: 'eu-west-1', devicePolicy: 'perspice-device', certsDir: dir }, { out: () => undefined, err: () => undefined });
    expect(iot.commandCalls(CreatePolicyCommand)).toHaveLength(0);
    expect(iot.commandCalls(CreateKeysAndCertificateCommand)).toHaveLength(0);
  });

  it('gives the ingest connection only its own client ids and the shared device and lifecycle topics', () => {
    const doc = JSON.parse(ingestPolicyDocument()) as { Statement: { Action: string; Resource: string | string[] }[] };
    expect(doc.Statement.find((s) => s.Action === 'iot:Connect')!.Resource).toBe('arn:aws:iot:*:*:client/perspice-ingest-*');
    expect(JSON.stringify(doc)).not.toContain('iot:Publish');
  });
});

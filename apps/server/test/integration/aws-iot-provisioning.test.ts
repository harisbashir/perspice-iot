import {
  AttachPolicyCommand,
  AttachThingPrincipalCommand,
  CreateKeysAndCertificateCommand,
  CreateThingCommand,
  DeleteCertificateCommand,
  DeleteThingCommand,
  DetachPolicyCommand,
  DetachThingPrincipalCommand,
  IoTClient,
  UpdateCertificateCommand,
} from '@aws-sdk/client-iot';
import { mockClient } from 'aws-sdk-client-mock';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { devicePolicyDocument } from '../../src/aws/iot-provisioning';
import { device } from '../../src/db/schema';
import { tokenFor } from '../auth-helpers';
import { createUser } from '../factories';
import { type TestApp, createTestApp } from '../harness';

const iot = mockClient(IoTClient);
const AWS = {
  MQTT_TRANSPORT: 'aws-iot',
  AWS_REGION: 'eu-west-1',
  AWS_IOT_ENDPOINT: 'abc123-ats.iot.eu-west-1.amazonaws.com',
  AWS_IOT_CERT_PATH: '/nonexistent/ingest.pem',
  AWS_IOT_KEY_PATH: '/nonexistent/ingest.key',
  AWS_IOT_CA_PATH: '/nonexistent/ca.pem',
};
const KEY = '-----BEGIN RSA PRIVATE KEY-----\nSUPERSECRETKEYMATERIAL\n-----END RSA PRIVATE KEY-----';

describe('AWS IoT Core provisioning (Review Focus 4)', () => {
  let t: TestApp;
  let auth: string;
  let certs = 0;

  beforeAll(async () => {
    t = await createTestApp({ overrides: AWS });
    const p = await createUser(t.db, { roleKey: 'platform_admin' });
    auth = `Bearer ${await tokenFor(t, p.email, p.password)}`;
  });

  beforeEach(() => {
    iot.reset();
    certs = 0;
    iot.onAnyCommand().resolves({});
    iot.on(CreateThingCommand).resolves({});
    iot.on(CreateKeysAndCertificateCommand).callsFake(() => {
      certs++;
      return { certificateArn: `arn:aws:iot:eu-west-1:123456789012:cert/c${certs}`, certificateId: `c${certs}`, certificatePem: `-----BEGIN CERTIFICATE-----\nCERT${certs}`, keyPair: { PrivateKey: KEY } };
    });
    iot.on(AttachPolicyCommand).resolves({});
    iot.on(AttachThingPrincipalCommand).resolves({});
  });

  afterAll(async () => {
    iot.restore();
    await t?.close();
  });

  async function profile() {
    const res = await t.http.post('/api/device-profiles').set('Authorization', auth).send({ name: `AWS ${Date.now()}${Math.random()}`, transport: 'aws-iot' });
    expect(res.status).toBe(201);
    return res.body.id as string;
  }
  const createDevice = (profileId: string) => t.http.post('/api/devices').set('Authorization', auth).send({ name: 'Remote site', profileId });

  it('creates a thing and certificate and returns the bundle once, without storing the key', async () => {
    const res = await createDevice(await profile());
    expect(res.status).toBe(201);
    const id = res.body.device.id as string;
    expect(res.body.awsIot).toEqual({
      endpoint: AWS.AWS_IOT_ENDPOINT,
      clientId: id,
      certificatePem: '-----BEGIN CERTIFICATE-----\nCERT1',
      privateKey: KEY,
      rootCaUrl: 'https://www.amazontrust.com/repository/AmazonRootCA1.pem',
      topicPrefix: `perspice/v1/${id}/`,
    });
    expect(iot.commandCalls(CreateThingCommand)[0]!.args[0].input).toEqual({ thingName: id });
    expect(iot.commandCalls(AttachPolicyCommand)[0]!.args[0].input).toEqual({ policyName: 'perspice-device', target: 'arn:aws:iot:eu-west-1:123456789012:cert/c1' });
    expect(iot.commandCalls(AttachThingPrincipalCommand)[0]!.args[0].input).toEqual({ thingName: id, principal: 'arn:aws:iot:eu-west-1:123456789012:cert/c1' });
    expect((await t.db.query.device.findFirst({ where: eq(device.id, id) }))!.awsCertificateArn).toBe('arn:aws:iot:eu-west-1:123456789012:cert/c1');

    // The key is nowhere in the database (device rows, audit trail, anything else).
    const dump = await t.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM (
        SELECT row_to_json(d)::text AS j FROM device d UNION ALL SELECT row_to_json(a)::text FROM audit_log a
      ) x WHERE j LIKE '%SUPERSECRETKEYMATERIAL%'`);
    expect(dump.rows[0]!.n).toBe(0);
    const again = await t.http.get(`/api/devices/${id}`).set('Authorization', auth);
    expect(JSON.stringify(again.body)).not.toContain('SUPERSECRET');
  });

  it('rotates the certificate, and cleans up thing and certificate on delete', async () => {
    const id = (await createDevice(await profile())).body.device.id as string;
    const rotated = await t.http.post(`/api/devices/${id}/credentials/regenerate`).set('Authorization', auth);
    expect(rotated.status).toBeLessThan(300);
    expect(rotated.body.awsIot.certificatePem).toContain('CERT2');
    expect(iot.commandCalls(UpdateCertificateCommand)[0]!.args[0].input).toEqual({ certificateId: 'c1', newStatus: 'INACTIVE' });
    expect(iot.commandCalls(DeleteCertificateCommand)[0]!.args[0].input).toEqual({ certificateId: 'c1', forceDelete: true });

    expect((await t.http.delete(`/api/devices/${id}`).set('Authorization', auth)).status).toBe(204);
    expect(iot.commandCalls(DetachThingPrincipalCommand).map((c) => c.args[0].input.principal)).toContain('arn:aws:iot:eu-west-1:123456789012:cert/c2');
    expect(iot.commandCalls(DetachPolicyCommand).length).toBeGreaterThanOrEqual(2);
    expect(iot.commandCalls(DeleteCertificateCommand).map((c) => c.args[0].input.certificateId)).toEqual(['c1', 'c2']);
    expect(iot.commandCalls(DeleteThingCommand)[0]!.args[0].input).toEqual({ thingName: id });
  });

  it('does not keep a device AWS refused, and removes what was created', async () => {
    iot.on(AttachPolicyCommand).rejects(new Error('Policy perspice-device not found'));
    const pid = await profile();
    const res = await createDevice(pid);
    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/Policy perspice-device not found/);
    expect(iot.commandCalls(DeleteCertificateCommand)).toHaveLength(1);
    expect(iot.commandCalls(DeleteThingCommand)).toHaveLength(1);
    expect(await t.db.select().from(device).where(eq(device.profileId, pid))).toHaveLength(0);
  });

  it('allows aws-iot profiles only on AWS IoT Core, and no transport switch under existing devices', async () => {
    const pid = await profile();
    await createDevice(pid);
    expect((await t.http.patch(`/api/device-profiles/${pid}`).set('Authorization', auth).send({ transport: 'mqtt' })).status).toBe(409);
    t.config.MQTT_TRANSPORT = 'emqx';
    try {
      const res = await t.http.post('/api/device-profiles').set('Authorization', auth).send({ name: `x${Date.now()}`, transport: 'aws-iot' });
      expect(res.status).toBe(400);
    } finally {
      t.config.MQTT_TRANSPORT = 'aws-iot';
    }
  });

  it('limits each certificate to its own thing and topics', () => {
    const policy = JSON.parse(devicePolicyDocument()) as { Statement: { Action: string | string[]; Resource: string; Condition?: unknown }[] };
    const resources = policy.Statement.map((s) => s.Resource);
    expect(resources).toEqual([
      'arn:aws:iot:*:*:client/${iot:Connection.Thing.ThingName}',
      'arn:aws:iot:*:*:topic/perspice/v1/${iot:Connection.Thing.ThingName}/*',
      'arn:aws:iot:*:*:topicfilter/perspice/v1/${iot:Connection.Thing.ThingName}/*',
    ]);
    expect(policy.Statement[0]!.Condition).toEqual({ Bool: { 'iot:Connection.Thing.IsAttached': 'true' } });
    expect(JSON.stringify(policy)).not.toMatch(/topic\/perspice\/v1\/\+|topic\/\*|"\*"/);
  });
});

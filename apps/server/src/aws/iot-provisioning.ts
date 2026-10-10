import { Inject, Injectable, Logger } from '@nestjs/common';
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
import type { AwsIotBundle } from '@perspice/shared';
import { CONFIG, type Config } from '../config/config';

export const AMAZON_ROOT_CA_URL = 'https://www.amazontrust.com/repository/AmazonRootCA1.pem';

/**
 * The policy every device certificate gets: a thing may connect only with its own name as client
 * id and use only its own `perspice/v1/<thingName>/…` topics (Review Focus 4).
 */
export function devicePolicyDocument(): string {
  const thing = '${iot:Connection.Thing.ThingName}';
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      { Effect: 'Allow', Action: 'iot:Connect', Resource: `arn:aws:iot:*:*:client/${thing}`, Condition: { Bool: { 'iot:Connection.Thing.IsAttached': 'true' } } },
      { Effect: 'Allow', Action: ['iot:Publish', 'iot:Receive'], Resource: `arn:aws:iot:*:*:topic/perspice/v1/${thing}/*` },
      { Effect: 'Allow', Action: 'iot:Subscribe', Resource: `arn:aws:iot:*:*:topicfilter/perspice/v1/${thing}/*` },
    ],
  });
}

/** Things and certificates for devices on aws-iot profiles (spec §5.5). */
@Injectable()
export class AwsIotProvisioning {
  private readonly logger = new Logger(AwsIotProvisioning.name);
  private client?: IoTClient;

  constructor(@Inject(CONFIG) private readonly config: Config) {}

  get enabled(): boolean {
    return this.config.MQTT_TRANSPORT === 'aws-iot';
  }

  private iot(): IoTClient {
    this.client ??= new IoTClient({ region: this.config.AWS_REGION });
    return this.client;
  }

  /** Creates the thing and an active certificate with the device policy. */
  async provision(deviceId: string): Promise<{ certificateArn: string; bundle: AwsIotBundle }> {
    const iot = this.iot();
    await iot.send(new CreateThingCommand({ thingName: deviceId }));
    const cert = await iot.send(new CreateKeysAndCertificateCommand({ setAsActive: true }));
    try {
      await iot.send(new AttachPolicyCommand({ policyName: this.config.AWS_IOT_POLICY_NAME, target: cert.certificateArn }));
      await iot.send(new AttachThingPrincipalCommand({ thingName: deviceId, principal: cert.certificateArn }));
    } catch (err) {
      await this.deleteCertificate(cert.certificateArn!, deviceId).catch(() => undefined);
      await iot.send(new DeleteThingCommand({ thingName: deviceId })).catch(() => undefined);
      throw err;
    }
    return { certificateArn: cert.certificateArn!, bundle: this.bundle(deviceId, cert) };
  }

  /** A new certificate for the thing; the old one stops working. */
  async rotate(deviceId: string, oldArn: string | null): Promise<{ certificateArn: string; bundle: AwsIotBundle }> {
    const iot = this.iot();
    const cert = await iot.send(new CreateKeysAndCertificateCommand({ setAsActive: true }));
    await iot.send(new AttachPolicyCommand({ policyName: this.config.AWS_IOT_POLICY_NAME, target: cert.certificateArn }));
    await iot.send(new AttachThingPrincipalCommand({ thingName: deviceId, principal: cert.certificateArn }));
    if (oldArn) await this.deleteCertificate(oldArn, deviceId);
    return { certificateArn: cert.certificateArn!, bundle: this.bundle(deviceId, cert) };
  }

  private bundle(deviceId: string, cert: { certificatePem?: string; keyPair?: { PrivateKey?: string } }): AwsIotBundle {
    return {
      endpoint: this.config.AWS_IOT_ENDPOINT!,
      clientId: deviceId,
      certificatePem: cert.certificatePem!,
      privateKey: cert.keyPair!.PrivateKey!,
      rootCaUrl: AMAZON_ROOT_CA_URL,
      topicPrefix: `perspice/v1/${deviceId}/`,
    };
  }

  /** Removes the device's certificate and thing (best effort: logs what it could not remove). */
  async deprovision(deviceId: string, arn: string | null): Promise<void> {
    try {
      if (arn) await this.deleteCertificate(arn, deviceId);
      await this.iot().send(new DeleteThingCommand({ thingName: deviceId }));
    } catch (err) {
      this.logger.warn(`Could not remove AWS IoT thing ${deviceId}: ${(err as Error).message}`);
    }
  }

  private async deleteCertificate(arn: string, deviceId: string): Promise<void> {
    const iot = this.iot();
    const certificateId = arn.split('/').pop()!;
    await iot.send(new DetachThingPrincipalCommand({ thingName: deviceId, principal: arn })).catch(() => undefined);
    await iot.send(new DetachPolicyCommand({ policyName: this.config.AWS_IOT_POLICY_NAME, target: arn })).catch(() => undefined);
    await iot.send(new UpdateCertificateCommand({ certificateId, newStatus: 'INACTIVE' }));
    await iot.send(new DeleteCertificateCommand({ certificateId, forceDelete: true }));
  }
}

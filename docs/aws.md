# Running on AWS

Perspice runs on a single EC2 instance like any other server (see [install.md](install.md)). On AWS you can also hand two parts to managed services:

- **Files on S3** (`--storage=s3`): uploaded images, firmware, exports and the backup live in a bucket instead of on the instance's disk.
- **Devices on AWS IoT Core** (`--mqtt=aws-iot`): devices connect to your account's IoT endpoint with a certificate each, instead of to the bundled EMQX broker with a token.

They are independent; use either or both.

```bash
sudo ./install.sh --domain iot.example.com --admin-email ops@example.com \
  --storage=s3 --s3-bucket example-perspice --s3-region eu-west-1 \
  --mqtt=aws-iot
```

Postgres (with TimescaleDB) and Redis stay on the instance. Amazon RDS doesn't offer TimescaleDB; to use a managed database, point `DATABASE_URL` at [Timescale Cloud](https://www.timescale.com/cloud) in `/opt/perspice/.env`. `REDIS_URL` can point at ElastiCache (Redis OSS 7, no cluster mode). For email, use Amazon SES's SMTP interface: `--smtp-host email-smtp.<region>.amazonaws.com --smtp-port 587` with SES SMTP credentials.

## Credentials

Give the instance an **IAM role** (instance profile); the containers pick its credentials up automatically. Outside EC2, export `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` before running the installer; it writes them to `.env` (mode 600).

The role needs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Files",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::example-perspice", "arn:aws:s3:::example-perspice/*"]
    },
    {
      "Sid": "DeviceProvisioning",
      "Effect": "Allow",
      "Action": [
        "iot:CreateThing", "iot:DeleteThing",
        "iot:CreateKeysAndCertificate", "iot:UpdateCertificate", "iot:DeleteCertificate",
        "iot:AttachPolicy", "iot:DetachPolicy",
        "iot:AttachThingPrincipal", "iot:DetachThingPrincipal"
      ],
      "Resource": "*"
    },
    {
      "Sid": "Setup",
      "Effect": "Allow",
      "Action": ["iot:DescribeEndpoint", "iot:GetPolicy", "iot:CreatePolicy"],
      "Resource": "*"
    },
    {
      "Sid": "Commands",
      "Effect": "Allow",
      "Action": "iot:Publish",
      "Resource": "arn:aws:iot:*:*:topic/perspice/v1/*"
    }
  ]
}
```

Keep the bucket private (Block Public Access on). Downloads go through short-lived links signed by the Perspice API, so the bucket never needs a public policy or CORS.

## AWS IoT Core

The installer runs `perspice-server cli aws-iot-setup`, which:

1. looks up your account's data endpoint (`xxxxxxxx-ats.iot.<region>.amazonaws.com`);
2. creates the IoT policies **perspice-device** and **perspice-ingest** if they don't exist;
3. creates the certificate the ingest service connects with, in `/opt/perspice/aws/` (mode 600), with the Amazon root CA;
4. writes `MQTT_TRANSPORT=aws-iot`, `AWS_REGION` and `AWS_IOT_ENDPOINT` to `.env`.

It is safe to run again: it keeps existing policies and certificates. To run it by hand (it writes into `/opt/perspice/aws`, so it runs in a one-off container rather than through `perspice cli`):

```bash
cd /opt/perspice
docker compose -p perspice -f docker-compose.yml -f docker-compose.aws.yml --env-file .env \
  run --rm --no-deps -e MQTT_TRANSPORT=emqx -v /opt/perspice/aws:/etc/perspice/aws \
  api node dist/cli.js aws-iot-setup --certs-dir /etc/perspice/aws --region eu-west-1
```

It prints the `.env` lines to set.

With `MQTT_TRANSPORT=aws-iot`, `perspice` commands include `docker-compose.aws.yml`, which leaves out EMQX and its certificate sync. Ports 1883 and 8883 aren't needed on the instance.

### Devices

Set the device profile's transport to **AWS IoT Core**. (A profile's transport can't change while it has devices.) Creating a device then creates an IoT thing named after the device id, with its own active certificate, and shows once:

- the endpoint and client id (the device id),
- the certificate and private key, as downloads,
- a link to the Amazon root CA.

The private key isn't kept anywhere: download it then. *Regenerate credentials* issues a new certificate and deactivates and deletes the old one, which disconnects the device. Deleting the device removes its certificate and thing.

The device policy lets a certificate connect only as its own thing (`${iot:Connection.Thing.ThingName}`) and use only its own topics, the same `perspice/v1/<device-id>/…` topics as on EMQX ([device-protocol.md](device-protocol.md)): telemetry, attributes and acks up; commands, config and OTA down. The firmware library only changes how it connects: the endpoint on port 8883, client id = device id, the certificate and key instead of a token.

### What changes

- **Presence** follows IoT Core's lifecycle events (`$aws/events/presence/…`), plus the usual inactivity timeout.
- **Commands and shared attributes** are published through the IoT data-plane API. IoT Core keeps retained messages, so a device gets its config when it subscribes.
- **Plain MQTT (1883) and token authentication** aren't available; IoT Core needs TLS with client certificates.
- **The device debug view** shows connects, disconnects and messages as before.

### Costs

IoT Core charges per connection minute and per message (in 5 KB units). As a rough guide in us-east-1 at the time of writing: one device connected all month, sending a reading every 10 seconds, costs about **US$0.30 a month** (≈ 43,800 connection minutes at $0.08 per million, plus ≈ 260,000 messages at $1.00 per million). 1,000 such devices are about $300 a month; EMQX on the instance has no per-message cost. Check the current [AWS IoT Core pricing](https://aws.amazon.com/iot-core/pricing/) for your region. S3 storage and requests are usually small next to that.

## Moving between EMQX and IoT Core

Devices don't move by themselves: their credentials are different (token versus certificate). To switch, create new profiles with the other transport, move devices to them one at a time (re-provisioning each), then change `MQTT_TRANSPORT`. Back up first (see [operations.md](operations.md)).

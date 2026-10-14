Everything the web app does goes through a REST API, so other systems can do it too: read telemetry, create devices, send commands, manage alarms.

## Authentication

- **API keys** (`pk_…`) for integrations: send `Authorization: Bearer pk_…`. A key acts with the permissions it was given, never more than its creator's, within its creator's customer, and can expire (`expiresAt`, milliseconds since 1970). Keys are managed through the API (there is no screen for them yet):

```bash
# Create (the key is shown once)
curl -X POST https://iot.example.com/api/api-keys \
  -H "Authorization: Bearer <session or key>" -H "content-type: application/json" \
  -d '{"name":"ERP sync","permissions":["device.read","telemetry.read"],"expiresAt":1798761600000}'
# List (without secrets) and delete
curl https://iot.example.com/api/api-keys -H "Authorization: Bearer …"
curl -X DELETE https://iot.example.com/api/api-keys/<id> -H "Authorization: Bearer …"
```

- Browser sessions use short-lived access tokens with a refresh cookie; integrations should use API keys.

## Documentation

The full reference (every endpoint with its request and response) is an OpenAPI document. Signed-in users can always download it from `/api/docs/openapi.json` (load it into Postman, Insomnia or a code generator). The interactive Swagger page at `/api/docs` is served only when **Settings → Security → Public API documentation** is on (after a restart), and then without signing in.

## Common calls

| Request | Does |
|---|---|
| `GET /api/devices?profileId=&status=&limit=` | list devices (paged with `cursor`) |
| `GET /api/devices/<id>` | a device with its latest values and attributes |
| `GET /api/devices/<id>/telemetry?keys=a,b&from=&to=&agg=` | history (aggregated for long ranges) |
| `POST /api/devices/<id>/commands` | send a command: `{"name":"gen_start","params":{}}` |
| `POST /api/devices/bulk` | tags, group, assign, command or delete for up to 500 devices |
| `POST /api/devices/import` | CSV import (`?dryRun=true` to check) |
| `GET /api/alarms?status=&severity=&assetId=` | alarms |
| `POST /api/alarms/<id>/ack`, `/clear` | acknowledge, clear |
| `POST /api/exports` | an export (the file, or a job for large ones) |
| `GET /api/assets/tree` | the asset tree with roll-ups |

Errors come back as `{"code":"…","message":"…"}` with a matching HTTP status; validation errors list the fields.

## Events instead of polling

For alarms and status changes, use [webhooks](/help/branding-webhooks) rather than polling the API. Devices themselves use the separate device protocol; see [Connecting devices](/help/connecting-devices).

## Limits

Sign-in attempts, claim codes (10 a minute) and device HTTP requests (60 a minute per device) are rate-limited. Bulk endpoints take up to 500 ids; imports up to 5,000 rows; exports over 50,000 rows run in the background.

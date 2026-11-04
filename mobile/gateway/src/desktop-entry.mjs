export { createGateway } from './server.mjs';
export { hostTls } from './tls.mjs';
export { prepareHostProcessIdentity } from './process-identity.mjs';
export { DeviceStore } from './device-store.mjs';
import QRCode from 'qrcode';
export async function pairingDisplay(gateway, tls, url, name) {
  const pairing = gateway.devices.createPairing();
  const payload = { v: 1, url, fingerprint: tls.fingerprint, hostId: gateway.devices.state.hostId, name, ...pairing };
  const link = 'zyra://pair#' + Buffer.from(JSON.stringify(payload)).toString('base64url');
  return { link, expiresAt: pairing.expiresAt, image: await QRCode.toDataURL(link, { width: 320, margin: 2, errorCorrectionLevel: 'M' }) };
}

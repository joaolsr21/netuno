import { PermissionsAndroid, Platform } from 'react-native';

// Mesmos UUIDs configurados no arquivo esp32-firmware/netuno_esp32.ino
export const NETUNO_DEVICE_NAME       = 'NETUNO_ESP32';
export const SERVICE_UUID             = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
export const CHAR_TELEMETRY_UUID      = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
export const CHAR_COMMAND_UUID        = '826f6405-10a0-42c6-9499-4a18725008b2';
export const CHAR_OFFLINE_SYNC_UUID   = 'd9b26f31-41f3-41c8-95e4-9e73f9e10421';

// Utilitários leves Base64 <-> UTF-8 (padrão exigido pelo react-native-ble-plx)
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

export function encodeBase64(str) {
  const utf8 = unescape(encodeURIComponent(str));
  let output = '';
  for (let i = 0; i < utf8.length; i += 3) {
    const c1 = utf8.charCodeAt(i);
    const c2 = utf8.charCodeAt(i + 1);
    const c3 = utf8.charCodeAt(i + 2);
    const e1 = c1 >> 2;
    const e2 = ((c1 & 3) << 4) | (c2 >> 4);
    const e3 = isNaN(c2) ? 64 : ((c2 & 15) << 2) | (c3 >> 6);
    const e4 = isNaN(c3) ? 64 : c3 & 63;
    output += BASE64_CHARS.charAt(e1) + BASE64_CHARS.charAt(e2) + BASE64_CHARS.charAt(e3) + BASE64_CHARS.charAt(e4);
  }
  return output;
}

export function decodeBase64(input) {
  const clean = input.replace(/[^A-Za-z0-9+/=]/g, '');
  let utf8 = '';
  for (let i = 0; i < clean.length; i += 4) {
    const e1 = BASE64_CHARS.indexOf(clean.charAt(i));
    const e2 = BASE64_CHARS.indexOf(clean.charAt(i + 1));
    const e3 = BASE64_CHARS.indexOf(clean.charAt(i + 2));
    const e4 = BASE64_CHARS.indexOf(clean.charAt(i + 3));
    const c1 = (e1 << 2) | (e2 >> 4);
    const c2 = ((e2 & 15) << 4) | (e3 >> 2);
    const c3 = ((e3 & 3) << 6) | e4;
    utf8 += String.fromCharCode(c1);
    if (e3 !== 64) utf8 += String.fromCharCode(c2);
    if (e4 !== 64) utf8 += String.fromCharCode(c3);
  }
  try {
    return decodeURIComponent(escape(utf8));
  } catch {
    return utf8;
  }
}

class NetunoBleService {
  constructor() {
    this.manager = null;
    this.connectedDevice = null;
  }

  // Inicializa BleManager apenas em build nativo (.APK)
  initManager() {
    if (this.manager) return this.manager;
    try {
      const { BleManager } = require('react-native-ble-plx');
      this.manager = new BleManager();
      return this.manager;
    } catch {
      console.warn('[BLE] Módulo nativo BLE indisponível no Expo Go. Gere o .APK para usar Bluetooth real.');
      return null;
    }
  }

  async requestAndroidPermissions() {
    if (Platform.OS !== 'android') return true;
    if (Platform.Version >= 31) {
      const result = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      return (
        result['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED &&
        result['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED
      );
    }
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  }

  async connectToEsp32({ onTelemetry, onOfflineRecord, onOfflineSyncComplete, onDisconnect }) {
    const manager = this.initManager();
    if (!manager) {
      throw new Error('BLE_NATIVE_UNAVAILABLE');
    }

    const hasPerm = await this.requestAndroidPermissions();
    if (!hasPerm) {
      throw new Error('Permissões de Bluetooth negadas no Android.');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        manager.stopDeviceScan();
        reject(new Error('ESP32 (NETUNO_ESP32) não encontrado por perto via Bluetooth.'));
      }, 10000);

      manager.startDeviceScan([SERVICE_UUID], null, async (error, device) => {
        if (error) {
          clearTimeout(timeout);
          manager.stopDeviceScan();
          reject(error);
          return;
        }

        if (device && (device.name === NETUNO_DEVICE_NAME || device.localName === NETUNO_DEVICE_NAME)) {
          clearTimeout(timeout);
          manager.stopDeviceScan();

          try {
            const connected = await device.connect();
            await connected.discoverAllServicesAndCharacteristics();
            this.connectedDevice = connected;

            connected.onDisconnected(() => {
              this.connectedDevice = null;
              if (onDisconnect) onDisconnect();
            });

            // Escuta telemetria ao vivo via BLE
            connected.monitorCharacteristicForService(
              SERVICE_UUID,
              CHAR_TELEMETRY_UUID,
              (err, characteristic) => {
                if (err || !characteristic?.value) return;
                try {
                  const json = JSON.parse(decodeBase64(characteristic.value));
                  if (onTelemetry) onTelemetry(json);
                } catch {}
              }
            );

            // Escuta fila offline resgatada do LittleFS do ESP32
            connected.monitorCharacteristicForService(
              SERVICE_UUID,
              CHAR_OFFLINE_SYNC_UUID,
              (err, characteristic) => {
                if (err || !characteristic?.value) return;
                const raw = decodeBase64(characteristic.value).trim();
                if (raw === 'EOF') {
                  if (onOfflineSyncComplete) onOfflineSyncComplete();
                  return;
                }
                try {
                  const record = JSON.parse(raw);
                  if (onOfflineRecord) onOfflineRecord(record);
                } catch {}
              }
            );

            resolve(connected);
          } catch (connErr) {
            reject(connErr);
          }
        }
      });
    });
  }

  async sendCommand(commandStr) {
    if (!this.connectedDevice) return false;
    const encoded = encodeBase64(commandStr);
    await this.connectedDevice.writeCharacteristicWithResponseForService(
      SERVICE_UUID,
      CHAR_COMMAND_UUID,
      encoded
    );
    return true;
  }

  async disconnect() {
    if (this.connectedDevice) {
      await this.connectedDevice.cancelConnection();
      this.connectedDevice = null;
    }
  }
}

export const bleService = new NetunoBleService();

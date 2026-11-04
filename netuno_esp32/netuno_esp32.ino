/**
 * ============================================================================
 * NETUNO — FIRMWARE DO ESP32 (Wi-Fi + Supabase + LCD 16x2 + DS18B20 + BLE)
 * ============================================================================
 * Dimensionamento do Aquário: 25 cm (C) x 13 cm (L) x 18 cm (A) (~5.85 Litros)
 *
 * Arquitetura Híbrida Offline-First:
 * 1. Sensor Ultrassônico HC-SR04 (GPIO 5/18) -> mede nível da água (cm, % e Litros)
 * 2. Sensor de Temperatura DS18B20 (GPIO 15) -> mede temperatura da água (°C)
 * 3. Display LCD 16x2 I2C (GPIO 21/22, 0x27) -> exibe Nível, Distância, Temp e Wi-Fi
 * 4. [FUTURO] Módulo Relé -> Bomba de Oxigênio (desativado nos testes atuais)
 * 5. [FUTURO] Motor de Passo -> Alimentador Automático (substituirá o servo)
 * 6. Wi-Fi Online -> envia status/telemetria e lê comandos em tempo real do Supabase
 * 7. Sem Wi-Fi -> salva eventos na Flash interna (/offline_queue.jsonl via LittleFS)
 * 8. Bluetooth Low Energy (BLE) -> comunicação direta com o .APK Android
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <time.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// ===================== CONFIGURAÇÕES DE REDE & SUPABASE =====================
const char* WIFI_SSID     = "Iphone de JL";
const char* WIFI_PASSWORD = "12345678";

const char* SUPABASE_URL  = "https://bcdwgmhhrptygaarocjy.supabase.co";
const char* SUPABASE_KEY  = "sb_publishable_3C-PPYFJNBrzQ1msagDQAQ_1EQm7GUa";

// ===================== PINAGEM DO HARDWARE (ESP32) ==========================
#define PIN_LCD_SDA     21   // Display LCD 16x2 I2C (SDA)
#define PIN_LCD_SCL     22   // Display LCD 16x2 I2C (SCL)
#define PIN_TRIG        5    // Sensor Ultrassônico HC-SR04 (Trigger)
#define PIN_ECHO        18   // Sensor Ultrassônico HC-SR04 (Echo)
#define PIN_ONEWIRE     15   // Sensor de Temperatura DS18B20 (OneWire)
// #define PIN_RELAY_PUMP  26   // [FUTURO] Módulo Relé da Bomba de Oxigênio
// [FUTURO] Definir portas do Motor de Passo (Alimentador Automático)

// ===================== INSTÂNCIAS DE HARDWARE ===============================
LiquidCrystal_I2C lcd(0x27, 16, 2); // Endereço I2C 0x27, 16 colunas x 2 linhas
OneWire oneWire(PIN_ONEWIRE);
DallasTemperature tempSensor(&oneWire);

// ===================== MEDIDAS DO AQUÁRIO (25 x 13 x 18 cm) =================
const float TANK_LENGTH_CM   = 25.0; // Comprimento do aquário em cm
const float TANK_WIDTH_CM    = 13.0; // Largura do aquário em cm
const float TANK_HEIGHT_CM   = 18.0; // Altura total do aquário em cm
const float SENSOR_OFFSET_CM = 2.0;  // Margem do sensor no topo até o nível 100% (16 cm de coluna máxima)

// ===================== UUIDs DO BLUETOOTH (BLE) PARA O .APK =================
#define SERVICE_UUID            "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHAR_TELEMETRY_UUID     "beb5483e-36e1-4688-b7f5-ea07361b26a8" // Read / Notify (Estado ao vivo)
#define CHAR_COMMAND_UUID       "826f6405-10a0-42c6-9499-4a18725008b2" // Write (Comandos vindos do .APK)
#define CHAR_OFFLINE_SYNC_UUID  "d9b26f31-41f3-41c8-95e4-9e73f9e10421" // Notify (Transfere fila offline p/ .APK)

// ===================== ESTADO ATUAL DO SISTEMA ==============================
int    waterLevelPct      = 85;
float  distanceCm         = 4.4;  // Distância inicial p/ 85% em aquário de 18cm
float  waterVolumeL       = 4.42; // Volume estimado em Litros
float  temperatureC       = 26.0; // Temperatura medida pelo DS18B20 (°C)
bool   pumpRelayOn        = true;
String pumpMode           = "auto";
bool   bleClientConnected = false;
int    offlineQueuedCount = 0;

BLECharacteristic* pTelemetryChar   = nullptr;
BLECharacteristic* pOfflineSyncChar = nullptr;

const char* OFFLINE_QUEUE_FILE = "/offline_queue.jsonl";

// ============================================================================
// UTILITÁRIO DE DATA/HORA ISO-8601 (NTP + RTC INTERNO DO ESP32)
// ============================================================================
String getCurrentIsoTimestamp() {
  struct tm timeinfo;
  if (getLocalTime(&timeinfo, 10)) {
    char buf[30];
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
    return String(buf);
  }
  return ""; // Se nunca sincronizou NTP, o Supabase usará DEFAULT NOW()
}

// ============================================================================
// 1. LEITURA DOS SENSORES (HC-SR04 + DS18B20) E ATUALIZAÇÃO DO LCD 16x2
// ============================================================================
void readWaterLevel() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  long duration = pulseIn(PIN_ECHO, HIGH, 30000); // Timeout 30ms
  if (duration > 0) {
    float measuredCm = (duration * 0.0343) / 2.0;
    // Filtra leituras dentro da faixa física do aquário (18 cm)
    distanceCm = constrain(measuredCm, 0.5, TANK_HEIGHT_CM);

    float maxColumn   = TANK_HEIGHT_CM - SENSOR_OFFSET_CM; // 16.0 cm (100%)
    float waterColumn = constrain(TANK_HEIGHT_CM - distanceCm, 0.0f, maxColumn);

    int pct = round((waterColumn / maxColumn) * 100.0);
    waterLevelPct = constrain(pct, 0, 100);
    waterVolumeL  = (TANK_LENGTH_CM * TANK_WIDTH_CM * waterColumn) / 1000.0;
  }

  // Proteção automática: desliga o relé se a água baixar para nível crítico (<30%)
  if (waterLevelPct < 30 && pumpRelayOn) {
    pumpRelayOn = false;
    // digitalWrite(PIN_RELAY_PUMP, LOW); // [FUTURO] Relé desativado
    Serial.println("[ALERTA] Nível crítico (<30%)! Relé da bomba desligado por segurança.");
  }
}

void readTemperature() {
  tempSensor.requestTemperatures();
  float t = tempSensor.getTempCByIndex(0);

  // Verifica se o sensor DS18B20 respondeu corretamente (-127 = desconectado)
  if (t != DEVICE_DISCONNECTED_C && t > -40.0 && t < 85.0) {
    temperatureC = t;
  } else {
    Serial.println("[AVISO] Sensor DS18B20 na porta 15 não detectado ou leitura inválida.");
  }
}

void updateLCD() {
  char line0[17];
  char line1[17];

  // Linha 0 (16 col): Ex: "Agua: 85%  4.4cm"
  snprintf(line0, sizeof(line0), "Agua:%3d%% %4.1fcm", waterLevelPct, distanceCm);
  // Linha 1 (16 col): Ex: "Temp:26.0C WiFi+"
  snprintf(
    line1,
    sizeof(line1),
    "Temp:%4.1fC %s",
    temperatureC,
    (WiFi.status() == WL_CONNECTED) ? "WiFi+" : "Offln"
  );

  lcd.setCursor(0, 0);
  lcd.print(line0);
  lcd.setCursor(0, 1);
  lcd.print(line1);
}

// ============================================================================
// 2. ACIONAMENTO DO ALIMENTADOR AUTOMÁTICO (MOTOR DE PASSO — FUTURO)
// ============================================================================
void saveOrSendLog(String eventType, String message, String source);

void triggerFeeder(String portion, String origin) {
  Serial.println("[NETUNO] Acionando alimentador (" + portion + ") via " + origin);

  // [FUTURO] Implementar acionamento do Motor de Passo aqui

  saveOrSendLog("feeder", "Alimentador acionado (" + portion + ")", origin);
}

// ============================================================================
// 3. FILA OFFLINE (LittleFS) — GUARDA INFORMAÇÕES QUANDO A INTERNET CAI
// ============================================================================
void saveToOfflineQueue(String eventType, String message) {
  File file = LittleFS.open(OFFLINE_QUEUE_FILE, FILE_APPEND);
  if (!file) {
    Serial.println("[ERRO] Falha ao abrir /offline_queue.jsonl");
    return;
  }

  String isoTime = getCurrentIsoTimestamp();
  String jsonLine = "{\"event_type\":\"" + eventType + "\","
                    "\"water_level_pct\":" + String(waterLevelPct) + ","
                    "\"distance_cm\":" + String(distanceCm, 1) + ","
                    "\"temperature_c\":" + String(temperatureC, 1) + ","
                    "\"message\":\"" + message + "\","
                    "\"source\":\"Fila Offline ESP32\"";
  if (isoTime.length() > 0) {
    jsonLine += ",\"recorded_at\":\"" + isoTime + "\"";
  }
  jsonLine += "}\n";

  file.print(jsonLine);
  file.close();
  offlineQueuedCount++;
  Serial.println("[OFFLINE] Salvo na memória do ESP32 (" + String(offlineQueuedCount) + "): " + jsonLine);
}

void saveOrSendLog(String eventType, String message, String source) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    String endpoint = String(SUPABASE_URL) + "/rest/v1/telemetry_logs";
    http.begin(endpoint);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("apikey", SUPABASE_KEY);
    http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);

    String payload = "{\"event_type\":\"" + eventType + "\","
                     "\"water_level_pct\":" + String(waterLevelPct) + ","
                     "\"distance_cm\":" + String(distanceCm, 1) + ","
                     "\"temperature_c\":" + String(temperatureC, 1) + ","
                     "\"message\":\"" + message + "\","
                     "\"source\":\"" + source + "\"}";

    int code = http.POST(payload);
    http.end();
    if (code >= 200 && code < 300) return;
  }

  // Se não tiver Wi-Fi ou se o POST falhar, salva na memória interna
  saveToOfflineQueue(eventType, message);
}

// ============================================================================
// 4. SINCRONIZAÇÃO WI-FI COM O SUPABASE (IDA E VOLTA)
// ============================================================================
void flushOfflineQueueToSupabase() {
  if (WiFi.status() != WL_CONNECTED || !LittleFS.exists(OFFLINE_QUEUE_FILE)) return;

  File file = LittleFS.open(OFFLINE_QUEUE_FILE, FILE_READ);
  if (!file || file.size() == 0) {
    if (file) file.close();
    return;
  }

  Serial.println("[SYNC] Internet voltou! Reenviando fila offline ao Supabase...");
  HTTPClient http;
  String endpoint = String(SUPABASE_URL) + "/rest/v1/telemetry_logs";
  bool allSent = true;

  while (file.available()) {
    String line = file.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) continue;

    http.begin(endpoint);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("apikey", SUPABASE_KEY);
    http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
    int code = http.POST(line);
    http.end();

    if (code < 200 || code >= 300) {
      allSent = false;
      break;
    }
  }

  file.close();
  if (allSent) {
    LittleFS.remove(OFFLINE_QUEUE_FILE);
    offlineQueuedCount = 0;
    Serial.println("[SYNC] Todos os registros offline foram sincronizados com o Supabase!");
  }
}

void pollCommandsFromSupabase() {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  String endpoint = String(SUPABASE_URL) + "/rest/v1/aquarium_status?id=eq.1&select=pump_relay_on,pump_mode,feed_now_command,feed_now_portion";
  http.begin(endpoint);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);

  int httpCode = http.GET();
  if (httpCode == 200) {
    String body = http.getString();

    // Verifica se o usuário pediu "Alimentar Agora" pelo Site ou pelo .APK
    if (body.indexOf("\"feed_now_command\":true") >= 0) {
      String portion = "Padrão (5g)";
      if (body.indexOf("3g") >= 0) portion = "Leve (3g)";
      else if (body.indexOf("8g") >= 0) portion = "Generosa (8g)";

      triggerFeeder(portion, "Comando Nuvem Supabase");

      // Limpa a flag feed_now_command no Supabase
      HTTPClient resetHttp;
      resetHttp.begin(String(SUPABASE_URL) + "/rest/v1/aquarium_status?id=eq.1");
      resetHttp.addHeader("Content-Type", "application/json");
      resetHttp.addHeader("apikey", SUPABASE_KEY);
      resetHttp.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);
      resetHttp.PATCH("{\"feed_now_command\":false}");
      resetHttp.end();
    }

    // Sincroniza estado do Relé da Bomba se nível da água permitir (>=30%)
    if (waterLevelPct >= 30) {
      bool cloudPumpOn = (body.indexOf("\"pump_relay_on\":true") >= 0);
      if (cloudPumpOn != pumpRelayOn) {
        pumpRelayOn = cloudPumpOn;
        // digitalWrite(PIN_RELAY_PUMP, pumpRelayOn ? HIGH : LOW); // [FUTURO] Relé desativado
      }
    }
  }
  http.end();
}

bool sendStatusToSupabase() {
  if (WiFi.status() != WL_CONNECTED) return false;

  HTTPClient http;
  String endpoint = String(SUPABASE_URL) + "/rest/v1/aquarium_status?id=eq.1";
  http.begin(endpoint);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_KEY);

  String isoNow = getCurrentIsoTimestamp();
  String payload = "{\"water_level_pct\":" + String(waterLevelPct) + ","
                   "\"distance_cm\":" + String(distanceCm, 1) + ","
                   "\"temperature_c\":" + String(temperatureC, 1) + ","
                   "\"pump_relay_on\":" + String(pumpRelayOn ? "true" : "false") + ","
                   "\"wifi_rssi\":" + String(WiFi.RSSI());
  if (isoNow.length() > 0) {
    payload += ",\"esp_last_seen\":\"" + isoNow + "\"";
  }
  payload += "}";

  int httpCode = http.PATCH(payload);
  http.end();
  return (httpCode >= 200 && httpCode < 300);
}

// ============================================================================
// 5. BLUETOOTH LOW ENERGY (BLE) — MODO DIRETO E RESGATE DE FILA PELO .APK
// ============================================================================
void sendOfflineQueueOverBLE() {
  if (!bleClientConnected || pOfflineSyncChar == nullptr || !LittleFS.exists(OFFLINE_QUEUE_FILE)) return;

  File file = LittleFS.open(OFFLINE_QUEUE_FILE, FILE_READ);
  if (!file) return;

  Serial.println("[BLE] Transferindo fila offline para o .APK via Bluetooth...");
  while (file.available()) {
    String line = file.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) continue;

    pOfflineSyncChar->setValue(line.c_str());
    pOfflineSyncChar->notify();
    delay(60); // Intervalo seguro para pacotes BLE MTU
  }
  file.close();

  pOfflineSyncChar->setValue("EOF");
  pOfflineSyncChar->notify();
}

class NetunoServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) override {
    bleClientConnected = true;
    Serial.println("[BLE] .APK Android conectado ao ESP32!");
  }
  void onDisconnect(BLEServer* pServer) override {
    bleClientConnected = false;
    Serial.println("[BLE] .APK desconectado. Retomando anúncio BLE...");
    BLEDevice::startAdvertising();
  }
};

class NetunoCommandCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) override {
    String cmd = pCharacteristic->getValue().c_str();
    cmd.trim();
    Serial.println("[BLE] Comando recebido do .APK: " + cmd);

    if (cmd == "PUMP_TOGGLE") {
      pumpRelayOn = !pumpRelayOn;
      // digitalWrite(PIN_RELAY_PUMP, pumpRelayOn ? HIGH : LOW); // [FUTURO] Relé desativado
      saveOrSendLog("pump", String("Relé ") + (pumpRelayOn ? "LIGADO" : "DESLIGADO") + " via Bluetooth", "Bluetooth APK");
    } else if (cmd == "PUMP_ON") {
      pumpRelayOn = true;
      // digitalWrite(PIN_RELAY_PUMP, HIGH); // [FUTURO] Relé desativado
    } else if (cmd == "PUMP_OFF") {
      pumpRelayOn = false;
      // digitalWrite(PIN_RELAY_PUMP, LOW); // [FUTURO] Relé desativado
    } else if (cmd == "MODE_AUTO") {
      pumpMode = "auto";
    } else if (cmd == "MODE_MANUAL") {
      pumpMode = "manual";
    } else if (cmd.startsWith("FEED:")) {
      String portion = cmd.substring(5);
      triggerFeeder(portion, "Bluetooth APK");
    } else if (cmd == "SYNC_OFFLINE") {
      sendOfflineQueueOverBLE();
    } else if (cmd == "CLEAR_OFFLINE") {
      LittleFS.remove(OFFLINE_QUEUE_FILE);
      offlineQueuedCount = 0;
      Serial.println("[BLE] Fila offline limpa após confirmação do .APK!");
    }
  }
};

void setupBLE() {
  BLEDevice::init("NETUNO_ESP32");
  BLEServer* pServer = BLEDevice::createServer();
  pServer->setCallbacks(new NetunoServerCallbacks());

  BLEService* pService = pServer->createService(SERVICE_UUID);

  // Característica 1: Telemetria em Tempo Real
  pTelemetryChar = pService->createCharacteristic(
    CHAR_TELEMETRY_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  pTelemetryChar->addDescriptor(new BLE2902());

  // Característica 2: Comandos enviados pelo .APK
  BLECharacteristic* pCommandChar = pService->createCharacteristic(
    CHAR_COMMAND_UUID,
    BLECharacteristic::PROPERTY_WRITE
  );
  pCommandChar->setCallbacks(new NetunoCommandCallbacks());

  // Característica 3: Transferência da Fila Offline para o .APK
  pOfflineSyncChar = pService->createCharacteristic(
    CHAR_OFFLINE_SYNC_UUID,
    BLECharacteristic::PROPERTY_NOTIFY
  );
  pOfflineSyncChar->addDescriptor(new BLE2902());

  pService->start();
  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  BLEDevice::startAdvertising();
}

void notifyBLEClient() {
  if (!bleClientConnected || pTelemetryChar == nullptr) return;

  String blePayload = "{\"water_level_pct\":" + String(waterLevelPct) + ","
                      "\"distance_cm\":" + String(distanceCm, 1) + ","
                      "\"temperature_c\":" + String(temperatureC, 1) + ","
                      "\"pump_relay_on\":" + String(pumpRelayOn ? "true" : "false") + ","
                      "\"pump_mode\":\"" + pumpMode + "\","
                      "\"wifi_online\":" + String(WiFi.status() == WL_CONNECTED ? "true" : "false") + ","
                      "\"offline_count\":" + String(offlineQueuedCount) + "}";

  pTelemetryChar->setValue(blePayload.c_str());
  pTelemetryChar->notify();
}

// ============================================================================
// SETUP & LOOP PRINCIPAL
// ============================================================================
unsigned long lastCycleMs      = 0;
unsigned long lastOfflineLogMs = 0;

void setup() {
  Serial.begin(115200);

  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  // pinMode(PIN_RELAY_PUMP, OUTPUT); // [FUTURO] Relé desativado
  // [FUTURO] Configurar pinos do Motor de Passo aqui

  // Inicializa barramento I2C (SDA=21, SCL=22), Display LCD 16x2 (0x27) e Sensor DS18B20 (GPIO 15)
  Wire.begin(PIN_LCD_SDA, PIN_LCD_SCL);
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("NETUNO AQUARIUM ");
  lcd.setCursor(0, 1);
  lcd.print("25x13x18cm Init.");

  tempSensor.begin();

  // Inicializa memória Flash interna (LittleFS)
  if (!LittleFS.begin(true)) {
    Serial.println("[ERRO] Falha ao montar LittleFS");
  }

  // Inicializa Bluetooth (BLE) para o .APK
  setupBLE();

  // Tenta conexão inicial Wi-Fi (não trava caso esteja sem internet)
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WIFI] Conectando");
  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 12) {
    delay(500);
    Serial.print(".");
    retries++;
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    configTime(-3 * 3600, 0, "pool.ntp.org", "time.nist.gov");
    Serial.println("[WIFI] Conectado! IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("[WIFI] Sem internet no momento. Operando em Modo Offline + Bluetooth BLE.");
  }

  // Primeira leitura imediata para atualizar o LCD logo ao ligar
  readWaterLevel();
  readTemperature();
  updateLCD();
}

void loop() {
  unsigned long now = millis();

  // Ciclo principal a cada 4 segundos
  if (now - lastCycleMs >= 4000) {
    lastCycleMs = now;

    // 1. Lê o sensor ultrassônico (HC-SR04) e o sensor de temperatura (DS18B20)
    readWaterLevel();
    readTemperature();

    // 2. Atualiza o Display LCD 16x2
    updateLCD();

    Serial.printf(
      "[NETUNO] Agua: %d%% (Dist: %.1f cm | Vol: %.2f L) | Temp: %.1f C\n",
      waterLevelPct,
      distanceCm,
      waterVolumeL,
      temperatureC
    );

    // 3. Verifica estado do Wi-Fi
    if (WiFi.status() == WL_CONNECTED) {
      flushOfflineQueueToSupabase();
      pollCommandsFromSupabase();
      sendStatusToSupabase();
    } else {
      // Tenta reconectar em background sem travar o aquário
      WiFi.reconnect();

      // Salva ponto de histórico na memória interna a cada 60 segundos enquanto estiver offline
      if (now - lastOfflineLogMs >= 60000 || lastOfflineLogMs == 0) {
        lastOfflineLogMs = now;
        saveToOfflineQueue(
          "sensor",
          "Leitura offline: " + String(waterLevelPct) + "% (" + String(distanceCm, 1) + " cm) | Temp: " + String(temperatureC, 1) + " C"
        );
      }
    }

    // 4. Atualiza o .APK via Bluetooth caso o celular esteja conectado
    notifyBLEClient();
  }
}

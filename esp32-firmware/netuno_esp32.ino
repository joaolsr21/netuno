/**
 * ============================================================================
 * NETUNO — FIRMWARE BASE DO ESP32 (Wi-Fi + Supabase + Buffer Offline + BLE)
 * ============================================================================
 * Arquitetura Híbrida Offline-First:
 * 1. Sensor Ultrassônico HC-SR04 -> mede nível da água (cm e %)
 * 2. Módulo Relé -> controla a Bomba de Oxigênio (Manual / Auto + Proteção <30%)
 * 3. Servo Motor -> aciona o Alimentador Automático
 * 4. Wi-Fi Online -> envia status/telemetria e lê comandos em tempo real do Supabase
 * 5. Sem Wi-Fi -> salva eventos na Flash interna (/offline_queue.jsonl via LittleFS)
 *    e reenvia tudo automaticamente ao Supabase assim que o Wi-Fi voltar
 * 6. Bluetooth Low Energy (BLE) -> permite ao .APK Android controlar o aquário
 *    sem Wi-Fi e resgatar a fila offline pelo celular (4G/5G -> Supabase)
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <time.h>

// ===================== CONFIGURAÇÕES DE REDE & SUPABASE =====================
const char* WIFI_SSID     = "SEU_WIFI_AQUI";
const char* WIFI_PASSWORD = "SUA_SENHA_AQUI";

const char* SUPABASE_URL  = "https://SEU_PROJETO.supabase.co";
const char* SUPABASE_KEY  = "SUA_ANON_KEY_DO_SUPABASE";

// ===================== PINAGEM DO HARDWARE (ESP32) ==========================
#define PIN_TRIG        5    // Sensor Ultrassônico HC-SR04 (Trigger)
#define PIN_ECHO        18   // Sensor Ultrassônico HC-SR04 (Echo)
#define PIN_RELAY_PUMP  26   // Módulo Relé da Bomba de Oxigênio
#define PIN_SERVO_FEED  14   // Servo Motor do Alimentador Automático

// ===================== MEDIDAS DO AQUÁRIO ===================================
const float TANK_HEIGHT_CM   = 40.0; // Altura total do aquário em cm
const float SENSOR_OFFSET_CM = 2.0;  // Margem do sensor até o nível 100%

// ===================== UUIDs DO BLUETOOTH (BLE) PARA O .APK =================
#define SERVICE_UUID            "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHAR_TELEMETRY_UUID     "beb5483e-36e1-4688-b7f5-ea07361b26a8" // Read / Notify (Estado ao vivo)
#define CHAR_COMMAND_UUID       "826f6405-10a0-42c6-9499-4a18725008b2" // Write (Comandos vindos do .APK)
#define CHAR_OFFLINE_SYNC_UUID  "d9b26f31-41f3-41c8-95e4-9e73f9e10421" // Notify (Transfere fila offline p/ .APK)

// ===================== ESTADO ATUAL DO SISTEMA ==============================
int    waterLevelPct      = 85;
float  distanceCm         = 8.1;
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
// 1. LEITURA DO SENSOR ULTRASSÔNICO (HC-SR04)
// ============================================================================
void readWaterLevel() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);

  long duration = pulseIn(PIN_ECHO, HIGH, 30000); // Timeout 30ms
  if (duration > 0) {
    distanceCm = (duration * 0.0343) / 2.0;
    float waterColumn = TANK_HEIGHT_CM - distanceCm;
    float maxColumn   = TANK_HEIGHT_CM - SENSOR_OFFSET_CM;
    int pct = round((waterColumn / maxColumn) * 100.0);
    waterLevelPct = constrain(pct, 0, 100);
  }

  // Proteção automática: desliga o relé se a água baixar para nível crítico (<30%)
  if (waterLevelPct < 30 && pumpRelayOn) {
    pumpRelayOn = false;
    digitalWrite(PIN_RELAY_PUMP, LOW);
    Serial.println("[ALERTA] Nível crítico (<30%)! Relé da bomba desligado por segurança.");
  }
}

// ============================================================================
// 2. ACIONAMENTO DO ALIMENTADOR AUTOMÁTICO (SERVO)
// ============================================================================
void saveOrSendLog(String eventType, String message, String source);

void triggerFeeder(String portion, String origin) {
  Serial.println("[NETUNO] Acionando alimentador (" + portion + ") via " + origin);

  int openDurationMs = 800; // Padrão (5g)
  if (portion.indexOf("3g") >= 0) openDurationMs = 500;
  else if (portion.indexOf("8g") >= 0) openDurationMs = 1200;

  // Base PWM / Pino digital (substituir por ESP32Servo.write() na calibração mecânica)
  digitalWrite(PIN_SERVO_FEED, HIGH);
  delay(openDurationMs);
  digitalWrite(PIN_SERVO_FEED, LOW);

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
        digitalWrite(PIN_RELAY_PUMP, pumpRelayOn ? HIGH : LOW);
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
      digitalWrite(PIN_RELAY_PUMP, pumpRelayOn ? HIGH : LOW);
      saveOrSendLog("pump", String("Relé ") + (pumpRelayOn ? "LIGADO" : "DESLIGADO") + " via Bluetooth", "Bluetooth APK");
    } else if (cmd == "PUMP_ON") {
      pumpRelayOn = true;
      digitalWrite(PIN_RELAY_PUMP, HIGH);
    } else if (cmd == "PUMP_OFF") {
      pumpRelayOn = false;
      digitalWrite(PIN_RELAY_PUMP, LOW);
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
  pinMode(PIN_RELAY_PUMP, OUTPUT);
  pinMode(PIN_SERVO_FEED, OUTPUT);
  digitalWrite(PIN_RELAY_PUMP, pumpRelayOn ? HIGH : LOW);

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
}

void loop() {
  unsigned long now = millis();

  // Ciclo principal a cada 4 segundos
  if (now - lastCycleMs >= 4000) {
    lastCycleMs = now;

    // 1. Lê o sensor ultrassônico
    readWaterLevel();

    // 2. Verifica estado do Wi-Fi
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
          "Leitura salva offline: " + String(waterLevelPct) + "% (" + String(distanceCm, 1) + " cm)"
        );
      }
    }

    // 3. Atualiza o .APK via Bluetooth caso o celular esteja conectado
    notifyBLEClient();
  }
}
